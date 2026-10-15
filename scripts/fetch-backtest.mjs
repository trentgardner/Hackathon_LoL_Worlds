// Backtest data: the same fetch, but from the start of the spring split into a separate cache file,
// so the site's own data (data/cache.json) is never touched. Run with: npm run fetch:backtest
process.env.WINDOW_START = '2026-04-01';
process.env.CACHE_PATH = 'data/cache-backtest.json';
await import('./fetch.mjs');
