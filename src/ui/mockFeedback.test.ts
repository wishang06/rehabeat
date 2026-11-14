import { describe, expect, it } from 'vitest';
import { MOVES } from '../moves';
import { GOOD_SCORE, PERFECT_SCORE } from '../scoring';
import { MOCK_COUNT_IN_BEATS, MOCK_STATES, mockFeedbackFrame, mockFrameAt, mockRunAt } from './mockFeedback';

const first = MOVES[0];
const moveStart = MOCK_COUNT_IN_BEATS;
const holdStart = moveStart + first.beats.reach;
const releaseStart = holdStart + first.beats.hold;

describe('mockFeedbackFrame', () => {
  it('is a whole frame: a limb for every drawn segment and a next move', () => {
    const frame = mockFeedbackFrame();
    expect(Object.keys(frame.limbs)).toHaveLength(8);
    expect(frame.move?.id).toBe(first.id);
    expect(frame.nextMove.id).toBe(MOVES[1 % MOVES.length].id);
  });

  it('takes overrides', () => {
    expect(mockFeedbackFrame({ lowVisibility: true, score: 12 })).toMatchObject({ lowVisibility: true, score: 12 });
  });
});

describe('mockFrameAt', () => {
  it('counts in before the first move, with the first move up next', () => {
    const frame = mockFrameAt(1.5);
    expect(frame.phase).toBe('ready');
    expect(frame.move).toBeNull();
    expect(frame.nextMove.id).toBe(first.id);
    expect(Math.ceil(frame.beatsToNextPhase)).toBe(3);
  });

  it('walks the first move through reach, hold and release on its own beat counts', () => {
    expect(mockFrameAt(moveStart + 0.5)).toMatchObject({ phase: 'reach', move: { id: first.id } });
    expect(mockFrameAt(holdStart + 0.5)).toMatchObject({ phase: 'hold', move: { id: first.id } });
    expect(mockFrameAt(releaseStart + 0.5)).toMatchObject({ phase: 'release', move: { id: first.id } });
    expect(mockFrameAt(releaseStart + first.beats.release + 0.5).move?.id).toBe(MOVES[1 % MOVES.length].id);
  });

  it('reports progress through the phase and beats left in it', () => {
    const frame = mockFrameAt(holdStart + first.beats.hold / 4);
    expect(frame.phaseProgress).toBeCloseTo(0.25);
    expect(frame.beatsToNextPhase).toBeCloseTo(first.beats.hold * 0.75);
    expect(frame.holdProgress).toBeCloseTo(0.25);
  });

  it('only carries a hold score during the hold, and scores nothing in a release', () => {
    expect(mockFrameAt(moveStart + 0.5).holdScore).toBeNull();
    expect(mockFrameAt(holdStart + 1).holdScore).toBeGreaterThanOrEqual(PERFECT_SCORE);
    expect(mockFrameAt(releaseStart + 0.5)).toMatchObject({ holdScore: null, score: 0, holdProgress: 1 });
  });

  it('is on target only in a reach or hold at Good or better', () => {
    expect(mockFrameAt(holdStart + 1).onTarget).toBe(true);
    expect(mockFrameAt(releaseStart + 0.5).onTarget).toBe(false);
    expect(mockFrameAt(1).onTarget).toBe(false);
  });

  it('turns up every state the HUD has to show', () => {
    expect(mockFrameAt(MOCK_STATES.countin).phase).toBe('ready');
    expect(mockFrameAt(MOCK_STATES.reach).phase).toBe('reach');
    expect(mockFrameAt(MOCK_STATES.hold).phase).toBe('hold');
    expect(mockFrameAt(MOCK_STATES.stepback).lowVisibility).toBe(true);
    expect(mockFrameAt(MOCK_STATES.easeoff).phase).toBe('hold');
    expect(mockRunAt(MOCK_STATES.easeoff).easeOff).toBe('Ease off your right shoulder');
    expect(mockRunAt(MOCK_STATES.hold).easeOff).toBeNull();
    for (const state of ['perfect', 'good', 'miss'] as const) {
      expect(mockFrameAt(MOCK_STATES[state]).phase).toBe('release');
    }
    // As in the engine, there is no hint while the player is partly out of view.
    expect(mockFrameAt(MOCK_STATES.stepback).hint).toBeNull();
  });
});

describe('mockRunAt', () => {
  it('has scored nothing until the first hold closes', () => {
    expect(mockRunAt(holdStart + 1)).toMatchObject({ points: 0, combo: 0, accuracy: null, result: null, moveNumber: 1 });
    expect(mockRunAt(1).moveNumber).toBe(0);
  });

  it('scores each move as its hold closes', () => {
    expect(mockRunAt(MOCK_STATES.perfect).result).toMatchObject({ serial: 1, label: 'Perfect' });
    expect(mockRunAt(MOCK_STATES.good).result).toMatchObject({ serial: 2, label: 'Good' });
    expect(mockRunAt(MOCK_STATES.miss).result).toMatchObject({ serial: 4, label: 'Miss', timing: null });
  });

  it('builds the combo and breaks it on a Miss', () => {
    expect(mockRunAt(MOCK_STATES.perfect).combo).toBe(1);
    expect(mockRunAt(MOCK_STATES.good).combo).toBe(2);
    expect(mockRunAt(MOCK_STATES.miss)).toMatchObject({ combo: 0, perfectStreak: 0 });
  });

  it('keeps points and accuracy in step with the results so far', () => {
    const afterTwo = mockRunAt(MOCK_STATES.good);
    expect(afterTwo.points).toBeGreaterThan(mockRunAt(MOCK_STATES.perfect).points);
    expect(afterTwo.accuracy).toBeGreaterThanOrEqual(GOOD_SCORE);
    expect(mockRunAt(MOCK_STATES.miss).points).toBe(mockRunAt(MOCK_STATES.miss - 1).points);
  });
});
