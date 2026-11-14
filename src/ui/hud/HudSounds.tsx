import { useEffect, useRef } from 'react';
import { playSfx } from '../../audio/sfx';
import { PERFECT_SCORE } from '../../scoring';
import type { FeedbackPhase, FeedbackStore, HudRun } from './types';

/** A combo of this, and every multiple of it, gets its own sound. */
const COMBO_STEP = 5;
/** The combo sound waits for the result sound to clear. */
const COMBO_DELAY_MS = 260;
/** "Step back" beeps at most this often. */
const WARN_GAP_MS = 4000;

const RESULT_SOUND = { Perfect: 'perfect', Good: 'good', Miss: 'miss' } as const;

interface HudSoundsProps {
  frames: FeedbackStore;
  run: HudRun;
}

/**
 * The play HUD's sounds. Renders nothing: it listens to the same frames and
 * run stats as the HUD and plays a sound when something happens.
 *
 * - 3, 2, 1: a knock each; the first move: GO.
 * - Each reach: a whoosh. Each hold: a ping, and a two-step up the first time
 *   the pose reaches Perfect in it.
 * - The result: PERFECT, GOOD or MISS, each its own sound.
 * - Every fifth move in a combo: a run that climbs higher each time.
 * - Step back: two low beeps.
 */
export function HudSounds({ frames, run }: HudSoundsProps) {
  useEffect(() => {
    let phase: FeedbackPhase | null = null;
    let count = 0;
    let started = false;
    let locked = false;
    let hidden = false;
    let warnedAt = -Infinity;

    const warn = () => {
      const now = performance.now();
      if (now - warnedAt < WARN_GAP_MS) return;
      warnedAt = now;
      playSfx('warn');
    };

    return frames.subscribe((frame) => {
      if (!frame) {
        phase = null;
        started = false;
        return;
      }

      if (frame.phase !== phase) {
        const was = phase;
        phase = frame.phase;
        locked = false;
        if (frame.phase === 'reach') playSfx(started || was === null ? 'reach' : 'go');
        else if (frame.phase === 'hold') playSfx('hold');
        if (frame.phase !== 'ready') started = true;
      }

      if (frame.phase === 'ready') {
        const left = Math.ceil(frame.beatsToNextPhase);
        if (left !== count && left >= 1 && left <= 3) playSfx('count');
        count = left;
      }

      if (frame.phase === 'hold' && !locked && frame.score >= PERFECT_SCORE) {
        locked = true;
        playSfx('lock');
      }

      if (frame.lowVisibility && !hidden) warn();
      hidden = frame.lowVisibility;
    });
  }, [frames]);

  const serial = run.result?.serial ?? 0;
  const label = run.result?.label;
  const seen = useRef(serial);
  useEffect(() => {
    if (serial === seen.current) return;
    seen.current = serial;
    if (!label) return;
    playSfx(RESULT_SOUND[label]);
  }, [serial, label]);

  const combo = run.combo;
  const lastCombo = useRef(combo);
  useEffect(() => {
    const before = lastCombo.current;
    lastCombo.current = combo;
    if (combo <= before || combo < COMBO_STEP || combo % COMBO_STEP !== 0) return;
    const timer = setTimeout(() => playSfx('combo', { step: combo / COMBO_STEP - 1 }), COMBO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [combo]);

  const lost = useRef(run.bodyLost);
  useEffect(() => {
    if (run.bodyLost && !lost.current) playSfx('warn');
    lost.current = run.bodyLost;
  }, [run.bodyLost]);

  return null;
}
