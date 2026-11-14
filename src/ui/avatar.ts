/**
 * Every player gets a little critter, picked from their id so it stays the
 * same on every device. These are Rehabeat's own characters.
 */
export const SPECIES = ['bear', 'cat', 'bunny', 'frog', 'chick', 'monster'] as const;
export type Species = (typeof SPECIES)[number];

/** Body colour, the darker shade used for ears and outlines, and the tile behind. */
export const CRITTER_COLORS = [
  { body: '#ffb84d', shade: '#e08a1e', tile: '#fff1d6' },
  { body: '#ff7aa8', shade: '#d94f80', tile: '#ffe3ee' },
  { body: '#5cc8ff', shade: '#2d9ad6', tile: '#dff3ff' },
  { body: '#6ee08f', shade: '#38b25e', tile: '#e1f9e8' },
  { body: '#b48cff', shade: '#865ce0', tile: '#efe6ff' },
  { body: '#ff8a5c', shade: '#da5f30', tile: '#ffe6dc' },
  { body: '#ffd93d', shade: '#d6ab00', tile: '#fff8d1' },
  { body: '#4fd6c4', shade: '#20a693', tile: '#dcf8f4' },
] as const;

export type CritterColor = (typeof CRITTER_COLORS)[number];

export interface Critter {
  species: Species;
  color: CritterColor;
}

/** FNV-1a: a small, stable string hash. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The critter for a player id (or any other stable string). */
export function critterFor(seed: string): Critter {
  const h = hash(seed);
  return {
    species: SPECIES[h % SPECIES.length],
    color: CRITTER_COLORS[Math.floor(h / SPECIES.length) % CRITTER_COLORS.length],
  };
}
