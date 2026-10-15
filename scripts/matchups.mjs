// Matchup script. Run with: npm run matchups
// Pre-generates a head-to-head breakdown for every pair of Worlds teams (19 teams = 171 pairs)
// into src/data/matchups.json. The app reads that file, so the live site never calls the AI.
// Safe to stop and re-run: finished pairs are skipped unless their numbers changed.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { matchupMessages, MATCHUP_MODELS } from '../shared/llm.js';
import { seriesWinChance, compareTeams, pastMeetings, matchupKey, draftMatchup } from '../shared/predict.js';
import { generateChecked, DailyLimitError } from './lib/generate.mjs';
import { OUTPUT_PATH } from './config.mjs';

const MATCHUPS_PATH = 'src/data/matchups.json';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in .env');

const { teams } = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
const saved = fs.existsSync(MATCHUPS_PATH) ? JSON.parse(fs.readFileSync(MATCHUPS_PATH, 'utf8')) : { matchups: {} };
const matchups = saved.matchups;

function save() {
  fs.writeFileSync(MATCHUPS_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), matchups }, null, 2));
}

// Every unordered pair, written from the higher-ranked team's side (teams.json is sorted by model rank)
const pairs = [];
for (let i = 0; i < teams.length; i++) {
  for (let j = i + 1; j < teams.length; j++) pairs.push([teams[i], teams[j]]);
}

const modelRank = (model) => {
  const i = MATCHUP_MODELS.findIndex((m) => m.model === model);
  return i === -1 ? MATCHUP_MODELS.length : i;
};

// Everything a breakdown is based on: both teams' numbers and the matchup context
function dataHash(a, b) {
  const pick = (t) => ({ scores: t.scores, game: t.game, series: t.series, playstyle: t.playstyle, draft: t.draft, archetype: t.archetype, tags: t.tags, ranks: t.ranks });
  const ctx = {
    chanceA: seriesWinChance(a, b),
    comparison: compareTeams(a, b, teams).map((s) => [s.a, s.b, s.edge]),
    meetings: pastMeetings(a, b),
    draft: draftMatchup(a, b),
  };
  return crypto.createHash('sha1').update(JSON.stringify([pick(a), pick(b), ctx])).digest('hex').slice(0, 12);
}

// Remove breakdowns whose numbers have changed, so the site never shows text that disagrees with its stats
// (the app shows "not available yet" instead; the loop below writes fresh ones when budget allows)
const currentHashes = new Set(pairs.map(([a, b]) => `${matchupKey(a.name, b.name)}#${dataHash(a, b)}`));
let removed = 0;
for (const [key, m] of Object.entries(matchups)) {
  if (!currentHashes.has(`${key}#${m.hash}`)) {
    delete matchups[key];
    removed++;
  }
}
if (removed) {
  save();
  console.log(`Removed ${removed} out-of-date breakdown(s)`);
}

let written = 0;
let modelIndex = 0; // move to the next model when one's free daily budget runs out
const skipped = [];
for (const [index, [a, b]] of pairs.entries()) {
  const messages = matchupMessages(a, b, teams, {
    chanceA: seriesWinChance(a, b),
    comparison: compareTeams(a, b, teams),
    meetings: pastMeetings(a, b),
    draft: draftMatchup(a, b),
  });
  const facts = messages.map((m) => m.content).join('\n');
  const key = matchupKey(a.name, b.name);
  // Fingerprint of the DATA only (not prompt wording), so prompt tweaks don't throw away good breakdowns
  const hash = dataHash(a, b);
  const existing = matchups[key];
  // Keep it if the numbers haven't changed and no better model is available right now
  if (existing?.hash === hash && modelRank(existing.model) <= modelIndex) continue;

  const label = `${a.short} vs ${b.short}`;
  let result = null;
  // Up-to-date breakdowns are only rewritten by a BETTER model than the one that wrote them
  const upgradeOnly = existing?.hash === hash;
  const stopAt = upgradeOnly ? modelRank(existing.model) : MATCHUP_MODELS.length;
  // Try the current model; if it can't produce a usable answer for this pair, try the next one
  for (let i = modelIndex; !result && i < stopAt; i++) {
    const { model, reasoningEffort } = MATCHUP_MODELS[i];
    try {
      result = { ...(await generateChecked({ apiKey, model, messages, facts, label, reasoningEffort })), model };
    } catch (err) {
      console.log(`  ${err.message}`);
      if (err instanceof DailyLimitError && i === modelIndex) modelIndex++; // this model is done for today
    }
  }
  if (modelIndex >= MATCHUP_MODELS.length) {
    console.log('\nAll models are out of daily budget. Progress is saved; run `npm run matchups` again later to finish.');
    break;
  }
  if (!result) {
    if (!upgradeOnly) skipped.push(label); // no model could answer this pair right now; a re-run will try again
    continue;
  }
  const { text, flagged, model } = result;
  matchups[key] = { text, hash, flagged, model };
  written++;
  save();
  console.log(`${String(index + 1).padStart(3)}/${pairs.length} ${label.padEnd(14)} ${flagged ? `FLAGGED: ${flagged.join(', ')}` : 'ok'} (${model.split('/')[1]})`);
}

save();
if (skipped.length) console.log(`\nSkipped (no usable answer, re-run to retry): ${skipped.join(', ')}`);
const flaggedPairs = Object.entries(matchups).filter(([, m]) => m.flagged).map(([k]) => k);
console.log(`\nWrote ${written} new matchup(s). Total ${Object.keys(matchups).length}/${pairs.length}. Flagged: ${flaggedPairs.length ? flaggedPairs.join(', ') : 'none'}`);
