/**
 * The doctor loop's shared shapes: what a doctor prescribes, what a program
 * session records, and the one interface both the doctor's page and the game
 * use to read and write them.
 */
import type { HoldDetail, JointLimits, RunSummary } from '../scoring';
import type { Move } from '../types';

/** What a doctor sets. The UI calls this a program. */
export interface PrescriptionBody {
  /** Moves from src/moves/moves.json, in play order. */
  moveIds: string[];
  /** Times through the routine in one session. */
  rounds: number;
  /** Hold length in beats for every move, or null to keep each move's own. */
  holdBeats: number | null;
  sessionsPerWeek: number;
  weeks: number;
  /** The program's first day, as a local YYYY-MM-DD key. */
  startDate: string;
  limits: JointLimits;
  /** Text for the patient, shown before they play. */
  note: string;
}

/**
 * One saved version of a program. Versions are never edited: a change saves
 * the next version, and the newest is the one in force.
 */
export interface Prescription extends PrescriptionBody {
  id: string;
  /** 1 for the first version saved for a patient. */
  version: number;
  /** ISO time the version was saved. */
  createdAt: string;
}

/** One hold of a program session. */
export interface HoldRecord extends HoldDetail {
  /** 1-based round the hold belongs to. */
  round: number;
}

/** One program session, as sent to the doctor. Only scores and joint angles: no picture, no landmarks. */
export interface SessionRecord {
  /** Made by the patient's browser, so saving the same session twice cannot make two. */
  id: string;
  /** The version the session was played under. */
  prescriptionId: string;
  /** ISO time the session started. */
  startedAt: string;
  /** The patient's local calendar day, YYYY-MM-DD. */
  day: string;
  songId: string;
  durationSec: number;
  roundsPrescribed: number;
  /** Whole rounds finished. */
  roundsDone: number;
  /** True when every prescribed round was finished. Only completed sessions count toward consistency. */
  completed: boolean;
  summary: RunSummary;
  holds: HoldRecord[];
}

export interface Patient {
  id: string;
  name: string;
  condition: string;
  /** The code the patient joins with, until they have. Always null in the demo clinic. */
  joinCode: string | null;
  joined: boolean;
  /** A sample patient of the demo clinic. */
  sample: boolean;
}

/** Everything a doctor has on one patient. Prescriptions and sessions are oldest first. */
export interface PatientFile {
  patient: Patient;
  prescriptions: Prescription[];
  sessions: SessionRecord[];
}

/** The patient's own view: the program in force, who set it, and their sessions (oldest first). */
export interface MyProgram {
  doctorName: string;
  prescription: Prescription;
  sessions: SessionRecord[];
}

/** What the Play screen is asked to play. Free play has no end: `rounds` is null. */
export interface PlayPlan {
  moves: readonly Move[];
  rounds: number | null;
  limits: JointLimits;
}

/**
 * Where programs and sessions live. The demo clinic keeps them in this
 * browser; the real clinic keeps them in private Supabase tables.
 */
export interface CareStore {
  readonly kind: 'demo' | 'clinic';
  // The doctor's side.
  listPatients(): Promise<PatientFile[]>;
  addPatient(input: { name: string; condition: string }): Promise<Patient>;
  /** Saves the next version of the patient's program. */
  savePrescription(patientId: string, body: PrescriptionBody): Promise<Prescription>;
  // The patient's side.
  myProgram(): Promise<MyProgram | null>;
  /** Saving a session whose id is already stored succeeds without storing it again. */
  saveSession(session: SessionRecord): Promise<void>;
  joinWithCode(code: string): Promise<void>;
  /** Demo clinic only: back to the sample patients. */
  reset?(): void;
}

/** The real clinic's tables are not there yet: the migration has not been applied. */
export class CareSetupError extends Error {}
