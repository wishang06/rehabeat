/**
 * The Gemini summary on the doctor's page: what is sent for one patient, and
 * the call to the Edge Function that asks Gemini. The prompt and the checks
 * are in supabase/functions/care-summary/draft.ts, shared with the function.
 */
import {
  DRAFT_LIMITS,
  parseDraft,
  type Draft,
  type SummaryInput,
} from '../../supabase/functions/care-summary/draft';
import { supabase } from '../lib/supabase';
import { JOINT_NAMES, type Move } from '../types';
import { consistency, findings, quality } from './analysis';
import { limitText } from './labels';
import { applyPrescription } from './prescription';
import type { PatientFile } from './types';

export type { Draft, SummaryInput };

/**
 * What the doctor's page sends to draft a summary of one patient: the
 * condition, the program, consistency, scores and problem spots. Never the
 * patient's name, the doctor's notes or any session's raw data.
 */
export function summaryInput(file: PatientFile, today: string, moves: readonly Move[]): SummaryInput {
  const { prescriptions, sessions } = file;
  const record = consistency(prescriptions, sessions, today);
  const scores = quality(sessions, today);
  const rx = prescriptions.at(-1);

  return {
    condition: file.patient.condition.slice(0, DRAFT_LIMITS.condition),
    program: rx
      ? {
          moves: applyPrescription(moves, rx).moves.map((move) => move.name).slice(0, DRAFT_LIMITS.moves),
          rounds: rx.rounds,
          sessionsPerWeek: rx.sessionsPerWeek,
          weeks: rx.weeks,
          week: record.programWeek,
          limits: JOINT_NAMES.flatMap((joint) => {
            const limit = rx.limits[joint];
            return limit ? [limitText(joint, limit)] : [];
          }).slice(0, DRAFT_LIMITS.limits),
        }
      : null,
    consistency: {
      status: record.statusText,
      weeks: record.weeks
        .slice(-DRAFT_LIMITS.weeks)
        .map((week) => ({ week: week.index, done: week.done, prescribed: week.prescribed })),
    },
    quality: {
      average: scores.average === null ? null : Math.round(scores.average),
      previous: scores.previous === null ? null : Math.round(scores.previous),
    },
    findings: findings(sessions, moves)
      .slice(0, DRAFT_LIMITS.findings)
      .map((finding) => ({ kind: finding.kind, text: finding.text, trend: finding.trend })),
    sessions: sessions.length,
  };
}

/** The Edge Function's name, as deployed. */
export const SUMMARY_FUNCTION = 'care-summary';

export type DraftResult =
  | { ok: true; draft: Draft }
  | { ok: false; reason: 'unavailable' | 'setup' | 'failed'; message: string };

/** Asks the Edge Function for a draft. Never throws: a failure comes back as a reason the page can show. */
export async function requestDraft(input: SummaryInput): Promise<DraftResult> {
  if (!supabase) {
    return { ok: false, reason: 'unavailable', message: 'Summaries need the Supabase project, and this build has none.' };
  }
  try {
    const { data, error } = await supabase.functions.invoke(SUMMARY_FUNCTION, { body: { input } });
    if (error) {
      // An HTTP error from the function carries its JSON body; a network error does not.
      const context = (error as { context?: unknown }).context;
      const body: unknown = context instanceof Response ? await context.json().catch(() => null) : null;
      const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
      if (code === 'setup') {
        return {
          ok: false,
          reason: 'setup',
          message: 'Gemini is not set up: add GEMINI_API_KEY to the project’s Edge Function secrets.',
        };
      }
      return { ok: false, reason: 'failed', message: 'Gemini did not answer. Try again.' };
    }
    const draft = parseDraft(typeof data === 'object' && data !== null ? (data as { draft?: unknown }).draft : null);
    return draft ? { ok: true, draft } : { ok: false, reason: 'failed', message: 'Gemini’s answer could not be read. Try again.' };
  } catch {
    return { ok: false, reason: 'failed', message: 'Gemini did not answer. Try again.' };
  }
}
