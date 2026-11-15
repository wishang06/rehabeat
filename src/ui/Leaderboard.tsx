import { useEffect, useState } from 'react';
import { fetchLeaderboard, type LeaderboardRow } from '../lib/scores';
import { Avatar } from './avatars/Avatar';
import { boardWindow } from './boardWindow';

/** How far down the board to read when looking for the player, so their neighbours can be shown. */
const AROUND_DEPTH = 100;

interface LeaderboardProps {
  /** The signed-in player, highlighted in the list. */
  userId?: string | null;
  /** Change this to fetch again, e.g. after saving a run. */
  refreshKey?: unknown;
  limit?: number;
  /**
   * Show the top three, then the player with one neighbour either side, with a gap between. For a
   * player who is not on the board yet it is the first `limit` rows, as without it.
   */
  around?: boolean;
}

/** The top players by best run. */
export function Leaderboard({ userId, refreshKey, limit = 10, around = false }: LeaderboardProps) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    fetchLeaderboard(around ? AROUND_DEPTH : limit)
      .then((result) => !cancelled && setRows(result))
      .catch((cause) => {
        console.error('Could not load the leaderboard', cause);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [limit, around, refreshKey]);

  if (error) return <p className="board__empty">Couldn't load the leaderboard.</p>;
  if (!rows) return <p className="board__empty">Loading…</p>;
  if (rows.length === 0) return <p className="board__empty">No scores yet. Be the first.</p>;

  const entries = boardWindow(rows, around ? userId : null, limit);

  return (
    <ol className="board" data-testid="leaderboard">
      {entries.map((entry) => {
        if (entry.kind === 'gap') {
          return (
            <li
              key={`gap-${entry.after}`}
              className="board__gap"
              aria-label="More players in between"
              data-testid="board-gap"
            >
              <span aria-hidden="true">···</span>
            </li>
          );
        }
        const { row } = entry;
        return (
          <li key={row.userId} className="board__row" data-me={row.userId === userId} data-sample={row.isSample}>
            <span className="board__rank">{row.rank}</span>
            <Avatar id={row.avatarId} seed={row.userId} />
            <span className="board__who">
              <span className="board__name">{row.displayName}</span>
              {/* Demo players from the seed, so nobody mistakes them for real scores. */}
              {row.isSample && (
                <span className="board__tag" data-testid="demo-tag">
                  Demo
                </span>
              )}
            </span>
            <span className="board__runs">
              {row.runs} {row.runs === 1 ? 'run' : 'runs'}
            </span>
            <span className="board__points">{row.bestPoints.toLocaleString()}</span>
          </li>
        );
      })}
    </ol>
  );
}
