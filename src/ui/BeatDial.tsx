import type { CSSProperties, ReactNode } from 'react';

interface BeatDialProps {
  /** One tick mark per beat (or per calibration click). */
  ticks: number;
  /** How many ticks are lit, clockwise from the top. */
  lit: number;
  /** Overrides for the --progress and --pulse variables, when no ancestor animates them. */
  style?: CSSProperties;
  /** Shown in the centre of the dial. */
  children?: ReactNode;
}

const CENTER = 60;
const RING_RADIUS = 43;
const TICK_INNER = 52;
const TICK_OUTER = 58;

/**
 * The beat dial: a ring that fills as the current phase plays out, with one
 * tick per beat around it and a pulse on every beat.
 *
 * It reads two CSS variables from itself or an ancestor, both 0 to 1:
 * --progress (how far round the ring has filled) and --pulse (1 on the beat, decaying).
 */
export function BeatDial({ ticks, lit, style, children }: BeatDialProps) {
  return (
    <div className="dial" style={style}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="dial__pulse" cx={CENTER} cy={CENTER} r={RING_RADIUS} />
        <circle className="dial__track" cx={CENTER} cy={CENTER} r={RING_RADIUS} />
        <circle
          className="dial__progress"
          cx={CENTER}
          cy={CENTER}
          r={RING_RADIUS}
          pathLength={1}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
        {Array.from({ length: ticks }, (_, index) => {
          const angle = (index / ticks) * 2 * Math.PI - Math.PI / 2;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          return (
            <line
              key={index}
              className="dial__tick"
              data-lit={index < lit}
              x1={CENTER + TICK_INNER * cos}
              y1={CENTER + TICK_INNER * sin}
              x2={CENTER + TICK_OUTER * cos}
              y2={CENTER + TICK_OUTER * sin}
            />
          );
        })}
      </svg>
      <div className="dial__center">{children}</div>
    </div>
  );
}
