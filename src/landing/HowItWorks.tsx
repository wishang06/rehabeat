import { useRef, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { ARM_REST, Figure, armAngle } from '@/components/Figure';
import { BEAT, MOTION_OK, MOVE_BEATS, MOVE_LENGTH, gsap, moveArms, playWhileVisible } from './motion';

const HOLD_START = MOVE_BEATS.reach * BEAT;
const HOLD_END = (MOVE_BEATS.reach + MOVE_BEATS.hold) * BEAT;

/** One step of the instruction card: an LED number, a small moving picture, a heading and a sentence. */
function Step({ number, title, text, children }: { number: number; title: string; text: string; children: ReactNode }) {
  return (
    <li className="lp-step slab" data-reveal={60 + number * 20}>
      <span className="lp-step__n led" aria-hidden="true">
        {number}
      </span>
      <div className="lp-step__pic" data-picture aria-hidden="true">
        {children}
      </div>
      <h3 className="display">{title}</h3>
      <p>{text}</p>
    </li>
  );
}

/**
 * "How it works" as the instruction card on an arcade cabinet: three numbered
 * steps. Each picture loops one move at the hero's tempo, and only while it
 * is on screen.
 */
export function HowItWorks() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const scope = root.current;
      if (!scope) return;
      const [back, match, music] = gsap.utils.toArray<HTMLElement>('[data-picture]', scope);

      gsap.matchMedia().add(MOTION_OK, () => {
        // 1. Stand back: the figure backs away from the laptop over the reach.
        const steps = gsap.timeline({ repeat: -1 });
        steps
          .fromTo(
            back.querySelector('.fig'),
            { x: -60 },
            { x: 0, duration: 2 * BEAT, ease: 'power3.out', immediateRender: false },
            0.4,
          )
          .set({}, {}, MOVE_LENGTH);
        playWhileVisible(steps, back);

        // 2. Match: the player's figure follows the gold one a moment behind.
        const follow = gsap.timeline({ repeat: -1 });
        const [you, target] = gsap.utils.toArray<SVGElement>('.fig', match);
        moveArms(follow, target, ARM_REST, armAngle('side'));
        moveArms(follow, you, ARM_REST, armAngle('side'), 0.3);
        follow.set({}, {}, MOVE_LENGTH + 0.3);
        playWhileVisible(follow, match);

        // 3. Music: the meter only stands up while the pose is held.
        const song = gsap.timeline({ repeat: -1 });
        const meter = music.querySelector('.lp-meter');
        moveArms(song, music.querySelector('.fig'), ARM_REST, armAngle('overhead'));
        song
          .set(meter, { scaleY: 0.1 }, 0)
          .to(meter, { scaleY: 1, duration: 0.25, ease: 'power3.out' }, HOLD_START)
          .to(meter, { scaleY: 0.1, duration: 0.25, ease: 'power3.in' }, HOLD_END)
          .set({}, {}, MOVE_LENGTH);
        playWhileVisible(song, music);
        const bars = gsap.fromTo(
          music.querySelectorAll('.lp-meter i'),
          { clipPath: 'inset(50% 0 0)' },
          {
            clipPath: 'inset(0% 0 0)',
            duration: BEAT / 2,
            ease: 'steps(4)',
            repeat: -1,
            yoyo: true,
            stagger: { each: 0.09, from: 'random' },
          },
        );
        playWhileVisible(bars, music);
      });
    },
    { scope: root },
  );

  return (
    <section id="how" ref={root} className="lp-how">
      <h2 className="display">How it works</h2>
      <ol className="lp-steps">
        <Step
          number={1}
          title="Stand back"
          text="About two metres from your laptop, so the camera can see all of you."
        >
          <span className="lp-laptop" />
          <span className="lp-dist led">2M</span>
          <Figure />
        </Step>

        <Step
          number={2}
          title="Match the gold figure on the beat"
          text="Reach, hold, release. Every move lands on the music."
        >
          <Figure pose="side" className="lp-you" />
          <Figure pose="side" className="lp-target" />
        </Step>

        <Step
          number={3}
          title="The music swells while your form holds"
          text="Drop the pose and the melody fades back. Find it again and it swells."
        >
          <span className="lp-meter">
            {[100, 66, 100, 82, 54].map((height, index) => (
              <i key={index} style={{ height: `${height}%` }} />
            ))}
          </span>
          <Figure pose="overhead" />
        </Step>
      </ol>
    </section>
  );
}
