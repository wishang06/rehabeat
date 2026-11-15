import { useEffect } from 'react';
import { Link } from 'react-router';
import { Figure } from '@/components/Figure';
import { playSfx } from '../audio/sfx';
import type { ProgramView } from '../care';
import type { AuthState } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AccountButton } from './AccountButton';
import { JoinCode } from './JoinCode';
import { Leaderboard } from './Leaderboard';
import { ProgramCard } from './ProgramCard';
import { ProgressMeters } from './ProgressMeters';
import './screens.css';

interface TitleScreenProps {
  /** Go to the song menu for free play. */
  onStart: () => void;
  /** The player's program, if a doctor gave them one. */
  program: ProgramView | null;
  /** Go to the song menu for a program session. */
  onStartProgram: () => void;
  /** False when the player's limits leave free play nothing to play. */
  freePlay: boolean;
  /** True until it is known whether the player has a program: play does not start before then. */
  loading: boolean;
  /** The program could not be read. The game still plays, without any limits a doctor set. */
  programFailed: boolean;
  onRetryProgram: () => void;
  /** Joins a doctor with their code. Null unless the player is signed in to the real clinic and has no program. */
  onJoin: ((code: string) => Promise<void>) | null;
  /** Open the Stats panel. */
  onStats: () => void;
  /** The player's account. With accounts on, the leaderboard and sign-in sit beside the start button. */
  auth: AuthState;
}

/** Rows on the title screen's board: few enough to read from two metres. */
const BOARD_ROWS = 5;
/** With a program card above it, the board gets fewer. */
const BOARD_ROWS_UNDER_CARD = 3;

/**
 * The first screen of the game: the name, the player's level and daily
 * streak, a way into Stats, and one primary button. Enter or Space starts from anywhere on it. With
 * accounts on, the leaderboard and sign-in take the right-hand column. A
 * player with a program gets its card there too, and the card's button
 * becomes the screen's one primary action.
 */
export function TitleScreen({
  onStart,
  onStats,
  auth,
  program,
  onStartProgram,
  freePlay,
  loading,
  programFailed,
  onRetryProgram,
  onJoin,
}: TitleScreenProps) {
  const session = program?.playable ?? false;
  // A patient's limits are in their program, so nothing starts until it is known whether there is one.
  const begin = loading ? null : session ? onStartProgram : freePlay ? onStart : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // A focused button, link or field handles its own key press, and so does an open dialog.
      if (event.target instanceof Element && event.target.closest('button, a, input, dialog')) return;
      if (!begin) return;
      event.preventDefault();
      playSfx('confirm');
      begin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [begin]);

  return (
    <section className="title" data-testid="title-screen" data-board={supabase || program ? 'true' : 'false'}>
      <div className="title__lanes" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="title__copy">
        <h1 className="title__name display">Rehabeat</h1>
        <p className="title__tag">Match the gold figure on the beat. The music plays while your form holds.</p>
        {loading ? (
          <p className="title__wait" role="status">
            Loading…
          </p>
        ) : session ? (
          // The program card holds the primary action; free play steps back.
          freePlay && (
            <button type="button" className="button title__free" onClick={onStart} data-testid="title-start">
              Free play
            </button>
          )
        ) : freePlay ? (
          <button
            type="button"
            className="button button--primary title__start"
            onClick={onStart}
            data-testid="title-start"
            autoFocus
          >
            Start <kbd>Enter</kbd>
          </button>
        ) : null}
        {programFailed && (
          <p className="title__warn" role="alert" data-testid="program-error">
            Your program could not be loaded, so any limits from your doctor are not applied.{' '}
            <button type="button" onClick={onRetryProgram}>
              Try again
            </button>
          </p>
        )}
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

      {(supabase || program) && (
        <div className="title__side">
          {program && <ProgramCard program={program} onStart={onStartProgram} />}
          {supabase && (
            <section className="title__board slab slab-edge" aria-labelledby="title-board-heading">
              <h2 id="title-board-heading" className="title__board-head display">
                High scores
              </h2>
              <Leaderboard
                userId={auth.user?.id ?? null}
                refreshKey={auth.user?.id}
                limit={program ? BOARD_ROWS_UNDER_CARD : BOARD_ROWS}
              />
              <div className="title__board-foot">
                {/* Signed in, the profile menu is in the marquee. */}
                {auth.ready && !auth.user && <AccountButton auth={auth} />}
                {onJoin && <JoinCode onJoin={onJoin} />}
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
