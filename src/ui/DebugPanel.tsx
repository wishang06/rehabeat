import { useEffect, useState, type RefObject } from 'react';
import type { Calibration } from '../scoring';
import type { Session } from '../session';
import { JOINT_NAMES } from '../types';
import { formatOffset } from './CalibrateScreen';
import type { PlayDebug } from './PlayScreen';

interface DebugPanelProps {
  session: Session | null;
  calibration: Calibration;
  playRef: RefObject<PlayDebug | null>;
}

const fixed = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? '–' : value.toFixed(digits);

/** Developer readout, toggled with the D key. Refreshes five times a second. */
export function DebugPanel({ session, calibration, playRef }: DebugPanelProps) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => refresh((n) => n + 1), 200);
    return () => window.clearInterval(timer);
  }, []);

  const sample = session?.latest() ?? null;
  const play = playRef.current;
  const engine = session?.engine;

  return (
    <aside className="debug" data-testid="debug-panel" aria-label="Debug panel">
      <dl className="debug__grid">
        <dt>FPS</dt>
        <dd data-testid="debug-fps">{fixed(sample?.fps)}</dd>
        <dt>Detection</dt>
        <dd>
          <span data-testid="debug-detect-ms">{fixed(sample?.detectMs)}</span> ms
          {session ? ` (${session.tracker.delegate})` : ''}
        </dd>
        <dt>Calibration offset</dt>
        <dd data-testid="debug-offset">{formatOffset(calibration.offsetMs)}</dd>
        <dt>Shrug baseline</dt>
        <dd>{fixed(calibration.shoulderEarBaseline, 3)}</dd>
        <dt>Audio</dt>
        <dd data-testid="debug-audio">
          {engine ? `${engine.mode}, ${engine.beatmapSource} beatmap, ${fixed(engine.grid.bpm, 0)} BPM` : '–'}
        </dd>
        <dt>Loop</dt>
        <dd data-testid="debug-loop">
          {engine?.loopLength != null ? `${engine.loopLength.toFixed(4)} s` : '–'}
        </dd>
        <dt>Melody stem</dt>
        <dd data-testid="debug-melody">
          {engine?.mode === 'stems' ? (engine.melodyActive ? 'in' : 'out') : 'no stems'}
        </dd>
        <dt>Beat</dt>
        <dd>{fixed(play?.beat, 2)}</dd>
        <dt>Frame / hold score</dt>
        <dd>
          {fixed(play?.frameScore, 0)} / {fixed(play?.holdScore, 0)}
        </dd>
        <dt>Trunk lean</dt>
        <dd>{fixed(sample?.form.trunkLeanDeg)}°</dd>
        <dt>Shoulder-ear ratio</dt>
        <dd>{fixed(sample?.form.shoulderEarRatio, 3)}</dd>
      </dl>

      <table className="debug__joints">
        <thead>
          <tr>
            <th scope="col">Joint</th>
            <th scope="col">Live</th>
            <th scope="col">Target</th>
            <th scope="col">Δ</th>
          </tr>
        </thead>
        <tbody>
          {JOINT_NAMES.map((joint) => {
            const angle = sample?.frame.angles[joint];
            const target = play?.move?.joints[joint];
            const delta = angle !== undefined && target !== undefined ? angle - target : null;
            return (
              <tr key={joint} data-targeted={target !== undefined}>
                <th scope="row">{joint}</th>
                <td>{fixed(angle, 0)}</td>
                <td>{fixed(target, 0)}</td>
                <td>{delta === null ? '–' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </aside>
  );
}
