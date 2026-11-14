import { useEffect, useRef, useState, type RefObject } from 'react';
import { CalibrationSession } from '../audio';
import { drawSkeleton } from '../pose';
import { ShrugBaselineCollector, saveCalibration, type Calibration } from '../scoring';
import type { Session } from '../session';
import { CANVAS_COLORS, prepareCanvas } from './canvas';
import { useAnimationFrame } from './useAnimationFrame';

interface CalibrateScreenProps {
  session: Session;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** A calibration saved on an earlier visit, offered as a way to skip. */
  saved: Calibration | null;
  onDone: (calibration: Calibration) => void;
}

type Status = 'idle' | 'running' | 'measured' | 'failed';

const CLICK_COUNT = 4;

export function formatOffset(offsetMs: number): string {
  return `${offsetMs > 0 ? '+' : ''}${Math.round(offsetMs)} ms`;
}

export function CalibrateScreen({ session, canvasRef, saved, onDone }: CalibrateScreenProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [clicks, setClicks] = useState(0);
  const [measured, setMeasured] = useState<Calibration | null>(null);
  const [inView, setInView] = useState(true);
  const stopRun = useRef<(() => void) | null>(null);

  useAnimationFrame(() => {
    const canvas = canvasRef.current;
    const surface = canvas && prepareCanvas(canvas);
    if (!surface) return;
    const landmarks = session.latest()?.landmarks;
    if (landmarks) {
      drawSkeleton(surface.ctx, landmarks, {
        width: surface.width,
        height: surface.height,
        lineColor: CANVAS_COLORS.skeletonLine,
        jointColor: CANVAS_COLORS.skeletonJoint,
        lineWidth: surface.width / 160,
      });
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const angles = session.latest()?.frame.angles;
      setInView(angles?.leftShoulder !== undefined || angles?.rightShoulder !== undefined);
    }, 300);
    return () => {
      window.clearInterval(timer);
      stopRun.current?.();
    };
  }, [session]);

  const run = () => {
    stopRun.current?.();
    const calibrator = new CalibrationSession(session.engine, { clicks: CLICK_COUNT });
    const baseline = new ShrugBaselineCollector();
    const unsubscribe = session.subscribe((sample) => {
      calibrator.pushFrame(sample.frame);
      baseline.push(sample.frame, sample.form);
    });

    const stop = () => {
      window.clearInterval(timer);
      unsubscribe();
      stopRun.current = null;
    };
    const timer = window.setInterval(() => {
      setClicks(calibrator.clicksPlayed());
      if (!calibrator.isDone()) return;
      stop();

      const result = calibrator.result();
      if (!result) {
        setStatus('failed');
        return;
      }
      const calibration: Calibration = {
        offsetMs: Math.round(result.offsetMs),
        shoulderEarBaseline: baseline.result(),
      };
      saveCalibration(calibration);
      setMeasured(calibration);
      setStatus('measured');
    }, 50);
    stopRun.current = stop;

    calibrator.start();
    setClicks(0);
    setStatus('running');
  };

  const skip = () => onDone(saved ?? { offsetMs: 0, shoulderEarBaseline: null });

  return (
    <section className="panel" aria-live="polite" data-testid="calibrate-screen">
      {status === 'idle' && (
        <>
          <h2 className="panel__title">Calibrate your timing</h2>
          <p className="panel__text">
            You'll hear four clicks. Raise one arm out to the side so it arrives on each click, and
            lower it in between.
          </p>
        </>
      )}

      {status === 'running' && (
        <>
          <h2 className="panel__title">Raise your arm on each click</h2>
          <ol className="clicks" aria-label={`Click ${Math.min(clicks, CLICK_COUNT)} of ${CLICK_COUNT}`}>
            {Array.from({ length: CLICK_COUNT }, (_, index) => (
              <li key={index} className="clicks__dot" data-on={index < clicks} />
            ))}
          </ol>
        </>
      )}

      {status === 'measured' && measured && (
        <>
          <h2 className="panel__title">
            Measured offset: <span data-testid="measured-offset">{formatOffset(measured.offsetMs)}</span>
          </h2>
          <p className="panel__text">
            That's the gap between each click and your arm arriving on camera. Scoring shifts your
            hold window by it.
          </p>
        </>
      )}

      {status === 'failed' && (
        <>
          <h2 className="panel__title">That didn't register</h2>
          <p className="panel__text">
            Fewer than three arm raises lined up with the clicks. Keep your shoulders and hips in the
            picture and lift your arm to shoulder height or above.
          </p>
        </>
      )}

      {!inView && status !== 'measured' && (
        <p className="panel__hint" data-testid="in-view-hint">
          Step back until your shoulders and hips are in the picture.
        </p>
      )}

      {status !== 'running' && (
        <div className="panel__actions">
          {status === 'measured' && measured ? (
            <>
              <button type="button" className="button button--primary" onClick={() => onDone(measured)}>
                Start playing
              </button>
              <button type="button" className="button" onClick={run}>
                Calibrate again
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button--primary" onClick={run} data-testid="calibrate-start">
                {status === 'failed' ? 'Try again' : 'Start calibration'}
              </button>
              <button type="button" className="button" onClick={skip} data-testid="calibrate-skip">
                {saved ? `Skip, use saved ${formatOffset(saved.offsetMs)}` : 'Skip for now'}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
