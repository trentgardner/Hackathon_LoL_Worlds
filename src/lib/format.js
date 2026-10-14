// Display helpers for numbers coming out of teams.json

// 1203 -> "+1,203", -306 -> "-306"
export function signed(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')}`;
}

// 57.9 -> "57.9%"
export function percent(n) {
  return n == null ? '—' : `${n}%`;
}

// 0.5 -> "+0.50"
export function score(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
}

// Archetype -> CSS color variable + short key used for class names
export const ARCHETYPES = {
  Powerhouse: { color: 'var(--powerhouse)', key: 'powerhouse' },
  Scrappy: { color: 'var(--scrappy)', key: 'scrappy' },
  'Dark horse': { color: 'var(--darkhorse)', key: 'darkhorse' },
  'Bottom of the barrel': { color: 'var(--bottom)', key: 'bottom' },
};
