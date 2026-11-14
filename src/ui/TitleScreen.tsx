import { useEffect } from 'react';
import { Link } from 'react-router';
import { Figure } from '@/components/Figure';
import { playSfx } from '../audio/sfx';
import type { AuthState } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AccountButton } from './AccountButton';
import { Leaderboard } from './Leaderboard';
import { ProgressMeters } from './ProgressMeters';
import './screens.css';

interface TitleScreenProps {
  /** Go to the song menu. */
  onStart: () => void;
  /** Open the Stats panel. */
  onStats: () => void;
  /** The player's account. With accounts on, the leaderboard and sign-in sit beside the start button. */
  auth: AuthState;
}

/** Rows on the title screen's board: few enough to read from two metres. */
const BOARD_ROWS = 5;

/**
 * The first screen of the game: the name, the player's level and daily
 * streak, a way into Stats, and one primary button. Enter or Space starts from anywhere on it. With
 * accounts on, the leaderboard and sign-in take the right-hand column.
 */
export function TitleScreen({ onStart, onStats, auth }: TitleScreenProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // A focused button, link or field handles its own key press, and so does an open dialog.
      if (event.target instanceof Element && event.target.closest('button, a, input, dialog')) return;
      event.preventDefault();
      playSfx('confirm');
      onStart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  return (
    <section className="title" data-testid="title-screen" data-board={supabase ? 'true' : 'false'}>
      <div className="title__lanes" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="title__copy">
        <h1 className="title__name display">Rehabeat</h1>
        <p className="title__tag">Match the gold figure on the beat. The music plays while your form holds.</p>
        <button
          type="button"
          className="button button--primary title__start"
          onClick={onStart}
          data-testid="title-start"
          autoFocus
        >
          Start <kbd>Enter</kbd>
        </button>
        <ProgressMeters className="title__meters" />
        <button type="button" className="button button--quiet title__stats" onClick={onStats} data-testid="title-stats">
          Stats
        </button>
        <p className="title__more">
          <Link to="/">How it works</Link>
        </p>
      </div>

      <div className="title__figure">
        <Figure pose="overhead" label="The gold figure with both arms raised" />
      </div>

      {supabase && (
        <section className="title__board slab slab-edge" aria-labelledby="title-board-heading">
          <h2 id="title-board-heading" className="title__board-head display">
            High scores
          </h2>
          <Leaderboard userId={auth.user?.id ?? null} refreshKey={auth.user?.id} limit={BOARD_ROWS} />
          <div className="title__board-foot">
            {auth.ready && !auth.user && <p className="title__board-text">Sign in to save your points and get on the board.</p>}
            <AccountButton auth={auth} />
          </div>
        </section>
      )}
    </section>
  );
}
