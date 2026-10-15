// Process script. Run with: npm run process
// Reads data/cache.json, computes team scores, writes src/data/teams.json.

import fs from 'node:fs';
import { loadCache } from './lib/cache.mjs';
import {
  EVENTS, EVENT_PAGES, EVENT_WEIGHTS, EVEN_ZONE, SEEDS, HYPE, SHRINK, TAG_GAP, STYLE, OUTPUT_PATH, OVERALL_GAME_WEIGHT,
} from './config.mjs';

function xpFromLevel(level) {
    let total = 0;
    for (let lvl = 2; lvl <= level; lvl++) total += 100 * lvl - 20;
    return total + (100 * (level + 1) -20) / 2;
}

// Weighted average: MSI,EWC, etc.
function weightedAvg(views, valueOf) {
    let total = 0;
    let weights = 0;
    for (const v of views) {
        const value = valueOf(v);
        if (value == null) continue;
        total += value * v.weight;
        weights += v.weight;
    }
    return weights ? total / weights : null;
}

// Average of the best 25% of values (at least 1 value)
function topQuarterAvg(values) {
    const sorted = values.filter((x) => x != null).sort((a, b) => b - a);
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 4)));
    return top.reduce((sum, x) => sum + x, 0) / top.length;
}

// Standard deviation: how spread out the values are. Low = steady, high = all over the place
function stdDev(values) {
    const xs = values.filter((x) => x != null);
    const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length);
}

const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length;

// { team: value } -> { team: how many standard deviations from the average }. 0 = average team.
function zScores(byTeam) {
  const values = Object.values(byTeam);
  const avg = mean(values);
  const sd = stdDev(values);
  return Object.fromEntries(Object.entries(byTeam).map(([t, x]) => [t, (x - avg) / sd]));
}

// { team: score } -> { team: rank }, 1 = highest score. Ties share a rank.
function ranks(byTeam) {
  const sorted = Object.values(byTeam).sort((a, b) => b - a);
  return Object.fromEntries(Object.entries(byTeam).map(([t, x]) => [t, sorted.indexOf(x) + 1]));
}

// Strength of schedule (Simple Rating System).
// A team's rating = average of (its margin in each game + that opponent's rating).
// Ratings depend on each other, so repeat until they settle. MSI/EWC games link the regions.
function scheduleRatings(views, valueOf) {
    // Every team's games, including non-Worlds opponents (seen from the other side)
    const games = {};
    for (const v of views) {
        const margin = valueOf(v);
        if (margin == null) continue;
        (games[v.team] ??= []).push({ opp: v.opponent, margin, weight: v.weight });
        if (!(v.opponent in cache.teams)) {
            (games[v.opponent] ??= []).push({ opp: v.team, margin: -margin, weight: v.weight });
        }
    }

    let rating = Object.fromEntries(Object.keys(games).map((t) => [t, 0]));
    for (let round = 0; round < 200; round++) {
        const next = {};
        for (const [team, list] of Object.entries(games)) {
            next[team] = weightedAvg(list, (g) => g.margin + rating[g.opp]);
        }
        // Keep the average team at 0 so numbers don't drift
        const mean = Object.values(next).reduce((sum, x) => sum + x, 0) / Object.keys(next).length;
        for (const team in next) next[team] -= mean;
        rating = next;
    }
    return rating;
}

// A usable 15-min snapshot: both teams' CS together should be near the normal 15:00 level.
// Guards against snapshots taken before 15:00 (pauses, early feeds) that slipped through the fetch.
const MIN_CS_AT_15 = 950;
function usableSnapshot(game) {
  const s = game.snap15;
  if (!s) return null;
  if (game.clockVersion != null) return s; // timing already verified by the fetch (incl. bloody low-CS games)
  const cs = s.flatMap((side) => side.players).reduce((sum, p) => sum + p.cs, 0);
  return cs >= MIN_CS_AT_15 ? s : null;
}

// Gold + XP lead at 15 for one side of a snapshot
function sideLead(s, side) {
  const sum = (players, fn) => players.reduce((total, p) => total + fn(p), 0);
  const xp = (t) => sum(t.players, (p) => xpFromLevel(p.level));
  return s[side].gold - s[1 - side].gold + xp(s[side]) - xp(s[1 - side]);
}

// How much a game counts. International -> domestic vs worlds teams -> rest
function weightFor(game, opponentIsWorlds) {
  if (game.tournament === EVENTS.msi || game.overviewPage === EVENT_PAGES.msi) return EVENT_WEIGHTS.msi;
  if (game.tournament === EVENTS.ewc || game.overviewPage === EVENT_PAGES.ewc) return EVENT_WEIGHTS.ewc;
    return opponentIsWorlds ? EVENT_WEIGHTS.domesticVsWorlds : EVENT_WEIGHTS.domesticVsOther;
}

// Ahead/behind at 15 + result = what kind of game it was
function outcomeOf(lead, won) {
    if (lead > EVEN_ZONE) return won ? 'conversion' : 'choke';
    if (lead < -EVEN_ZONE) return won ? 'comeback' : 'expectedLoss';
    return 'even';
}

// One game from one team's side. side 0 = team1, side 1 = team2
function teamView(game, side) {
  const me = side;
  const opp = 1 - side;
  const team = side === 0 ? game.team1 : game.team2;
  const opponent = side === 0 ? game.team2 : game.team1;

  const view = {
    team,
    opponent,
    matchId: game.matchId,
    gameInMatch: game.gameInMatch,
    tournament: game.tournament,
    date: game.date,
    won: game.winner === team,
    weight: weightFor(game, opponent in cache.teams),
    minutes: game.minutes,
    endGoldDiff: game.end.gold[me] - game.end.gold[opp],
    at15: null, // stays null for the 3 games with no snapshot
  };

  const s = usableSnapshot(game);
  if (s) {
    const sum = (players, fn) => players.reduce((total, p) => total + fn(p), 0);
    const xp = (t) => sum(t.players, (p) => xpFromLevel(p.level));
    const cs = (t) => sum(t.players, (p) => p.cs);

    view.at15 = {
      goldDiff: s[me].gold - s[opp].gold,
      xpDiff: xp(s[me]) - xp(s[opp]),
      csDiff: cs(s[me]) - cs(s[opp]),
      killDiff: s[me].kills - s[opp].kills,
      towerDiff: s[me].towers - s[opp].towers,
      dragonDiff: s[me].dragons.length - s[opp].dragons.length,
    };
    view.swing = view.endGoldDiff - view.at15.goldDiff;
    view.lead15 = view.at15.goldDiff + view.at15.xpDiff;
    view.outcome = outcomeOf(view.lead15, view.won);
  }

  return view;
}

// Game tier: how good are they at 15, and what do they do with it
function gameTier(views) {
  const outcomeRate = (yes, no) =>
    weightedAvg(views, (v) => (v.outcome === yes ? 1 : v.outcome === no ? 0 : null));

  return {
    games: views.length,
    winRate: weightedAvg(views, (v) => (v.won ? 1 : 0)),
    avgLead15: weightedAvg(views, (v) => v.adjLead15), // adjusted for opponent strength
    rawLead15: weightedAvg(views, (v) => v.lead15),
    avgGoldDiff15: weightedAvg(views, (v) => v.at15?.goldDiff),
    avgXpDiff15: weightedAvg(views, (v) => v.at15?.xpDiff),
    conversionRate: outcomeRate('conversion', 'choke'),  // when ahead, how often they win
    comebackRate: outcomeRate('comeback', 'expectedLoss'), // when behind, how often they win
    ceiling: (topQuarterAvg(views.map((v) => v.adjLead15)) + topQuarterAvg(views.map((v) => v.adjEndGoldDiff))) / 2,
    swingSpread: stdDev(views.map((v) => v.swing)), // lower = more consistent
  };
}

// One team's series, from the schedule results (every game's winner, even games with no scoreboard).
// Bo1s are flagged: they show up in past meetings but not in the series tier
// (a single game is already counted in the game tier).
function seriesViews(team) {
  const series = [];
  for (const sr of Object.values(cache.series)) {
    if (sr.team1 !== team && sr.team2 !== team) continue;
    if (!sr.games.length) continue;
    const opponent = sr.team1 === team ? sr.team2 : sr.team1;
    const results = sr.games.map((g) => g.winner === team); // in game order
    const wins = results.filter(Boolean).length;
    const losses = results.length - wins;
    const won = wins > losses;
    series.push({
      team,
      opponent,
      tournament: sr.tournament ?? sr.overviewPage,
      date: sr.date,
      weight: weightFor({ tournament: sr.tournament, overviewPage: sr.overviewPage }, opponent in cache.teams),
      bo1: Math.max(wins, losses) < 2,
      won,
      score: `${wins}-${losses}`,
      margin: won ? 1 : -1, // a series win is a series win
      sweep: won && losses === 0, // 2-0 / 3-0
      wentDistance: Math.abs(wins - losses) === 1, // 2-1 / 3-2
      reverseSweep: won && results.length >= 4 && !results[0] && !results[1], // down 0-2, won anyway (grit)
    });
  }
  return series;
}

// Series tier: do they win series, and how
function seriesTier(series) {
  return {
    series: series.length,
    seriesWinRate: weightedAvg(series, (s) => (s.won ? 1 : 0)),
    seriesStrength: weightedAvg(series, (s) => s.adjMargin), // win rate adjusted for opponent strength
    sweepRate: weightedAvg(series, (s) => (s.won ? (s.sweep ? 1 : 0) : null)), // of series won, how many were clean
    closeSeriesWinRate: weightedAvg(series, (s) => (s.wentDistance ? (s.won ? 1 : 0) : null)), // record in 2-1 / 3-2 series
    reverseSweeps: series.filter((s) => s.reverseSweep).length,
  };
}

const cache = loadCache();

// Backtesting: PROCESS_CUTOFF=2026-08-20 rates teams using only games before that date,
// PROCESS_OUTPUT writes somewhere other than the app's teams.json
const CUTOFF = process.env.PROCESS_CUTOFF;
if (CUTOFF) {
  cache.games = Object.fromEntries(Object.entries(cache.games).filter(([, g]) => g.date < CUTOFF));
  cache.series = Object.fromEntries(Object.entries(cache.series).filter(([, s]) => s.date < CUTOFF));
}
const games = Object.values(cache.games);

// Every game from every Worlds team's point of view.
// A game between two Worlds teams (T1 vs Gen.G) counts once for each of them.
const views = [];
for (const game of games) {
  if (game.team1 in cache.teams) views.push(teamView(game, 0));
  if (game.team2 in cache.teams) views.push(teamView(game, 1));
}

// Adjust every game for opponent strength: lead + opponent's rating
const leadRating = scheduleRatings(views, (v) => v.lead15);
const endRating = scheduleRatings(views, (v) => v.endGoldDiff);
for (const v of views) {
  v.adjLead15 = v.lead15 == null ? null : v.lead15 + leadRating[v.opponent];
  v.adjEndGoldDiff = v.endGoldDiff + endRating[v.opponent];
}

// Group by team: { 'T1': [game, game, ...], 'Gen.G': [...], ... }
const byTeam = {};
for (const v of views) (byTeam[v.team] ??= []).push(v);

// Every series from every Worlds team's point of view, adjusted for opponent strength
const seriesByTeam = Object.fromEntries(
  Object.keys(byTeam).map((team) => [team, seriesViews(team)]),
);
const allSeries = Object.values(seriesByTeam).flat().filter((s) => !s.bo1);
const seriesRating = scheduleRatings(allSeries, (s) => s.margin);
for (const s of allSeries) s.adjMargin = s.margin + seriesRating[s.opponent];

// ---------- Scoring ----------

const teamNames = Object.keys(cache.teams);
const tiers = Object.fromEntries(teamNames.map((team) => [team, {
  game: gameTier(byTeam[team]),
  series: seriesTier(seriesByTeam[team].filter((s) => !s.bo1)),
  aheadGames: byTeam[team].filter((v) => v.outcome === 'conversion' || v.outcome === 'choke').length,
}]));

// Pull each team's stat toward the Worlds-field average. Small samples move more.
// k = how many games/series it takes before we trust a team's own number halfway.
function shrunk(statOf, sampleOf, k) {
  const raw = Object.fromEntries(teamNames.map((t) => [t, statOf(tiers[t])]));
  const avg = mean(Object.values(raw).filter((x) => x != null));
  return Object.fromEntries(teamNames.map((t) => {
    // No data for this stat (e.g. never ahead at 15 yet) = field average, not 0
    if (raw[t] == null) return [t, avg];
    const n = sampleOf(tiers[t]);
    return [t, avg + (raw[t] - avg) * (n / (n + k))];
  }));
}

const lead = shrunk((x) => x.game.avgLead15, (x) => x.game.games, SHRINK.games);
const ceiling = shrunk((x) => x.game.ceiling, (x) => x.game.games, SHRINK.games);
const conversion = shrunk((x) => x.game.conversionRate, (x) => x.aheadGames, SHRINK.games);
const seriesStrength = shrunk((x) => x.series.seriesStrength, (x) => x.series.series, SHRINK.series);
const spread = Object.fromEntries(teamNames.map((t) => [t, tiers[t].game.swingSpread]));

// X axis: game tier = average of lead, ceiling, conversion (each as distance from the Worlds average)
const zLead = zScores(lead);
const zCeiling = zScores(ceiling);
const zConversion = zScores(conversion);
const gameScore = Object.fromEntries(teamNames.map((t) => [t, (zLead[t] + zCeiling[t] + zConversion[t]) / 3]));

// Y axis: series tier
const seriesScore = zScores(seriesStrength);

// Dot size: consistency (flip the sign so higher = steadier)
const consistency = Object.fromEntries(Object.entries(zScores(spread)).map(([t, z]) => [t, -z]));

// Overall (ranking + predictions). Backtested on unseen later results: game score predicts best;
// series records lean on close-series luck (see OVERALL_GAME_WEIGHT in config.mjs).
const overall = Object.fromEntries(teamNames.map((t) => [t, OVERALL_GAME_WEIGHT * gameScore[t] + (1 - OVERALL_GAME_WEIGHT) * seriesScore[t]]));
const gameRank = ranks(gameScore);
const seriesRank = ranks(seriesScore);
const modelRank = ranks(overall);

// Hype: lower = more hyped. Pool counts double (it compares across regions).
const hype = Object.fromEntries(teamNames.map((t) => {
  const { seed, pool } = SEEDS[t];
  return [t, (HYPE.POOL_WEIGHT * (pool ?? HYPE.PLAY_IN_POOL) + seed) / (HYPE.POOL_WEIGHT + 1)];
}));
const hypeScore = zScores(Object.fromEntries(teamNames.map((t) => [t, -hype[t]]))); // higher = more hyped
const hypeRank = ranks(hypeScore);

// Model score vs hype score on the same scale. + = better than hyped, - = worse.
const modelZ = zScores(overall);
const hypeGap = Object.fromEntries(teamNames.map((t) => [t, modelZ[t] - hypeScore[t]]));

function archetypeOf(x, y) {
  if (x >= 0 && y >= 0) return 'Powerhouse';
  if (x < 0 && y >= 0) return 'Scrappy';
  if (x >= 0 && y < 0) return 'Dark horse';
  return 'Bottom of the barrel';
}

function clutchTagOf(t) {
  const gap = gameRank[t] - seriesRank[t];
  if (gap >= TAG_GAP) return 'Clutch'; // series rank much better than game rank
  if (gap <= -TAG_GAP) return 'Fragile'; // game rank much better than series rank
  return null;
}

// ---------- Playstyle ----------

// Tempo: how strong they are early (adjusted lead @15) and how fast their games end.
// Positive = early-game team, negative = late-game team.
const avgLength = Object.fromEntries(teamNames.map((t) => [t, mean(byTeam[t].map((v) => v.minutes))]));
const zShortGames = Object.fromEntries(Object.entries(zScores(avgLength)).map(([t, z]) => [t, -z]));
const tempo = Object.fromEntries(teamNames.map((t) => [t, (zLead[t] + zShortGames[t]) / 2]));
const tempoTagOf = (t) => (tempo[t] >= STYLE.TEMPO_TAG ? 'Early game' : tempo[t] <= -STYLE.TEMPO_TAG ? 'Late game' : 'Flexible');

// ---------- Draft ----------

const champKey = (name) => name.toLowerCase().replace(/[^a-z]/g, '');
const champName = {}; // key -> display name

// Champion early-game index: average gold + XP lead @15 of every side (any team) that picked it.
// Kept per team too, so a team's own games can be left out when judging its picks.
const champAll = {}; // key -> { sum, n }
const champByTeam = {}; // team -> key -> { sum, n }
for (const g of games) {
  const s = usableSnapshot(g);
  if (!s) continue;
  [g.team1, g.team2].forEach((team, side) => {
    const lead = sideLead(s, side);
    for (const name of g.picks[side]) {
      const k = champKey(name);
      champName[k] ??= name;
      (champAll[k] ??= { sum: 0, n: 0 }).sum += lead;
      champAll[k].n++;
      ((champByTeam[team] ??= {})[k] ??= { sum: 0, n: 0 }).sum += lead;
      champByTeam[team][k].n++;
    }
  });
}

// Draft tempo: average early-game index of a team's picks, judged only on OTHER teams' games
function draftTempoOf(team) {
  const values = [];
  for (const g of games) {
    const side = g.team1 === team ? 0 : g.team2 === team ? 1 : -1;
    if (side === -1) continue;
    for (const name of g.picks[side]) {
      const k = champKey(name);
      if (!champAll[k]) continue; // only picked in games without a usable 15-min snapshot
      const own = champByTeam[team]?.[k] ?? { sum: 0, n: 0 };
      const n = champAll[k].n - own.n;
      if (n >= STYLE.MIN_CHAMP_GAMES) values.push((champAll[k].sum - own.sum) / n);
    }
  }
  return mean(values);
}
const draftTempo = Object.fromEntries(teamNames.map((t) => [t, draftTempoOf(t)]));
const zDraftTempo = zScores(draftTempo);
const draftTagOf = (t) => (zDraftTempo[t] >= STYLE.DRAFT_TAG ? 'Early-game drafts' : zDraftTempo[t] <= -STYLE.DRAFT_TAG ? 'Scaling drafts' : null);

function draftProfile(team) {
  const picks = {};
  const bans = {};
  const bannedAgainst = {};
  let pickCount = 0;
  for (const g of games) {
    const side = g.team1 === team ? 0 : g.team2 === team ? 1 : -1;
    if (side === -1) continue;
    const won = g.winner === team;
    for (const name of g.picks[side]) {
      const k = champKey(name);
      champName[k] ??= name;
      const p = (picks[k] ??= { games: 0, wins: 0 });
      p.games++;
      if (won) p.wins++;
      pickCount++;
    }
    for (const name of g.bans[side]) bans[champKey(name)] = (bans[champKey(name)] ?? 0) + 1;
    for (const name of g.bans[1 - side]) bannedAgainst[champKey(name)] = (bannedAgainst[champKey(name)] ?? 0) + 1;
  }

  const byGames = Object.entries(picks).sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins);
  const topN = (counts, n) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, count]) => ({ champion: champName[k] ?? k, count }));

  return {
    pool: byGames.length, // different champions played
    top5Share: byGames.slice(0, 5).reduce((sum, [, p]) => sum + p.games, 0) / pickCount,
    signature: byGames.slice(0, 5).map(([k, p]) => ({ champion: champName[k], games: p.games, wins: p.wins })),
    topPicks: byGames.slice(0, 10).map(([k, p]) => ({ champion: champName[k], games: p.games })),
    bans: topN(bans, 5),
    bannedAgainst: topN(bannedAgainst, 5),
  };
}

// ---------- Output ----------

const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10); // 0.5793 -> 57.9
const whole = (x) => (x == null ? null : Math.round(x));
const two = (x) => (x == null ? null : Math.round(x * 100) / 100);

const teams = teamNames.map((t) => {
  const info = cache.teams[t];
  const g = tiers[t].game;
  const s = tiers[t].series;
  return {
    name: t,
    short: info.short,
    region: info.region,
    stage: info.stage,
    seed: SEEDS[t].seed,
    pool: SEEDS[t].pool,
    archetype: archetypeOf(gameScore[t], seriesScore[t]),
    tags: {
      clutch: clutchTagOf(t),
      bust: hypeGap[t] <= -HYPE.TAG_GAP, // hyped above what the data says
      underrated: hypeGap[t] >= HYPE.TAG_GAP, // data says better than the hype
      grit: s.reverseSweeps > 0,
    },
    scores: {
      game: two(gameScore[t]),
      series: two(seriesScore[t]),
      overall: two(overall[t]),
      consistency: two(consistency[t]),
    },
    ranks: { model: modelRank[t], game: gameRank[t], series: seriesRank[t], hype: hypeRank[t] },
    game: {
      games: g.games,
      winRate: pct(g.winRate),
      // Raw = actual average lead (gold + XP). Adjusted = raw, corrected for opponent strength.
      lead15Raw: whole(g.rawLead15),
      lead15Adjusted: whole(g.avgLead15),
      goldDiff15: whole(g.avgGoldDiff15), // raw
      xpDiff15: whole(g.avgXpDiff15), // raw
      // Ceiling uses adjusted numbers
      conversionRate: pct(g.conversionRate),
      chokeRate: pct(g.conversionRate == null ? null : 1 - g.conversionRate),
      comebackRate: pct(g.comebackRate),
      ceiling: whole(g.ceiling),
      swingSpread: whole(g.swingSpread),
    },
    series: {
      series: s.series,
      winRate: pct(s.seriesWinRate),
      strength: two(s.seriesStrength),
      sweepRate: pct(s.sweepRate),
      closeSeriesWinRate: pct(s.closeSeriesWinRate),
      reverseSweeps: s.reverseSweeps,
    },
    playstyle: {
      tempo: tempoTagOf(t),
      tempoScore: two(tempo[t]),
      avgGameMinutes: Math.round(avgLength[t] * 10) / 10,
    },
    draft: (() => {
      const d = draftProfile(t);
      return {
        ...d,
        top5Share: pct(d.top5Share),
        tempo: draftTagOf(t),
        tempoScore: two(zDraftTempo[t]),
      };
    })(),
    // Every series (incl. Bo1) for the head-to-head "past meetings" panel
    matches: seriesByTeam[t]
      .map((m) => ({ opponent: m.opponent, score: m.score, won: m.won, tournament: m.tournament, date: m.date.slice(0, 10) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    report: null, // LLM scouting report, filled in later
  };
}).sort((a, b) => a.ranks.model - b.ranks.model);

const output = {
  meta: {
    generatedAt: new Date().toISOString(),
    windowStart: cache.meta.windowStart,
    games: games.length,
    // Quadrant lines sit at 0 = the average Worlds team on each axis
    lines: { game: 0, series: 0 },
    fieldAverage: {
      lead15Adjusted: whole(mean(Object.values(lead))),
      conversionRate: pct(mean(Object.values(conversion))),
      seriesStrength: two(mean(Object.values(seriesStrength))),
    },
  },
  teams,
};

fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync(process.env.PROCESS_OUTPUT ?? OUTPUT_PATH, JSON.stringify(output, null, 2));

// Summary table
console.log(`${games.length} games, ${views.length} team-games, ${allSeries.length} team-series\n`);
console.log('#   team   game  series  archetype              tags');
for (const t of teams) {
  const tags = [t.playstyle.tempo, t.draft.tempo, t.tags.clutch, t.tags.bust && 'Bust', t.tags.underrated && 'Underrated', t.tags.grit && 'Grit']
    .filter(Boolean)
    .join(', ');
  console.log(
    `${String(t.ranks.model).padEnd(3)} ${t.short.padEnd(5)} ${String(t.scores.game).padStart(5)} ${String(t.scores.series).padStart(7)}  ${t.archetype.padEnd(22)} ${tags}`,
  );
}
console.log(`\nWrote ${OUTPUT_PATH}`);