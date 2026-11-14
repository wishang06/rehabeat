import { useEffect, useRef, useState } from 'react';
import type { AuthState } from '../lib/auth';
import { keepPendingRun, saveScore } from '../lib/scores';
import { supabase } from '../lib/supabase';
import type { RunSummary } from '../scoring';
import { AccountButton } from './AccountButton';
import { Leaderboard } from './Leaderboard';

interface ResultsScreenProps {
  run: RunSummary;
  auth: AuthState;
  onPlayAgain: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function ResultsScreen({ run, auth, onPlayAgain }: ResultsScreenProps) {
  const [save, setSave] = useState<SaveState>('idle');
  const attempted = useRef(false);
  const userId = auth.user?.id ?? null;

  // Save once, as soon as there is a signed-in player (also right after the Google redirect).
  useEffect(() => {
    if (!userId || attempted.current || run.moves === 0) return;
    attempted.current = true;
    setSave('saving');
    saveScore(run)
      .then(() => setSave('saved'))
      .catch((cause) => {
        console.error('Could not save the run', cause);
        setSave('failed');
      });
  }, [userId, run]);

  return (
    <section className="panel panel--results" data-testid="results-screen">
      <div className="results">
        <div className="results__score">
          <p className="panel__label">Points</p>
          <p className="panel__figure" data-testid="run-points">
            {run.points.toLocaleString()}
          </p>
          <dl className="results__stats">
            <div>
              <dt>Accuracy</dt>
              <dd>{run.moves > 0 ? `${Math.round(run.accuracy)}%` : '–'}</dd>
            </div>
            <div>
              <dt>Best combo</dt>
              <dd>{run.bestCombo}</dd>
            </div>
            <div>
              <dt>Perfect · Good · Miss</dt>
              <dd>
                {run.perfect} · {run.good} · {run.miss}
              </dd>
            </div>
          </dl>
          <p className="panel__text" role="status" data-testid="save-status">
            {saveMessage(save, run, auth)}
          </p>
          <div className="panel__actions">
            <button type="button" className="button button--primary" onClick={onPlayAgain}>
              Play again
            </button>
            {supabase && auth.ready && !auth.user && run.moves > 0 && (
              <AccountButton auth={auth} onBeforeSignIn={() => keepPendingRun(run)} />
            )}
          </div>
        </div>

        {supabase && (
          <div className="results__board">
            <h2 className="panel__label">Leaderboard</h2>
            <Leaderboard userId={userId} refreshKey={save} limit={5} />
          </div>
        )}
      </div>
    </section>
  );
}

function saveMessage(save: SaveState, run: RunSummary, auth: AuthState): string {
  if (run.moves === 0) return 'Finish at least one move to score.';
  if (!supabase) return 'Scores are not saved in this build.';
  if (!auth.user) return 'Sign in to put this run on the leaderboard.';
  switch (save) {
    case 'saving':
      return 'Saving your run…';
    case 'saved':
      return 'Saved to the leaderboard.';
    case 'failed':
      return "Couldn't save this run. Check your connection.";
    default:
      return '';
  }
}
