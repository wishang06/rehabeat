/**
 * The run log: every finished run with its day, length and estimated
 * calories, plus the player's optional body weight. Kept in localStorage
 * under its own key; nothing here leaves the browser.
 */
import { useSyncExternalStore } from 'react';
import { estimateKcal, isWeightKg, type WeightUnit } from './calories';
import { dayKey, isDayKey } from './streak';

export const HISTORY_KEY = 'rehabeat.history.v1';
/** Runs kept in the log. Older ones drop off; the totals keep counting them. */
export const MAX_LOGGED_RUNS = 1000;
/** Days on the Stats chart. */
export const CHART_DAYS = 14;

export interface LoggedRun {
  /** When the run ended, in milliseconds since 1970. */
  at: number;
  /** The player's local calendar day the run ended on, as YYYY-MM-DD. */
  day: string;
  seconds: number;
  moves: number;
  /** Estimated with the weight that was set when the run ended. */
  kcal: number;
}

export interface HistoryTotals {
  runs: number;
  seconds: number;
  kcal: number;
}

export interface History {
  /** Body weight for the estimate, or null to use the default. */
  weightKg: number | null;
  /** The unit the weight field shows. */
  unit: WeightUnit;
  /** Over all time, including runs that have dropped off the log. */
  totals: HistoryTotals;
  /** Oldest first. */
  runs: LoggedRun[];
}

export const NEW_HISTORY: History = {
  weightKg: null,
  unit: 'kg',
  totals: { runs: 0, seconds: 0, kcal: 0 },
  runs: [],
};

/** A finished run, as far as the log cares. */
export interface RunToLog {
  moves: number;
  durationSec: number;
}

const amount = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const hundredths = (value: number): number => Math.round(value * 100) / 100;

function parseRun(raw: unknown): LoggedRun | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { at, day, seconds, moves, kcal } = raw as Record<string, unknown>;
  if (!isAmount(at) || !isDayKey(day) || !isAmount(seconds) || !isAmount(moves) || !isAmount(kcal)) return null;
  return { at, day, seconds, moves, kcal };
}

/** Reads whatever was stored, keeping only what is valid. */
export function parseHistory(raw: unknown): History {
  if (typeof raw !== 'object' || raw === null) return NEW_HISTORY;
  const record = raw as Record<string, unknown>;
  const runs = (Array.isArray(record.runs) ? record.runs : [])
    .map(parseRun)
    .filter((run): run is LoggedRun => run !== null)
    .slice(-MAX_LOGGED_RUNS);
  const stored = typeof record.totals === 'object' && record.totals !== null ? (record.totals as Record<string, unknown>) : {};
  // Totals are never smaller than the runs still in the log.
  const logged = runs.reduce(
    (sum, run) => ({ runs: sum.runs + 1, seconds: sum.seconds + run.seconds, kcal: sum.kcal + run.kcal }),
    { runs: 0, seconds: 0, kcal: 0 },
  );
  return {
    weightKg: isWeightKg(record.weightKg) ? record.weightKg : null,
    unit: record.unit === 'lb' ? 'lb' : 'kg',
    totals: {
      runs: Math.max(Math.floor(amount(stored.runs)), logged.runs),
      seconds: Math.max(amount(stored.seconds), logged.seconds),
      kcal: hundredths(Math.max(amount(stored.kcal), logged.kcal)),
    },
    runs,
  };
}

/**
 * The history after a finished run, and the run's estimated calories. A run
 * with no scored moves changes nothing and earns none, like XP and the streak.
 */
export function logRun(history: History, run: RunToLog, now: Date): { history: History; kcal: number } {
  if (!(run.moves > 0)) return { history, kcal: 0 };
  const seconds = Math.round(amount(run.durationSec));
  const kcal = hundredths(estimateKcal(seconds, history.weightKg));
  const logged: LoggedRun = { at: now.getTime(), day: dayKey(now), seconds, moves: run.moves, kcal };
  return {
    history: {
      ...history,
      totals: {
        runs: history.totals.runs + 1,
        seconds: history.totals.seconds + seconds,
        kcal: hundredths(history.totals.kcal + kcal),
      },
      runs: [...history.runs, logged].slice(-MAX_LOGGED_RUNS),
    },
    kcal,
  };
}

export interface DayTotal {
  day: string;
  date: Date;
  runs: number;
  seconds: number;
  kcal: number;
}

/** One total per calendar day for the `days` days ending on `today`, oldest first. */
export function lastDays(history: History, today: Date, days = CHART_DAYS): DayTotal[] {
  const totals: DayTotal[] = [];
  const byDay = new Map<string, DayTotal>();
  for (let back = days - 1; back >= 0; back--) {
    // Noon, so a clock change at midnight cannot land the date on the day before.
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 12);
    const total: DayTotal = { day: dayKey(date), date, runs: 0, seconds: 0, kcal: 0 };
    totals.push(total);
    byDay.set(total.day, total);
  }
  for (const run of history.runs) {
    const total = byDay.get(run.day);
    if (!total) continue;
    total.runs += 1;
    total.seconds += run.seconds;
    total.kcal += run.kcal;
  }
  return totals;
}

// ------------------------------------------------------------ storage

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage can be blocked outright (some private windows).
    return null;
  }
}

/** The stored history, or null when there is none or it cannot be read. */
function readStored(storage: StorageLike | null): History | null {
  try {
    const text = storage?.getItem(HISTORY_KEY);
    return text ? parseHistory(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function loadHistory(storage: StorageLike | null = browserStorage()): History {
  return readStored(storage) ?? NEW_HISTORY;
}

export function saveHistory(history: History, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // Full or blocked storage: the history lasts for this visit only.
  }
}

// ------------------------------------------------------------ live store

export interface HistoryStore {
  get(): History;
  subscribe(listener: () => void): () => void;
  /** Logs a finished run and returns its estimated calories. */
  recordRun(run: RunToLog, now?: Date): number;
  setWeight(kg: number | null, unit: WeightUnit): void;
}

export function createHistoryStore(getStorage: () => StorageLike | null = browserStorage): HistoryStore {
  let current: History | null = null;
  const listeners = new Set<() => void>();

  const get = (): History => {
    current ??= loadHistory(getStorage());
    return current;
  };

  /**
   * The history to build a change on: what is stored now, so a run finished
   * in another tab is kept, unless storage is behind this visit (blocked or full).
   */
  const latest = (): History => {
    const mine = get();
    const stored = readStored(getStorage());
    return stored && stored.totals.runs >= mine.totals.runs ? stored : mine;
  };

  const commit = (next: History): void => {
    current = next;
    saveHistory(next, getStorage());
    for (const listener of listeners) listener();
  };

  return {
    get,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recordRun(run, now = new Date()) {
      const before = latest();
      const { history, kcal } = logRun(before, run, now);
      if (history !== before) commit(history);
      return kcal;
    },
    setWeight(kg, unit) {
      commit({ ...latest(), weightKg: kg !== null && isWeightKg(kg) ? kg : null, unit });
    },
  };
}

const store = createHistoryStore();

/** Logs a finished run in this browser and returns its estimated calories. */
export function recordRunStats(run: RunToLog, now: Date = new Date()): number {
  return store.recordRun(run, now);
}

/** Saves the body weight (null for the default) and the unit the field shows. */
export function setWeight(kg: number | null, unit: WeightUnit): void {
  store.setWeight(kg, unit);
}

/** The run log, re-rendering when a run is logged or the weight changes. */
export function useHistory(): History {
  return useSyncExternalStore(store.subscribe, store.get, () => NEW_HISTORY);
}
