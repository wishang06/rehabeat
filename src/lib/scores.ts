import type { RunSummary } from '../scoring';
import { supabase } from './supabase';

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bestPoints: number;
  totalPoints: number;
  runs: number;
  rank: number;
}

/** Saves a finished run for the signed-in player. */
export async function saveScore(run: RunSummary): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.from('scores').insert({
    points: run.points,
    moves: run.moves,
    perfect: run.perfect,
    good: run.good,
    miss: run.miss,
    best_combo: run.bestCombo,
    accuracy: run.accuracy,
    duration_sec: run.durationSec,
  });
  if (error) throw error;
}

/** The top players by best run. */
export async function fetchLeaderboard(limit = 10): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('leaderboard')
    .select('user_id, display_name, avatar_url, best_points, total_points, runs, rank')
    .order('rank', { ascending: true })
    .limit(limit);
  if (error) throw error;
  // View columns come back nullable in the generated types; they never are in practice.
  return (data ?? []).map((row) => ({
    userId: row.user_id ?? '',
    displayName: row.display_name ?? 'Player',
    avatarUrl: row.avatar_url,
    bestPoints: Number(row.best_points ?? 0),
    totalPoints: Number(row.total_points ?? 0),
    runs: row.runs ?? 0,
    rank: row.rank ?? 0,
  }));
}

/** A run kept across the Google sign-in redirect, so it can be saved on return. */
const PENDING_KEY = 'rehabeat:pending-run';

export function keepPendingRun(run: RunSummary): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(run));
  } catch {
    // Storage blocked: the run just won't survive the redirect.
  }
}

/** True while a run is waiting to be shown again after the Google redirect. */
export function hasPendingRun(): boolean {
  try {
    return sessionStorage.getItem(PENDING_KEY) !== null;
  } catch {
    return false;
  }
}

export function takePendingRun(): RunSummary | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as RunSummary) : null;
  } catch {
    return null;
  }
}
