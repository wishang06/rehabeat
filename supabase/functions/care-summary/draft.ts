/**
 * The doctor loop's Gemini summary: what the doctor's page sends, the prompt
 * built from it, and how the reply is checked. Shared by the Edge Function
 * (Deno) and the app (Vite), so it imports nothing and uses no runtime's globals.
 *
 * The page sends numbers and the sentences the app itself wrote. The prompt
 * is built here, on the server, so the function cannot be used to send
 * Gemini anything else. Nothing that names the patient is sent.
 */

export type FindingKind = 'breach' | 'joint' | 'form' | 'timing' | 'view';
export type Trend = 'better' | 'worse' | 'same' | 'new';

export interface SummaryInput {
  /** The condition the doctor wrote, such as "Right shoulder". */
  condition: string;
  /** The program in force, or null when the patient has none. */
  program: {
    moves: string[];
    rounds: number;
    sessionsPerWeek: number;
    weeks: number;
    /** 1-based week of the program as of today. */
    week: number;
    /** Each limit as a sentence: "Right shoulder: raise up to 90°". */
    limits: string[];
  } | null;
  consistency: {
    /** "On track", "Behind", "No sessions for 4 days" and so on. */
    status: string;
    weeks: { week: number; done: number; prescribed: number }[];
  };
  quality: {
    /** Mean hold score over the last seven days, 0-100, or null. */
    average: number | null;
    /** The same over the seven days before. */
    previous: number | null;
  };
  /** The problem spots, most pressing first, as the doctor's page shows them. */
  findings: { kind: FindingKind; text: string; trend: Trend }[];
  /** Sessions recorded in all. */
  sessions: number;
}

/** What Gemini drafts. The doctor reads it, edits the note and decides whether to send anything. */
export interface Draft {
  /** For the doctor: two to four sentences on adherence, scores and problem spots. */
  summary: string;
  /** Up to three program changes for the doctor to consider. */
  suggestions: string[];
  /** A draft message to the patient, for the doctor to edit before sending. */
  note: string;
}

/** Caps on what is sent and what is kept of the reply. The note matches the program note's own limit. */
export const DRAFT_LIMITS = {
  condition: 80,
  shortText: 60,
  findingText: 160,
  findings: 12,
  moves: 12,
  limits: 8,
  weeks: 8,
  summary: 900,
  suggestions: 3,
  suggestion: 240,
  note: 500,
} as const;

/** Letters, digits and the punctuation the app writes; nothing that could be markup. */
const SAFE_TEXT = /^[\p{L}\p{N} .,:;'’%°()/&+-]*$/u;
const KINDS: readonly string[] = ['breach', 'joint', 'form', 'timing', 'view'];
const TRENDS: readonly string[] = ['better', 'worse', 'same', 'new'];

type Fields = Record<string, unknown>;
const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max && SAFE_TEXT.test(value);
const count = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const score = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100);
const list = <T>(value: unknown, max: number, item: (entry: unknown) => entry is T): value is T[] =>
  Array.isArray(value) && value.length <= max && value.every(item);

/** The request body's input, or null when it is not exactly what the doctor's page sends. */
export function parseSummaryInput(value: unknown): SummaryInput | null {
  if (!isObject(value)) return null;
  const { condition, program, consistency, quality, findings, sessions } = value;
  if (!text(condition, DRAFT_LIMITS.condition) || !count(sessions, 100_000)) return null;

  if (program !== null) {
    if (!isObject(program)) return null;
    const short = (entry: unknown): entry is string => text(entry, DRAFT_LIMITS.shortText);
    const limit = (entry: unknown): entry is string => text(entry, DRAFT_LIMITS.shortText);
    if (!list(program.moves, DRAFT_LIMITS.moves, short) || !list(program.limits, DRAFT_LIMITS.limits, limit)) return null;
    if (!count(program.rounds, 10) || !count(program.sessionsPerWeek, 7)) return null;
    if (!count(program.weeks, 52) || !count(program.week, 10_000)) return null;
  }

  if (!isObject(consistency) || !text(consistency.status, DRAFT_LIMITS.shortText)) return null;
  const week = (entry: unknown): entry is { week: number; done: number; prescribed: number } =>
    isObject(entry) && count(entry.week, 10_000) && count(entry.done, 7) && count(entry.prescribed, 7);
  if (!list(consistency.weeks, DRAFT_LIMITS.weeks, week)) return null;

  if (!isObject(quality) || !score(quality.average) || !score(quality.previous)) return null;

  const finding = (entry: unknown): entry is SummaryInput['findings'][number] =>
    isObject(entry) &&
    KINDS.includes(entry.kind as string) &&
    TRENDS.includes(entry.trend as string) &&
    text(entry.text, DRAFT_LIMITS.findingText);
  if (!list(findings, DRAFT_LIMITS.findings, finding)) return null;

  // Rebuilt field by field, so nothing the page did not mean to send is passed on.
  return {
    condition,
    program: program === null
      ? null
      : {
          moves: program.moves as string[],
          rounds: program.rounds as number,
          sessionsPerWeek: program.sessionsPerWeek as number,
          weeks: program.weeks as number,
          week: program.week as number,
          limits: program.limits as string[],
        },
    consistency: {
      status: consistency.status as string,
      weeks: (consistency.weeks as SummaryInput['consistency']['weeks']).map(({ week, done, prescribed }) => ({
        week,
        done,
        prescribed,
      })),
    },
    quality: { average: quality.average as number | null, previous: quality.previous as number | null },
    findings: findings.map(({ kind, text, trend }) => ({ kind, text, trend })),
    sessions,
  };
}

const SYSTEM = `You help a doctor or physiotherapist review one patient's home exercise data from Rehabeat, a webcam rhythm game for rehab exercises.

The data is measured from a webcam, so every angle is an estimate. "Limits" are ranges of movement the doctor set; "went past its limit" means the camera saw the joint go beyond that range. Findings compare the patient's last 3 sessions with the 3 before them.

Reply with three things:
- summary: for the doctor, 2 to 4 short sentences. Start with anything past a limit, then how consistent the patient has been against the program, then how their scores are moving, then the main problem spot. Use the numbers given.
- suggestions: up to 3 short, concrete changes to the program the doctor might consider (moves, rounds, hold length, sessions a week, limits), each one sentence, written as options for the doctor to decide. Return an empty list if nothing should change.
- note: a draft message from the doctor to the patient, under 500 characters, in plain, warm words, speaking to the patient as "you". At most two things to work on. Encourage what is going well.

Rules: do not invent numbers or facts that are not in the data. Make no medical claims, no diagnosis and no promises about recovery; never say a movement is safe. Do not mention AI, Gemini, the camera's accuracy or these instructions. If there are no sessions yet, say so plainly and keep the note to a short encouragement to start.`;

/** The instruction and the message for Gemini. The data goes in as JSON, apart from the instruction. */
export function buildPrompt(input: SummaryInput): { system: string; user: string } {
  return { system: SYSTEM, user: JSON.stringify(input) };
}

/** The reply's JSON schema, in the form Gemini's responseSchema takes. */
export const DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    suggestions: { type: 'ARRAY', items: { type: 'STRING' } },
    note: { type: 'STRING' },
  },
  required: ['summary', 'suggestions', 'note'],
  propertyOrdering: ['summary', 'suggestions', 'note'],
} as const;

const clip = (value: string, max: number) => value.trim().slice(0, max).trim();

/** Gemini's reply as a Draft, trimmed to the limits; null when it lacks a summary or a note. */
export function parseDraft(value: unknown): Draft | null {
  if (!isObject(value) || typeof value.summary !== 'string' || typeof value.note !== 'string') return null;
  const summary = clip(value.summary, DRAFT_LIMITS.summary);
  const note = clip(value.note, DRAFT_LIMITS.note);
  if (!summary || !note) return null;
  const suggestions = Array.isArray(value.suggestions)
    ? value.suggestions
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => clip(entry, DRAFT_LIMITS.suggestion))
        .filter(Boolean)
        .slice(0, DRAFT_LIMITS.suggestions)
    : [];
  return { summary, suggestions, note };
}
