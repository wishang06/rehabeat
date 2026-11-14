import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FeedbackFrame } from '../types/ui';
import { createFeedbackStore } from './feedbackStore';
import { useFeedbackFrame } from './useFeedbackFrame';

const frame = (t: number): FeedbackFrame => ({ t }) as FeedbackFrame;

describe('createFeedbackStore', () => {
  it('starts empty and returns the latest published frame', () => {
    const store = createFeedbackStore();
    expect(store.getSnapshot()).toBeNull();
    store.publish(frame(1));
    store.publish(frame(2));
    expect(store.getSnapshot()?.t).toBe(2);
  });

  it('calls subscribers with each frame until they unsubscribe', () => {
    const store = createFeedbackStore();
    const seen: (number | null)[] = [];
    const unsubscribe = store.subscribe((f) => seen.push(f?.t ?? null));
    store.publish(frame(1));
    store.publish(null);
    unsubscribe();
    store.publish(frame(3));
    expect(seen).toEqual([1, null]);
  });
});

describe('useFeedbackFrame', () => {
  function Probe() {
    return createElement('output', null, String(useFeedbackFrame()?.t));
  }

  it('reads the current frame, or a selected part of it', () => {
    const store = createFeedbackStore();
    store.publish(frame(7));
    const html = renderToString(
      createElement(
        'div',
        null,
        createElement(ProbeWith, { store }),
        createElement(ProbeWith, { store, select: (f: FeedbackFrame | null) => (f ? f.t * 2 : 'none') }),
      ),
    );
    expect(html).toContain('<output>7</output>');
    expect(html).toContain('<output>14</output>');
  });

  it('defaults to the shared store, which is empty until the Play screen publishes', () => {
    expect(renderToString(createElement(Probe))).toContain('<output>undefined</output>');
  });

  function ProbeWith({ store, select }: { store: ReturnType<typeof createFeedbackStore>; select?: (f: FeedbackFrame | null) => unknown }) {
    const value = useFeedbackFrame(select ?? ((f) => f?.t), store);
    return createElement('output', null, String(value));
  }
});
