import type { RunSummary } from '../scoring';
import { supabase } from './supabase';

export interface LeaderboardRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** The avatar the player chose (src/ui/avatars), or null to draw the one their id gives. */
  avatarId: string | null;
  /** A demo player from supabase/seed_sample_players.sql, not a real one. */
  isSample: boolean;
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

const BOARD_COLUMNS = 'user_id, display_name, avatar_url, avatar_id, is_sample, best_points, total_points, runs, rank';
/** The view's columns before the avatar migration (20261116090000), so the board still loads until it is applied. */
const OLD_BOARD_COLUMNS = 'user_id, display_name, avatar_url, best_points, total_points, runs, rank';

/** One row of the leaderboard view. View columns come back nullable; they never are in practice. */
export function toLeaderboardRow(row: Record<string, unknown>): LeaderboardRow {
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  return {
    userId: text(row.user_id) ?? '',
    displayName: text(row.display_name) ?? 'Player',
    avatarUrl: text(row.avatar_url),
    avatarId: text(row.avatar_id),
    isSample: row.is_sample === true,
    bestPoints: Number(row.best_points ?? 0),
    totalPoints: Number(row.total_points ?? 0),
    runs: Number(row.runs ?? 0),
    rank: Number(row.rank ?? 0),
  };
}

/** The top players by best run. */
export async function fetchLeaderboard(limit = 10): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  const client = supabase;
  const query = (columns: string) =>
    client.from('leaderboard').select(columns).order('rank', { ascending: true }).limit(limit);
  let { data, error } = await query(BOARD_COLUMNS);
  if (error) ({ data, error } = await query(OLD_BOARD_COLUMNS));
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toLeaderboardRow);
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
