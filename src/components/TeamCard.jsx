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

function Stat({ label, value, sub, hint }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function ChampionList({ title, items }) {
  return (
    <div className="champ-row">
      <span className="champ-row-title">{title}</span>
      <span className="champ-chips">
        {items.length === 0 && <span className="champ-none">none</span>}
        {items.map((c) => (
          <span key={c.name} className="champ-chip">
            {c.name} <span className="champ-detail">{c.detail}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

export default function TeamCard({ team, teamCount, report, onCompare }) {
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

      <div className="card-actions">
        <div className="archetype-badge">{team.archetype}</div>
        <button type="button" className="compare-btn" onClick={onCompare}>
          Compare head-to-head →
        </button>
      </div>

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
        <Stat
          label="Model rating"
          value={score(team.scores.game)}
          sub={`#${team.ranks.game} of ${teamCount}`}
          hint="Game strength: adjusted lead at 15, ceiling, and closing out leads. This decides the ranking and predictions."
        />
        <Stat
          label="Series results"
          value={score(team.scores.series)}
          sub={`#${team.ranks.series} of ${teamCount}`}
          hint="How they've done in Bo3/Bo5 series, adjusted for opponents. Context: it leans on close-series luck, so it doesn't drive predictions."
        />
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
          <Stat
            label="Volatility"
            value={game.swingSpread.toLocaleString('en-US')}
            sub="lower = steadier"
            hint="How much games change after minute 15. Low = their games play out the way they start; high = leads come and go."
          />
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
        <h3>Playstyle &amp; draft <span className="section-sub">since MSI</span></h3>
        <div className="style-tags">
          <span className="style-tag" title="From results: adjusted lead at 15 + how fast their games end">
            {team.playstyle.tempo}
          </span>
          {team.draft.tempo && (
            <span className="style-tag draft" title="Which champions they pick, judged by how those champions do at 15 in other teams' games">
              {team.draft.tempo}
            </span>
          )}
        </div>
        <div className="stat-grid">
          <Stat label="Avg game length" value={`${team.playstyle.avgGameMinutes} min`} />
          <Stat label="Champion pool" value={team.draft.pool} sub="different champions" />
          <Stat label="Top-5 reliance" value={percent(team.draft.top5Share)} sub="of picks on 5 champs" />
        </div>
        <ChampionList title="Most played" items={team.draft.signature.map((c) => ({ name: c.champion, detail: `${c.wins}-${c.games - c.wins}` }))} />
        <ChampionList title="They ban" items={team.draft.bans.slice(0, 3).map((c) => ({ name: c.champion, detail: `×${c.count}` }))} />
        <ChampionList title="Banned vs them" items={team.draft.bannedAgainst.slice(0, 3).map((c) => ({ name: c.champion, detail: `×${c.count}` }))} />
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
        {report ? (
          report.split(/\n\s*\n/).map((para, i) => <p key={i} className="report">{para}</p>)
        ) : (
          <p className="report muted">Scouting report not available yet.</p>
        )}
      </section>
    </article>
  );
}
