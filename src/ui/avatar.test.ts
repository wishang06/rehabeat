import { describe, expect, it } from 'vitest';
import { CRITTER_COLORS, SPECIES, critterFor } from './avatar';

describe('critterFor', () => {
  it('gives the same critter for the same id', () => {
    const id = '7f3c2a10-1d5e-4c8b-9a77-3e2f1b0c9d11';
    expect(critterFor(id)).toEqual(critterFor(id));
  });

  it('always picks a known species and colour', () => {
    for (let i = 0; i < 200; i++) {
      const critter = critterFor(`player-${i}`);
      expect(SPECIES).toContain(critter.species);
      expect(CRITTER_COLORS).toContain(critter.color);
    }
  });

  it('spreads players across every species', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => critterFor(`player-${i}`).species));
    expect(seen.size).toBe(SPECIES.length);
  });
});
