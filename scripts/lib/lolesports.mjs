// lolesports.com feed (unofficial). Used for the ~15-min snapshot for every game.
//
// Two hosts:
//   esports-api.lolesports.com/persisted/gw/<op>  -> schedule + match details (needs x-api-key header)
//   feed.lolesports.com/livestats/v1/window/<gameId>  -> in-game stats (no key)
//
// The key below is public: it's embedded in lolesports.com itself.

import { WINDOW_START } from '../config.mjs';

const GW = 'https://esports-api.lolesports.com/persisted/gw';
const FEED = 'https://feed.lolesports.com/livestats/v1';
const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

async function gwRequest(op, params = {}) {
  const query = new URLSearchParams({ hl: 'en-US', ...params });
  const res = await fetch(`${GW}/${op}?${query}`, { headers: { 'x-api-key': API_KEY } });
  if (!res.ok) throw new Error(`lolesports ${op} failed: ${res.status}`);
  return (await res.json()).data;
}

/**
 * Get all leagues as { [slug]: leagueId }.
 */
export async function getLeagues() {
  const { leagues } = await gwRequest('getLeagues');
  return Object.fromEntries(leagues.map((l) => [l.slug, l.id]));
}

/**
 * Get completed matches (series) for one league since WINDOW_START.
 * Returns [{ matchId, startTime, codes: ['GEN', 'T1'] }]
 */
export async function getCompletedMatches(leagueId) {
  const matches = [];
  let pageToken;

  // Schedule pages go oldest -> newest within a page; `pages.older` steps back in time
  for (;;) {
    const { schedule } = await gwRequest('getSchedule', pageToken ? { leagueId, pageToken } : { leagueId });
    for (const e of schedule.events) {
      if (e.type !== 'match' || e.state !== 'completed' || e.startTime < WINDOW_START) continue;
      matches.push({
        matchId: e.match.id,
        startTime: e.startTime,
        codes: e.match.teams.map((t) => t.code),
      });
    }
    const oldest = schedule.events[0]?.startTime;
    if (!schedule.pages.older || !oldest || oldest < WINDOW_START) break;
    pageToken = schedule.pages.older;
  }
  return matches;
}

/**
 * Get the games inside one match (series).
 * Returns { teams: { [teamId]: code }, games: [{ number, gameId }] } (completed games only)
 */
export async function getMatchGames(matchId) {
  const { event } = await gwRequest('getEventDetails', { id: matchId });
  return {
    teams: Object.fromEntries(event.match.teams.map((t) => [t.id, t.code])),
    games: event.match.games
      .filter((g) => g.state === 'completed')
      .map((g) => ({ number: g.number, gameId: g.id })),
  };
}

// The feed only accepts start times on a 10-second boundary with 0 ms
function toFeedTime(ms) {
  const d = new Date(Math.floor(ms / 10_000) * 10_000);
  return d.toISOString().replace('.000Z', 'Z');
}

async function getWindow(gameId, startingTime) {
  const url = `${FEED}/window/${gameId}${startingTime ? `?startingTime=${startingTime}` : ''}`;
  const res = await fetch(url);
  if (res.status !== 200) return null; // 204/404 = no data for this game
  return res.json();
}

/**
 * Get the ~15-min snapshot for one game.
 * Returns { blueTeamId, redTeamId, blue, red } or null if the feed has no data.
 * blue/red = { gold, kills, towers, inhibitors, barons, dragons: [...types], players: [...] }
 * players  = [{ role, champion, gold, level, cs, kills, deaths, assists }]
 *
 * "Minute 15" = 15 min after the feed's first in-game frame. No XP in the feed, only level.
 *
 * The feed only has wall-clock time, so pauses and early-starting feeds can make that snapshot
 * land before 15:00 in-game. If combined CS looks too low, we measure the lost time directly:
 * (feed time from start to end) - (real game length from Leaguepedia) = pauses + loading.
 *  - Almost no lost time: it's just a bloody game (fighting instead of farming). Keep 15:00.
 *  - Real lost time: move forward until CS reaches the normal 15:00 level, but never further
 *    than the lost time (so a low-CS game can't be pushed past 15:00).
 */
export const CS_AT_15 = 1099; // median combined CS (both teams) at 15:00, from 581 clean snapshots
const CS_TOO_EARLY = 950; // clean snapshots almost never go below ~1,000
const MIN_LOST_MS = 20_000; // under this much pause/loading time, the original 15:00 snapshot stands
const MAX_FRAME_GAP_MS = 30_000; // feed has gaps: a frame this far from the asked-for time isn't trusted
export const CLOCK_VERSION = 2; // bump when the clock logic changes, so old snapshots get re-checked

const combinedCs = (frame) =>
  [...frame.blueTeam.participants, ...frame.redTeam.participants].reduce((sum, p) => sum + p.creepScore, 0);

export async function getSnapshot15(gameId, gameMinutes) {
  const first = await getWindow(gameId);
  const startFrame = first?.frames?.find((f) => f.gameState === 'in_game');
  if (!startFrame) return null;

  const start = new Date(startFrame.rfc460Timestamp).getTime();
  // Frame at (or just after) a time. null if the feed has a gap there.
  const frameAt = async (ms) => {
    const f = (await getWindow(gameId, toFeedTime(ms)))?.frames?.[0];
    if (!f || Math.abs(new Date(f.rfc460Timestamp).getTime() - ms) > MAX_FRAME_GAP_MS) return null;
    return f;
  };

  let frame = await frameAt(start + 15 * 60_000);
  if (!frame || frame.gameState === 'finished') return null;

  let clockCorrectedBy = 0; // seconds we moved forward (pause / early feed start)
  if (combinedCs(frame) < CS_TOO_EARLY) {
    if (!gameMinutes) return null;
    const t15 = start + 15 * 60_000;

    // When did the game end in feed time? Binary search for the switch to "finished".
    let lo = start + gameMinutes * 60_000 - 60_000;
    let hi = start + gameMinutes * 60_000 + 60 * 60_000;
    while (hi - lo > 10_000) {
      const mid = (lo + hi) / 2;
      const f = await frameAt(mid);
      if (!f || f.gameState === 'finished') hi = mid;
      else lo = mid;
    }
    const lostMs = Math.max(0, hi - start - gameMinutes * 60_000);

    if (lostMs >= MIN_LOST_MS) {
      // Move forward until CS reaches the 15:00 level, capped at the measured lost time
      let a = t15;
      let b = t15 + lostMs;
      while (b - a > 10_000) {
        const mid = (a + b) / 2;
        const f = await frameAt(mid);
        if (!f || f.gameState === 'finished' || combinedCs(f) >= CS_AT_15) b = mid;
        else a = mid;
      }
      frame = await frameAt(b);
      if (!frame || frame.gameState === 'finished') return null;
      clockCorrectedBy = Math.round((b - t15) / 1000);
    }
    // else: no real lost time, so CS is low because the game was bloody. 15:00 snapshot stands.
  }

  const meta = first.gameMetadata;
  const side = (teamFrame, teamMeta) => ({
    gold: teamFrame.totalGold,
    kills: teamFrame.totalKills,
    towers: teamFrame.towers,
    inhibitors: teamFrame.inhibitors,
    barons: teamFrame.barons,
    dragons: teamFrame.dragons,
    players: teamFrame.participants.map((p) => {
      const pm = teamMeta.participantMetadata.find((m) => m.participantId === p.participantId);
      return {
        role: pm?.role,
        champion: pm?.championId,
        gold: p.totalGold,
        level: p.level,
        cs: p.creepScore,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
      };
    }),
  });

  return {
    blueTeamId: meta.blueTeamMetadata.esportsTeamId,
    redTeamId: meta.redTeamMetadata.esportsTeamId,
    blue: side(frame.blueTeam, meta.blueTeamMetadata),
    red: side(frame.redTeam, meta.redTeamMetadata),
    clockCorrectedBy,
    clockVersion: CLOCK_VERSION,
  };
}

/**
 * True if a cached game's snapshot needs its 15:00 timing checked (or re-checked with newer logic).
 */
export function snapshotLooksEarly(game) {
  if (!game.snap15 || game.clockVersion === CLOCK_VERSION) return false;
  const cs = game.snap15.flatMap((side) => side.players).reduce((sum, p) => sum + p.cs, 0);
  // Low CS, or corrected by an older version of the clock logic: check it again
  return cs < CS_TOO_EARLY || game.clockCorrectedBy > 0;
}

// Champion names differ between sites ("Wukong" vs "MonkeyKing", "Renata Glasc" vs "Renata")
const CHAMPION_ALIASES = { monkeyking: 'wukong', renataglasc: 'renata', nunuwillump: 'nunu' };
export function championKey(name) {
  const key = (name ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return CHAMPION_ALIASES[key] ?? key;
}

/**
 * Champions in a lolesports game: { blue: [...], red: [...] } (normalized), or null if no feed.
 * Used to prove a lolesports game is the same game as a Leaguepedia one.
 */
export async function getGameChampions(gameId) {
  const meta = (await getWindow(gameId))?.gameMetadata;
  if (!meta) return null;
  const champs = (team) => team.participantMetadata.map((p) => championKey(p.championId));
  return { blue: champs(meta.blueTeamMetadata), red: champs(meta.redTeamMetadata) };
}

/**
 * How many of the 10 champions match, trying both side orders. 8+ = same game.
 */
export function championOverlap(picks, blue, red) {
  const [p1, p2] = picks.map((side) => side.map(championKey));
  const count = (a, b) => a.filter((c) => b.includes(c)).length;
  return Math.max(count(p1, blue) + count(p2, red), count(p1, red) + count(p2, blue));
}
