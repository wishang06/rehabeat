import type { StartStep } from '../session';

interface WelcomeScreenProps {
  /** The start-up step in progress, or null when idle. */
  step: StartStep | null;
  error: string | null;
  onStart: () => void;
}

const STEP_LABEL: Record<StartStep, string> = {
  sound: 'Starting sound…',
  camera: 'Waiting for your camera…',
  model: 'Loading pose tracking…',
};

export function WelcomeScreen({ step, error, onStart }: WelcomeScreenProps) {
  const busy = step !== null;
  return (
    <div className="welcome">
      <h1 className="welcome__title">Rehabeat</h1>
      <p className="welcome__lede">
        Rehab moves, played to a beat. Reach for the pose, hold it in time, and the music follows you.
      </p>
      <ol className="welcome__steps">
        <li>Stand back until your head and knees are in the picture.</li>
        <li>Calibrate with four clicks.</li>
        <li>Follow the glowing guide: reach, hold, release.</li>
      </ol>
      <button
        type="button"
        className="button button--primary"
        onClick={onStart}
        disabled={busy}
        data-testid="start-button"
      >
        {busy ? STEP_LABEL[step] : 'Start camera and sound'}
      </button>
      {error && (
        <p className="welcome__error" role="alert" data-testid="start-error">
          {error}
        </p>
      )}
    </div>
  );
}
