// Generate text with Groq, fact-check it, retry if needed. Used by reports.mjs and matchups.mjs.

import { groqChat, unknownNumbers } from '../../shared/llm.js';

const MAX_TRIES = 3;

export class DailyLimitError extends Error {}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns { text, flagged }. flagged = numbers in the text that aren't in `facts` (null if clean).
 * Waits out rate limits, retries empty answers and answers that cite unknown numbers.
 */
export async function generateChecked({ apiKey, model, messages, facts, label, reasoningEffort = 'medium', maxTokens = 6000 }) {
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let res;
    try {
      res = await groqChat({ apiKey, model, messages, reasoningEffort, maxTokens });
    } catch (err) {
      // Network blip (timeout, dropped connection): wait and retry, doesn't count as a failed try
      console.log(`  ${label}: network error (${err.cause?.code ?? err.message}), retrying in 15s`);
      await sleep(15_000);
      attempt--;
      continue;
    }

    if (res.status === 429) {
      // Free tier limits. Groq says how long to wait: "try again in 8.1s" or "try again in 5m49.5s"
      const body = await res.text();
      const m = body.match(/try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/);
      const wait = m ? (Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3])) : 20;
      if (/tokens per day|requests per day/.test(body) && wait > 120) {
        // Daily budget used up: stop cleanly (everything finished so far is already saved)
        throw new DailyLimitError(`Daily free-tier limit reached for ${model}. Try again in ~${Math.ceil(wait / 60)} min, or use another model.`);
      }
      console.log(`  rate limit, waiting ${Math.ceil(wait)}s...`);
      await sleep((wait + 1) * 1000);
      attempt--; // doesn't count as a failed try
      continue;
    }
    if (res.status >= 500) {
      console.log(`  ${label}: Groq ${res.status}, retrying in 10s`);
      await sleep(10_000);
      continue;
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);

    // Strip any markdown the model slips in (**bold**, headings, backticks)
    const text = ((await res.json()).choices?.[0]?.message?.content ?? '')
      .replace(/\*\*|__|`/g, '')
      .replace(/^#+\s*/gm, '')
      .trim();
    if (!text) {
      console.log(`  ${label}: attempt ${attempt} came back empty, retrying`);
      continue;
    }

    const unknown = unknownNumbers(text, facts);
    if (!unknown.length) return { text, flagged: null };
    console.log(`  ${label}: attempt ${attempt} cited numbers not in the facts (${unknown.join(', ')}), retrying`);
    if (attempt === MAX_TRIES) return { text, flagged: unknown };
  }
  throw new Error(`${label}: no usable answer after ${MAX_TRIES} tries`);
}
