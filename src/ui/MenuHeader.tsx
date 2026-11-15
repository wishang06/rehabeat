import type { StartStep } from '../session';

const STEP_LABEL: Record<StartStep, string> = {
  sound: 'Starting sound…',
  camera: 'Waiting for your camera…',
  model: 'Loading pose tracking…',
  song: 'Loading the song…',
};

interface MenuHeaderProps {
  /** The start-up step in progress after a pick, or null when idle. */
  step: StartStep | null;
  error: string | null;
}

/** Sits above the song menu: what to do, start-up progress, and any start-up error. */
export function MenuHeader({ step, error }: MenuHeaderProps) {
  return (
    <div className="menu-header">
      <h1 className="menu-header__title">Pick a song</h1>
      <p className="menu-header__lede">
        Reach for the pose, hold it on the beat, release. The melody swells while you hold it well.
      </p>
      {step && (
        <p className="menu-header__status" role="status" data-testid="start-progress">
          {STEP_LABEL[step]}
        </p>
      )}
      {error && (
        <p className="menu-header__error" role="alert" data-testid="start-error">
          {error}
        </p>
      )}
    </div>
  );
}
