import { useEffect, useState } from 'react';
import data from './data/teams.json';
import reportData from './data/reports.json';
import QuadrantMap from './components/QuadrantMap';
import TeamCard from './components/TeamCard';
import HeadToHead from './components/HeadToHead';
import { ARCHETYPES } from './lib/format';
import './App.css';

// Shareable links: #h2h/GEN-T1 opens that matchup. Anything invalid falls back to the defaults.
function readHash(teams) {
  const match = window.location.hash.match(/^#h2h(?:\/([^-/]+)-([^-/]+))?$/i);
  if (!match) return null;
  const find = (short) => teams.find((t) => t.short.toLowerCase() === short?.toLowerCase())?.name;
  const a = find(match[1]);
  const b = find(match[2]);
  return a && b && a !== b ? [a, b] : [teams[0].name, teams[1].name];
}

export default function App() {
  const { teams } = data;
  const fromHash = readHash(teams);
  const [view, setView] = useState(fromHash ? 'h2h' : 'map'); // 'map' | 'h2h'
  // Start with the top-ranked team selected
  const [selected, setSelected] = useState(teams[0].name);
  const [pair, setPair] = useState(fromHash ?? [teams[0].name, teams[1].name]);
  const team = teams.find((t) => t.name === selected);

  // If someone edits the #h2h/... part of the address in an open tab, follow it
  useEffect(() => {
    const onHashChange = () => {
      const next = readHash(teams);
      if (next) {
        setPair(next);
        setView('h2h');
      } else {
        setView('map');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [teams]);

  // Keep the address bar in sync so a matchup can be shared
  useEffect(() => {
    const shortOf = (name) => teams.find((t) => t.name === name).short;
    const hash = view === 'h2h' ? `#h2h/${shortOf(pair[0])}-${shortOf(pair[1])}` : '';
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  }, [view, pair, teams]);

  // Team card "Compare" button: open head-to-head with this team vs the current opponent (or the next best team)
  function compare(name) {
    const opponent = pair[1] !== name ? pair[1] : teams.find((t) => t.name !== name).name;
    setPair([name, opponent]);
    setView('h2h');
  }

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">WORLDS 2026</span>
          <h1>Moneyball</h1>
        </div>
        <p className="tagline">
          Every Worlds team by how they play and whether they win. Built on every pro game since MSI, adjusted for
          strength of schedule.
        </p>
      </header>

      <nav className="tabs" aria-label="View">
        <button type="button" className={view === 'map' ? 'active' : ''} aria-pressed={view === 'map'} onClick={() => setView('map')}>
          Quadrant map
        </button>
        <button type="button" className={view === 'h2h' ? 'active' : ''} aria-pressed={view === 'h2h'} onClick={() => setView('h2h')}>
          Head-to-head
        </button>
      </nav>

      {view === 'map' ? (
        <main className="layout">
          <section className="map-panel">
            <QuadrantMap teams={teams} selected={selected} onSelect={setSelected} />
            <div className="legend">
              {Object.entries(ARCHETYPES).map(([name, a]) => (
                <span key={name} className="legend-item">
                  <span className="legend-dot" style={{ background: a.color }} />
                  {name}
                </span>
              ))}
              <span className="legend-note">Bigger dot = more consistent · Lines = average Worlds team</span>
            </div>
          </section>

          <aside className="card-panel">
            <TeamCard
              team={team}
              teamCount={teams.length}
              report={reportData.reports[team.name]?.text}
              onCompare={() => compare(team.name)}
            />
          </aside>
        </main>
      ) : (
        <main>
          <HeadToHead teams={teams} a={pair[0]} b={pair[1]} onChange={(a, b) => setPair([a, b])} />
        </main>
      )}
    </div>
  );
}
