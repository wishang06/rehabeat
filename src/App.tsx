import { useEffect, useRef, useState, type RefObject } from 'react';
import { hasStems } from 'virtual:public-assets';
import { useAuth } from './lib/auth';
import { takePendingRun } from './lib/scores';
import { supabase } from './lib/supabase';
import {
  DEFAULT_CALIBRATION,
  initialStats,
  loadCalibration,
  summarizeRun,
  type Calibration,
  type RunSummary,
} from './scoring';
import { describeStartError, startSession, type Session, type StartStep } from './session';
import { AccountButton } from './ui/AccountButton';
import { CalibrateScreen } from './ui/CalibrateScreen';
import { DebugPanel } from './ui/DebugPanel';
import { Leaderboard } from './ui/Leaderboard';
import { MusicCredit } from './ui/MusicCredit';
import { PlayScreen, type PlayDebug, type PlayRun } from './ui/PlayScreen';
import { ResultsScreen } from './ui/ResultsScreen';
import { Stage } from './ui/Stage';
import { WelcomeScreen } from './ui/WelcomeScreen';

type Screen = 'welcome' | 'calibrate' | 'play' | 'results';

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playDebugRef = useRef<PlayDebug | null>(null);
  const playRunRef = useRef<PlayRun | null>(null);
  const boardRef = useRef<HTMLDialogElement>(null);
  const auth = useAuth();

  // A run finished before signing in comes back from the Google redirect here.
  const [run, setRun] = useState<RunSummary | null>(() => takePendingRun());
  const [screen, setScreen] = useState<Screen>(() => (run ? 'results' : 'welcome'));
  const [session, setSession] = useState<Session | null>(null);
  const [step, setStep] = useState<StartStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Calibration | null>(() => loadCalibration());
  const [calibration, setCalibration] = useState<Calibration>(saved ?? DEFAULT_CALIBRATION);
  const [debug, setDebug] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd' || event.ctrlKey || event.metaKey || event.altKey) return;
      setDebug((shown) => !shown);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => () => session?.dispose(), [session]);

  const finish = () => {
    const current = playRunRef.current;
    const stats = current?.stats ?? initialStats();
    const seconds = current ? (performance.now() - current.startedAt) / 1000 : 0;
    setRun(summarizeRun(stats, current?.points ?? 0, seconds));
    setScreen('results');
  };

  const playAgain = () => setScreen(session ? 'play' : 'welcome');

  const start = async () => {
    const video = videoRef.current;
    if (!video || step !== null) return;
    setError(null);

    // Created inside the click so the browser lets it make sound.
    const ctx = new AudioContext();
    try {
      setSession(await startSession(video, ctx, setStep));
      setScreen('calibrate');
    } catch (cause) {
      console.error('Rehabeat failed to start', cause);
      setError(describeStartError(cause));
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="app" data-screen={screen} data-credit={hasStems}>
      <header className="app__bar">
        <span className="app__wordmark">Rehabeat</span>
        {session && screen !== 'results' && (
          <ol className="app__steps" aria-label="Progress">
            <li aria-current={screen === 'calibrate' ? 'step' : undefined}>Calibrate</li>
            <li aria-current={screen === 'play' ? 'step' : undefined}>Play</li>
          </ol>
        )}
        <div className="app__actions">
          {screen === 'play' && (
            <>
              <button type="button" className="button button--quiet" onClick={() => setScreen('calibrate')}>
                Recalibrate
              </button>
              <button
                type="button"
                className="button button--quiet button--accent"
                onClick={finish}
                data-testid="finish-button"
              >
                Finish run
              </button>
            </>
          )}
          {supabase && screen !== 'play' && (
            <>
              <button type="button" className="button button--quiet" onClick={() => boardRef.current?.showModal()}>
                Leaderboard
              </button>
              <AccountButton auth={auth} />
            </>
          )}
          {session && (
            <span className="app__hint">
              <kbd>D</kbd> debug
            </span>
          )}
        </div>
      </header>

      <main className="app__main">
        <Stage videoRef={videoRef} canvasRef={canvasRef} live={session !== null}>
          {screen === 'welcome' && <WelcomeScreen step={step} error={error} onStart={start} />}
          {screen === 'calibrate' && session && (
            <CalibrateScreen
              session={session}
              canvasRef={canvasRef}
              saved={saved}
              onDone={(result) => {
                setCalibration(result);
                setSaved(loadCalibration());
                setScreen('play');
              }}
            />
          )}
          {screen === 'play' && session && (
            <PlayScreen
              session={session}
              calibration={calibration}
              canvasRef={canvasRef}
              debugRef={playDebugRef}
              runRef={playRunRef}
            />
          )}
          {screen === 'results' && run && <ResultsScreen run={run} auth={auth} onPlayAgain={playAgain} />}
        </Stage>
        {debug && <DebugPanel session={session} calibration={calibration} playRef={playDebugRef} />}
      </main>

      {supabase && (
        <dialog
          ref={boardRef}
          className="board-dialog"
          aria-labelledby="board-title"
          onClick={(event) => event.target === event.currentTarget && boardRef.current?.close()}
        >
          <div className="board-dialog__body">
            <header className="board-dialog__head">
              <h2 id="board-title" className="panel__title">
                Leaderboard
              </h2>
              <button type="button" className="button button--quiet" onClick={() => boardRef.current?.close()}>
                Close
              </button>
            </header>
            <p className="panel__text">Best run per player. Sign in and finish a run to get on it.</p>
            <BoardWhenOpen dialogRef={boardRef} userId={auth.user?.id ?? null} />
          </div>
        </dialog>
      )}

      {/* The strip keeps its height on every screen so the camera view never jumps. */}
      {hasStems && (
        <footer className="app__footer">
          {(screen === 'welcome' || screen === 'play') && <MusicCredit />}
        </footer>
      )}
    </div>
  );
}

/** Loads the leaderboard each time the dialog opens, not on page load. */
function BoardWhenOpen({
  dialogRef,
  userId,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  userId: string | null;
}) {
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const observer = new MutationObserver(() => {
      if (dialog.open) setOpened((count) => count + 1);
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, [dialogRef]);
  return opened > 0 ? <Leaderboard userId={userId} refreshKey={opened} /> : null;
}
