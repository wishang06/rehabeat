import { angleForMovement, movementOf, type JointLimits } from '../scoring';
import { JOINT_NAMES, type JointName, type Move } from '../types';
import { isDay } from './days';
import { jointLabel, limitVerb } from './labels';
import type { PrescriptionBody } from './types';

/** Inclusive bounds on a program's numbers, and the longest note. */
export const RX_BOUNDS = {
  rounds: [1, 10],
  holdBeats: [1, 16],
  sessionsPerWeek: [1, 7],
  weeks: [1, 52],
  note: 500,
} as const;

/** An empty program starting on `today`, with the defaults the editor opens on. */
export function newPrescriptionBody(today: string): PrescriptionBody {
  return {
    moveIds: [],
    rounds: 3,
    holdBeats: null,
    sessionsPerWeek: 5,
    weeks: 6,
    startDate: today,
    limits: {},
    note: '',
  };
}

/** One thing the limits changed about the program, for the doctor's preview. */
export interface MoveChange {
  moveId: string;
  name: string;
  kind: 'removed' | 'scaled';
  joint: JointName;
  /** "Standing Knee Raise removed: left knee is off", "Overhead Arm Raise plays as a raise to 90°". */
  text: string;
}

export interface AppliedProgram {
  /** Ordinary moves, ready for a Routine. May be empty. */
  moves: Move[];
  changes: MoveChange[];
}

/**
 * Applies joint limits to a list of moves. A move that scores a joint that
 * is off is removed. A target beyond a range limit is set to the limit. The
 * moves passed in are not modified.
 */
export function applyLimits(moves: readonly Move[], limits: JointLimits): AppliedProgram {
  const applied: Move[] = [];
  const changes: MoveChange[] = [];

  for (const move of moves) {
    const offJoint = JOINT_NAMES.find((joint) => move.joints[joint] !== undefined && limits[joint]?.kind === 'off');
    if (offJoint) {
      changes.push({
        moveId: move.id,
        name: move.name,
        kind: 'removed',
        joint: offJoint,
        text: `${move.name} removed: ${jointLabel(offJoint)} is off`,
      });
      continue;
    }

    const joints = { ...move.joints };
    for (const joint of JOINT_NAMES) {
      const target = joints[joint];
      const limit = limits[joint];
      if (target === undefined || limit?.kind !== 'range') continue;
      if (movementOf(joint, target) <= limit.maxDeg) continue;
      joints[joint] = angleForMovement(joint, limit.maxDeg);
      changes.push({
        moveId: move.id,
        name: move.name,
        kind: 'scaled',
        joint,
        text:
          limitVerb(joint) === 'raise'
            ? `${move.name} plays as a raise to ${limit.maxDeg}°`
            : `${move.name} plays with a bend to ${limit.maxDeg}°`,
      });
    }
    applied.push({ ...move, joints, beats: { ...move.beats }, formRules: [...move.formRules] });
  }
  return { moves: applied, changes };
}

/**
 * The moves a program session plays: the program's moves in its order (ids
 * that no longer exist are skipped), with its hold length, through its limits.
 */
export function applyPrescription(
  all: readonly Move[],
  rx: Pick<PrescriptionBody, 'moveIds' | 'holdBeats' | 'limits'>,
): AppliedProgram {
  const picked: Move[] = [];
  for (const id of rx.moveIds) {
    const move = all.find((candidate) => candidate.id === id);
    if (!move) continue;
    picked.push(rx.holdBeats === null ? move : { ...move, beats: { ...move.beats, hold: rx.holdBeats } });
  }
  return applyLimits(picked, rx.limits);
}

const between = (value: number, [min, max]: readonly [number, number]) =>
  Number.isInteger(value) && value >= min && value <= max;

/** Null when the program can be saved, otherwise one sentence for the doctor saying why not. */
export function validatePrescription(body: PrescriptionBody, all: readonly Move[]): string | null {
  const { rounds, holdBeats, sessionsPerWeek, weeks, note } = RX_BOUNDS;
  if (!between(body.rounds, rounds)) return `Rounds must be between ${rounds[0]} and ${rounds[1]}.`;
  if (body.holdBeats !== null && !between(body.holdBeats, holdBeats)) {
    return `Hold beats must be between ${holdBeats[0]} and ${holdBeats[1]}.`;
  }
  if (!between(body.sessionsPerWeek, sessionsPerWeek)) {
    return `Sessions a week must be between ${sessionsPerWeek[0]} and ${sessionsPerWeek[1]}.`;
  }
  if (!between(body.weeks, weeks)) return `Weeks must be between ${weeks[0]} and ${weeks[1]}.`;
  if (body.note.length > note) return `The note is longer than ${note} characters.`;
  if (!isDay(body.startDate)) return 'The start date is not a date.';
  for (const limit of Object.values(body.limits)) {
    if (limit.kind === 'range' && !(Number.isFinite(limit.maxDeg) && limit.maxDeg > 0)) {
      return 'A limit needs a number of degrees above 0.';
    }
  }

  if (!body.moveIds.some((id) => all.some((move) => move.id === id))) return 'Pick at least one move.';
  if (applyPrescription(all, body).moves.length === 0) {
    return 'The limits remove every move. Loosen a limit or pick other moves.';
  }
  return null;
}
