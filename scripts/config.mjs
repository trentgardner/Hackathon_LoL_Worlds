// Shared settings for the fetch + process scripts.

// Data window: MSI 2026 start date through now
export const WINDOW_START = process.env.WINDOW_START ?? '2026-06-28';
// (WINDOW_START / CACHE_PATH can be overridden for backtests, e.g. fetching the spring split into a separate file)

// Leaguepedia page for the Worlds field (TournamentRosters.OverviewPage starts with this)
export const WORLDS_OVERVIEW = '2026 Season World Championship';

// Leaguepedia Tournament names for the weighted international events.
// Everything else (domestic splits, KeSPA Cup, CBLOL Promotion) counts as domestic.
// Demacia Cup dropped: no Worlds team played in it.
export const EVENTS = {
  msi: 'MSI 2026',
  ewc: 'Esports World Cup 2026',
};

// Leaguepedia event pages for the same events (used for series that have no scoreboard games)
export const EVENT_PAGES = {
  msi: '2026 Mid-Season Invitational',
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
// Play-In teams count as pool 5. Hype and model score are compared on the same scale (0 = average Worlds team):
// model beats hype by TAG_GAP+ = Underrated, hype beats model by TAG_GAP+ = Bust.
export const HYPE = {
  POOL_WEIGHT: 2,
  PLAY_IN_POOL: 5,
  TAG_GAP: 1.0, // in standard steps; 1.0 tags 4 teams each way on current data
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
export const CACHE_PATH = process.env.CACHE_PATH ?? 'data/cache.json';

// Delay between API calls so we stay under rate limits
export const REQUEST_DELAY_MS = 1500;

// Lead @15 (gold diff + XP diff) within ± this counts as "even": left out of conversion/choke/comeback rates
export const EVEN_ZONE = 1000;

// Shrink small samples toward the Worlds-field average.
// k = sample size where a team's own number counts half and the field average counts half.
export const SHRINK = {
  games: 10,
  series: 6,
};

// Clutch / fragile tag: game rank and series rank this many places apart
export const TAG_GAP = 4;

// Where the processed team table goes (the app reads this)
export const OUTPUT_PATH = 'src/data/teams.json';

// Playstyle + draft tags. Scores are in standard steps from the Worlds-field average.
export const STYLE = {
  TEMPO_TAG: 0.6, // tempo (early lead + short games) beyond this = Early game / Late game, else Flexible
  DRAFT_TAG: 1.0, // draft tempo is a softer signal, so only clear outliers get a tag
  MIN_CHAMP_GAMES: 8, // a champion needs this many games (from other teams) to count toward draft tempo
};

// Overall rating (ranking + predictions) = this much game score + the rest series score.
// Backtest (Oct 14): teams rated on games before Aug 1 / 10 / 15 / 20, scored on ~145 later series and
// ~500 later games between Worlds teams. Game score alone predicted best (69.7% of series, log-loss 0.629);
// adding any series score made predictions worse. Series score still drives the map's Y axis, archetypes
// and clutch/fragile tags, it just doesn't drive predictions.
export const OVERALL_GAME_WEIGHT = 1.0;
