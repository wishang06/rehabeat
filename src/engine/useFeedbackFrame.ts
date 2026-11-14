import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { FeedbackFrame } from '../types/ui';
import { feedbackStore, type FeedbackStore } from './feedbackStore';

type Select<T> = (frame: FeedbackFrame | null) => T;

const identity: Select<FeedbackFrame | null> = (frame) => frame;

/**
 * The latest FeedbackFrame (null outside the Play screen), re-rendering on
 * every new frame: up to once per display frame.
 *
 * Pass a selector to re-render only when the part you read changes, e.g.
 * `useFeedbackFrame((f) => f?.hint?.text ?? null)`. Return primitives (or
 * values taken straight off the frame) from it: a selector that builds a new
 * object re-renders on every frame.
 */
export function useFeedbackFrame(): FeedbackFrame | null;
export function useFeedbackFrame<T>(select: Select<T>, store?: FeedbackStore): T;
export function useFeedbackFrame<T>(select?: Select<T>, store: FeedbackStore = feedbackStore): T | FeedbackFrame | null {
  const chosen = (select ?? identity) as Select<T | FeedbackFrame | null>;
  const cache = useRef<{ frame: FeedbackFrame | null; select: Select<unknown>; value: unknown } | null>(null);

  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const read = () => {
    const frame = store.getSnapshot();
    const cached = cache.current;
    // Same frame and selector: hand back the same value, as useSyncExternalStore requires.
    if (cached && cached.frame === frame && cached.select === chosen) return cached.value as T;
    const value = chosen(frame);
    cache.current = { frame, select: chosen, value };
    return value;
  };
  return useSyncExternalStore(subscribe, read, read);
}
