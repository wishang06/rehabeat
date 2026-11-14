import { describe, expect, it } from 'vitest';
import {
  HISTORY_KEY,
  MAX_LOGGED_RUNS,
  NEW_HISTORY,
  lastDays,
  createHistoryStore,
  loadHistory,
  logRun,
  parseHistory,
  saveHistory,
  type History,
} from './history';

const noon = (day: number) => new Date(2026, 10, day, 12);

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('logRun', () => {
  it('logs a scored run with its day, time and calories', () => {
    const { history, kcal } = logRun(NEW_HISTORY, { moves: 6, durationSec: 180 }, noon(14));
    expect(kcal).toBeCloseTo(8.05, 2);
    expect(history.runs).toEqual([{ at: noon(14).getTime(), day: '2026-11-14', seconds: 180, moves: 6, kcal: 8.05 }]);
    expect(history.totals).toEqual({ runs: 1, seconds: 180, kcal: 8.05 });
  });

  it('uses the weight that is set when the run ends', () => {
    const heavy: History = { ...NEW_HISTORY, weightKg: 100 };
    expect(logRun(heavy, { moves: 1, durationSec: 3600 }, noon(14)).kcal).toBeCloseTo(230, 2);
  });

  it('does not log a run with no scored moves', () => {
    const result = logRun(NEW_HISTORY, { moves: 0, durationSec: 180 }, noon(14));
    expect(result.history).toBe(NEW_HISTORY);
    expect(result.kcal).toBe(0);
  });

  it('keeps the newest 1,000 runs and does not shrink the totals', () => {
    let history = NEW_HISTORY;
    for (let i = 0; i < MAX_LOGGED_RUNS + 5; i++) {
      history = logRun(history, { moves: 1, durationSec: 60 }, new Date(2026, 0, 1, 0, i)).history;
    }
    expect(history.runs).toHaveLength(MAX_LOGGED_RUNS);
    expect(history.runs[0].at).toBe(new Date(2026, 0, 1, 0, 5).getTime());
    expect(history.totals.runs).toBe(MAX_LOGGED_RUNS + 5);
  });
});

describe('lastDays', () => {
  it('buckets the last 14 days, oldest first, across a month end', () => {
    let history = logRun(NEW_HISTORY, { moves: 1, durationSec: 180 }, new Date(2026, 9, 30, 9)).history;
    history = logRun(history, { moves: 1, durationSec: 180 }, new Date(2026, 10, 3, 9)).history;
    history = logRun(history, { moves: 1, durationSec: 60 }, new Date(2026, 10, 3, 21)).history;
    const days = lastDays(history, new Date(2026, 10, 5, 12));
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe('2026-10-23');
    expect(days[13].day).toBe('2026-11-05');
    expect(days.find((d) => d.day === '2026-10-30')).toMatchObject({ runs: 1, seconds: 180 });
    expect(days.find((d) => d.day === '2026-11-03')).toMatchObject({ runs: 2, seconds: 240 });
    expect(days[13]).toMatchObject({ runs: 0, seconds: 0, kcal: 0 });
  });

  it('adds up the calories of a day', () => {
    let history = logRun(NEW_HISTORY, { moves: 1, durationSec: 180 }, new Date(2026, 10, 14, 9)).history;
    history = logRun(history, { moves: 1, durationSec: 180 }, new Date(2026, 10, 14, 21)).history;
    expect(lastDays(history, noon(14))[13].kcal).toBeCloseTo(16.1, 5);
  });

  it('leaves runs outside the window out of the chart but in the totals', () => {
    // One run dated in the future (the clock was moved), one long ago.
    let history = logRun(NEW_HISTORY, { moves: 1, durationSec: 60 }, new Date(2026, 10, 20, 12)).history;
    history = logRun(history, { moves: 1, durationSec: 60 }, new Date(2026, 8, 1, 12)).history;
    expect(lastDays(history, noon(14)).every((d) => d.runs === 0)).toBe(true);
    expect(history.totals.runs).toBe(2);
  });
});

describe('parseHistory', () => {
  it('drops what is not valid and keeps the rest', () => {
    const good = { at: 1, day: '2026-11-14', seconds: 60, moves: 2, kcal: 2.68 };
    const parsed = parseHistory({
      weightKg: 500,
      unit: 'stone',
      totals: { runs: -3, seconds: 'x', kcal: Number.NaN },
      runs: [good, null, { ...good, day: '2026-13-40' }, { ...good, kcal: Number.NaN }, { ...good, seconds: -1 }],
    });
    // Totals that are missing or too small are rebuilt from the runs that survive.
    expect(parsed).toEqual({ weightKg: null, unit: 'kg', totals: { runs: 1, seconds: 60, kcal: 2.68 }, runs: [good] });
  });

  it('starts fresh from anything that is not a history', () => {
    for (const junk of [null, 'x', 7, [], { runs: 'none' }]) expect(parseHistory(junk)).toEqual(NEW_HISTORY);
  });

  it('keeps totals that are larger than the log, from runs that have dropped off it', () => {
    const good = { at: 1, day: '2026-11-14', seconds: 60, moves: 2, kcal: 2.68 };
    const totals = { runs: 1200, seconds: 90000, kcal: 4000.5 };
    expect(parseHistory({ ...NEW_HISTORY, totals, runs: [good] }).totals).toEqual(totals);
  });

  it('keeps a valid weight, unit and totals', () => {
    const stored = { weightKg: 82.5, unit: 'lb', totals: { runs: 4, seconds: 700, kcal: 36.9 }, runs: [] };
    expect(parseHistory(stored)).toEqual(stored);
  });

  it('keeps only the newest 1,000 runs of an oversized log', () => {
    const runs = Array.from({ length: MAX_LOGGED_RUNS + 3 }, (_, at) => ({ at, day: '2026-11-14', seconds: 60, moves: 1, kcal: 2.68 }));
    const parsed = parseHistory({ ...NEW_HISTORY, runs });
    expect(parsed.runs).toHaveLength(MAX_LOGGED_RUNS);
    expect(parsed.runs[0].at).toBe(3);
  });
});

describe('storage', () => {
  it('survives storage that is missing, blocked or holds bad JSON', () => {
    expect(loadHistory(null)).toEqual(NEW_HISTORY);
    expect(loadHistory(fakeStorage({ [HISTORY_KEY]: '{oops' }))).toEqual(NEW_HISTORY);
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('full');
      },
    };
    expect(loadHistory(blocked)).toEqual(NEW_HISTORY);
    expect(() => saveHistory(NEW_HISTORY, blocked)).not.toThrow();
  });

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    const start: History = { ...NEW_HISTORY, weightKg: 82, unit: 'lb' };
    const { history } = logRun(start, { moves: 3, durationSec: 200 }, noon(14));
    saveHistory(history, storage);
    expect(loadHistory(storage)).toEqual(history);
  });
});

describe('createHistoryStore', () => {
  const run = { moves: 2, durationSec: 180 };

  it('logs a run, saves it and tells its listeners', () => {
    const storage = fakeStorage();
    const store = createHistoryStore(() => storage);
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.recordRun(run, noon(14))).toBeCloseTo(8.05, 2);
    expect(store.get().totals.runs).toBe(1);
    expect(loadHistory(storage).totals.runs).toBe(1);
    expect(calls).toBe(1);
  });

  it('changes nothing for a run with no scored moves', () => {
    const storage = fakeStorage();
    const store = createHistoryStore(() => storage);
    const before = store.get();
    expect(store.recordRun({ moves: 0, durationSec: 180 }, noon(14))).toBe(0);
    expect(store.get()).toBe(before);
    expect(storage.data.has(HISTORY_KEY)).toBe(false);
  });

  it('saves the weight and unit, and uses the weight for the next run', () => {
    const storage = fakeStorage();
    const store = createHistoryStore(() => storage);
    store.setWeight(100, 'lb');
    expect(loadHistory(storage)).toMatchObject({ weightKg: 100, unit: 'lb' });
    expect(store.recordRun({ moves: 1, durationSec: 3600 }, noon(14))).toBeCloseTo(230, 2);
    store.setWeight(null, 'kg');
    expect(store.get()).toMatchObject({ weightKg: null, unit: 'kg' });
  });

  it('does not erase a run finished in another tab', () => {
    const storage = fakeStorage();
    const tabA = createHistoryStore(() => storage);
    const tabB = createHistoryStore(() => storage);
    // Both tabs have read the empty log before either finishes a run.
    tabA.get();
    tabB.get();
    tabA.recordRun(run, noon(13));
    tabB.recordRun(run, noon(14));
    expect(loadHistory(storage).totals.runs).toBe(2);
    expect(loadHistory(storage).runs.map((logged) => logged.day)).toEqual(['2026-11-13', '2026-11-14']);
  });

  it('keeps counting for the visit when storage is blocked', () => {
    const blocked = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
      setItem: (): void => {
        throw new Error('blocked');
      },
    };
    for (const storage of [null, blocked]) {
      const store = createHistoryStore(() => storage);
      store.recordRun(run, noon(13));
      store.recordRun(run, noon(14));
      expect(store.get().totals.runs).toBe(2);
    }
  });

  it('keeps the runs of this visit when storage is full and holds an older log', () => {
    const older = logRun(NEW_HISTORY, run, noon(12)).history;
    const full = {
      getItem: (): string | null => JSON.stringify(older),
      setItem: (): void => {
        throw new Error('full');
      },
    };
    const store = createHistoryStore(() => full);
    store.recordRun(run, noon(13));
    store.recordRun(run, noon(14));
    expect(store.get().totals.runs).toBe(3);
  });
});
