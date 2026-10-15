// Head-to-head prediction. Pure math, used by the app and scripts/matchups.mjs (to tell the LLM the pick).
// The numbers decide the pick; the LLM only explains it.

// Fitted OUT-OF-SAMPLE: teams rated on games before Aug 1/10/15/20, scored on 145 later series between
// Worlds teams. Favorites won ~70% across confidence bands, so the curve is kept gentle.
export const PREDICTION_K = 1.05;

/**
 * Chance team A wins a series against team B, from their overall model scores.
 */
export function seriesWinChance(a, b) {
  return 1 / (1 + Math.exp(-PREDICTION_K * (a.scores.overall - b.scores.overall)));
}

/**
 * Stats compared side by side. better: which direction is good. meaning: plain English, given to the LLM.
 * group: 'rating' = the inputs of the model rating (they decide the pick); 'context' = everything else.
 */
export const COMPARE_STATS = [
  { key: 'game', group: 'rating', label: 'Model rating (game score)', get: (t) => t.scores.game, better: 'higher', format: 'score', meaning: 'overall game-by-game strength, adjusted for opponents' },
  { key: 'lead', group: 'rating', label: 'Lead @15 (adjusted)', get: (t) => t.game.lead15Adjusted, better: 'higher', format: 'gold', meaning: 'average gold + XP lead at 15 minutes, adjusted for opponents; higher = stronger early game' },
  { key: 'conv', group: 'rating', label: 'Converts leads', get: (t) => t.game.conversionRate, better: 'higher', format: 'pct', meaning: 'win rate when ahead at 15 minutes; higher = closes out leads' },
  { key: 'ceiling', group: 'rating', label: 'Ceiling', get: (t) => t.game.ceiling, better: 'higher', format: 'gold', meaning: 'how dominant their best 25% of games are' },
  { key: 'comeback', group: 'context', label: 'Comebacks', get: (t) => t.game.comebackRate, better: 'higher', format: 'pct', meaning: 'win rate when behind at 15 minutes; higher = better at coming back' },
  { key: 'spread', group: 'context', label: 'Volatility', get: (t) => t.game.swingSpread, better: 'lower', format: 'plain', meaning: 'how much games flip after minute 15; LOWER = steadier and more predictable, HIGHER = more volatile' },
  { key: 'series', group: 'context', label: 'Series score', get: (t) => t.scores.series, better: 'higher', format: 'score', meaning: 'how well they win Bo3/Bo5 series, adjusted for opponents' },
  { key: 'serieswin', group: 'context', label: 'Series win rate', get: (t) => t.series.winRate, better: 'higher', format: 'pct', meaning: 'raw share of series won, not adjusted for opponents' },
  { key: 'close', group: 'context', label: 'Close series (2-1 / 3-2)', get: (t) => t.series.closeSeriesWinRate, better: 'higher', format: 'pct', meaning: 'record in series that went the distance' },
];

/**
 * Which side wins each stat: 'a', 'b', or 'even' (within 3% of the field's range).
 */
export function compareTeams(a, b, teams) {
  return COMPARE_STATS.map((stat) => {
    const va = stat.get(a);
    const vb = stat.get(b);
    const all = teams.map(stat.get).filter((x) => x != null);
    const range = Math.max(...all) - Math.min(...all);
    let edge = 'even';
    if (va != null && vb != null && Math.abs(va - vb) > range * 0.03) {
      const aHigher = va > vb;
      edge = (stat.better === 'higher') === aHigher ? 'a' : 'b';
    }
    return { ...stat, a: va, b: vb, edge };
  });
}

/**
 * Past series between the two teams (from A's side), oldest first.
 */
export function pastMeetings(a, b) {
  return a.matches.filter((m) => m.opponent === b.name);
}

/**
 * Order-independent key for a pair of teams, so "T1 vs Gen.G" and "Gen.G vs T1" share one breakdown.
 */
export function matchupKey(nameA, nameB) {
  return [nameA, nameB].sort().join(' | ');
}

/**
 * Draft clash between two teams (from teams.json draft profiles).
 * contested: champions in both teams' top 10 picks (likely early picks or bans).
 * aTargets: B's top picks that A bans a lot (and bTargets the other way round).
 */
export function draftMatchup(a, b) {
  const names = (list) => list.map((x) => x.champion);
  const bTop = names(b.draft.topPicks);
  const aTop = names(a.draft.topPicks);
  return {
    contested: aTop.filter((c) => bTop.includes(c)),
    aTargets: a.draft.bans.filter((x) => bTop.includes(x.champion)).map((x) => x.champion),
    bTargets: b.draft.bans.filter((x) => aTop.includes(x.champion)).map((x) => x.champion),
  };
}
