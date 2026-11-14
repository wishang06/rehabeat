import type { AuthState } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { MOVES } from '../moves';
import type { StartStep } from '../session';
import { AccountButton } from './AccountButton';
import { Leaderboard } from './Leaderboard';
import { PoseGlyph } from './PoseGlyph';

interface WelcomeScreenProps {
  /** The start-up step in progress, or null when idle. */
  step: StartStep | null;
  error: string | null;
  onStart: () => void;
  auth: AuthState;
}

const STEP_LABEL: Record<StartStep, string> = {
  sound: 'Starting sound…',
  camera: 'Waiting for your camera…',
  model: 'Loading pose tracking…',
};

/** The start card and, when accounts are on, the leaderboard beside it. */
export function WelcomeScreen({ step, error, onStart, auth }: WelcomeScreenProps) {
  const busy = step !== null;
  return (
    <div className={supabase ? 'welcome' : 'welcome welcome--solo'}>
      <section className="card welcome__start" aria-labelledby="welcome-title">
        <h1 id="welcome-title" className="welcome__title">
          Rehabeat
        </h1>
        <p className="welcome__lede">
          Rehab moves, played to a beat. Reach for the pose, hold it in time, and the music follows you.
        </p>
        <ol className="welcome__steps">
          <li>Stand back until your head and knees are in the picture.</li>
          <li>Calibrate your timing with four clicks.</li>
          <li>Follow the glowing guide: reach, hold, release.</li>
        </ol>

        <ul className="welcome__moves" aria-label="Moves in this routine">
          {MOVES.map((move) => (
            <li key={move.id} className="welcome__move">
              <PoseGlyph move={move} />
              <span className="welcome__move-name">{move.name}</span>
              <span className="welcome__move-beats">
                {move.beats.reach} · {move.beats.hold} · {move.beats.release} beats
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="button button--primary button--big welcome__cta"
          onClick={onStart}
          disabled={busy}
          data-testid="start-button"
        >
          {busy ? STEP_LABEL[step] : 'Start playing'}
        </button>
        {error && (
          <p className="welcome__error" role="alert" data-testid="start-error">
            {error}
          </p>
        )}
      </section>

      {supabase && (
        <section className="card welcome__board" aria-labelledby="board-heading">
          <div className="welcome__board-head">
            <h2 id="board-heading" className="card__title">
              Leaderboard
            </h2>
          </div>
          <Leaderboard userId={auth.user?.id ?? null} refreshKey={auth.user?.id} limit={8} />
          <div className="welcome__board-foot">
            {auth.user ? (
              <p className="card__text">
                Playing as <strong>{auth.profile?.displayName ?? 'you'}</strong>. Finish a run to climb the board.
              </p>
            ) : (
              <>
                <p className="card__text">Sign in to save your points and get on the board.</p>
                <AccountButton auth={auth} />
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
