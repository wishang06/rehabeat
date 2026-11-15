/**
 * Player avatars: sixteen neon glyphs in the Attract Mode look, drawn in
 * art.tsx. A player picks one in the profile menu; until they have, and for
 * anyone whose row has none, one is chosen from their id so it is the same on
 * every device.
 */
export const AVATAR_IDS = [
  'figure',
  'star',
  'bolt',
  'note',
  'ring',
  'crown',
  'heart',
  'eq',
  'diamond',
  'lanes',
  'chevrons',
  'flame',
  'pips',
  'arrow',
  'ace',
  'dial',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

/** What each avatar is, for the picker's buttons. */
export const AVATAR_NAMES: Record<AvatarId, string> = {
  figure: 'Gold figure',
  star: 'Star',
  bolt: 'Bolt',
  note: 'Notes',
  ring: 'Match ring',
  crown: 'Crown',
  heart: 'Pixel heart',
  eq: 'Equaliser',
  diamond: 'Tempo rod',
  lanes: 'Lanes',
  chevrons: 'Chevrons',
  flame: 'Flame',
  pips: 'Beat pips',
  arrow: 'Arrow',
  ace: 'S grade',
  dial: 'Beat dial',
};

const KNOWN = new Set<string>(AVATAR_IDS);

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && KNOWN.has(value);
}

/** A random avatar, for a new account. `random` returns a number in [0, 1), like Math.random. */
export function pickRandomAvatar(random: () => number = Math.random): AvatarId {
  const index = Math.min(AVATAR_IDS.length - 1, Math.max(0, Math.floor(random() * AVATAR_IDS.length)));
  return AVATAR_IDS[index];
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

/** The avatar a player id stands for when no avatar has been chosen. */
export function avatarForSeed(seed: string): AvatarId {
  return AVATAR_IDS[hash(seed) % AVATAR_IDS.length];
}

/** The avatar to draw: the chosen one if it is in the set, otherwise the seed's. */
export function resolveAvatar(id: string | null | undefined, seed: string): AvatarId {
  return isAvatarId(id) ? id : avatarForSeed(seed);
}
