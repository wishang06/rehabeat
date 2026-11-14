/**
 * Every player gets a little critter, picked from their id so it stays the
 * same on every device. These are Rehabeat's own characters.
 */
export const SPECIES = ['bear', 'cat', 'bunny', 'frog', 'chick', 'monster'] as const;
export type Species = (typeof SPECIES)[number];

/**
 * Body colour, the darker shade used for ears and outlines, and the tile
 * behind. Attract Mode's light only: cyan, pink and white on the deck tones.
 * Gold is kept for the figure and the selected thing, so no critter is gold.
 */
export const CRITTER_COLORS = [
  { body: '#27e0f0', shade: '#1497a3', tile: '#151c36' },
  { body: '#ff2e88', shade: '#b01d5d', tile: '#151c36' },
  { body: '#eef2ff', shade: '#9aa3c2', tile: '#151c36' },
  { body: '#27e0f0', shade: '#1497a3', tile: '#242d50' },
  { body: '#ff2e88', shade: '#b01d5d', tile: '#242d50' },
  { body: '#eef2ff', shade: '#9aa3c2', tile: '#242d50' },
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
