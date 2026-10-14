// Shared settings for the fetch + process scripts.

// Data window: MSI 2026 start date through now
export const WINDOW_START = '2026-06-28';

// Leaguepedia page for the Worlds field (TournamentRosters.OverviewPage starts with this)
export const WORLDS_OVERVIEW = '2026 Season World Championship';

// Leaguepedia Tournament names for the weighted international events.
// Everything else (domestic splits, KeSPA Cup, CBLOL Promotion) counts as domestic.
// Demacia Cup dropped: no Worlds team played in it.
export const EVENTS = {
  msi: 'MSI 2026',
  ewc: 'Esports World Cup 2026',
};

// Event weights. Starting values, tune once real numbers are in.
export const EVENT_WEIGHTS = {
  msi: 2.0,
  ewc: 1.75,
  domesticVsWorlds: 1.25,
  domesticVsOther: 1.0,
};

// Worlds 2026 seeds, hand-copied from the Leaguepedia "2026 Season World Championship" page (Oct 14).
// seed = place within the team's region. pool = Riot's cross-region draw tier (1 = strongest).
// Play-In teams have no pool.
export const SEEDS = {
  'Gen.G': { seed: 1, pool: 1 },
  'Hanwha Life Esports': { seed: 2, pool: 2 },
  'T1': { seed: 3, pool: 3 },
  'Dplus Kia': { seed: 4, pool: 4 },
  "Anyone's Legend": { seed: 1, pool: 1 },
  'Bilibili Gaming': { seed: 2, pool: 2 },
  'Top Esports': { seed: 3, pool: 3 },
  'Invictus Gaming': { seed: 4, pool: 4 },
  'Team Liquid': { seed: 1, pool: 1 },
  'LYON (2024 American Team)': { seed: 2, pool: 3 },
  'Cloud9': { seed: 3, pool: null },
  'G2 Esports': { seed: 1, pool: 1 },
  'Movistar KOI': { seed: 2, pool: 3 },
  'Karmine Corp': { seed: 3, pool: null },
  'Team Secret Whales': { seed: 1, pool: 2 },
  'CTBC Flying Oyster': { seed: 2, pool: 4 },
  'MVK Esports': { seed: 3, pool: null },
  'LØS': { seed: 1, pool: 2 },
  'FURIA': { seed: 2, pool: null },
};

// Overhyped / bust tag. hype = (POOL_WEIGHT * pool + seed) / (POOL_WEIGHT + 1), lower = more hyped.
// Play-In teams count as pool 5. Flag a team when its hype rank beats our model rank by BUST_GAP+ places.
export const HYPE = {
  POOL_WEIGHT: 2,
  PLAY_IN_POOL: 5,
  BUST_GAP: 4, // starting value, tune once real scores exist
};

// Leaguepedia tournament name (prefix) -> lolesports league slug.
// Used to find each game's lolesports ID. Order matters: first prefix that matches wins.
export const LEAGUE_SLUGS = [
  ['MSI 2026', 'msi'],
  ['Esports World Cup 2026', 'ewc_lol'],
  ['KeSPA Cup', 'kespa_cup'],
  ['CBLOL 2027 Promotion', 'cblol_promotion'],
  ['CBLOL', 'cblol-brazil'],
  ['LCK', 'lck'],
  ['LPL', 'lpl'],
  ['LEC', 'lec'],
  ['LCS', 'lcs'],
  ['LCP', 'lcp'],
];

// Single cache file for everything fetched. Delete it to wipe all downloaded data.
export const CACHE_PATH = 'data/cache.json';

// Delay between API calls so we stay under rate limits
export const REQUEST_DELAY_MS = 1500;
