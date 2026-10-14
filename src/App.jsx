import { useState } from 'react';
import data from './data/teams.json';
import QuadrantMap from './components/QuadrantMap';
import TeamCard from './components/TeamCard';
import { ARCHETYPES } from './lib/format';
import './App.css';

export default function App() {
  const { teams, meta } = data;
  // Start with the top-ranked team selected
  const [selected, setSelected] = useState(teams[0].name);
  const team = teams.find((t) => t.name === selected);

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-mark">WORLDS 2026</span>
          <h1>Moneyball</h1>
        </div>
        <p className="tagline">
          Every Worlds team by how they play and whether they win. {meta.games} pro games since MSI, adjusted for
          strength of schedule.
        </p>
      </header>

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
          <TeamCard team={team} teamCount={teams.length} />
        </aside>
      </main>
    </div>
  );
}
