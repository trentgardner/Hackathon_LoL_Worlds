// Fetch script. Run with: npm run fetch
// Pulls everything we need and writes it to data/cache.json. Runs on your machine only.
// Safe to re-run: games that already have a 15-min snapshot are skipped.

import { WINDOW_START, REQUEST_DELAY_MS, LEAGUE_SLUGS } from './config.mjs';
import { loadCache, saveCache } from './lib/cache.mjs';
import { login, getWorldsTeams, getGames, getPlayerStats, getTeamAliases, getSeriesResults } from './lib/leaguepedia.mjs';
import {
  getLeagues, getCompletedMatches, getMatchGames, getSnapshot15, snapshotLooksEarly,
  getGameChampions, championOverlap, championKey, CLOCK_VERSION,
} from './lib/lolesports.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MATCH_WINDOW_MS = 12 * 60 * 60 * 1000; // lolesports match start must be within 12h of the game
const MIN_CHAMPION_MATCH = 8; // of 10 champions, to accept that two games are the same game

const slugFor = (tournament) => LEAGUE_SLUGS.find(([prefix]) => tournament.startsWith(prefix))?.[1];
// Leaguepedia dates are UTC without a zone marker
const toMs = (lpDate) => new Date(`${lpDate.replace(' ', 'T')}Z`).getTime();

async function main() {
  const cache = loadCache();

  // 1. Leaguepedia: login, Worlds teams, games, player stats
  await login();

  const teams = await getWorldsTeams();
  cache.teams = Object.fromEntries(teams.map((t) => [t.name, t]));
  const teamNames = teams.map((t) => t.name);
  const codesOf = Object.fromEntries(teams.map((t) => [t.name, t.codes]));
  console.log(`Worlds teams: ${teams.length}`);

  // Old names (e.g. "Team Secret (Vietnamese Team)" -> Team Secret Whales): search them too,
  // then file everything under the current name
  const aliases = await getTeamAliases(teamNames);
  const rename = (name) => aliases[name]?.current ?? name;
  for (const { current, short } of Object.values(aliases)) {
    if (short && !codesOf[current].includes(short.toLowerCase())) codesOf[current].push(short.toLowerCase());
  }
  const searchNames = [...teamNames, ...Object.keys(aliases)];
  console.log(`Old team names searched too: ${Object.keys(aliases).length}`);

  const games = (await getGames(searchNames)).map((g) => ({
    ...g, team1: rename(g.team1), team2: rename(g.team2), winner: rename(g.winner),
  }));
  const players = await getPlayerStats(searchNames);
  for (const list of Object.values(players)) for (const p of list) p.team = rename(p.team);

  // Series results from the schedule (covers games that have no scoreboard)
  const seriesResults = await getSeriesResults(searchNames);
  for (const sr of Object.values(seriesResults)) {
    sr.team1 = rename(sr.team1);
    sr.team2 = rename(sr.team2);
    for (const gm of sr.games) gm.winner = rename(gm.winner);
  }
  console.log(`Series from the schedule: ${Object.keys(seriesResults).length}`);

  for (const g of games) {
    const old = cache.games[g.gameId] ?? {};
    // Keep anything already fetched from lolesports
    cache.games[g.gameId] = {
      ...g,
      endPlayers: players[g.gameId] ?? [],
      lolesportsGameId: old.lolesportsGameId ?? null,
      snap15: old.snap15 ?? null,
      clockCorrectedBy: old.clockCorrectedBy ?? null,
      clockVersion: old.clockVersion ?? null,
      noReliableSnapshot: old.noReliableSnapshot && old.clockVersion === CLOCK_VERSION,
    };
  }
  // Tournament name for each series, from its scoreboard games (falls back to the event page)
  const tournamentOf = {};
  for (const g of games) tournamentOf[g.matchId] ??= g.tournament;
  for (const [id, sr] of Object.entries(seriesResults)) sr.tournament = tournamentOf[id] ?? null;
  cache.series = seriesResults;

  saveCache(cache);
  console.log(`Games since ${WINDOW_START}: ${games.length}`);

  // Re-check every saved snapshot: its champions must match Leaguepedia's picks, or it's the wrong game
  let mismatched = 0;
  for (const g of Object.values(cache.games)) {
    if (!g.snap15) continue;
    const [a, b] = g.snap15.map((side) => side.players.map((p) => championKey(p.champion)));
    if (championOverlap(g.picks, a, b) < MIN_CHAMPION_MATCH) {
      Object.assign(g, { lolesportsGameId: null, snap15: null, clockCorrectedBy: null });
      mismatched++;
    }
  }
  if (mismatched) console.log(`Cleared ${mismatched} snapshot(s) whose champions didn't match (wrong game)`);

  // 2. Match each Leaguepedia series to a lolesports match
  const leagueIds = await getLeagues();
  const scheduleBySlug = {};
  const series = {}; // Leaguepedia matchId -> games in that series
  for (const g of Object.values(cache.games)) (series[g.matchId] ??= []).push(g);

  const unmatched = [];
  const usedGameIds = new Set(Object.values(cache.games).map((g) => g.lolesportsGameId).filter(Boolean));
  for (const seriesGames of Object.values(series)) {
    if (seriesGames.every((g) => g.snap15 && !snapshotLooksEarly(g))) continue;

    const first = seriesGames[0];
    const slug = slugFor(first.tournament);
    if (!slug || !leagueIds[slug]) {
      unmatched.push(`${first.matchId} (no lolesports league for "${first.tournament}")`);
      continue;
    }
    scheduleBySlug[slug] ??= await getCompletedMatches(leagueIds[slug]);

    // Match on the Worlds team code(s) + closest start time
    const teamCodes = [first.team1, first.team2].filter((t) => codesOf[t]).map((t) => codesOf[t]);
    const gameMs = toMs(first.date);
    const candidates = scheduleBySlug[slug]
      .filter((m) => teamCodes.every((codes) => m.codes.some((mc) => codes.includes(mc.toLowerCase()))))
      .filter((m) => Math.abs(new Date(m.startTime).getTime() - gameMs) < MATCH_WINDOW_MS)
      .sort((a, b) => Math.abs(new Date(a.startTime) - gameMs) - Math.abs(new Date(b.startTime) - gameMs));

    if (!candidates.length) {
      unmatched.push(`${first.matchId} (${first.team1} vs ${first.team2}, ${first.date})`);
      continue;
    }

    // Take the closest candidate whose game has the same champions (two series on one day can fool time alone)
    let match = null;
    const ownIds = new Set(seriesGames.map((g) => g.lolesportsGameId)); // this series' own games aren't "taken"
    for (const candidate of candidates) {
      const m = await getMatchGames(candidate.matchId);
      const lg = m.games.find((x) => x.number === first.gameInMatch);
      if (!lg || (usedGameIds.has(lg.gameId) && !ownIds.has(lg.gameId))) continue;
      const champs = await getGameChampions(lg.gameId);
      if (champs && championOverlap(first.picks, champs.blue, champs.red) >= MIN_CHAMPION_MATCH) {
        match = m;
        break;
      }
    }
    if (!match) {
      unmatched.push(`${first.matchId} (${first.team1} vs ${first.team2}: no lolesports game with the same champions)`);
      continue;
    }

    for (const g of seriesGames) {
      const lg = match.games.find((x) => x.number === g.gameInMatch);
      if (!lg) {
        unmatched.push(`${g.gameId} (game ${g.gameInMatch} not in lolesports match)`);
        continue;
      }
      g.lolesportsGameId = lg.gameId;
      usedGameIds.add(lg.gameId);
    }
    await sleep(REQUEST_DELAY_MS / 3);
  }
  saveCache(cache);

  // 3. ~15-min snapshot for each matched game (plus re-takes of old snapshots that landed before 15:00)
  const todo = Object.values(cache.games).filter((g) => g.lolesportsGameId && !g.noReliableSnapshot && (!g.snap15 || snapshotLooksEarly(g)));
  console.log(`Fetching 15-min snapshots: ${todo.length} games`);
  const noFeed = [];

  for (const [i, g] of todo.entries()) {
    const snap = await getSnapshot15(g.lolesportsGameId, g.minutes);
    if (!snap) {
      // No trustworthy 15:00 frame: drop any old snapshot rather than keep a bad one
      Object.assign(g, { snap15: null, clockCorrectedBy: null, clockVersion: null, noReliableSnapshot: true });
      noFeed.push(g.gameId);
    } else {
      // Line up blue/red with Leaguepedia's team1/team2 by champions (team1's picks are on one side)
      const keys = (side) => side.players.map((p) => championKey(p.champion));
      const [t1] = g.picks.map((side) => side.map(championKey));
      const team1IsBlue = keys(snap.blue).filter((c) => t1.includes(c)).length >= keys(snap.red).filter((c) => t1.includes(c)).length;
      g.snap15 = team1IsBlue ? [snap.blue, snap.red] : [snap.red, snap.blue];
      g.clockCorrectedBy = snap.clockCorrectedBy;
      g.clockVersion = snap.clockVersion;
    }
    if ((i + 1) % 25 === 0) {
      saveCache(cache);
      console.log(`  ${i + 1}/${todo.length}`);
    }
    await sleep(REQUEST_DELAY_MS / 3);
  }

  cache.meta = { fetchedAt: new Date().toISOString(), windowStart: WINDOW_START };
  saveCache(cache);

  const all = Object.values(cache.games);
  console.log(`\nDone. ${all.filter((g) => g.snap15).length}/${all.length} games have a 15-min snapshot.`);
  if (unmatched.length) console.log(`\nNot matched to lolesports (${unmatched.length}):\n  ${unmatched.join('\n  ')}`);
  if (noFeed.length) console.log(`\nMatched but no feed data (${noFeed.length}):\n  ${noFeed.join('\n  ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
