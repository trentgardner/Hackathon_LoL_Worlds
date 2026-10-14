import { ARCHETYPES, percent, score, signed } from '../lib/format';

// Tag chips: label + whether it's a good or bad sign + what it means
function tagsOf(team) {
  const tags = [];
  if (team.tags.clutch === 'Clutch') tags.push({ label: 'Clutch', tone: 'good', hint: 'Wins more series than their game stats say' });
  if (team.tags.clutch === 'Fragile') tags.push({ label: 'Fragile', tone: 'bad', hint: 'Game stats are better than their series results' });
  if (team.tags.underrated) tags.push({ label: 'Underrated', tone: 'good', hint: 'Data rates them well above their seed and pool' });
  if (team.tags.bust) tags.push({ label: 'Bust risk', tone: 'bad', hint: 'Seeded well above what the data says' });
  if (team.tags.grit) tags.push({ label: 'Grit', tone: 'good', hint: 'Has reverse-swept a series (down 0-2, won)' });
  return tags;
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function TeamCard({ team, teamCount }) {
  const { game, series } = team;
  const color = ARCHETYPES[team.archetype].color;
  const recent = team.matches.slice(-5).reverse();

  return (
    <article className="team-card" style={{ '--team-color': color }}>
      <header className="card-header">
        <div className="card-rank">#{team.ranks.model}</div>
        <div>
          <h2>{team.name}</h2>
          <div className="card-meta">
            {team.region} · Seed {team.seed}
            {team.pool ? ` · Pool ${team.pool}` : ' · Play-In'}
          </div>
        </div>
      </header>

      <div className="archetype-badge">{team.archetype}</div>

      {tagsOf(team).length > 0 && (
        <div className="tags">
          {tagsOf(team).map((tag) => (
            <span key={tag.label} className={`tag ${tag.tone}`} title={tag.hint}>
              {tag.label}
            </span>
          ))}
        </div>
      )}

      <div className="score-row">
        <Stat label="Game score" value={score(team.scores.game)} sub={`#${team.ranks.game} of ${teamCount}`} />
        <Stat label="Series score" value={score(team.scores.series)} sub={`#${team.ranks.series} of ${teamCount}`} />
        <Stat label="Hype rank" value={`#${team.ranks.hype}`} sub="seed + pool" />
      </div>

      <section>
        <h3>Game tier <span className="section-sub">{game.games} games</span></h3>
        <div className="stat-grid">
          <Stat label="Lead @15 (adj.)" value={signed(game.lead15Adjusted)} sub={`raw ${signed(game.lead15Raw)}`} />
          <Stat label="Win rate" value={percent(game.winRate)} />
          <Stat label="Converts leads" value={percent(game.conversionRate)} sub={`chokes ${percent(game.chokeRate)}`} />
          <Stat label="Comebacks" value={percent(game.comebackRate)} sub="when behind @15" />
          <Stat label="Ceiling" value={signed(game.ceiling)} sub="best 25% of games" />
          <Stat label="Swing spread" value={game.swingSpread.toLocaleString('en-US')} sub="lower = steadier" />
        </div>
      </section>

      <section>
        <h3>Series tier <span className="section-sub">{series.series} series</span></h3>
        <div className="stat-grid">
          <Stat label="Series win rate" value={percent(series.winRate)} />
          <Stat label="Clean sweeps" value={percent(series.sweepRate)} sub="of series won" />
          <Stat label="Close series" value={percent(series.closeSeriesWinRate)} sub="2-1 / 3-2 record" />
        </div>
      </section>

      <section>
        <h3>Recent series</h3>
        <ul className="recent">
          {recent.map((m) => (
            <li key={`${m.date}-${m.opponent}`} className={m.won ? 'win' : 'loss'}>
              <span className="recent-score">{m.score}</span>
              <span className="recent-opp">vs {m.opponent}</span>
              <span className="recent-event">{m.tournament}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Scouting report</h3>
        <p className="report">{team.report ?? 'Scouting report coming soon.'}</p>
      </section>
    </article>
  );
}
