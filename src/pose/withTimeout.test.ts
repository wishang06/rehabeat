import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the work finishes in time', async () => {
    const work = new Promise<string>((resolve) => setTimeout(() => resolve('ready'), 100));
    const result = withTimeout(work, 1000, 'too slow');
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the given message when the work takes too long', async () => {
    const never = new Promise<void>(() => {});
    const result = withTimeout(never, 1000, 'too slow');
    const outcome = expect(result).rejects.toThrow('too slow');
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
  });

  it('passes a rejection through unchanged and clears its timer', async () => {
    const failure = new DOMException('Permission denied', 'NotAllowedError');
    const result = withTimeout(Promise.reject(failure), 1000, 'too slow');
    await expect(result).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores work that finishes after the timeout', async () => {
    const late = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 2000));
    const result = withTimeout(late, 1000, 'too slow');
    const outcome = expect(result).rejects.toThrow('too slow');
    await vi.advanceTimersByTimeAsync(3000);
    await outcome;
  });
});
