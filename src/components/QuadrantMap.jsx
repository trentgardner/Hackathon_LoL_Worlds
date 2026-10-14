import { useMemo, useState } from 'react';
import { ARCHETYPES } from '../lib/format';

// Chart size in SVG units. The SVG scales to fit its container.
const W = 820;
const H = 580;
const PAD = 56;

const QUADRANTS = [
  { name: 'Scrappy', corner: 'top-left' },
  { name: 'Powerhouse', corner: 'top-right' },
  { name: 'Bottom of the barrel', corner: 'bottom-left' },
  { name: 'Dark horse', corner: 'bottom-right' },
];

// Bigger dot = steadier team (consistency score is ~ -2..+2)
const radiusOf = (consistency) => Math.max(8, Math.min(19, 13 + consistency * 2.5));

export default function QuadrantMap({ teams, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);

  // Axes are symmetric around 0 so the average-team lines sit in the middle
  const { sx, sy } = useMemo(() => {
    const xExt = Math.max(...teams.map((t) => Math.abs(t.scores.game))) + 0.35;
    const yExt = Math.max(...teams.map((t) => Math.abs(t.scores.series))) + 0.35;
    return {
      sx: (x) => PAD + ((x + xExt) / (2 * xExt)) * (W - 2 * PAD),
      sy: (y) => PAD + ((yExt - y) / (2 * yExt)) * (H - 2 * PAD),
    };
  }, [teams]);

  // Label placement: each label tries above, below, right, left of its dot (then further out)
  // and takes the first spot that doesn't cover another label or dot. Top-ranked teams pick first.
  const labels = useMemo(() => {
    const dots = teams.map((t) => ({ x: sx(t.scores.game), y: sy(t.scores.series), r: radiusOf(t.scores.consistency) }));
    const boxes = []; // placed label boxes
    const result = {};

    const hitsBox = (b) => boxes.some((o) => b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
    const hitsDot = (b) => dots.some((d) => {
      const cx = Math.max(b.x1, Math.min(d.x, b.x2));
      const cy = Math.max(b.y1, Math.min(d.y, b.y2));
      return (cx - d.x) ** 2 + (cy - d.y) ** 2 < d.r ** 2;
    });

    for (const t of [...teams].sort((a, b) => a.ranks.model - b.ranks.model)) {
      const x = sx(t.scores.game);
      const y = sy(t.scores.series);
      const r = radiusOf(t.scores.consistency);
      const w = t.short.length * 8.5 + 4;
      const h = 14;

      // Candidate spots: [text x, text baseline y, anchor]
      const candidates = [];
      for (const gap of [4, 14, 26]) {
        candidates.push(
          [x, y - r - gap, 'middle'],
          [x, y + r + gap + 10, 'middle'],
          [x + r + gap, y + 5, 'start'],
          [x - r - gap, y + 5, 'end'],
        );
      }

      const boxOf = ([lx, ly, anchor]) => {
        const left = anchor === 'middle' ? lx - w / 2 : anchor === 'start' ? lx : lx - w;
        return { x1: left, x2: left + w, y1: ly - h + 2, y2: ly + 2 };
      };
      const spot = candidates.find((c) => !hitsBox(boxOf(c)) && !hitsDot(boxOf(c)))
        ?? candidates.find((c) => !hitsBox(boxOf(c)))
        ?? candidates[0];

      boxes.push(boxOf(spot));
      result[t.name] = { x: spot[0], y: spot[1], anchor: spot[2], dotX: x, dotY: y, r };
    }
    return result;
  }, [teams, sx, sy]);

  // Draw the selected/hovered team last so it sits on top
  const drawOrder = [...teams].sort((a, b) => {
    const rank = (t) => (t.name === selected ? 2 : t.name === hovered ? 1 : 0);
    return rank(a) - rank(b);
  });

  const midX = sx(0);
  const midY = sy(0);

  return (
    <svg className="quadrant-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Worlds teams by game tier and series tier">
      {/* Quadrant tints */}
      {QUADRANTS.map((q) => {
        const left = q.corner.endsWith('left');
        const top = q.corner.startsWith('top');
        const x = left ? PAD : midX;
        const y = top ? PAD : midY;
        const w = left ? midX - PAD : W - PAD - midX;
        const h = top ? midY - PAD : H - PAD - midY;
        return (
          <g key={q.name}>
            <rect x={x} y={y} width={w} height={h} fill={ARCHETYPES[q.name].color} opacity="0.05" />
            <text
              className="quadrant-label"
              x={left ? x + 12 : x + w - 12}
              y={top ? y + 22 : y + h - 12}
              textAnchor={left ? 'start' : 'end'}
              fill={ARCHETYPES[q.name].color}
            >
              {q.name.toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* Frame + average-team lines */}
      <rect x={PAD} y={PAD} width={W - 2 * PAD} height={H - 2 * PAD} className="frame" />
      <line x1={midX} y1={PAD} x2={midX} y2={H - PAD} className="avg-line" />
      <line x1={PAD} y1={midY} x2={W - PAD} y2={midY} className="avg-line" />

      {/* Axis titles */}
      <text className="axis-label" x={W / 2} y={H - 18} textAnchor="middle">
        GAME TIER →  early leads · ceiling · converting leads
      </text>
      <text className="axis-label" transform={`translate(20 ${H / 2}) rotate(-90)`} textAnchor="middle">
        SERIES TIER →  winning series
      </text>

      {/* Teams */}
      {drawOrder.map((t) => {
        const x = sx(t.scores.game);
        const y = sy(t.scores.series);
        const r = radiusOf(t.scores.consistency);
        const color = ARCHETYPES[t.archetype].color;
        const isSelected = t.name === selected;
        return (
          <g
            key={t.name}
            className={`team-dot${isSelected ? ' selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${t.name}, ${t.archetype}`}
            onClick={() => onSelect(t.name)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(t.name)}
            onMouseEnter={() => setHovered(t.name)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{`${t.name} — ${t.archetype}`}</title>
            {isSelected && <circle cx={x} cy={y} r={r + 7} className="select-ring" />}
            <circle cx={x} cy={y} r={r} fill={color} fillOpacity="0.85" stroke="#070b14" strokeWidth="2" />
          </g>
        );
      })}

      {/* Labels sit in their own layer above every dot */}
      {teams.map((t) => {
        const label = labels[t.name];
        return (
          <text
            key={t.name}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            className={`dot-label${t.name === selected ? ' selected' : ''}`}
          >
            {t.short}
          </text>
        );
      })}
    </svg>
  );
}
