import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { Session } from '../../session';
import { bodyCutOff } from './framing';
import { setCameraZoom, useCameraZoom } from './zoomStore';

/** How often the hint checks whether the head or feet are cut off. */
const CHECK_MS = 300;

/**
 * The camera zoom slider on the Calibrate screen: from the closest view out
 * to the camera's full frame. Play uses the same zoom. At full frame, if the
 * head or feet are still cut off, the only fix left is to step back.
 */
export function ZoomControl({ session }: { session: Session }) {
  const zoom = useCameraZoom();
  const id = useId();
  const [cutOff, setCutOff] = useState(false);
  const full = zoom >= 1;

  useEffect(() => {
    const timer = window.setInterval(() => setCutOff(bodyCutOff(session.latest()?.landmarks)), CHECK_MS);
    return () => window.clearInterval(timer);
  }, [session]);

  return (
    <div className="zoom" data-testid="zoom-control">
      <label className="zoom__label" htmlFor={id}>
        Camera zoom
      </label>
      <div className="zoom__row">
        <span className="zoom__end" aria-hidden="true">
          Close
        </span>
        <input
          id={id}
          className="zoom__slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={zoom}
          onChange={(event) => setCameraZoom(Number(event.target.value))}
          aria-valuetext={full ? 'Full frame' : zoom <= 0 ? 'Closest' : `${Math.round(zoom * 100)}% of the way out`}
          style={{ '--fill': `${zoom * 100}%` } as CSSProperties}
          data-testid="zoom-slider"
        />
        <span className="zoom__end" aria-hidden="true">
          Full frame
        </span>
      </div>
      {full && cutOff && (
        <p className="zoom__hint" role="status" data-testid="zoom-hint">
          Still too close? Step back
        </p>
      )}
    </div>
  );
}
