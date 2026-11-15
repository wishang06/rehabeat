import { GOOD_SCORE, jointReading, type LiveState, type Routine } from '../scoring';
import { JOINT_NAMES, type JointName, type Landmark, type Move, type PoseFrame } from '../types';
import type {
  FeedbackFrame,
  FeedbackPhase,
  LimbFeedback,
  LimbName,
  LimbStatus,
  MoveRef,
} from '../types/ui';
import { hintText, jointStatus, pickHintJoint } from './hints';
import { LIMBS, LIMB_OF_JOINT, jointVisibility } from './limbs';

/** A joint must stay out of tolerance this long before a hint names it. */
export const HINT_DELAY_MS = 300;
/** A scored joint must stay under the visibility cutoff this long before the player is told. */
export const LOW_VISIBILITY_MS = 500;

export interface FeedbackInput {
  /** Master-clock seconds of the audible present. Paces the hint and visibility timers. */
  now: number;
  /** Fractional beat position of the audible present. */
  beat: number;
  /** The latest pose frame, or null when there is none or it is stale. */
  frame: PoseFrame | null;
  /** That frame's world landmarks, for per-joint visibility. */
  world: Landmark[] | null;
  /** The scoring engine's live state. */
  live: LiveState;
}

type Judged = 'green' | 'amber' | 'red';

/** What the builder remembers between frames. Treat as opaque. */
export interface FeedbackState {
  cycleIndex: number | null;
  hintJoint: JointName | null;
  /** When the current unbroken stretch of out-of-tolerance error began. */
  errorSince: number | null;
  /** When each currently unmeasured joint was last measured (or first seen missing). */
  hiddenSince: Partial<Record<JointName, number>>;
  /** Each joint's status the last time it was measured in this cycle. */
  lastStatus: Partial<Record<JointName, Judged>>;
}

export function initialFeedbackState(): FeedbackState {
  return { cycleIndex: null, hintJoint: null, errorSince: null, hiddenSince: {}, lastStatus: {} };
}

const moveRef = (move: Move): MoveRef => ({ id: move.id, name: move.name });

interface Timing {
  phase: FeedbackPhase;
  phaseProgress: number;
  beatsToNextPhase: number;
  holdProgress: number;
  /** The move whose targets apply now: the first move during the count-in. */
  move: Move;
  current: MoveRef | null;
  next: MoveRef;
  cycleIndex: number | null;
}

function timingAt(routine: Routine, beat: number): Timing {
  const info = routine.phaseAt(beat);
  if (!info) {
    const first = routine.cycle(0).move;
    const countIn = routine.startBeat;
    return {
      phase: 'ready',
      phaseProgress: countIn > 0 ? Math.min(1, Math.max(0, beat / countIn)) : 1,
      beatsToNextPhase: Math.max(0, countIn - beat),
      holdProgress: 0,
      move: first,
      current: null,
      next: moveRef(first),
      cycleIndex: null,
    };
  }
  const { cycle, phase, progress } = info;
  const end = phase === 'reach' ? cycle.holdStartBeat : phase === 'hold' ? cycle.holdEndBeat : cycle.endBeat;
  return {
    phase,
    phaseProgress: progress,
    beatsToNextPhase: Math.max(0, end - beat),
    holdProgress: phase === 'reach' ? 0 : phase === 'hold' ? progress : 1,
    move: cycle.move,
    current: moveRef(cycle.move),
    next: moveRef(routine.cycle(cycle.index + 1).move),
    cycleIndex: cycle.index,
  };
}

/**
 * One FeedbackFrame from the present moment. Pure: pass the state returned
 * by the previous call (or initialFeedbackState()) and keep the new one.
 *
 * Limb errors compare the latest frame with the move the player can hear
 * (the audible beat), the same move the HUD names. The score and hold score
 * come from the scoring engine, and only while it is on that same move.
 */
export function buildFeedbackFrame(
  routine: Routine,
  input: FeedbackInput,
  previous: FeedbackState,
): { frame: FeedbackFrame; state: FeedbackState } {
  const { now, frame, world, live } = input;
  const timing = timingAt(routine, input.beat);
  const { move, phase } = timing;
  const judged = phase === 'reach' || phase === 'hold';
  const newCycle = timing.cycleIndex !== previous.cycleIndex;

  const angles = frame?.angles ?? {};
  const hiddenSince: FeedbackState['hiddenSince'] = {};
  for (const joint of JOINT_NAMES) {
    if (angles[joint] === undefined) hiddenSince[joint] = previous.hiddenSince[joint] ?? now;
  }
  const hiddenFor = (joint: JointName) => {
    const since = hiddenSince[joint];
    return since === undefined ? 0 : (now - since) * 1000;
  };

  const lastStatus: FeedbackState['lastStatus'] = newCycle ? {} : { ...previous.lastStatus };
  const errors: Partial<Record<JointName, number>> = {};
  const limbs = {} as Record<LimbName, LimbFeedback>;
  const hiddenJoints: JointName[] = [];
  let worstJoint: JointName | null = null;

  for (const { limb, joint } of LIMBS) {
    const target = move.joints[joint];
    // A scored joint is read the way scoring reads it, so the colours and the hint agree with the score.
    const current = frame && target !== undefined ? jointReading(frame, joint, target) : angles[joint];
    const scored = target !== undefined;
    const errorDeg = scored && current !== undefined ? Math.abs(current - target) : null;

    let status: LimbStatus = 'idle';
    if (scored && errorDeg !== null) {
      errors[joint] = errorDeg;
      const measured = jointStatus(errorDeg, move.tolerance);
      lastStatus[joint] = measured;
      if (judged) status = measured;
    } else if (scored) {
      const stale = hiddenFor(joint) > LOW_VISIBILITY_MS;
      const remembered = lastStatus[joint];
      if (stale) status = 'grey';
      else if (judged) status = remembered ?? 'grey';
    }

    limbs[limb] = {
      limb,
      joint,
      status,
      scored,
      errorDeg,
      currentDeg: current ?? null,
      targetDeg: target ?? null,
      visibility: jointVisibility(world, joint),
    };
  }

  for (const joint of JOINT_NAMES) {
    if (move.joints[joint] !== undefined && hiddenFor(joint) > LOW_VISIBILITY_MS) hiddenJoints.push(joint);
    const error = errors[joint];
    if (error !== undefined && (worstJoint === null || error > (errors[worstJoint] ?? -1))) worstJoint = joint;
  }
  const lowVisibility = hiddenJoints.length > 0;

  // The hint: whichever joint is worst out of tolerance, once error has lasted HINT_DELAY_MS.
  const candidate = judged && !lowVisibility ? pickHintJoint(errors, move.tolerance, newCycle ? null : previous.hintJoint) : null;
  const errorSince = candidate === null ? null : newCycle ? now : (previous.errorSince ?? now);
  let hint: FeedbackFrame['hint'] = null;
  if (candidate !== null && errorSince !== null && (now - errorSince) * 1000 >= HINT_DELAY_MS) {
    const target = move.joints[candidate];
    const current = frame && target !== undefined ? jointReading(frame, candidate, target) : undefined;
    const status = limbs[LIMB_OF_JOINT[candidate]].status;
    if (current !== undefined && target !== undefined && (status === 'amber' || status === 'red')) {
      hint = { joint: candidate, limb: LIMB_OF_JOINT[candidate], text: hintText(candidate, current, target), status };
    }
  }

  const sameCycle = timing.cycleIndex !== null && live.cycle?.index === timing.cycleIndex;
  const score = sameCycle ? live.frameScore : 0;

  return {
    frame: {
      t: now,
      phase,
      phaseProgress: timing.phaseProgress,
      beatsToNextPhase: timing.beatsToNextPhase,
      move: timing.current,
      nextMove: timing.next,
      limbs,
      worstJoint,
      hint,
      holdProgress: timing.holdProgress,
      score,
      holdScore: sameCycle ? live.holdScore : null,
      onTarget: judged && score >= GOOD_SCORE,
      lowVisibility,
      hiddenJoints,
    },
    state: { cycleIndex: timing.cycleIndex, hintJoint: candidate, errorSince, hiddenSince, lastStatus },
  };
}

/** Holds the state between frames so callers just pass the present moment. */
export class FeedbackTracker {
  private state = initialFeedbackState();

  constructor(private readonly routine: Routine) {}

  update(input: FeedbackInput): FeedbackFrame {
    const { frame, state } = buildFeedbackFrame(this.routine, input, this.state);
    this.state = state;
    return frame;
  }

  reset(): void {
    this.state = initialFeedbackState();
  }
}
