import { useEffect, useMemo, useRef, useState } from 'react';
import { createFeedbackStore } from '../../engine';
import { MOCK_STATES, mockFrameAt, mockRunAt, type MockState } from '../mockFeedback';
import { PlayHud } from './PlayHud';
import type { HudRun } from './types';

/** The preview runs at the tempo of the default song. */
const BEATS_PER_SECOND = 72 / 60;

/**
 * The play HUD on a blank stage, fed by the mock frame instead of a camera:
 * for design work, screenshots and checking states that are hard to reach by
 * hand. Not linked from the app.
 *
 *   /hud               the scripted run, looping
 *   /hud?state=perfect one named moment, frozen (see MOCK_STATES)
 *   /hud?beat=12.5     any beat, frozen
 *
 * There is no music here, so the looping preview keeps time with the display
 * clock. On the Play screen the same HUD is driven by the audio clock.
 */
export function HudPreview() {
  const frames = useMemo(() => createFeedbackStore(), []);
  const hud = useRef<HTMLDivElement>(null);

  const frozenBeat = useMemo(() => {
    const query = new URLSearchParams(window.location.search);
    const state = query.get('state');
    if (state && state in MOCK_STATES) return MOCK_STATES[state as MockState];
    const beat = Number(query.get('beat'));
    return query.has('beat') && Number.isFinite(beat) ? beat : null;
  }, []);

  const [run, setRun] = useState<HudRun>(() => mockRunAt(frozenBeat ?? 0));

  useEffect(() => {
    const show = (beat: number) => {
      frames.publish(mockFrameAt(beat));
      hud.current?.style.setProperty('--pulse', ((1 - (beat - Math.floor(beat))) ** 2).toFixed(3));
      setRun((shown) => {
        const next = mockRunAt(beat);
        const same =
          shown.points === next.points &&
          shown.moveNumber === next.moveNumber &&
          shown.result?.serial === next.result?.serial;
        return same ? shown : next;
      });
    };

    if (frozenBeat !== null) {
      show(frozenBeat);
      return () => frames.publish(null);
    }

    const started = performance.now();
    let request = requestAnimationFrame(function tick(now) {
      request = requestAnimationFrame(tick);
      show(((now - started) / 1000) * BEATS_PER_SECOND);
    });
    return () => {
      cancelAnimationFrame(request);
      frames.publish(null);
    };
  }, [frames, frozenBeat]);

  return (
    <div className="hud-preview">
      <div className="hud-preview__stage">
        <p className="hud-preview__note">
          HUD preview. The camera picture and the canvas overlay go here; this page feeds the HUD a mock frame.
        </p>
        <PlayHud frames={frames} run={run} ref={hud} />
      </div>
    </div>
  );
}
