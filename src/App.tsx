import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CALIBRATION, loadCalibration, type Calibration } from './scoring';
import { describeStartError, startSession, type Session, type StartStep } from './session';
import { CalibrateScreen } from './ui/CalibrateScreen';
import { DebugPanel } from './ui/DebugPanel';
import { PlayScreen, type PlayDebug } from './ui/PlayScreen';
import { Stage } from './ui/Stage';
import { WelcomeScreen } from './ui/WelcomeScreen';

type Screen = 'welcome' | 'calibrate' | 'play';

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playDebugRef = useRef<PlayDebug | null>(null);

  const [screen, setScreen] = useState<Screen>('welcome');
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
    <div className="app" data-screen={screen}>
      <header className="app__bar">
        <span className="app__wordmark">Rehabeat</span>
        {session && (
          <nav className="app__steps" aria-label="Progress">
            <span data-current={screen === 'calibrate'}>Calibrate</span>
            <span data-current={screen === 'play'}>Play</span>
          </nav>
        )}
        <div className="app__actions">
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
            />
          )}
        </Stage>
        {debug && <DebugPanel session={session} calibration={calibration} playRef={playDebugRef} />}
      </main>
    </div>
  );
}
