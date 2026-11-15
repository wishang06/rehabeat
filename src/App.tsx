import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, MotionConfig, motion, type Variants } from 'motion/react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { BeatEngine } from './audio';
import { buildSession, dayKey, freePlan, playSetup, programView, type PlaySetup } from './care';
import { careStoreFor, useMyProgram } from './care/useCare';
import { useAuth } from './lib/auth';
import { takePendingRun } from './lib/scores';
import { supabase } from './lib/supabase';
import { MOVES } from './moves';
import { countedSeconds, estimateKcal, loadHistory, recordRun, recordRunStats, type RunGains } from './progress';
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
import { PlayScreen, type PlayDebug, type PlayRun } from './ui/PlayScreen';
import { ProgressMeters } from './ui/ProgressMeters';
import { ResultsScreen } from './ui/ResultsScreen';
import type { SentCare } from './ui/SentStrip';
import { Stage } from './ui/Stage';
import { FigureColorButton, FullscreenButton } from './ui/StageControls';
import { StatsPanel } from './ui/StatsPanel';
import { TitleScreen } from './ui/TitleScreen';
import { SongMenu } from './ui/menu/SongMenu';
import { loadLastSong, saveLastSong } from './ui/menu/lastSong';

type Screen = 'title' | 'menu' | 'calibrate' | 'play' | 'results';

/** Screens change the way everything arrives: along the lane. Reduced motion keeps only the fade. */
const SCREEN_LANE: Variants = {
  enter: { opacity: 0, x: 48 },
  on: { opacity: 1, x: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, x: -48, transition: { duration: 0.11, ease: 'easeIn' } },
};

/** Free play with no program: every move, until the player finishes. */
const FREE_PLAY: PlaySetup = { mode: 'free', plan: freePlan(null, MOVES), program: null };

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
  const statsRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const songRef = useRef<LoadedSong | null>(null);
  const auth = useAuth();

  // A run finished before signing in comes back from the Google redirect here.
  const [run, setRun] = useState<RunSummary | null>(() => takePendingRun());
  const [screen, setScreen] = useState<Screen>(() => (run ? 'results' : 'title'));
  /** What the last finished run earned. Null for a run restored after the redirect: it was banked before leaving. */
  const [gains, setGains] = useState<RunGains | null>(null);
  /** The last run's estimated calories. A restored run was logged before the redirect, so it is only estimated again here. */
  const [kcal, setKcal] = useState(() => (run && run.moves > 0 ? estimateKcal(countedSeconds(run.durationSec), loadHistory().weightKg) : 0));
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
  /** The Stats panel is mounted only while its dialog is open, so it reads today's date each time. */
  const [statsOpen, setStatsOpen] = useState(false);
  const openStats = useCallback(() => {
    setStatsOpen(true);
    statsRef.current?.showModal();
  }, []);

  // The doctor loop: the player's program, if they have one, and the session to send after a program run.
  const care = careStoreFor(auth);
  const {
    program,
    loading: programLoading,
    error: programError,
    reload: reloadProgram,
  } = useMyProgram(care);
  const today = dayKey(new Date());
  const programCard = useMemo(() => (program ? programView(program, MOVES, today) : null), [program, today]);
  const freePlay = useMemo(() => freePlan(program, MOVES), [program]);
  /** What the player asked for on the title screen. */
  const [wanted, setWanted] = useState<PlaySetup['mode']>('free');
  /**
   * What is being played. It is fixed when play starts (a song is picked, or
   * Play again), from the program as it stands then: early enough that a
   * program the doctor changes mid-song does not restart the song, late
   * enough that a patient's limits are always in it.
   */
  const [setup, setSetup] = useState<PlaySetup>(FREE_PLAY);
  const [sent, setSent] = useState<SentCare | null>(null);
  /** Set while a run is being finished, so the song ending and a key press cannot both finish it. */
  const finishing = useRef(false);

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
      // Keys typed into a field (the weight in Stats) are not shortcuts.
      if (event.target instanceof HTMLInputElement) return;
      if (event.key.toLowerCase() === 'd') setDebug((shown) => !shown);
      // The menu handles Esc itself, and an open dialog closes on its own.
      const dialogOpen = boardRef.current?.open || statsRef.current?.open;
      if (event.key !== 'Escape' || screen === 'menu' || screen === 'title' || dialogOpen) return;
      // In full screen, Esc leaves full screen; it takes a second press to leave the game.
      if (document.fullscreenElement) return;
      if (screen === 'play') leaveRef.current();
      else backToMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, backToMenu]);

  useEffect(() => () => session?.dispose(), [session]);
  useEffect(() => () => songRef.current?.engine.dispose(), []);

  const pick = async (id: string) => {
    const video = videoRef.current;
    if (!video || step !== null || !library?.songs[id]) return;
    const next = playSetup(wanted, program, MOVES, today);
    if (next.plan.moves.length === 0) {
      setError('Your limits leave nothing to play here. Ask your doctor about your program.');
      return;
    }
    setSetup(next);
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

  const startFree = () => {
    setWanted('free');
    setScreen('menu');
  };

  const startProgram = () => {
    if (!programCard?.playable) return;
    setWanted('program');
    setScreen('menu');
  };

  const finish = () => {
    if (finishing.current) return;
    finishing.current = true;
    const current = playRunRef.current;
    const stats = current?.stats ?? initialStats();
    const seconds = current ? (performance.now() - current.startedAt) / 1000 : 0;
    const summary = summarizeRun(stats, current?.points ?? 0, seconds, current?.maxPoints);
    // XP and the daily streak are banked here, once, as the run ends.
    const earned = recordRun(summary);
    // The run log and the calorie estimate are banked with it.
    setKcal(recordRunStats(summary));
    if (earned.levelAfter > earned.levelBefore) {
      toast(`Level ${earned.levelAfter}`, { description: 'You levelled up.' });
    } else if (earned.streakAfter > earned.streakBefore && earned.streakAfter > 1) {
      toast(`${earned.streakAfter} day streak`, { description: 'Come back tomorrow to keep it going.' });
    }
    // A program session is sent to the doctor from the results screen, even one that ended early.
    const record =
      setup.mode === 'program' && setup.program
        ? buildSession({
            prescription: setup.program.prescription,
            moveCount: setup.plan.moves.length,
            details: current?.details ?? [],
            summary,
            songId: song?.id ?? '',
            startedAt: new Date(Date.now() - seconds * 1000),
          })
        : null;
    setSent(record && care && setup.program ? { store: care, program: setup.program, session: record } : null);
    setGains(earned);
    setRun(summary);
    setScreen('results');
  };

  /** Esc or Songs on the Play screen. A program session with a scored hold is finished and sent, not dropped. */
  const leavePlay = () => {
    if (setup.mode === 'program' && (playRunRef.current?.stats.total ?? 0) > 0) finish();
    else backToMenu();
  };
  const leaveRef = useRef(leavePlay);
  leaveRef.current = leavePlay;

  useEffect(() => {
    if (screen === 'play') finishing.current = false;
  }, [screen]);

  // The song stays loaded on the results screen, so playing again restarts it.
  const playAgain = () => {
    if (!session || !song) return backToMenu();
    // The next run plays the program as it stands now: the doctor may have changed it.
    const next = playSetup(setup.mode, program, MOVES, today);
    if (next.plan.moves.length === 0) return backToMenu();
    setSetup(next);
    setScreen('play');
  };

  // Joining a doctor with their code, from the profile menu: for a player signed in to the real clinic with no program.
  const joinDoctor =
    care?.kind === 'clinic' && !program && !programLoading && programError === null
      ? (code: string) => care.joinWithCode(code).then(reloadProgram)
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app" data-screen={screen}>
        <header className="app__bar">
          <Link to="/" className="app__wordmark">
            Rehabeat
          </Link>
          {/* The results screen has its own XP tile, so the meters stay on the menu. */}
          {screen === 'menu' && <ProgressMeters />}
          <div className="app__actions">
            {/* The results screen has Change song on it; Esc still goes back from there too. */}
            {(screen === 'calibrate' || screen === 'play') && (
              <button
                type="button"
                className="button button--quiet"
                onClick={screen === 'play' ? leavePlay : backToMenu}
              >
                Songs <kbd>Esc</kbd>
              </button>
            )}
            {/* One button for both screens, so recalibrating does not drop out of full screen. */}
            {(screen === 'calibrate' || screen === 'play') && <FullscreenButton />}
            {screen === 'play' && (
              <>
                <FigureColorButton />
                {/* A program session is recorded from its first hold, so it is calibrated before, not during. */}
                {setup.mode === 'free' && (
                  <button type="button" className="button button--quiet" onClick={() => setScreen('calibrate')}>
                    Recalibrate
                  </button>
                )}
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
            {/* The title screen has its own Stats button, and Play keeps the bar clear. */}
            {screen !== 'play' && screen !== 'title' && (
              <button type="button" className="button button--quiet" onClick={openStats} data-testid="stats-button">
                Stats
              </button>
            )}
            {/* The title and results screens show the board already. */}
            {supabase && (screen === 'menu' || screen === 'calibrate') && (
              <button type="button" className="button button--quiet" onClick={() => boardRef.current?.showModal()}>
                Leaderboard
              </button>
            )}
            {/*
              Signed in, the profile menu is in the bar on every screen but Play. Signed out, the title
              and results screens have their own sign-in (the results one keeps the run).
            */}
            {supabase && screen !== 'play' && (auth.user || (screen !== 'title' && screen !== 'results')) && (
              <AccountButton auth={auth} onJoin={joinDoctor} />
            )}
          </div>
        </header>

        <main className="app__main">
          <Stage
            videoRef={videoRef}
            canvasRef={canvasRef}
            live={session !== null}
            rails={screen === 'play' || screen === 'calibrate'}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={screen}
                className="screen"
                variants={SCREEN_LANE}
                initial="enter"
                animate="on"
                exit="exit"
              >
                {screen === 'title' && (
                  <TitleScreen
                    onStart={startFree}
                    onStats={openStats}
                    auth={auth}
                    program={programCard}
                    onStartProgram={startProgram}
                    freePlay={freePlay.moves.length > 0}
                    loading={programLoading}
                    programFailed={programError === 'failed'}
                    onRetryProgram={reloadProgram}
                  />
                )}
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
                    key={`${song.id}:${setup.mode}`}
                    session={session}
                    engine={song.engine}
                    calibration={calibration}
                    plan={setup.plan}
                    onComplete={finish}
                    canvasRef={canvasRef}
                    debugRef={playDebugRef}
                    runRef={playRunRef}
                  />
                )}
                {screen === 'results' && run && (
                  <ResultsScreen
                    run={run}
                    gains={gains}
                    kcal={kcal}
                    auth={auth}
                    care={sent}
                    onSessionSaved={reloadProgram}
                    onPlayAgain={playAgain}
                    onChangeSong={backToMenu}
                  />
                )}
              </motion.div>
            </AnimatePresence>
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
              <BoardWhenOpen dialogRef={boardRef} userId={auth.user?.id ?? null} />
            </div>
          </dialog>
        )}

        <dialog
          ref={statsRef}
          className="board-dialog stats-dialog"
          aria-labelledby="stats-title"
          onClose={() => setStatsOpen(false)}
          onClick={(event) => event.target === event.currentTarget && statsRef.current?.close()}
          data-testid="stats-dialog"
        >
          <div className="board-dialog__body">
            <header className="board-dialog__head">
              <h2 id="stats-title" className="panel__title">
                Stats
              </h2>
              <button type="button" className="button button--quiet" onClick={() => statsRef.current?.close()}>
                Close
              </button>
            </header>
            {statsOpen && <StatsPanel />}
          </div>
        </dialog>
      </div>
    </MotionConfig>
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
