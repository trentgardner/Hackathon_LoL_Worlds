// Read/write the single cache file (data/cache.json).
//
// Cache shape:
// {
//   meta:  { fetchedAt, windowStart },
//   teams: { [teamName]: { region, seed, ... } },
//   games: { [leaguepediaGameId]: { ...leaguepedia fields, lolesportsGameId, snap15 } }
// }
//
// Games that already have a snap15 can be skipped on a re-run, so a crashed
// fetch picks up where it left off instead of starting over.
import fs from 'node:fs';
import { CACHE_PATH } from '../config.mjs';

/**
 * Load the cache from disk.
 * Returns an empty cache ({ meta: {}, teams: {}, games: {} }) if the file doesn't exist yet.
 */
export function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) {
    return {meta: {}, teams: {}, games: {}};
  }
  const text = fs.readFileSync(CACHE_PATH, 'utf8');
  return JSON.parse(text);
}

/**
 * Save the cache to disk.
 * Create the data/ folder first if it doesn't exist.
 */
export function saveCache(cache) {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}
