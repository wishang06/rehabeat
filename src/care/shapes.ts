/**
 * Reads stored programs and sessions back into their types. Anything that
 * came from storage or the network is checked here, so a row written by an
 * older version, or by hand, is skipped instead of crashing a page.
 */
import type { JointLimits } from '../scoring';
import { JOINT_NAMES, type JointName } from '../types';
import { isDay } from './days';
import type { HoldRecord, Patient, PrescriptionBody, SessionRecord } from './types';

type Fields = Record<string, unknown>;

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isJoint = (value: unknown): value is JointName => JOINT_NAMES.includes(value as JointName);

function parseLimits(value: unknown): JointLimits | null {
  if (!isObject(value)) return null;
  const limits: JointLimits = {};
  for (const [joint, limit] of Object.entries(value)) {
    if (!isJoint(joint) || !isObject(limit)) return null;
    if (limit.kind === 'off') limits[joint] = { kind: 'off' };
    else if (limit.kind === 'range' && isNumber(limit.maxDeg)) limits[joint] = { kind: 'range', maxDeg: limit.maxDeg };
    else return null;
  }
  return limits;
}

/** The program fields of a stored value, or null if any is missing or the wrong type. Extra fields are dropped. */
export function parsePrescriptionBody(value: unknown): PrescriptionBody | null {
  if (!isObject(value)) return null;
  const { moveIds, rounds, holdBeats, sessionsPerWeek, weeks, startDate, note } = value;
  const limits = parseLimits(value.limits);
  if (!isStrings(moveIds) || !isNumber(rounds) || !isNumber(sessionsPerWeek) || !isNumber(weeks)) return null;
  if (holdBeats !== null && !isNumber(holdBeats)) return null;
  if (!isDay(startDate) || typeof note !== 'string' || limits === null) return null;
  return { moveIds, rounds, holdBeats, sessionsPerWeek, weeks, startDate, limits, note };
}

function parseHold(value: unknown): HoldRecord | null {
  if (!isObject(value)) return null;
  const { cycleIndex, round, moveId, score, label, timingOffsetMs, joints, formFlags, overLimit } = value;
  if (!isNumber(cycleIndex) || !isNumber(round) || typeof moveId !== 'string' || !isNumber(score)) return null;
  if (label !== 'Perfect' && label !== 'Good' && label !== 'Miss') return null;
  if (!isNumber(timingOffsetMs) || !isObject(joints) || !isStrings(formFlags)) return null;
  if (!Array.isArray(overLimit) || !overLimit.every(isJoint)) return null;

  const measured: HoldRecord['joints'] = {};
  for (const [joint, hold] of Object.entries(joints)) {
    if (!isJoint(joint) || !isObject(hold)) return null;
    if (!isNumber(hold.target) || !isNumber(hold.meanError) || !isNumber(hold.seen)) return null;
    measured[joint] = { target: hold.target, meanError: hold.meanError, seen: hold.seen };
  }
  return { cycleIndex, round, moveId, score, label, timingOffsetMs, joints: measured, formFlags, overLimit };
}

/** A stored session, or null if it cannot be read. */
export function parseSession(value: unknown): SessionRecord | null {
  if (!isObject(value)) return null;
  const { id, prescriptionId, startedAt, day, songId, durationSec, roundsPrescribed, roundsDone, completed } = value;
  if (typeof id !== 'string' || typeof prescriptionId !== 'string' || typeof startedAt !== 'string') return null;
  if (!isDay(day) || typeof songId !== 'string' || !isNumber(durationSec)) return null;
  if (!isNumber(roundsPrescribed) || !isNumber(roundsDone) || typeof completed !== 'boolean') return null;

  const summary = value.summary;
  if (!isObject(summary)) return null;
  const { points, moves, perfect, good, miss, bestCombo, accuracy } = summary;
  const numbers = [points, moves, perfect, good, miss, bestCombo, accuracy, summary.durationSec];
  if (!numbers.every(isNumber)) return null;

  if (!Array.isArray(value.holds)) return null;
  const holds: HoldRecord[] = [];
  for (const item of value.holds) {
    const hold = parseHold(item);
    if (!hold) return null;
    holds.push(hold);
  }

  return {
    id,
    prescriptionId,
    startedAt,
    day,
    songId,
    durationSec,
    roundsPrescribed,
    roundsDone,
    completed,
    summary: summary as unknown as SessionRecord['summary'],
    holds,
  };
}

/** A stored patient, or null if it cannot be read. */
export function parsePatient(value: unknown): Patient | null {
  if (!isObject(value)) return null;
  const { id, name, condition } = value;
  if (typeof id !== 'string' || typeof name !== 'string' || typeof condition !== 'string') return null;
  return {
    id,
    name,
    condition,
    joinCode: typeof value.joinCode === 'string' ? value.joinCode : null,
    joined: value.joined !== false,
    sample: value.sample === true,
  };
}
