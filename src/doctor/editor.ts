/** The program editor's state changes and the trend line's geometry, kept apart from the page so they can be tested. */
import { newPrescriptionBody, parsePrescriptionBody, type PatientFile, type PrescriptionBody } from '../care';
import type { JointLimit } from '../scoring';
import type { JointName } from '../types';

/** What the editor opens on: the patient's newest version, or an empty program starting today. */
export function draftFor(file: PatientFile, today: string): PrescriptionBody {
  const newest = file.prescriptions.at(-1);
  // parsePrescriptionBody keeps the program's fields and drops the version's id, number and date.
  return (newest && parsePrescriptionBody(newest)) ?? newPrescriptionBody(today);
}

/** Adds a move at the end of the program, or takes it out. */
export function toggleMove(body: PrescriptionBody, moveId: string): PrescriptionBody {
  const moveIds = body.moveIds.includes(moveId)
    ? body.moveIds.filter((id) => id !== moveId)
    : [...body.moveIds, moveId];
  return { ...body, moveIds };
}

function shift(body: PrescriptionBody, moveId: string, by: -1 | 1): PrescriptionBody {
  const from = body.moveIds.indexOf(moveId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= body.moveIds.length) return body;
  const moveIds = [...body.moveIds];
  [moveIds[from], moveIds[to]] = [moveIds[to], moveIds[from]];
  return { ...body, moveIds };
}

export const moveUp = (body: PrescriptionBody, moveId: string) => shift(body, moveId, -1);
export const moveDown = (body: PrescriptionBody, moveId: string) => shift(body, moveId, 1);

/** Sets a joint's limit, or removes it with null. */
export function setLimit(body: PrescriptionBody, joint: JointName, limit: JointLimit | null): PrescriptionBody {
  const limits = { ...body.limits };
  if (limit) limits[joint] = limit;
  else delete limits[joint];
  return { ...body, limits };
}

/** The same program, starting over today: its week count and consistency begin again. */
export function startNewProgram(body: PrescriptionBody, today: string): PrescriptionBody {
  return { ...body, startDate: today };
}

/** A stable text form of a program, so two drafts can be compared whatever order their limits were set in. */
function fingerprint(body: PrescriptionBody): string {
  const limits = Object.entries(body.limits).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([
    body.moveIds,
    body.rounds,
    body.holdBeats,
    body.sessionsPerWeek,
    body.weeks,
    body.startDate,
    limits,
    body.note,
  ]);
}

/** True when the draft differs from what the editor opened on. */
export function isDirty(body: PrescriptionBody, file: PatientFile, today: string): boolean {
  return fingerprint(body) !== fingerprint(draftFor(file, today));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Points for a trend line in a `width` by `height` box with `pad` on every
 * side. The line is scaled to its largest value (at least 1), so a flat line
 * of zeros sits on the baseline. A single value sits at the right-hand end.
 */
export function sparkPoints(series: readonly number[], width: number, height: number, pad: number): [number, number][] {
  const sizes = series.map(Math.abs);
  const max = Math.max(1, ...sizes);
  const span = width - 2 * pad;
  return sizes.map((size, index) => [
    round2(series.length === 1 ? width - pad : pad + (index * span) / (series.length - 1)),
    round2(height - pad - (size / max) * (height - 2 * pad)),
  ]);
}
