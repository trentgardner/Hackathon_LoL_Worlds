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
 */
export async function getSnapshot15(gameId) {
  const first = await getWindow(gameId);
  const startFrame = first?.frames?.find((f) => f.gameState === 'in_game');
  if (!startFrame) return null;

  const start = new Date(startFrame.rfc460Timestamp).getTime();
  const at15 = await getWindow(gameId, toFeedTime(start + 15 * 60_000));
  const frame = at15?.frames?.[0];
  if (!frame || frame.gameState === 'finished') return null;

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
  };
}
