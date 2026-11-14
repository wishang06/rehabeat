import { JOINT_NAMES, type JointName, type Move } from '../types';
import rawMoves from './moves.json';

export class MoveFormatError extends Error {}

const JOINT_SET: ReadonlySet<string> = new Set(JOINT_NAMES);

function fail(where: string, problem: string): never {
  throw new MoveFormatError(`moves.json ${where}: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJoints(value: unknown, where: string): Partial<Record<JointName, number>> {
  if (!isRecord(value)) fail(where, '"joints" must be an object of joint name to target angle');
  const entries = Object.entries(value);
  if (entries.length === 0) fail(where, '"joints" needs at least one joint');

  const joints: Partial<Record<JointName, number>> = {};
  for (const [name, angle] of entries) {
    if (!JOINT_SET.has(name)) {
      fail(where, `unknown joint "${name}" (expected one of ${JOINT_NAMES.join(', ')})`);
    }
    if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < 0 || angle > 180) {
      fail(where, `joint "${name}" needs a target angle between 0 and 180 degrees`);
    }
    joints[name as JointName] = angle;
  }
  return joints;
}

function parseBeats(value: unknown, where: string): Move['beats'] {
  if (!isRecord(value)) fail(where, '"beats" must be { reach, hold, release }');
  const read = (key: 'reach' | 'hold' | 'release', min: number): number => {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min) {
      fail(where, `"beats.${key}" must be a whole number of beats, at least ${min}`);
    }
    return n;
  };
  return { reach: read('reach', 0), hold: read('hold', 1), release: read('release', 0) };
}

/** Validates one move, throwing a MoveFormatError that names the offending field. */
export function parseMove(value: unknown, index = 0): Move {
  const where = `[${index}]`;
  if (!isRecord(value)) fail(where, 'each move must be an object');

  const { id, name, tolerance, formRules } = value;
  if (typeof id !== 'string' || id.length === 0) fail(where, '"id" must be a non-empty string');
  const named = `[${index}] (${id})`;
  if (typeof name !== 'string' || name.length === 0) fail(named, '"name" must be a non-empty string');
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0) {
    fail(named, '"tolerance" must be a positive number of degrees');
  }
  if (!Array.isArray(formRules) || !formRules.every((rule) => typeof rule === 'string')) {
    fail(named, '"formRules" must be an array of rule ids (it may be empty)');
  }

  return {
    id,
    name,
    joints: parseJoints(value.joints, named),
    tolerance,
    beats: parseBeats(value.beats, named),
    formRules: [...formRules],
  };
}

/** Validates the whole move list: a non-empty array of moves with unique ids. */
export function parseMoves(value: unknown): Move[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new MoveFormatError('moves.json: expected a non-empty array of moves');
  }
  const moves = value.map((entry, index) => parseMove(entry, index));
  const seen = new Set<string>();
  for (const move of moves) {
    if (seen.has(move.id)) throw new MoveFormatError(`moves.json: duplicate move id "${move.id}"`);
    seen.add(move.id);
  }
  return moves;
}

/** The routine's moves, validated at load so a malformed moves.json fails loudly. */
export const MOVES: readonly Move[] = parseMoves(rawMoves);

export { computeGhost, drawGhost, type GhostLimb, type Point } from './ghost';
