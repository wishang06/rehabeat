import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { Play, Star } from 'lucide-react';
import type { AuthState } from '../lib/auth';
import { keepPendingRun, saveScore } from '../lib/scores';
import { supabase } from '../lib/supabase';
import { MAX_STARS, gradeFor, levelFor, starsFor, useProgress, type RunGains } from '../progress';
import type { RunSummary } from '../scoring';
import { AccountButton } from './AccountButton';
import { Leaderboard } from './Leaderboard';
import { XpBar } from './ProgressMeters';
import './screens.css';

interface ResultsScreenProps {
  run: RunSummary;
  /** What the run earned. Null for a run restored after the sign-in redirect: its XP was banked before leaving. */
  gains: RunGains | null;
  auth: AuthState;
  onPlayAgain: () => void;
  onChangeSong: () => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

const TALLY = [
  ['perfect', 'Perfect'],
  ['good', 'Good'],
  ['miss', 'Miss'],
] as const;

/**
 * The end of a run: the grade, stars, points, the Perfect / Good / Miss
 * split, the best combo and the XP it earned. Numbers count up as the screen
 * arrives; with reduced motion they are simply there.
 */
export function ResultsScreen({ run, gains, auth, onPlayAgain, onChangeSong }: ResultsScreenProps) {
  const root = useRef<HTMLElement>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const attempted = useRef(false);
  const userId = auth.user?.id ?? null;
  const progress = useProgress();

  const grade = gains?.grade ?? gradeFor(run);
  const stars = gains?.stars ?? starsFor(run);
  const xpBefore = gains ? levelFor(gains.xpBefore) : null;
  const xpAfter = levelFor(gains?.xpAfter ?? progress.xp);

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

  useGSAP(
    () => {
      const scope = root.current;
      if (!scope) return;
      gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
        const arrive = gsap.timeline({ defaults: { ease: 'power3.out' } });
        // Every number with data-count rolls up from zero to the value it was rendered with.
        for (const element of scope.querySelectorAll<HTMLElement>('[data-count]')) {
          const target = Number(element.dataset.count);
          const prefix = element.dataset.prefix ?? '';
          const counter = { value: 0 };
          arrive.to(
            counter,
            {
              value: target,
              duration: target > 200 ? 1.3 : 0.7,
              onUpdate: () => {
                element.textContent = prefix + Math.round(counter.value).toLocaleString();
              },
            },
            0.15,
          );
        }
        arrive
          .from('.res__grade .grade', { autoAlpha: 0, scale: 1.6, duration: 0.3, ease: 'back.out(1.6)' }, 0.1)
          .from('.stars [data-on="true"]', { autoAlpha: 0, x: 40, skewX: -20, duration: 0.2, stagger: 0.18 }, 0.5)
          .from('.tally__bar i', { scaleX: 0, duration: 0.6, stagger: 0.1 }, 0.3);
        // The XP bar starts where it was before the run. A level-up fills it, then it restarts at the new level.
        const fill = scope.querySelector<HTMLElement>('.res__xp .xp__fill');
        if (fill && xpBefore) {
          const leveled = xpBefore.level !== xpAfter.level;
          arrive.fromTo(
            fill,
            { '--fill': xpBefore.fraction },
            { '--fill': leveled ? 1 : xpAfter.fraction, duration: 0.9 },
            0.9,
          );
          if (leveled) arrive.fromTo(fill, { '--fill': 0 }, { '--fill': xpAfter.fraction, duration: 0.6 });
        }
      });
    },
    { scope: root },
  );

  const share = (count: number) => (run.moves > 0 ? count / run.moves : 0);

  return (
    <section className="res" ref={root} data-testid="results-screen" data-board={supabase ? 'true' : 'false'}>
      <div className="res__grade slab slab-edge">
        <span className="grade display" role="img" aria-label={`Grade ${grade}`} data-testid="run-grade">
          {grade}
        </span>
        <span className="stars" role="img" aria-label={`${stars} of ${MAX_STARS} stars`} data-testid="run-stars">
          {Array.from({ length: MAX_STARS }, (_, index) => (
            <Star key={index} data-on={index < stars} fill="currentColor" strokeWidth={0} aria-hidden="true" />
          ))}
        </span>
      </div>

      <div className="res__main">
        <h1 className="res__title display">{run.moves > 0 ? 'Routine complete' : 'No moves scored'}</h1>

        <div className="res__score">
          <span className="res__label label">Points</span>
          <span className="res__num led" data-testid="run-points" data-count={run.points}>
            {run.points.toLocaleString()}
          </span>
        </div>

        <dl className="res__tally">
          {TALLY.map(([key, label]) => (
            <div key={key} className={`tally tally--${key}`}>
              <dt className="display">{label}</dt>
              <span className="tally__bar segments" aria-hidden="true">
                <i style={{ '--share': share(run[key]) } as CSSProperties} />
              </span>
              <dd className="led" data-count={run[key]}>
                {run[key]}
              </dd>
            </div>
          ))}
        </dl>

        <div className="res__meta">
          <div className="res__stat slab">
            <span className="res__label label">Best combo</span>
            <span className="res__num led" data-count={run.bestCombo}>
              {run.bestCombo}
            </span>
          </div>
          <div className="res__stat res__xp slab">
            <span className="res__label label">{gains ? 'XP gained' : 'Your level'}</span>
            {gains && (
              <span className="res__num led" data-testid="run-xp" data-count={gains.xp.total} data-prefix="+">
                +{gains.xp.total}
              </span>
            )}
            <XpBar xp={gains?.xpAfter ?? progress.xp} />
          </div>
        </div>

        <p className="res__status" role="status" data-testid="save-status">
          {saveMessage(save, run, auth)}
        </p>

        <div className="res__actions">
          <button type="button" className="button button--primary" onClick={onPlayAgain} data-testid="play-again">
            <Play fill="currentColor" strokeWidth={0} aria-hidden="true" />
            Play again
          </button>
          <button type="button" className="button" onClick={onChangeSong} data-testid="change-song">
            Change song
          </button>
          {supabase && auth.ready && !auth.user && run.moves > 0 && (
            <AccountButton auth={auth} onBeforeSignIn={() => keepPendingRun(run)} />
          )}
        </div>
      </div>

      {supabase && (
        <div className="res__board">
          <h2 className="res__label label">Leaderboard</h2>
          <Leaderboard userId={userId} refreshKey={save} limit={5} />
        </div>
      )}
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
