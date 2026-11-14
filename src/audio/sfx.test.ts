import { describe, expect, it, vi } from 'vitest';
import { isSfxMuted, onSfxMuteChange, playSfx, setSfxMuted, unlockSfx } from './sfx';

describe('sfx', () => {
  it('is silent and harmless without Web Audio', () => {
    expect(() => unlockSfx()).not.toThrow();
    expect(() => playSfx('perfect')).not.toThrow();
  });

  it('remembers mute and tells listeners', () => {
    const listener = vi.fn();
    const stop = onSfxMuteChange(listener);
    setSfxMuted(true);
    expect(isSfxMuted()).toBe(true);
    setSfxMuted(false);
    expect(isSfxMuted()).toBe(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    stop();
  });
});
