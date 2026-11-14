/**
 * What the patient's screens say about their program, worked out in one
 * place: the card on the title screen, the plan the Play screen is given,
 * and the strip on the results screen.
 */
import { JOINT_NAMES, type Move } from '../types';
import { consistency, findings } from './analysis';
import { limitText } from './labels';
import { applyLimits, applyPrescription } from './prescription';
import type { MyProgram, PlayPlan, PlaySetup, SessionRecord } from './types';

export interface ProgramView {
  doctorName: string;
  /** The moves a session will play, after the limits. */
  moveNames: string[];
  rounds: number;
  /** Each limit as a sentence: "Right shoulder: raise up to 90°". */
  limits: string[];
  week: { done: number; prescribed: number } | null;
  doneToday: boolean;
  /** The program's last week has passed. */
  finished: boolean;
  note: string;
  /** False when the limits leave no move to play. */
  playable: boolean;
  /** What a program session plays. */
  plan: PlayPlan;
}

export function programView(program: MyProgram, all: readonly Move[], today: string): ProgramView {
  const { prescription, sessions } = program;
  const applied = applyPrescription(all, prescription);
  const record = consistency([prescription], sessions, today);
  const todayCell = record.weeks.at(-1)?.days.find((cell) => cell.today);

  return {
    doctorName: program.doctorName,
    moveNames: applied.moves.map((move) => move.name),
    rounds: prescription.rounds,
    limits: JOINT_NAMES.flatMap((joint) => {
      const limit = prescription.limits[joint];
      return limit ? [limitText(joint, limit)] : [];
    }),
    week: record.thisWeek,
    doneToday: todayCell?.state === 'done',
    finished: record.status.kind === 'finished',
    note: prescription.note,
    playable: applied.moves.length > 0,
    plan: { moves: applied.moves, rounds: prescription.rounds, limits: prescription.limits },
  };
}

/**
 * What free play plays: every move, until the player finishes. A patient's
 * limits still apply: a restricted joint is restricted whatever they chose to play.
 */
export function freePlan(program: MyProgram | null, all: readonly Move[]): PlayPlan {
  if (!program) return { moves: all, rounds: null, limits: {} };
  const { limits } = program.prescription;
  return { moves: applyLimits(all, limits).moves, rounds: null, limits };
}

export interface SentView {
  /** Mean hold score of the session, 0-100. */
  average: number;
  holds: number;
  /** This week, counting this session as saved. */
  week: { done: number; prescribed: number } | null;
  /** The one thing to work on from this session alone, or null. */
  workOn: string | null;
  /** The session ended before its last round, so it does not count toward the week. */
  partial: boolean;
}

/** What the results screen says was sent to the doctor. */
export function sentView(program: MyProgram, session: SessionRecord, all: readonly Move[], today: string): SentView {
  const sessions = program.sessions.some((saved) => saved.id === session.id)
    ? program.sessions
    : [...program.sessions, session];
  const scores = session.holds.map((hold) => hold.score);

  return {
    average: scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    holds: session.holds.length,
    week: consistency([program.prescription], sessions, today).thisWeek,
    workOn: findings([session], all)[0]?.text ?? null,
    partial: !session.completed,
  };
}

/**
 * What a run will be, worked out from the program as it stands at the
 * moment play starts. Asked for a program session, it gives one when the
 * program has something to play; otherwise it gives free play. Either way a
 * patient's limits are in the plan.
 */
export function playSetup(
  wanted: 'free' | 'program',
  program: MyProgram | null,
  all: readonly Move[],
  today: string,
): PlaySetup {
  if (wanted === 'program' && program) {
    const view = programView(program, all, today);
    if (view.playable) return { mode: 'program', plan: view.plan, program };
  }
  return { mode: 'free', plan: freePlan(program, all), program: null };
}
