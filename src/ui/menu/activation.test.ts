import { describe, expect, it } from 'vitest';
import { isActivationEvent, pageHasBeenActive } from './activation';

describe('isActivationEvent', () => {
  it('counts a key press, except Esc', () => {
    expect(isActivationEvent({ type: 'keydown', key: 'ArrowDown' })).toBe(true);
    expect(isActivationEvent({ type: 'keydown', key: 'Enter' })).toBe(true);
    expect(isActivationEvent({ type: 'keydown', key: 'Escape' })).toBe(false);
  });

  it('counts a mouse press on the way down', () => {
    expect(isActivationEvent({ type: 'pointerdown', pointerType: 'mouse' })).toBe(true);
    expect(isActivationEvent({ type: 'pointerup', pointerType: 'mouse' })).toBe(false);
  });

  it('counts a touch or pen tap on the way up', () => {
    expect(isActivationEvent({ type: 'pointerdown', pointerType: 'touch' })).toBe(false);
    expect(isActivationEvent({ type: 'pointerup', pointerType: 'touch' })).toBe(true);
    expect(isActivationEvent({ type: 'pointerup', pointerType: 'pen' })).toBe(true);
    expect(isActivationEvent({ type: 'touchend' })).toBe(true);
  });

  it('ignores hovering and anything else', () => {
    expect(isActivationEvent({ type: 'pointermove', pointerType: 'mouse' })).toBe(false);
    expect(isActivationEvent({ type: 'focus' })).toBe(false);
    expect(isActivationEvent({ type: 'pointerup' })).toBe(false);
  });
});

describe('pageHasBeenActive', () => {
  it("trusts the browser's own record where it has one", () => {
    expect(pageHasBeenActive(false, { hasBeenActive: true })).toBe(true);
    expect(pageHasBeenActive(true, { hasBeenActive: false })).toBe(false);
  });

  it('goes by the events seen in browsers without navigator.userActivation', () => {
    expect(pageHasBeenActive(true, undefined)).toBe(true);
    expect(pageHasBeenActive(false, undefined)).toBe(false);
  });

  it('reads navigator in the environment it runs in', () => {
    // Node's navigator has no userActivation, so this goes by `seen`.
    expect(pageHasBeenActive(false)).toBe(false);
    expect(pageHasBeenActive(true)).toBe(true);
  });
});
