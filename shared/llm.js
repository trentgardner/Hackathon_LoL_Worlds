// LLM helpers for scripts/reports.mjs and scripts/matchups.mjs (both run locally, ahead of time).
// The LLM only writes prose. Every number and every comparison it sees was computed in code.

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const REPORT_MODEL = 'openai/gpt-oss-120b';
// Reports, best first; the next model takes over when one's free daily budget runs out.
// GPT OSS 20B was dropped (Oct 15): it gave numbers to the wrong team. Missing text waits for budget instead.
export const REPORT_MODELS = [
  { model: 'openai/gpt-oss-120b', reasoningEffort: 'medium' },
  { model: 'qwen/qwen3.8-27b', reasoningEffort: 'none' },
];
// Matchups, best first. Qwen tested most accurate (thinking off: ~1,550 tokens per matchup instead of ~4,000).
// When a model's free daily budget runs out, the next one takes over. Later runs upgrade
// breakdowns written by a lower model as soon as a better one has budget again.
export const MATCHUP_MODELS = [
  { model: 'qwen/qwen3.8-27b', reasoningEffort: 'none' },
  { model: 'openai/gpt-oss-120b', reasoningEffort: 'low' },
];

/**
 * Call Groq's chat endpoint. Returns the fetch Response.
 * reasoningEffort: gpt-oss "thinks" before answering. 'low' = fast, 'medium' = more careful.
 */
export function groqChat({ apiKey, model, messages, stream = false, maxTokens = 4000, reasoningEffort = 'low' }) {
  return fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream,
      temperature: 0.5,
      max_completion_tokens: maxTokens,
      reasoning_effort: reasoningEffort,
    }),
  });
}

// ---------- Fact sheet ----------

const ARCHETYPE_MEANINGS = {
  Powerhouse: 'above-average game stats AND above-average series results: a real contender',
  Scrappy: 'below-average game stats but above-average series results: wins more than their stats say',
  'Dark horse': 'above-average game stats but below-average series results: dangerous on their day, drops series it could win',
  'Bottom of the barrel': 'below average in both game stats and series results',
};

const TAG_MEANINGS = {
  Clutch: 'series results rank well above their game stats',
  Fragile: 'game stats rank well above their series results',
  Underrated: 'the data rates them well above their seed and pool',
  'Bust risk': 'seeded well above what the data says',
  Grit: 'has reverse-swept a series (down 0-2, won)',
};

function tagList(team) {
  const tags = [];
  if (team.tags.clutch) tags.push(team.tags.clutch);
  if (team.tags.underrated) tags.push('Underrated');
  if (team.tags.bust) tags.push('Bust risk');
  if (team.tags.grit) tags.push('Grit');
  return tags;
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;
const gold = (n) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const plain = (n) => Math.round(n).toLocaleString('en-US');

/**
 * One stat, already compared in code: "69.0% (below the field average of 78.7%, 15th of 19)".
 * The model never has to decide which number is bigger.
 */
function compare(teams, team, get, format, { lowerIsBetter = false } = {}) {
  const value = get(team);
  if (value == null) return 'no data yet';
  const values = teams.map(get).filter((x) => x != null);
  const avg = values.reduce((sum, x) => sum + x, 0) / values.length;
  const rank = [...values].sort((a, b) => (lowerIsBetter ? a - b : b - a)).indexOf(value) + 1;

  const spread = Math.max(...values) - Math.min(...values);
  const close = Math.abs(value - avg) < spread * 0.05;
  const better = lowerIsBetter ? value < avg : value > avg;
  const word = close ? 'about level with' : better ? 'better than' : 'worse than';
  return `${format(value)} (${word} the field average of ${format(avg)}; ${ordinal(rank)} of ${values.length})`;
}

/**
 * Plain-text fact sheet for one team. Every comparison is pre-computed.
 */
export function teamFacts(team, teams) {
  const n = teams.length;
  const g = team.game;
  const s = team.series;
  const tags = tagList(team);
  const c = (get, format, opts) => compare(teams, team, get, format, opts);
  const recent = team.matches.slice(-5).reverse()
    .map((m) => `${m.won ? 'W' : 'L'} ${m.score} vs ${m.opponent} (${m.tournament})`).join('; ');

  return [
    `Team: ${team.name} (${team.short}), ${team.region}. Region seed ${team.seed}, ${team.pool ? `draw pool ${team.pool}` : 'Play-In team (no draw pool)'}.`,
    `Model rank: ${ordinal(team.ranks.model)} of ${n}. The model rank comes from game performance only (adjusted lead at 15, ceiling, lead conversion): in backtests that predicted future wins better than series records, which lean on close-series luck. Hype rank from seed + pool: ${ordinal(team.ranks.hype)} of ${n}.`,
    `Archetype: ${team.archetype}, meaning ${ARCHETYPE_MEANINGS[team.archetype]}.`,
    `Tags: ${tags.length ? tags.map((t) => `${t} (${TAG_MEANINGS[t]})`).join('; ') : 'none'}.`,
    `Model rating / game score (opponent-adjusted, 0 = average Worlds team): ${c((t) => t.scores.game, (x) => x.toFixed(2))}.`,
    `Series score (opponent-adjusted series results, 0 = average Worlds team; context about winning when it counts, not part of the model rank): ${c((t) => t.scores.series, (x) => x.toFixed(2))}.`,
    `Games since MSI: ${g.games}. Game win rate: ${c((t) => t.game.winRate, pct)}.`,
    `Lead at 15 minutes, gold + XP, ADJUSTED for opponent strength: ${c((t) => t.game.lead15Adjusted, gold)}.`,
    `Lead at 15 minutes, gold + XP, RAW (not adjusted): ${gold(g.lead15Raw)} (gold ${gold(g.goldDiff15)}, XP ${gold(g.xpDiff15)}).`,
    `Win rate when ahead at 15 (lead conversion): ${c((t) => t.game.conversionRate, pct)}.`,
    `Win rate when behind at 15 (comebacks): ${c((t) => t.game.comebackRate, pct)}.`,
    `Ceiling, average of their best 25% of games (adjusted): ${c((t) => t.game.ceiling, gold)}.`,
    `Volatility, spread of the gold swing from 15 minutes to game end (lower = steadier): ${c((t) => t.game.swingSpread, plain, { lowerIsBetter: true })}.`,
    `Series played (Bo3/Bo5): ${s.series}. Raw series win rate: ${c((t) => t.series.winRate, pct)}.`,
    `Of the series they won, clean sweeps: ${pct(s.sweepRate)}. Record in series that went the distance (2-1 or 3-2): ${s.closeSeriesWinRate == null ? 'none played' : pct(s.closeSeriesWinRate)}. Reverse sweeps: ${s.reverseSweeps}.`,
    `Playstyle (from results): ${team.playstyle.tempo}. Average game length: ${c((t) => t.playstyle.avgGameMinutes, (x) => `${x.toFixed(1)} min`, { lowerIsBetter: true }).replace('better than', 'shorter than').replace('worse than', 'longer than')}.`,
    `Draft (since MSI): ${team.draft.pool} different champions played (${ordinal(rankOf(teams, (t) => t.draft.pool, team))} deepest pool of ${n}); their top 5 picks make up ${team.draft.top5Share}% of picks.`,
    `Most-played champions (wins-losses): ${team.draft.signature.map((x) => `${x.champion} ${x.wins}-${x.games - x.wins}`).join(', ')}.`,
    `They ban most: ${team.draft.bans.map((x) => `${x.champion} (${x.count})`).join(', ')}. Opponents ban against them most: ${team.draft.bannedAgainst.map((x) => `${x.champion} (${x.count})`).join(', ')}.`,
    `Draft lean (which champions they pick, judged by how those champions do at 15 in other teams' games): ${team.draft.tempo ?? 'no clear lean'}. This can differ from playstyle, which comes from their own results.`,
    `Last 5 series, newest first: ${recent}.`,
  ].join('\n');
}

// Rank (1 = highest value) of a team on one stat
function rankOf(teams, get, team) {
  return teams.map(get).sort((x, y) => y - x).indexOf(get(team)) + 1;
}

// ---------- Prompts ----------

const STYLE_RULES = [
  'Voice: a professional analyst on an esports broadcast desk. Confident, precise, plain English, no hype words.',
  'Use ONLY the facts given. Never invent player names, rosters, champions, drafts, quotes, events, or storylines.',
  'Every comparison is already worked out in the facts ("better than", "worse than", rank). Repeat those comparisons exactly; never reverse them or make your own.',
  'Copy numbers exactly as written in the facts. Do not round, add, subtract, or combine them.',
  '"About level with" the field average means about average: say "about average", never better or worse.',
  'Playstyle (from results) and draft lean (champion choice) are different things. Never merge them into one phrase like "early-game scaling picks".',
  'Write numbers as digits with symbols, exactly as in the facts: +2,267, 54%, -0.09. Never spell them out ("plus", "percent").',
  'Pick the 3 or 4 most telling numbers. Do not list every stat.',
  'If you cite the adjusted lead at 15, call it adjusted for opponent strength.',
  'Each stat comes with its meaning in brackets. Describe what a number means exactly as given; never reverse it (e.g. lower volatility means steadier).',
  'No headings, no bullet points, no markdown, no asterisks. Plain prose only.',
].join(' ');

/**
 * Messages for one team's scouting report (analyst-desk breakdown).
 */
export function reportMessages(team, teams) {
  return [
    {
      role: 'system',
      content: `You write team scouting reports for a League of Legends Worlds 2026 stats site. ${STYLE_RULES} Hard limit: 120 words, two short paragraphs.`,
    },
    {
      role: 'user',
      content: [
        'Write the scouting report for this team, structured like an analyst-desk breakdown:',
        'paragraph 1 = their identity (archetype) and their win condition (how they actually win, per the numbers);',
        'paragraph 2 = where they fall apart, then one specific thing to watch at Worlds.',
        '',
        teamFacts(team, teams),
      ].join('\n'),
    },
  ];
}

// ---------- Fact check ----------

// Numbers that can appear without being in the facts: minute 15, the year, "best 25%", small counts
const ALWAYS_OK = new Set([0, 1, 2, 3, 4, 5, 15, 25, 2026]);

const numbersIn = (text) =>
  [...text.replace(/[−–]/g, '-').matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Math.abs(Number(m[0].replace(/[,+]/g, ''))))
    .filter((x) => !Number.isNaN(x));

/**
 * Numbers in the report that don't appear in the facts. Empty array = passed.
 * Allows rounding (69.0% written as 69%).
 */
export function unknownNumbers(report, facts) {
  const known = numbersIn(facts);
  return [...new Set(numbersIn(report))].filter(
    (x) => !ALWAYS_OK.has(x) && !known.some((k) => Math.abs(k - x) < 0.51),
  );
}

// ---------- Head-to-head ----------

const fmtStat = (format, x) => {
  if (x == null) return 'n/a';
  if (format === 'pct') return pct(x);
  if (format === 'gold') return gold(x);
  if (format === 'score') return `${x > 0 ? '+' : ''}${x.toFixed(2)}`;
  return plain(x);
};

// Short profile for matchups: identity only. The stats themselves are in the comparison table.
function teamProfile(team, n) {
  const tags = tagList(team);
  return `${team.short} = ${team.name} (${team.region}, region seed ${team.seed}). Model rank ${ordinal(team.ranks.model)} of ${n}. `
    + `Archetype ${team.archetype}: ${ARCHETYPE_MEANINGS[team.archetype]}. `
    + `Tags: ${tags.length ? tags.map((t) => `${t} (${TAG_MEANINGS[t]})`).join('; ') : 'none'}.`;
}

/**
 * Messages for a head-to-head breakdown. `prediction` and `comparison` come from shared/predict.js.
 */
export function matchupMessages(a, b, teams, { chanceA, comparison, meetings, draft }) {
  const fav = chanceA >= 0.5 ? a : b;
  const dog = fav === a ? b : a;
  const favChance = Math.round(Math.max(chanceA, 1 - chanceA) * 100);

  const edgeLines = (group) => comparison.filter((s) => s.group === group).map((s) => {
    const who = s.edge === 'a' ? `edge ${a.short}` : s.edge === 'b' ? `edge ${b.short}` : 'even';
    return `${s.label} (${s.meaning}): ${a.short} ${fmtStat(s.format, s.a)} vs ${b.short} ${fmtStat(s.format, s.b)} -> ${who}`;
  }).join('\n');

  const history = meetings.length
    ? meetings.map((m) => `${m.won ? `${a.short} won` : `${b.short} won`} ${m.won ? m.score : m.score.split('-').reverse().join('-')} (${m.tournament}, ${m.date})`).join('; ')
    : 'They have not played each other since MSI.';

  return [
    {
      role: 'system',
      content: `You write head-to-head matchup breakdowns for a League of Legends Worlds 2026 stats site. ${STYLE_RULES} The model's pick is final: explain it, never overrule it. Only call a stat an edge if the comparison marks it as an edge; stats marked even are not edges for either team. Hard limit: 170 words, three short paragraphs.`,
    },
    {
      role: 'user',
      content: [
        'Write the matchup breakdown, structured like an analyst-desk preview:',
        `paragraph 1 = the pick: ${fav.name} at ${favChance}% to win the series, and the main reason, taken ONLY from the MODEL RATING stats;`,
        `paragraph 2 = where ${dog.name} can win this (their best edges from any section, including series results);`,
        'paragraph 3 = the draft and style battle (contested champions, target bans, tempo), then past meetings if they have played.',
        '',
        `MODEL PICK: ${fav.name} (${favChance}% to win a series). This is decided by the numbers and is final.`,
        'The pick comes only from the model rating (game strength). In backtests it predicted future wins better than series records, which lean on close-series luck. Never say series results decide the pick.',
        '',
        'MODEL RATING STATS (these decide the pick; edge already decided):',
        edgeLines('rating'),
        '',
        'OTHER CONTEXT (not part of the pick; edge already decided):',
        edgeLines('context'),
        '',
        `PAST MEETINGS SINCE MSI: ${history}`,
        '',
        'STYLE AND DRAFT:',
        `Playstyle (from results): ${a.short} ${a.playstyle.tempo}, ${b.short} ${b.playstyle.tempo}. Average game length: ${a.short} ${a.playstyle.avgGameMinutes} min, ${b.short} ${b.playstyle.avgGameMinutes} min.`,
        `Draft lean (champion choice, can differ from playstyle): ${a.short} ${a.draft.tempo ?? 'no clear lean'}, ${b.short} ${b.draft.tempo ?? 'no clear lean'}.`,
        `Champion pools: ${a.short} ${a.draft.pool} champions, ${b.short} ${b.draft.pool} champions.`,
        `${a.short} most-played (W-L): ${a.draft.signature.map((x) => `${x.champion} ${x.wins}-${x.games - x.wins}`).join(', ')}.`,
        `${b.short} most-played (W-L): ${b.draft.signature.map((x) => `${x.champion} ${x.wins}-${x.games - x.wins}`).join(', ')}.`,
        `Contested (in both teams' top 10 picks, likely early picks or bans): ${draft.contested.length ? draft.contested.join(', ') : 'none'}.`,
        `${a.short} often bans these ${b.short} comfort picks: ${draft.aTargets.length ? draft.aTargets.join(', ') : 'none'}. ${b.short} often bans these ${a.short} comfort picks: ${draft.bTargets.length ? draft.bTargets.join(', ') : 'none'}.`,
        '',
        'TEAM PROFILES:',
        teamProfile(a, teams.length),
        teamProfile(b, teams.length),
      ].join('\n'),
    },
  ];
}
