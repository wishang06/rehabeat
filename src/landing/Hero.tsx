import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { Play } from 'lucide-react';
import { Link } from 'react-router';
import { ARM_REST, Figure, armAngle } from '@/components/Figure';
import { Button } from '@/components/ui/button';
import { BEAT, MOTION_OK, MOVE_BEATS, MOVE_LENGTH, flashOn, gsap, laneIn, moveArms } from './motion';

const PHASES = ['Reach', 'Hold', 'Release'] as const;
/** The beat each phase starts on. */
const PHASE_STARTS = [0, MOVE_BEATS.reach, MOVE_BEATS.reach + MOVE_BEATS.hold];
const BEATS = MOVE_BEATS.reach + MOVE_BEATS.hold + MOVE_BEATS.release;

const GLOW_ON_BEAT = 'drop-shadow(0 0 26px rgba(255, 210, 63, 0.95))';
const GLOW_AT_REST = 'drop-shadow(0 0 12px rgba(255, 210, 63, 0.5))';

/**
 * The attract screen: the headline, the one gold button, and the gold figure
 * doing an overhead raise in time with a silent beat. Without motion it rests
 * in the hold, arms up.
 */
export function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const scope = root.current;
      if (!scope) return;
      const figure = scope.querySelector('.fig');
      const words = gsap.utils.toArray<HTMLElement>('.lp-phase span', scope);
      const pips = gsap.utils.toArray<HTMLElement>('.lp-pips span', scope);

      gsap.matchMedia().add(MOTION_OK, () => {
        const loop = gsap.timeline({ repeat: -1 });
        moveArms(loop, figure, ARM_REST, armAngle('overhead'));
        words.forEach((word, index) => {
          const at = PHASE_STARTS[index] * BEAT;
          loop.set(words, { autoAlpha: 0 }, at);
          laneIn(loop, word, at);
        });
        pips.forEach((pip, index) => {
          const at = index * BEAT;
          loop.set(pips, { autoAlpha: 0 }, at);
          flashOn(loop, pip, at);
          // The tube flares on every beat and settles before the next.
          loop.fromTo(
            figure,
            { filter: GLOW_ON_BEAT },
            { filter: GLOW_AT_REST, duration: BEAT * 0.45, ease: 'none', immediateRender: false },
            at,
          );
        });
        // Pad to exactly one move so the loop stays on the beat.
        loop.set({}, {}, MOVE_LENGTH);
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="lp-hero">
      <div className="lp-lanes" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <h1 className="display">
        Your home stretching routine, <br className="max-md:hidden" />
        as a rhythm game
      </h1>

      <div className="lp-hero__copy">
        <p className="lp-lede">
          Stand back from your laptop, match the gold figure on the beat, and keep the music playing.
        </p>
        <Button asChild variant="gold" size="xl">
          <Link to="/play" data-testid="landing-play">
            <Play fill="currentColor" strokeWidth={0} className="size-[0.6em]" aria-hidden="true" />
            Play now
          </Link>
        </Button>

        <div className="lp-beat" aria-hidden="true">
          <p className="lp-phase">
            {PHASES.map((phase) => (
              <span key={phase} data-rest={phase === 'Hold' ? '' : undefined}>
                {phase}
              </span>
            ))}
          </p>
          <ol className="lp-pips">
            {Array.from({ length: BEATS }, (_, index) => (
              <li key={index} data-gap={index > 0 && PHASE_STARTS.includes(index) ? '' : undefined}>
                <span data-rest={index === MOVE_BEATS.reach ? '' : undefined} />
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="lp-hero__stage">
        <Figure pose="overhead" label="The gold figure raising both arms overhead in time with the beat" />
      </div>
    </section>
  );
}
