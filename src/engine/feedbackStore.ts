import type { FeedbackFrame } from '../types/ui';

export type FeedbackListener = (frame: FeedbackFrame | null) => void;

/** Holds the latest FeedbackFrame and tells subscribers when a new one arrives. */
export interface FeedbackStore {
  /** The latest frame, or null when no game is running. */
  getSnapshot(): FeedbackFrame | null;
  /** Calls `listener` with every new frame. Returns the unsubscribe function. */
  subscribe(listener: FeedbackListener): () => void;
  publish(frame: FeedbackFrame | null): void;
}

export function createFeedbackStore(): FeedbackStore {
  let current: FeedbackFrame | null = null;
  const listeners = new Set<FeedbackListener>();
  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(frame) {
      current = frame;
      for (const listener of listeners) listener(frame);
    },
  };
}

/**
 * The store the Play screen publishes to, once per display frame. It holds
 * null outside the Play screen.
 */
export const feedbackStore: FeedbackStore = createFeedbackStore();
