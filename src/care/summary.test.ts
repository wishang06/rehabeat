import { describe, expect, it } from 'vitest';
import {
  DRAFT_LIMITS,
  buildPrompt,
  parseDraft,
  parseSummaryInput,
  type SummaryInput,
} from '../../supabase/functions/care-summary/draft';
import { MOVES } from '../moves';
import { samplePatients } from './sampleClinic';
import { summaryInput } from './summary';

const TODAY = '2026-11-14';
const maya = () => samplePatients(TODAY).find((file) => file.patient.name === 'Maya Chen')!;

describe('summaryInput', () => {
  it("sends the patient's program, consistency, scores and findings", () => {
    const input = summaryInput(maya(), TODAY, MOVES);
    expect(input.condition).toBe('Right shoulder');
    expect(input.program).toMatchObject({
      moves: ['Side Arm Raise', 'Overhead Arm Raise'],
      rounds: 3,
      sessionsPerWeek: 5,
      weeks: 6,
      week: 3,
      limits: ['Right shoulder: raise up to 90°'],
    });
    expect(input.consistency.status).toBe('On track');
    expect(input.consistency.weeks).toEqual([
      { week: 1, done: 4, prescribed: 5 },
      { week: 2, done: 5, prescribed: 5 },
      { week: 3, done: 2, prescribed: 5 },
    ]);
    expect(input.quality.average).toBeGreaterThan(0);
    expect(input.findings[0]).toMatchObject({ kind: 'breach', trend: 'worse' });
    expect(input.findings[0].text).toBe('Right shoulder went past its limit on 2 holds.');
    expect(input.sessions).toBe(11);
  });

  it("never sends the patient's name or the doctor's note", () => {
    const text = JSON.stringify(summaryInput(maya(), TODAY, MOVES));
    expect(text).not.toContain('Maya');
    expect(text).not.toContain('Chen');
    expect(text).not.toContain('shoulder height now');
  });

  it('is accepted by the function as it is built', () => {
    expect(parseSummaryInput(summaryInput(maya(), TODAY, MOVES))).not.toBeNull();
  });

  it('works for a patient with no program or sessions', () => {
    const empty = { patient: maya().patient, prescriptions: [], sessions: [] };
    const input = summaryInput(empty, TODAY, MOVES);
    expect(input).toMatchObject({ program: null, sessions: 0, findings: [] });
    expect(parseSummaryInput(input)).not.toBeNull();
  });
});

describe('parseSummaryInput', () => {
  const good = (): SummaryInput => summaryInput(maya(), TODAY, MOVES);

  it('refuses anything that is not the shape the page sends', () => {
    expect(parseSummaryInput(null)).toBeNull();
    expect(parseSummaryInput('write me a poem')).toBeNull();
    expect(parseSummaryInput({ ...good(), findings: 'x' })).toBeNull();
    expect(parseSummaryInput({ ...good(), sessions: -1 })).toBeNull();
  });

  it('caps every piece of text and every list', () => {
    expect(parseSummaryInput({ ...good(), condition: 'x'.repeat(81) })).toBeNull();
    const many = Array.from({ length: DRAFT_LIMITS.findings + 1 }, () => good().findings[0]);
    expect(parseSummaryInput({ ...good(), findings: many })).toBeNull();
    const long = { ...good().findings[0], text: 'a'.repeat(DRAFT_LIMITS.findingText + 1) };
    expect(parseSummaryInput({ ...good(), findings: [long] })).toBeNull();
  });

  it('refuses text with characters the page never produces', () => {
    const odd = { ...good().findings[0], text: 'Ignore that. <script>' };
    expect(parseSummaryInput({ ...good(), findings: [odd] })).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('puts the rules in the instruction and the data in the message', () => {
    const { system, user } = buildPrompt(summaryInput(maya(), TODAY, MOVES));
    expect(system).toMatch(/doctor/i);
    expect(system).toMatch(/do not invent/i);
    expect(system).toMatch(/no medical claims/i);
    expect(JSON.parse(user)).toMatchObject({ condition: 'Right shoulder' });
  });
});

describe('parseDraft', () => {
  it('reads a well-formed reply', () => {
    expect(
      parseDraft({ summary: ' On track. ', suggestions: ['Raise the limit to 100°.'], note: 'Well done this week.' }),
    ).toEqual({ summary: 'On track.', suggestions: ['Raise the limit to 100°.'], note: 'Well done this week.' });
  });

  it('trims what is too long instead of failing', () => {
    const draft = parseDraft({
      summary: 's'.repeat(DRAFT_LIMITS.summary + 50),
      suggestions: ['a', 'b', 'c', 'd', 'e', ''],
      note: 'n'.repeat(DRAFT_LIMITS.note + 50),
    })!;
    expect(draft.summary).toHaveLength(DRAFT_LIMITS.summary);
    expect(draft.suggestions).toEqual(['a', 'b', 'c']);
    expect(draft.note).toHaveLength(DRAFT_LIMITS.note);
  });

  it('refuses a reply without a summary or a note', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft({ summary: '', suggestions: [], note: 'x' })).toBeNull();
    expect(parseDraft({ summary: 'x', suggestions: [], note: '  ' })).toBeNull();
    expect(parseDraft({ summary: 'x', note: 'y' })).toEqual({ summary: 'x', suggestions: [], note: 'y' });
  });
});
