import { expect, it } from 'vitest';
import { quality } from './quality';
import { hold, session } from './testSessions';

it('compares the last seven days with the seven before', () => {
  const q = quality(
    [session('2026-11-03', [hold({ score: 60 })]), session('2026-11-10', [hold({ score: 70 }), hold({ score: 78 })])],
    '2026-11-14',
  );
  expect(q).toMatchObject({ average: 74, previous: 60, change: 14 });
  expect(q.byMove).toEqual([
    {
      moveId: 'side-arm-raise',
      points: [
        { day: '2026-11-03', score: 60 },
        { day: '2026-11-10', score: 74 },
      ],
    },
  ]);
});

it('has no average without recent sessions', () => {
  expect(quality([], '2026-11-14')).toEqual({ average: null, previous: null, change: null, byMove: [] });
});
