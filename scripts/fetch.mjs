// Fetch script. Run with: npm run fetch
// Pulls everything we need and writes it to data/cache.json. Runs on your machine only.
// Safe to re-run: games that already have a 15-min snapshot are skipped.

import { WINDOW_START, REQUEST_DELAY_MS, LEAGUE_SLUGS } from './config.mjs';
import { loadCache, saveCache } from './lib/cache.mjs';
import { login, getWorldsTeams, getGames, getPlayerStats } from './lib/leaguepedia.mjs';
import { getLeagues, getCompletedMatches, getMatchGames, getSnapshot15 } from './lib/lolesports.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MATCH_WINDOW_MS = 12 * 60 * 60 * 1000; // lolesports match start must be within 12h of the game

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

  const games = await getGames(teamNames);
  const players = await getPlayerStats(teamNames);
  for (const g of games) {
    const old = cache.games[g.gameId] ?? {};
    // Keep anything already fetched from lolesports
    cache.games[g.gameId] = {
      ...g,
      endPlayers: players[g.gameId] ?? [],
      lolesportsGameId: old.lolesportsGameId ?? null,
      snap15: old.snap15 ?? null,
    };
  }
  saveCache(cache);
  console.log(`Games since ${WINDOW_START}: ${games.length}`);

  // 2. Match each Leaguepedia series to a lolesports match
  const leagueIds = await getLeagues();
  const scheduleBySlug = {};
  const series = {}; // Leaguepedia matchId -> games in that series
  for (const g of Object.values(cache.games)) (series[g.matchId] ??= []).push(g);

  const unmatched = [];
  for (const seriesGames of Object.values(series)) {
    if (seriesGames.every((g) => g.snap15)) continue;

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

    const match = await getMatchGames(candidates[0].matchId);
    for (const g of seriesGames) {
      const lg = match.games.find((x) => x.number === g.gameInMatch);
      if (!lg) {
        unmatched.push(`${g.gameId} (game ${g.gameInMatch} not in lolesports match)`);
        continue;
      }
      g.lolesportsGameId = lg.gameId;
      g.lolesportsTeams = match.teams; // teamId -> code, used to line up sides below
    }
    await sleep(REQUEST_DELAY_MS / 3);
  }
  saveCache(cache);

  // 3. ~15-min snapshot for each matched game
  const todo = Object.values(cache.games).filter((g) => g.lolesportsGameId && !g.snap15);
  console.log(`Fetching 15-min snapshots: ${todo.length} games`);
  const noFeed = [];

  for (const [i, g] of todo.entries()) {
    const snap = await getSnapshot15(g.lolesportsGameId);
    if (!snap) {
      noFeed.push(g.gameId);
    } else {
      // Line up blue/red with Leaguepedia's team1/team2 using a Worlds team's code
      const worldsTeam = codesOf[g.team1] ? g.team1 : g.team2;
      const blueCode = g.lolesportsTeams[snap.blueTeamId]?.toLowerCase();
      const worldsIsBlue = codesOf[worldsTeam].includes(blueCode);
      const team1IsBlue = worldsTeam === g.team1 ? worldsIsBlue : !worldsIsBlue;
      g.snap15 = team1IsBlue ? [snap.blue, snap.red] : [snap.red, snap.blue];
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
