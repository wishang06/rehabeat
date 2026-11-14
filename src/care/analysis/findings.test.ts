import { expect, it } from 'vitest';
import { MOVES } from '../../moves';
import { findings } from './findings';
import { hold, session, short } from './testSessions';

it('reports a joint that stops short, with its trend', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-10', '2026-11-11', '2026-11-12'];
  const sessions = days.map((d, i) => session(d, [short(i < 3 ? 25 : 14)]));
  const [f] = findings(sessions, MOVES);
  expect(f).toMatchObject({
    kind: 'joint',
    moveId: 'side-arm-raise',
    joint: 'rightShoulder',
    value: 14,
    previous: 25,
    trend: 'better',
  });
  expect(f.series).toEqual([25, 25, 25, 14, 14, 14]);
  expect(f.text).toBe('Side Arm Raise: right shoulder stops 14° short. Was 25°.');
});

it('says past for a knee that bends too far', () => {
  const s = session('2026-11-12', [
    hold({ moveId: 'standing-knee-raise', joints: { leftKnee: { target: 90, meanError: -12, seen: 1 } } }),
  ]);
  expect(findings([s], MOVES)[0].text).toBe('Standing Knee Raise: left knee goes 12° past.');
});

it('leaves out small errors and joints that were mostly out of view', () => {
  expect(findings([session('2026-11-12', [short(7)])], MOVES)).toEqual([]);
  const hidden = hold({ joints: { rightShoulder: { target: 90, meanError: 0, seen: 0 } } });
  const out = findings([session('2026-11-12', [hidden])], MOVES);
  expect(out.map((f) => f.kind)).toEqual(['view']);
  expect(out[0].text).toBe('Right shoulder is out of view for 100% of the hold.');
  expect(out.every((f) => Number.isFinite(f.value))).toBe(true);
});

it('reports a form rule flagged on enough holds', () => {
  const holds = Array.from({ length: 10 }, (_, i) => hold({ formFlags: i < 4 ? ['trunk-lean'] : [] }));
  expect(findings([session('2026-11-12', holds)], MOVES)[0]).toMatchObject({
    kind: 'form',
    ruleId: 'trunk-lean',
    value: 0.4,
    trend: 'new',
    text: 'Side Arm Raise: trunk leans on 4 of 10 holds.',
  });
});

it('puts breaches first', () => {
  const s = session('2026-11-12', [
    short(20),
    hold({ overLimit: ['rightShoulder'] }),
    hold({ overLimit: ['rightShoulder'] }),
  ]);
  const out = findings([s], MOVES);
  expect(out[0]).toMatchObject({
    kind: 'breach',
    joint: 'rightShoulder',
    value: 2,
    text: 'Right shoulder went past its limit on 2 holds.',
  });
  expect(out[1].kind).toBe('joint');
});

it('reports lateness, ignoring misses', () => {
  const s = session('2026-11-12', [
    hold({ timingOffsetMs: 400 }),
    hold({ timingOffsetMs: 400 }),
    hold({ label: 'Miss', score: 0, timingOffsetMs: 2000 }),
  ]);
  expect(findings([s], MOVES)[0]).toMatchObject({ kind: 'timing', value: 400, text: 'Arrives 0.4 s late on average.' });
});

it('finds nothing in no sessions', () => expect(findings([], MOVES)).toEqual([]));
