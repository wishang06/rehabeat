import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { BeatEngine } from './audio';
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
import { describeStartError, loadSong, startSession, type Session, type StartStep } from './session';
import { DEFAULT_SONG_ID, loadLibrary, type Library } from './songs/library';
import { AccountButton } from './ui/AccountButton';
import { CalibrateScreen } from './ui/CalibrateScreen';
import { DebugPanel } from './ui/DebugPanel';
import { Leaderboard } from './ui/Leaderboard';
import { MenuHeader } from './ui/MenuHeader';
import { MusicCredit } from './ui/MusicCredit';
import { PlayScreen, type PlayDebug, type PlayRun } from './ui/PlayScreen';
import { ResultsScreen } from './ui/ResultsScreen';
import { Stage } from './ui/Stage';
import { SongMenu } from './ui/menu/SongMenu';
import { loadLastSong, saveLastSong } from './ui/menu/lastSong';

type Screen = 'menu' | 'calibrate' | 'play' | 'results';

/** The picked song, loaded into its own beat engine. */
interface LoadedSong {
  id: string;
  engine: BeatEngine;
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playDebugRef = useRef<PlayDebug | null>(null);
  const playRunRef = useRef<PlayRun | null>(null);
  const boardRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const songRef = useRef<LoadedSong | null>(null);
  const auth = useAuth();

  // A run finished before signing in comes back from the Google redirect here.
  const [run, setRun] = useState<RunSummary | null>(() => takePendingRun());
  const [screen, setScreen] = useState<Screen>(() => (run ? 'results' : 'menu'));
  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(DEFAULT_SONG_ID);
  const [session, setSession] = useState<Session | null>(null);
  const [song, setSong] = useState<LoadedSong | null>(null);
  const [step, setStep] = useState<StartStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Calibration | null>(() => loadCalibration());
  const [calibration, setCalibration] = useState<Calibration>(saved ?? DEFAULT_CALIBRATION);
  /** Calibrated or skipped during this visit: later picks go straight to Play. */
  const [calibrated, setCalibrated] = useState(false);
  const [debug, setDebug] = useState(false);

  /** One AudioContext for previews and play. Browsers keep it silent until the page has had a click or key press. */
  const getAudioContext = useCallback((): AudioContext => {
    audioRef.current ??= new AudioContext();
    if (audioRef.current.state === 'suspended') void audioRef.current.resume().catch(() => undefined);
    return audioRef.current;
  }, []);

  useEffect(() => {
    let current = true;
    loadLibrary()
      .then((loaded) => {
        if (!current) return;
        for (const problem of loaded.problems) console.warn('[songs]', problem);
        setLibrary(loaded);
        setSelectedId(loadLastSong(Object.keys(loaded.songs)));
      })
      .catch((cause: unknown) => {
        if (current) setLibraryError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      current = false;
    };
  }, []);

  const releaseSong = useCallback(() => {
    songRef.current?.engine.dispose();
    songRef.current = null;
    setSong(null);
  }, []);

  const backToMenu = useCallback(() => {
    setScreen('menu');
    releaseSong();
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [releaseSong]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === 'd') setDebug((shown) => !shown);
      // The menu handles Esc itself, and an open leaderboard dialog closes on its own.
      if (event.key === 'Escape' && screen !== 'menu' && !boardRef.current?.open) backToMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, backToMenu]);

  useEffect(() => () => session?.dispose(), [session]);
  useEffect(() => () => songRef.current?.engine.dispose(), []);

  const pick = async (id: string) => {
    const video = videoRef.current;
    if (!video || step !== null || !library?.songs[id]) return;
    saveLastSong(id);
    setSelectedId(id);
    setError(null);

    // Created or resumed inside the click or key press, so the browser lets it make sound.
    const ctx = getAudioContext();
    try {
      let active = session;
      if (!active) {
        active = await startSession(video, ctx, setStep);
        setSession(active);
      }
      setStep('song');
      const engine = await loadSong(ctx, id);
      releaseSong();
      songRef.current = { id, engine };
      setSong(songRef.current);
      setScreen(calibrated ? 'play' : 'calibrate');
    } catch (cause) {
      console.error('Rehabeat failed to start', cause);
      setError(describeStartError(cause));
    } finally {
      setStep(null);
    }
  };

  const finish = () => {
    const current = playRunRef.current;
    const stats = current?.stats ?? initialStats();
    const seconds = current ? (performance.now() - current.startedAt) / 1000 : 0;
    setRun(summarizeRun(stats, current?.points ?? 0, seconds));
    setScreen('results');
  };

  // The song stays loaded on the results screen, so playing again restarts it.
  const playAgain = () => (session && song ? setScreen('play') : backToMenu());

  const creditSong = library?.songs[screen === 'menu' ? selectedId : (song?.id ?? selectedId)];
  const showCredit = screen === 'menu' || screen === 'play';

  return (
    <div className="app" data-screen={screen} data-credit="true">
      <header className="app__bar">
        <span className="app__wordmark">Rehabeat</span>
        {screen !== 'results' && (
          <ol className="app__steps" aria-label="Progress">
            <li aria-current={screen === 'menu' ? 'step' : undefined}>Song</li>
            <li aria-current={screen === 'calibrate' ? 'step' : undefined}>Calibrate</li>
            <li aria-current={screen === 'play' ? 'step' : undefined}>Play</li>
          </ol>
        )}
        <div className="app__actions">
          {screen !== 'menu' && (
            <button type="button" className="button button--quiet" onClick={backToMenu}>
              Songs <kbd>Esc</kbd>
            </button>
          )}
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
          {screen === 'menu' &&
            (library ? (
              <SongMenu
                library={library}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onPick={(id) => void pick(id)}
                getAudioContext={getAudioContext}
                header={<MenuHeader step={step} error={error} />}
              />
            ) : (
              <div className="menu-loading" role="status">
                {libraryError ? `The song list could not be loaded: ${libraryError}` : 'Loading songs…'}
              </div>
            ))}
          {screen === 'calibrate' && session && (
            <CalibrateScreen
              session={session}
              canvasRef={canvasRef}
              saved={saved}
              onDone={(result) => {
                setCalibration(result);
                setSaved(loadCalibration());
                setCalibrated(true);
                setScreen(song ? 'play' : 'menu');
              }}
            />
          )}
          {screen === 'play' && session && song && (
            <PlayScreen
              key={song.id}
              session={session}
              engine={song.engine}
              calibration={calibration}
              canvasRef={canvasRef}
              debugRef={playDebugRef}
              runRef={playRunRef}
            />
          )}
          {screen === 'results' && run && <ResultsScreen run={run} auth={auth} onPlayAgain={playAgain} />}
        </Stage>
        {debug && (
          <DebugPanel
            session={session}
            engine={song?.engine ?? null}
            songId={song?.id ?? null}
            calibration={calibration}
            playRef={playDebugRef}
          />
        )}
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
      <footer className="app__footer">{showCredit && creditSong && <MusicCredit song={creditSong} />}</footer>
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
