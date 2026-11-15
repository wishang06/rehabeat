import { useEffect, useState } from 'react';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/scores';
import { Avatar } from './avatars/Avatar';

interface LeaderboardProps {
  /** The signed-in player, highlighted in the list. */
  userId?: string | null;
  /** Change this to fetch again, e.g. after saving a run. */
  refreshKey?: unknown;
  limit?: number;
}

/** The top players by best run. */
export function Leaderboard({ userId, refreshKey, limit = 10 }: LeaderboardProps) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetchLeaderboard(limit)
      .then((result) => !cancelled && setRows(result))
      .catch((cause) => {
        console.error('Could not load the leaderboard', cause);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [limit, refreshKey]);

  if (error) return <p className="board__empty">Couldn't load the leaderboard.</p>;
  if (!rows) return <p className="board__empty">Loading…</p>;
  if (rows.length === 0) return <p className="board__empty">No scores yet. Be the first.</p>;

  return (
    <ol className="board" data-testid="leaderboard">
      {rows.map((row) => (
        <li key={row.userId} className="board__row" data-me={row.userId === userId}>
          <span className="board__rank">{row.rank}</span>
          <Avatar id={row.avatarId} seed={row.userId} />
          <span className="board__name">{row.displayName}</span>
          <span className="board__runs">
            {row.runs} {row.runs === 1 ? 'run' : 'runs'}
          </span>
          <span className="board__points">{row.bestPoints.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
