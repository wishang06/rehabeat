import { describe, expect, it } from 'vitest';
import { AVATAR_IDS, AVATAR_NAMES, avatarForSeed, isAvatarId, pickRandomAvatar, resolveAvatar } from './avatars';

describe('the avatar set', () => {
  it('has 12 to 16 avatars, each named once', () => {
    expect(AVATAR_IDS.length).toBeGreaterThanOrEqual(12);
    expect(AVATAR_IDS.length).toBeLessThanOrEqual(16);
    expect(new Set(AVATAR_IDS).size).toBe(AVATAR_IDS.length);
    for (const id of AVATAR_IDS) {
      expect(id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(AVATAR_NAMES[id]).toBeTruthy();
    }
  });

  it('knows its own ids and nothing else', () => {
    expect(isAvatarId(AVATAR_IDS[0])).toBe(true);
    expect(isAvatarId('bear')).toBe(false);
    expect(isAvatarId(null)).toBe(false);
    expect(isAvatarId(7)).toBe(false);
  });
});

describe('pickRandomAvatar', () => {
  it('maps the ends of the random range to the first and last avatar', () => {
    expect(pickRandomAvatar(() => 0)).toBe(AVATAR_IDS[0]);
    expect(pickRandomAvatar(() => 0.9999)).toBe(AVATAR_IDS[AVATAR_IDS.length - 1]);
  });

  it('stays in the set even if the source returns exactly 1', () => {
    expect(pickRandomAvatar(() => 1)).toBe(AVATAR_IDS[AVATAR_IDS.length - 1]);
  });

  it('only ever picks a known avatar, and reaches most of them', () => {
    const picks = Array.from({ length: 500 }, () => pickRandomAvatar());
    for (const pick of picks) expect(AVATAR_IDS).toContain(pick);
    expect(new Set(picks).size).toBeGreaterThanOrEqual(12);
  });
});

describe('avatarForSeed and resolveAvatar', () => {
  const seed = '7f3c2a10-1d5e-4c8b-9a77-3e2f1b0c9d11';

  it('gives one player the same avatar every time', () => {
    expect(avatarForSeed(seed)).toBe(avatarForSeed(seed));
  });

  it('spreads player ids across the set', () => {
    const seen = new Set(Array.from({ length: 300 }, (_, i) => avatarForSeed(`player-${i}`)));
    expect(seen.size).toBe(AVATAR_IDS.length);
  });

  it('uses a chosen avatar, and falls back to the seed for an unknown or missing one', () => {
    expect(resolveAvatar(AVATAR_IDS[3], seed)).toBe(AVATAR_IDS[3]);
    expect(resolveAvatar('bear', seed)).toBe(avatarForSeed(seed));
    expect(resolveAvatar(null, seed)).toBe(avatarForSeed(seed));
    expect(resolveAvatar(undefined, seed)).toBe(avatarForSeed(seed));
  });
});
