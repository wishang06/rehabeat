import { useCallback, useEffect, useRef, useState } from 'react';
import type { BeatEngine } from './audio';
import { DEFAULT_CALIBRATION, loadCalibration, type Calibration } from './scoring';
import { describeStartError, loadSong, startSession, type Session, type StartStep } from './session';
import { DEFAULT_SONG_ID, loadLibrary, type Library } from './songs/library';
import { CalibrateScreen } from './ui/CalibrateScreen';
import { DebugPanel } from './ui/DebugPanel';
import { MenuHeader } from './ui/MenuHeader';
import { MusicCredit } from './ui/MusicCredit';
import { PlayScreen, type PlayDebug } from './ui/PlayScreen';
import { Stage } from './ui/Stage';
import { SongMenu } from './ui/menu/SongMenu';
import { loadLastSong, saveLastSong } from './ui/menu/lastSong';

type Screen = 'menu' | 'calibrate' | 'play';

/** The picked song, loaded into its own beat engine. */
interface LoadedSong {
  id: string;
  engine: BeatEngine;
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playDebugRef = useRef<PlayDebug | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const songRef = useRef<LoadedSong | null>(null);

  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(DEFAULT_SONG_ID);
  const [screen, setScreen] = useState<Screen>('menu');
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
      // The menu handles Esc itself; everywhere else it goes back to the menu.
      if (event.key === 'Escape' && screen !== 'menu') backToMenu();
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

  const creditSong = library?.songs[screen === 'menu' ? selectedId : (song?.id ?? selectedId)];

  return (
    <div className="app" data-screen={screen} data-credit="true">
      <header className="app__bar">
        <span className="app__wordmark">Rehabeat</span>
        <ol className="app__steps" aria-label="Progress">
          <li aria-current={screen === 'menu' ? 'step' : undefined}>Song</li>
          <li aria-current={screen === 'calibrate' ? 'step' : undefined}>Calibrate</li>
          <li aria-current={screen === 'play' ? 'step' : undefined}>Play</li>
        </ol>
        <div className="app__actions">
          {screen !== 'menu' && (
            <button type="button" className="button button--quiet" onClick={backToMenu}>
              Songs <kbd>Esc</kbd>
            </button>
          )}
          {screen === 'play' && (
            <button type="button" className="button button--quiet" onClick={() => setScreen('calibrate')}>
              Recalibrate
            </button>
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
            />
          )}
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

      {/* The strip keeps its height on every screen so the camera view never jumps. */}
      <footer className="app__footer">
        {screen !== 'calibrate' && creditSong && <MusicCredit song={creditSong} />}
      </footer>
    </div>
  );
}
