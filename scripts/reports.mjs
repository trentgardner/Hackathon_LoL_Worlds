// Scouting report script. Run with: npm run reports
// Writes one LLM scouting report per team into src/data/reports.json.
// Skips teams whose numbers haven't changed since their last report, so re-runs are cheap.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { reportMessages, teamFacts, REPORT_MODELS } from '../shared/llm.js';
import { generateChecked, DailyLimitError } from './lib/generate.mjs';
import { OUTPUT_PATH } from './config.mjs';

const REPORTS_PATH = 'src/data/reports.json';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('Missing GROQ_API_KEY in .env');

const { teams } = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
const saved = fs.existsSync(REPORTS_PATH) ? JSON.parse(fs.readFileSync(REPORTS_PATH, 'utf8')) : { reports: {} };
const reports = saved.reports;

function save() {
  fs.writeFileSync(REPORTS_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2));
}

const modelRank = (model) => {
  const i = REPORT_MODELS.findIndex((m) => m.model === model);
  return i === -1 ? REPORT_MODELS.length : i;
};

// Remove reports whose numbers have changed, so the site never shows a report that disagrees with its stats
let removed = 0;
for (const team of teams) {
  const r = reports[team.name];
  if (r && r.hash !== crypto.createHash('sha1').update(teamFacts(team, teams)).digest('hex').slice(0, 12)) {
    delete reports[team.name];
    removed++;
  }
}
if (removed) {
  save();
  console.log(`Removed ${removed} out-of-date report(s)`);
}

let written = 0;
let modelIndex = 0; // move to the next model when one's free daily budget runs out
for (const team of teams) {
  const facts = teamFacts(team, teams);
  const hash = crypto.createHash('sha1').update(facts).digest('hex').slice(0, 12);
  const existing = reports[team.name];
  // Keep it if the numbers are unchanged and no better model is available right now
  if (existing?.hash === hash && modelRank(existing.model) <= modelIndex) continue;
  const stopAt = existing?.hash === hash ? modelRank(existing.model) : REPORT_MODELS.length; // never downgrade

  let result = null;
  for (let i = modelIndex; !result && i < stopAt; i++) {
    const { model, reasoningEffort } = REPORT_MODELS[i];
    try {
      result = { ...(await generateChecked({ apiKey, model, messages: reportMessages(team, teams), facts, label: team.short, reasoningEffort })), model };
    } catch (err) {
      console.log(`  ${err.message}`);
      if (err instanceof DailyLimitError && i === modelIndex) modelIndex++;
    }
  }
  if (!result) {
    if (modelIndex >= REPORT_MODELS.length) {
      console.log('All models are out of daily budget. Run `npm run reports` again later.');
      break;
    }
    continue;
  }
  const { text, flagged, model } = result;
  reports[team.name] = { text, hash, flagged, model };
  written++;
  save(); // after every team, so a crash never loses finished reports
  console.log(`${team.short.padEnd(5)} ${flagged ? `FLAGGED: ${flagged.join(', ')}` : 'ok'} (${text.split(/\s+/).length} words, ${model.split('/')[1]})`);
}

save();
const flaggedTeams = Object.entries(reports).filter(([, r]) => r.flagged).map(([name]) => name);
console.log(`\nWrote ${written} new report(s) to ${REPORTS_PATH}. Flagged for review: ${flaggedTeams.length ? flaggedTeams.join(', ') : 'none'}`);
