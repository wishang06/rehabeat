/**
 * The player's progress (XP, daily streak), kept in localStorage. Nothing
 * here leaves the browser.
 */
import { useSyncExternalStore } from 'react';
import { gradeFor, starsFor, type Grade, type GradedRun, type StarredRun } from './grade';
import { NO_STREAK, advanceStreak, currentStreak, dayKey, isDayKey, playedToday, type Streak } from './streak';
import { levelFor, xpForRun, type XpGain, type XpRun } from './xp';

export const PROGRESS_KEY = 'rehabeat.progress.v1';

export interface Progress {
  /** Total XP earned. */
  xp: number;
  streak: Streak;
  /** Runs finished with at least one scored move. */
  runs: number;
}

export const NEW_PROGRESS: Progress = { xp: 0, streak: NO_STREAK, runs: 0 };

/** What a finished run earned, for the results screen. */
export interface RunGains {
  grade: Grade;
  stars: number;
  xp: XpGain;
  /** Total XP before and after this run. */
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  /** The live streak before this run and after it. */
  streakBefore: number;
  streakAfter: number;
}

const wholeNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Reads whatever was stored, keeping only what is valid. */
export function parseProgress(raw: unknown): Progress {
  if (typeof raw !== 'object' || raw === null) return NEW_PROGRESS;
  const record = raw as Record<string, unknown>;
  const stored =
    typeof record.streak === 'object' && record.streak !== null ? (record.streak as Record<string, unknown>) : {};
  const count = wholeNumber(stored.count);
  const streak: Streak = isDayKey(stored.lastDay) && count > 0 ? { count, lastDay: stored.lastDay } : NO_STREAK;
  return { xp: wholeNumber(record.xp), streak, runs: wholeNumber(record.runs) };
}

/**
 * Progress after a finished run, and what the run earned. A run with no
 * scored moves changes nothing: it earns no XP and does not count as a day played.
 */
export function applyRun(
  progress: Progress,
  run: GradedRun & StarredRun & XpRun,
  now: Date,
): { progress: Progress; gains: RunGains } {
  const today = dayKey(now);
  const grade = gradeFor(run);
  const scored = run.moves > 0;
  const xp = xpForRun(run, grade, scored && !playedToday(progress.streak, today));
  const streak = scored ? advanceStreak(progress.streak, today) : progress.streak;
  const next: Progress = scored ? { xp: progress.xp + xp.total, streak, runs: progress.runs + 1 } : progress;
  return {
    progress: next,
    gains: {
      grade,
      stars: starsFor(run),
      xp,
      xpBefore: progress.xp,
      xpAfter: next.xp,
      levelBefore: levelFor(progress.xp).level,
      levelAfter: levelFor(next.xp).level,
      streakBefore: currentStreak(progress.streak, today),
      streakAfter: currentStreak(streak, today),
    },
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage can be blocked outright (some private windows).
    return null;
  }
}

export function loadProgress(storage: StorageLike | null = browserStorage()): Progress {
  try {
    const text = storage?.getItem(PROGRESS_KEY);
    return text ? parseProgress(JSON.parse(text)) : NEW_PROGRESS;
  } catch {
    return NEW_PROGRESS;
  }
}

export function saveProgress(progress: Progress, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Full or blocked storage: progress lasts for this visit only.
  }
}

// ------------------------------------------------------------ live store

let current: Progress | null = null;
const listeners = new Set<() => void>();

function snapshot(): Progress {
  current ??= loadProgress();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Banks a finished run: updates and saves progress, and returns what the run earned. */
export function recordRun(run: GradedRun & StarredRun & XpRun, now: Date = new Date()): RunGains {
  const before = snapshot();
  const { progress, gains } = applyRun(before, run, now);
  if (progress !== before) {
    current = progress;
    saveProgress(progress);
    for (const listener of listeners) listener();
  }
  return gains;
}

/** What a run would earn against the progress as it stands, without banking it. */
export function previewRun(run: GradedRun & StarredRun & XpRun, now: Date = new Date()): RunGains {
  return applyRun(snapshot(), run, now).gains;
}

/** The player's progress, re-rendering when a run is banked. */
export function useProgress(): Progress {
  return useSyncExternalStore(subscribe, snapshot, () => NEW_PROGRESS);
}
