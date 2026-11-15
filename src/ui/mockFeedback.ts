/**
 * A typed stand-in for the engine's FeedbackFrame, so the play HUD can be
 * built, previewed and tested without a camera. The HUD reads frames from a
 * FeedbackStore and cannot tell this from the real thing: on the Play screen
 * it is given `feedbackStore` from src/engine, in the preview (/hud) a store
 * fed from here.
 *
 * `mockFrameAt(beat)` is a scripted run through the routine that turns up
 * every HUD state: the count-in, a Perfect, a Good, and a Miss with the
 * player partly out of view.
 */
import { LIMBS } from '../engine';
import { MOVES } from '../moves';
import { maxPointsFor } from '../progress';
import { GOOD_SCORE, labelFor, pointsFor } from '../scoring';
import type { JointName, Move } from '../types';
import type { FeedbackFrame, FeedbackPhase, LimbFeedback, LimbName } from '../types/ui';
import type { HudResult, HudRun } from './hud/types';

/** Beats of count-in before the first move, as on the Play screen. */
export const MOCK_COUNT_IN_BEATS = 4;

/** The hold score each successive move of the script ends on: Perfect, Good, Perfect, Miss. */
const SCRIPT = [92, 74, 88, 41];

const PHASES = ['reach', 'hold', 'release'] as const;

function idleLimbs(move: Move | null, onTarget: boolean): Record<LimbName, LimbFeedback> {
  const limbs = {} as Record<LimbName, LimbFeedback>;
  for (const { limb, joint } of LIMBS) {
    const target = move?.joints[joint as JointName];
    const scored = target !== undefined;
    limbs[limb] = {
      limb,
      joint,
      status: scored ? (onTarget ? 'green' : 'amber') : 'idle',
      scored,
      errorDeg: scored ? (onTarget ? 6 : 28) : null,
      currentDeg: scored ? target - (onTarget ? 6 : 28) : null,
      targetDeg: scored ? target : null,
      visibility: 0.95,
    };
  }
  return limbs;
}

/** One frame, mid-hold and on target unless `overrides` says otherwise. */
export function mockFeedbackFrame(overrides: Partial<FeedbackFrame> = {}): FeedbackFrame {
  const move = MOVES[0];
  const next = MOVES[1 % MOVES.length];
  return {
    t: 0,
    phase: 'hold',
    phaseProgress: 0.6,
    beatsToNextPhase: 1.6,
    move: { id: move.id, name: move.name },
    nextMove: { id: next.id, name: next.name },
    limbs: idleLimbs(move, true),
    worstJoint: null,
    hint: null,
    holdProgress: 0.6,
    score: 88,
    holdScore: 88,
    onTarget: true,
    lowVisibility: false,
    hiddenJoints: [],
    ...overrides,
  };
}

interface Position {
  /** Which move of the endless run this is, from 0. -1 during the count-in. */
  cycle: number;
  move: Move | null;
  phase: FeedbackPhase;
  /** 0 to 1 through the phase. */
  progress: number;
  beatsLeft: number;
}

const moveLength = (move: Move) => move.beats.reach + move.beats.hold + move.beats.release;

function positionAt(beat: number): Position {
  if (beat < MOCK_COUNT_IN_BEATS) {
    const safe = Math.max(0, beat);
    return {
      cycle: -1,
      move: null,
      phase: 'ready',
      progress: safe / MOCK_COUNT_IN_BEATS,
      beatsLeft: MOCK_COUNT_IN_BEATS - safe,
    };
  }
  let rest = beat - MOCK_COUNT_IN_BEATS;
  let cycle = 0;
  for (;;) {
    const move = MOVES[cycle % MOVES.length];
    if (rest < moveLength(move)) {
      for (const phase of PHASES) {
        const length = move.beats[phase];
        if (rest < length) return { cycle, move, phase, progress: rest / length, beatsLeft: length - rest };
        rest -= length;
      }
    }
    rest -= moveLength(move);
    cycle += 1;
  }
}

/** The frame at `beat` of the scripted run. `t` is left to the caller's clock. */
export function mockFrameAt(beat: number, t = 0): FeedbackFrame {
  const { cycle, move, phase, progress, beatsLeft } = positionAt(beat);
  const target = cycle < 0 ? 0 : SCRIPT[cycle % SCRIPT.length];
  // A small wobble so the ring is alive while the player "holds".
  const wobble = Math.sin(beat * 5.1) * 3;
  const score =
    phase === 'reach'
      ? 20 + (target - 20) * progress
      : phase === 'hold'
        ? Math.max(0, Math.min(100, target + wobble))
        : 0;
  const struggling = target < GOOD_SCORE;
  const next = MOVES[(cycle + 1) % MOVES.length];
  const onTarget = (phase === 'reach' || phase === 'hold') && score >= GOOD_SCORE;
  const lowVisibility = struggling && (phase === 'reach' || (phase === 'hold' && progress < 0.6));

  return mockFeedbackFrame({
    t,
    phase,
    phaseProgress: progress,
    beatsToNextPhase: beatsLeft,
    move: move ? { id: move.id, name: move.name } : null,
    nextMove: { id: next.id, name: next.name },
    limbs: idleLimbs(move, onTarget),
    hint:
      struggling && phase === 'hold' && !lowVisibility
        ? { joint: 'leftShoulder', limb: 'leftUpperArm', text: 'left arm higher', status: 'red' }
        : null,
    holdProgress: phase === 'hold' ? progress : phase === 'release' ? 1 : 0,
    score: Math.round(score),
    holdScore: phase === 'hold' ? target : null,
    onTarget,
    lowVisibility,
    hiddenJoints: lowVisibility ? ['leftKnee', 'rightKnee'] : [],
  });
}

/** How many moves the mock run is planned for: the score tube is full at all of them Perfect. */
export const MOCK_PLANNED_MOVES = 8;

/** The run stats that go with `mockFrameAt(beat)`: one result as each hold closes. */
export function mockRunAt(beat: number): HudRun {
  const { cycle, phase } = positionAt(beat);
  // A move is scored when its hold closes, so the current one counts once it is in its release.
  const scored = cycle < 0 ? 0 : cycle + (phase === 'release' ? 1 : 0);
  let points = 0;
  let combo = 0;
  let perfectStreak = 0;
  let total = 0;
  let result: HudResult | null = null;
  for (let index = 0; index < scored; index++) {
    const score = SCRIPT[index % SCRIPT.length];
    const label = labelFor(score);
    combo = label === 'Miss' ? 0 : combo + 1;
    perfectStreak = label === 'Perfect' ? perfectStreak + 1 : 0;
    points += pointsFor(label, combo);
    total += score;
    result = { serial: index + 1, label, score, timing: label === 'Miss' ? null : 'In time' };
  }
  return {
    points,
    maxPoints: maxPointsFor(MOCK_PLANNED_MOVES),
    combo,
    perfectStreak,
    accuracy: scored > 0 ? total / scored : null,
    moveNumber: cycle < 0 ? 0 : (cycle % MOVES.length) + 1,
    moveCount: MOVES.length,
    round: null,
    result,
    formNote: null,
    bodyLost: false,
    // The second move's hold stands in for a limited joint going past its limit.
    easeOff: cycle === 1 && phase === 'hold' ? 'Ease off your right shoulder' : null,
  };
}

/** Named beats of the script, for screenshots and tests: `?state=perfect` in the preview. */
export const MOCK_STATES = {
  countin: 1.4,
  reach: MOCK_COUNT_IN_BEATS + 1.2,
  hold: MOCK_COUNT_IN_BEATS + 4.4,
  perfect: MOCK_COUNT_IN_BEATS + 6.5,
  easeoff: MOCK_COUNT_IN_BEATS + 8 + 4.4,
  good: MOCK_COUNT_IN_BEATS + 8 + 6.5,
  stepback: MOCK_COUNT_IN_BEATS + 24 + 1.4,
  miss: MOCK_COUNT_IN_BEATS + 24 + 6.5,
} as const;

export type MockState = keyof typeof MOCK_STATES;
