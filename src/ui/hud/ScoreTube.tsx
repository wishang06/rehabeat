import { useCallback, useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useSpring } from 'motion/react';
import { playSfx } from '../../audio/sfx';
import { MAX_STARS, STAR_THRESHOLDS, scoreFraction, starsForFraction } from '../../progress';
import type { HudResult } from './types';
import './tube.css';

interface ScoreTubeProps {
  /** The run's points so far. */
  points: number;
  /** The most the run can score: the tube is full here. */
  maxPoints: number;
  /** The last scored move: a new one sends its points flying into the tube. */
  result: HudResult | null;
}

interface Point {
  x: number;
  y: number;
}

/** "+points" on its way from the move's label into the tube. */
interface Flyer {
  id: number;
  amount: number;
  from: Point;
  to: Point;
  /** The fill to spring to when it lands. */
  target: number;
}

/** Underdamped, so the fill overshoots a little and settles. */
const FILL_SPRING = { stiffness: 220, damping: 14, mass: 0.9 };
const FLIGHT_SEC = 0.7;

/** Centre of an element, in the HUD's own coordinates. */
function centreIn(hud: DOMRect, element: Element | null): Point | null {
  const box = element?.getBoundingClientRect();
  if (!box || box.width === 0) return null;
  return { x: box.left + box.width / 2 - hud.left, y: box.top + box.height / 2 - hud.top };
}

/**
 * The score tube: a tall meter on the left edge of the play HUD, filling
 * from the bottom with the run's points as a share of the most it can score.
 * Its five star marks sit at the results screen's star thresholds
 * (STAR_THRESHOLDS), so the two always agree; each lights with a burst and a
 * chime as the fill passes it, and with all five the tube turns gold and
 * pulses on the beat (--pulse, written from the audio clock). A scored move's
 * points fly in from its PERFECT or GOOD label, then the fill springs up. A
 * Miss adds nothing and nothing drains. DOM only, never the canvas.
 */
export function ScoreTube({ points, maxPoints, result }: ScoreTubeProps) {
  const reduced = useReducedMotion() ?? false;
  const target = scoreFraction(points, maxPoints);
  const tube = useRef<HTMLDivElement>(null);
  const fill = useSpring(target, FILL_SPRING);
  /** Where the fill is headed: stars light as the fill passes them on its way here, not on the overshoot. */
  const landed = useRef(target);
  const [lit, setLit] = useState(() => starsForFraction(target));
  const litRef = useRef(lit);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const seen = useRef({ serial: result?.serial ?? 0, points });

  const lightUpTo = useCallback((fraction: number) => {
    const stars = starsForFraction(Math.min(fraction, landed.current));
    if (stars <= litRef.current) return;
    for (let step = litRef.current; step < stars; step++) playSfx('star', { step });
    litRef.current = stars;
    setLit(stars);
  }, []);

  const land = useCallback(
    (to: number) => {
      landed.current = Math.max(landed.current, to);
      if (reduced) {
        fill.jump(landed.current);
        lightUpTo(landed.current);
      } else fill.set(landed.current);
    },
    [fill, lightUpTo, reduced],
  );

  useMotionValueEvent(fill, 'change', lightUpTo);

  // A newly scored move: fly its points in, or with reduced motion just fill.
  useEffect(() => {
    const serial = result?.serial ?? 0;
    const before = seen.current;
    if (serial === before.serial && points === before.points) return;
    seen.current = { serial, points };
    const gained = points - before.points;
    const hud = tube.current?.closest('.hud');
    if (gained <= 0) return;
    if (reduced || !hud || !result || result.label === 'Miss') return land(target);

    const box = hud.getBoundingClientRect();
    const from = centreIn(box, hud.querySelector('.hud-pop__word')) ?? { x: box.width / 2, y: box.height * 0.45 };
    const track = tube.current?.getBoundingClientRect();
    const to = track
      ? { x: track.left + track.width / 2 - box.left, y: track.bottom - track.height * target - box.top }
      : { x: 0, y: box.height / 2 };
    setFlyers((shown) => [...shown, { id: serial, amount: gained, from, to, target }]);
  }, [result, points, target, reduced, land]);

  // Each mark lit, and the tube SUPERSTAR with all five.
  const superstar = lit >= MAX_STARS;

  if (maxPoints <= 0) return null;
  return (
    <>
      <div
        className="tube"
        data-super={superstar}
        data-testid="score-tube"
        data-fill={target.toFixed(3)}
        data-stars={lit}
        role="img"
        aria-label={`Score: ${lit} of ${MAX_STARS} stars${superstar ? ', superstar' : ''}`}
      >
        <span className="tube__super display" aria-hidden="true">
          Superstar
        </span>
        <div className="tube__track" ref={tube}>
          <motion.div className="tube__fill" style={{ scaleY: fill }} />
          <div className="tube__glow" />
        </div>
        <ol className="tube__marks" aria-hidden="true">
          {STAR_THRESHOLDS.map((threshold, index) => (
            <li key={threshold} className="tube__mark" data-lit={index < lit} style={{ bottom: `${threshold * 100}%` }}>
              <i className="tube__tick" />
              <span className="tube__star">
                <Star fill="currentColor" strokeWidth={0} />
                <i className="tube__burst" />
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="tube-flyers" aria-hidden="true">
        <AnimatePresence>
          {flyers.map((flyer) => (
            <motion.span
              key={flyer.id}
              className="tube-flyer led"
              initial={{ x: flyer.from.x, y: flyer.from.y, scale: 1.25, opacity: 0 }}
              animate={{
                x: [flyer.from.x, flyer.from.x, flyer.to.x],
                y: [flyer.from.y, flyer.from.y - 56, flyer.to.y],
                scale: [1.25, 1.1, 0.55],
                opacity: [0, 1, 0.9],
              }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={{ duration: FLIGHT_SEC, times: [0, 0.3, 1], ease: ['easeOut', 'easeIn'] }}
              onAnimationComplete={() => {
                setFlyers((shown) => shown.filter((item) => item.id !== flyer.id));
                land(flyer.target);
              }}
            >
              +{flyer.amount.toLocaleString()}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
}
