/**
 * The demo clinic's sample patients. Their history is written in days before
 * today, so the charts are always current, and it is the same every time it
 * is built: the small variations come from a generator seeded by the patient
 * and the day offset, never from the clock.
 */
import { MOVES } from '../moves';
import {
  applyResult,
  initialStats,
  labelFor,
  pointsFor,
  scoreFromError,
  summarizeRun,
  type JointLimits,
} from '../scoring';
import type { JointName, Move } from '../types';
import { addDays } from './days';
import { applyPrescription } from './prescription';
import type { HoldRecord, PatientFile, Prescription, PrescriptionBody, SessionRecord } from './types';

export const DEMO_DOCTOR = 'Dr. Okafor';
/** The demo clinic's patient who is whoever plays in this browser. */
export const YOU_ID = 'you';

/** Seconds per beat the sample sessions pretend to have been played at (100 BPM). */
const SECONDS_PER_BEAT = 0.6;

/** A small repeatable generator (mulberry32) seeded from a string. Returns numbers in [0, 1). */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What one sample session was like. */
interface SessionShape {
  daysAgo: number;
  /** Rounds played; fewer than prescribed makes the session partial. */
  rounds?: number;
  /** Typical size, in degrees, of every joint's error. Its direction varies hold to hold. */
  slack: number;
  /** A steady error on one joint of one move, as (measured - target) in degrees. */
  bias?: { moveId: string; joint: JointName; error: number };
  latenessMs: number;
  /** Holds, counted from 0 across the session, that went past the limit on a joint. */
  breaches?: { hold: number; joint: JointName }[];
}

interface SamplePatient {
  id: string;
  name: string;
  condition: string;
  /** Versions of the program, oldest first. `savedDaysAgo` of the first is the program's start. */
  versions: { savedDaysAgo: number; body: Omit<PrescriptionBody, 'startDate'> }[];
  /** A form rule flagged on some holds of one move. */
  form?: { moveId: string; ruleId: string; onHold: (index: number) => boolean };
  sessions: SessionShape[];
}

const body = (
  moveIds: string[],
  sessionsPerWeek: number,
  weeks: number,
  limits: JointLimits,
  note: string,
): Omit<PrescriptionBody, 'startDate'> => ({ moveIds, rounds: 3, holdBeats: null, sessionsPerWeek, weeks, limits, note });

/** Maya's right shoulder, in degrees short of the side raise, session by session: it closes in over the last three. */
const MAYA_SHORT = [25, 25, 24, 24, 23, 22, 21, 20, 16, 15, 14];
const MAYA_DAYS = [16, 15, 13, 11, 9, 8, 6, 5, 3, 2, 1];
const PRIYA_DAYS = [30, 28, 26, 24, 23, 21, 19, 17, 16, 14, 12, 10, 9, 7, 5, 3, 2, 1];

const PATIENTS: SamplePatient[] = [
  {
    id: 'sample-maya',
    name: 'Maya Chen',
    condition: 'Right shoulder',
    versions: [
      {
        savedDaysAgo: 16,
        body: body(
          ['side-arm-raise', 'overhead-arm-raise'],
          5,
          6,
          { rightShoulder: { kind: 'range', maxDeg: 80 } },
          'Start gently. Stop below shoulder height on your right side.',
        ),
      },
      {
        savedDaysAgo: 7,
        body: body(
          ['side-arm-raise', 'overhead-arm-raise'],
          5,
          6,
          { rightShoulder: { kind: 'range', maxDeg: 90 } },
          'Good first week. You can raise your right arm to shoulder height now. Keep your trunk tall.',
        ),
      },
    ],
    form: { moveId: 'side-arm-raise', ruleId: 'trunk-lean', onHold: (index) => index % 5 === 0 || index % 5 === 3 },
    sessions: MAYA_DAYS.map((daysAgo, i) => ({
      daysAgo,
      slack: 14 - i * 0.4,
      bias: { moveId: 'side-arm-raise', joint: 'rightShoulder' as const, error: -MAYA_SHORT[i] },
      latenessMs: 820 - i * 42,
      // Both of the latest session's breaches are on the overhead raise, in its last two rounds.
      breaches: i === 2 ? [{ hold: 5, joint: 'rightShoulder' as const }] : i === 10 ? [3, 5].map((hold) => ({ hold, joint: 'rightShoulder' as const })) : [],
    })),
  },
  {
    id: 'sample-sam',
    name: 'Sam Ortiz',
    condition: 'Left knee',
    versions: [
      {
        savedDaysAgo: 6,
        body: body(
          ['side-arm-raise', 'overhead-arm-raise'],
          5,
          4,
          { leftKnee: { kind: 'off' } },
          'Upper body only until your knee has settled.',
        ),
      },
    ],
    sessions: [
      { daysAgo: 6, slack: 11, latenessMs: 520 },
      { daysAgo: 4, slack: 10, latenessMs: 480 },
    ],
  },
  {
    id: 'sample-priya',
    name: 'Priya Nair',
    condition: 'Lower back',
    versions: [
      {
        savedDaysAgo: 30,
        body: body(['goddess-pose', 'warrior-ii'], 4, 8, {}, 'Slow and steady. Sink into the squat only as far as is comfortable.'),
      },
    ],
    sessions: PRIYA_DAYS.map((daysAgo, i) => ({
      daysAgo,
      slack: 12 - i * 0.35,
      // Her front knee stays a little straighter than the pose asks for.
      bias: { moveId: 'warrior-ii', joint: 'rightKnee' as const, error: 10 },
      latenessMs: 240 - i * 6,
    })),
  },
  {
    id: 'sample-jonah',
    name: 'Jonah Reed',
    condition: 'Left hip',
    versions: [
      {
        savedDaysAgo: 12,
        body: body(
          ['standing-knee-raise', 'tree-pose'],
          5,
          6,
          { leftHip: { kind: 'range', maxDeg: 60 } },
          'Lift the knee only part of the way for now.',
        ),
      },
    ],
    // In Tree Pose his raised knee stays well short of the bend the pose asks for.
    sessions: [
      { daysAgo: 12, slack: 13, latenessMs: 560 },
      { daysAgo: 11, slack: 13, latenessMs: 540 },
      { daysAgo: 9, slack: 12, latenessMs: 520 },
      { daysAgo: 7, slack: 12, latenessMs: 500 },
      { daysAgo: 3, rounds: 1, slack: 12, latenessMs: 520 },
      { daysAgo: 1, slack: 11, latenessMs: 480, breaches: [{ hold: 0, joint: 'leftHip' as const }] },
    ].map((shape) => ({ ...shape, bias: { moveId: 'tree-pose', joint: 'leftKnee' as const, error: 19 } })),
  },
];

function holdsFor(patient: SamplePatient, shape: SessionShape, moves: Move[], rounds: number): HoldRecord[] {
  const random = seeded(`${patient.id}:${shape.daysAgo}`);
  const holds: HoldRecord[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (const move of moves) {
      const index = holds.length;
      const joints: HoldRecord['joints'] = {};
      let totalError = 0;
      for (const [joint, target] of Object.entries(move.joints) as [JointName, number][]) {
        const biased = shape.bias?.moveId === move.id && shape.bias.joint === joint;
        const wobble = (random() - 0.5) * 2;
        const meanError = biased
          ? shape.bias!.error + wobble
          : (random() < 0.5 ? -1 : 1) * shape.slack * (0.6 + 0.4 * random());
        joints[joint] = { target, meanError: Math.round(meanError * 10) / 10, seen: 1 };
        totalError += Math.abs(meanError);
      }
      const score = Math.round(scoreFromError(totalError / Object.keys(move.joints).length, move.tolerance));
      const label = labelFor(score);
      const flagged = patient.form?.moveId === move.id && patient.form.onHold(index);
      holds.push({
        cycleIndex: index,
        round,
        moveId: move.id,
        score,
        label,
        timingOffsetMs: label === 'Miss' ? 0 : Math.round(shape.latenessMs + (random() - 0.5) * 120),
        joints,
        formFlags: flagged ? [patient.form!.ruleId] : [],
        overLimit: (shape.breaches ?? []).filter((breach) => breach.hold === index).map((breach) => breach.joint),
      });
    }
  }
  return holds;
}

function sessionFor(patient: SamplePatient, shape: SessionShape, prescription: Prescription, today: string): SessionRecord {
  const moves = applyPrescription(MOVES, prescription).moves;
  const rounds = shape.rounds ?? prescription.rounds;
  const holds = holdsFor(patient, shape, moves, rounds);

  let stats = initialStats();
  let points = 0;
  for (const hold of holds) {
    stats = applyResult(stats, hold);
    points += pointsFor(hold.label, stats.combo);
  }
  const beatsPerRound = moves.reduce((sum, move) => sum + move.beats.reach + move.beats.hold + move.beats.release, 0);
  const durationSec = Math.round((4 + rounds * beatsPerRound) * SECONDS_PER_BEAT);
  const day = addDays(today, -shape.daysAgo);

  return {
    id: `${patient.id}-s${shape.daysAgo}`,
    prescriptionId: prescription.id,
    startedAt: `${day}T18:00:00`,
    day,
    songId: 'past-sadness',
    durationSec,
    roundsPrescribed: prescription.rounds,
    roundsDone: rounds,
    completed: rounds >= prescription.rounds,
    summary: summarizeRun(stats, points, durationSec),
    holds,
  };
}

/** The sample patients as of `today` (a local YYYY-MM-DD key), with their programs and history. */
export function samplePatients(today: string): PatientFile[] {
  return PATIENTS.map((patient) => {
    const startDate = addDays(today, -patient.versions[0].savedDaysAgo);
    const prescriptions: Prescription[] = patient.versions.map((version, index) => ({
      ...version.body,
      startDate,
      id: `${patient.id}-v${index + 1}`,
      version: index + 1,
      // Written as local time, so the version belongs to that calendar day wherever the page is opened.
      createdAt: `${addDays(today, -version.savedDaysAgo)}T09:00:00`,
    }));
    /** The version that was in force on the day of a session. */
    const inForce = (daysAgo: number) =>
      prescriptions.filter((_, index) => patient.versions[index].savedDaysAgo >= daysAgo).at(-1) ?? prescriptions[0];

    return {
      patient: { id: patient.id, name: patient.name, condition: patient.condition, joinCode: null, joined: true, sample: true },
      prescriptions,
      sessions: patient.sessions.map((shape) => sessionFor(patient, shape, inForce(shape.daysAgo), today)),
    };
  });
}
