import { Fragment, useEffect, useState } from 'react';
import { seriesWinChance, compareTeams, pastMeetings, matchupKey, draftMatchup } from '../../shared/predict.js';
import { ChampionList } from './TeamCard';
import { ARCHETYPES, percent, score, signed } from '../lib/format';
import matchupData from '../data/matchups.json';

const THINK_MS = 600; // short "analyzing" pause before the text starts
const CHARS_PER_TICK = 3;
const TICK_MS = 16;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Pre-generated breakdown, typed out on screen. Matchups already watched this session show instantly.
const watched = new Set();

function useTypedText(key, fullText) {
  // Show it all at once if there's nothing to type, it's been watched, or the user prefers less motion
  const instant = !fullText || watched.has(key) || prefersReducedMotion();
  const [progress, setProgress] = useState({ key: null, length: 0 });

  // The effect only runs timers; state changes happen inside the timer callbacks
  useEffect(() => {
    if (instant) return undefined;
    let length = 0;
    let interval;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        length = Math.min(fullText.length, length + CHARS_PER_TICK);
        if (length === fullText.length) {
          clearInterval(interval);
          watched.add(key);
        }
        setProgress({ key, length });
      }, TICK_MS);
    }, THINK_MS);
    // Switching teams mid-typing stops the old one
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [key, fullText, instant]);

  const skip = () => {
    watched.add(key);
    setProgress({ key, length: fullText.length });
  };

  if (instant) return { shown: fullText, phase: 'done', skip };
  if (progress.key !== key) return { shown: '', phase: 'thinking', skip }; // new matchup, timer not started yet
  const done = progress.length >= fullText.length;
  return { shown: fullText.slice(0, progress.length), phase: done ? 'done' : 'typing', skip };
}

const formatStat = (format, x) => {
  if (x == null) return '—';
  if (format === 'pct') return percent(x);
  if (format === 'gold') return signed(x);
  if (format === 'score') return score(x);
  return x.toLocaleString('en-US');
};

function TeamPicker({ teams, value, other, onChange, side }) {
  return (
    <label className={`picker picker-${side}`}>
      <span className="picker-label">{side === 'a' ? 'Team A' : 'Team B'}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {teams.map((t) => (
          <option key={t.name} value={t.name} disabled={t.name === other}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function HeadToHead({ teams, a, b, onChange }) {
  const teamA = teams.find((t) => t.name === a);
  const teamB = teams.find((t) => t.name === b);

  const chanceA = seriesWinChance(teamA, teamB);
  const comparison = compareTeams(teamA, teamB, teams);
  const meetings = pastMeetings(teamA, teamB);
  const draft = draftMatchup(teamA, teamB);
  const favorite = chanceA >= 0.5 ? teamA : teamB;

  const key = matchupKey(a, b);
  const breakdown = matchupData.matchups[key]?.text ?? '';
  const typed = useTypedText(key, breakdown);

  const pctA = Math.round(chanceA * 100);

  return (
    <section className="h2h">
      <div className="h2h-pickers">
        <TeamPicker teams={teams} value={a} other={b} side="a" onChange={(name) => onChange(name, b)} />
        <button type="button" className="swap" onClick={() => onChange(b, a)} aria-label="Swap teams">
          ⇄
        </button>
        <TeamPicker teams={teams} value={b} other={a} side="b" onChange={(name) => onChange(a, name)} />
      </div>

      {/* Prediction */}
      <div className="prediction">
        <div className="prediction-teams">
          {[teamA, teamB].map((t, i) => (
            <div key={t.name} className={`prediction-team ${i === 0 ? 'left' : 'right'}`}>
              <div className="prediction-short" style={{ color: ARCHETYPES[t.archetype].color }}>{t.short}</div>
              <div className="prediction-pct">{i === 0 ? pctA : 100 - pctA}%</div>
              <div className="prediction-meta">{t.archetype} · #{t.ranks.model}</div>
            </div>
          ))}
        </div>
        {/* Favorite's side green, underdog's side red (neutral if it's a dead-even 50/50) */}
        <div className="prediction-bar" role="img" aria-label={`${teamA.short} ${pctA}%, ${teamB.short} ${100 - pctA}%`}>
          <span className={pctA === 50 ? 'even' : pctA > 50 ? 'fav' : 'dog'} style={{ width: `${pctA}%` }} />
          <span className={pctA === 50 ? 'even' : pctA < 50 ? 'fav' : 'dog'} style={{ width: `${100 - pctA}%` }} />
        </div>
        <p className="prediction-pick">
          Model pick: <strong>{favorite.name}</strong> to win the series · based on game strength
        </p>
      </div>

      <div className="h2h-grid">
        {/* Stat comparison */}
        <div className="h2h-panel">
          <h3>Tale of the tape</h3>
          <table className="tape">
            <thead>
              <tr>
                <th>{teamA.short}</th>
                <th />
                <th>{teamB.short}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['rating', 'Model rating · decides the pick'],
                ['context', 'Other context'],
              ].map(([group, title]) => (
                <Fragment key={group}>
                  <tr className="tape-group">
                    <td colSpan={3}>{title}</td>
                  </tr>
                  {comparison.filter((s) => s.group === group).map((s) => (
                    <tr key={s.key}>
                      <td className={s.edge === 'a' ? 'edge' : ''}>{formatStat(s.format, s.a)}</td>
                      <td className="tape-label">
                        {s.label}
                        {s.better === 'lower' && <span className="tape-hint">lower = steadier</span>}
                      </td>
                      <td className={s.edge === 'b' ? 'edge' : ''}>{formatStat(s.format, s.b)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>

          <h3 className="meetings-title">Draft &amp; style</h3>
          <table className="tape">
            <tbody>
              <tr>
                <td>{teamA.playstyle.tempo}</td>
                <td className="tape-label">Playstyle</td>
                <td>{teamB.playstyle.tempo}</td>
              </tr>
              <tr>
                <td>{teamA.draft.tempo ?? '—'}</td>
                <td className="tape-label">Draft lean</td>
                <td>{teamB.draft.tempo ?? '—'}</td>
              </tr>
              <tr>
                <td>{teamA.playstyle.avgGameMinutes} min</td>
                <td className="tape-label">Avg game length</td>
                <td>{teamB.playstyle.avgGameMinutes} min</td>
              </tr>
              <tr>
                <td>{teamA.draft.pool}</td>
                <td className="tape-label">Champion pool</td>
                <td>{teamB.draft.pool}</td>
              </tr>
            </tbody>
          </table>
          <ChampionList title="Contested" items={draft.contested.map((c) => ({ name: c, detail: '' }))} />
          <ChampionList title={`${teamA.short} bans ${teamB.short}'s`} items={draft.aTargets.map((c) => ({ name: c, detail: '' }))} />
          <ChampionList title={`${teamB.short} bans ${teamA.short}'s`} items={draft.bTargets.map((c) => ({ name: c, detail: '' }))} />
          <ChampionList title={`${teamA.short} plays`} items={teamA.draft.signature.slice(0, 4).map((c) => ({ name: c.champion, detail: `${c.wins}-${c.games - c.wins}` }))} />
          <ChampionList title={`${teamB.short} plays`} items={teamB.draft.signature.slice(0, 4).map((c) => ({ name: c.champion, detail: `${c.wins}-${c.games - c.wins}` }))} />

          <h3 className="meetings-title">Past meetings since MSI</h3>
          {meetings.length ? (
            <ul className="recent">
              {[...meetings].reverse().map((m) => (
                <li key={`${m.date}-${m.score}`} className={m.won ? 'win' : 'loss'}>
                  <span className="recent-score">{m.score}</span>
                  <span className="recent-opp">{m.won ? `${teamA.short} won` : `${teamB.short} won`}</span>
                  <span className="recent-event">{m.tournament}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No series between these teams since MSI.</p>
          )}
        </div>

        {/* AI breakdown */}
        <div className="h2h-panel">
          <h3>Analyst breakdown</h3>
          {!breakdown && <p className="muted">Breakdown for this matchup isn't available yet.</p>}
          {breakdown && typed.phase === 'thinking' && <p className="muted thinking">Analyzing matchup…</p>}
          {breakdown && typed.phase !== 'thinking' && (
            // Click the text to skip the typing
            <div
              className={`analysis${typed.phase === 'typing' ? ' typing' : ''}`}
              onClick={typed.phase === 'typing' ? typed.skip : undefined}
              title={typed.phase === 'typing' ? 'Click to show it all' : undefined}
              aria-live="polite"
            >
              {typed.shown.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}
            </div>
          )}
          <p className="fine-print">
            The pick comes from the model's scores. Breakdowns are generated with Groq from the same numbers shown here.
          </p>
        </div>
      </div>
    </section>
  );
}
