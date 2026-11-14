/**
 * Motion shared by the landing page sections. Everything here is GSAP on DOM
 * and SVG; nothing touches a canvas. Each helper is a no-op for a visitor who
 * asked for reduced motion: the page then shows its resting state.
 *
 * The house move is the lane: things ride in along the slant and flash for a
 * frame as they land.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/** The landing page has no music, so it keeps time at the tempo of the default song, Past Sadness. */
export const BEAT = 60 / 72;
/** One move: two beats to reach, four to hold, two to release. */
export const MOVE_BEATS = { reach: 2, hold: 4, release: 2 } as const;
export const MOVE_LENGTH = (MOVE_BEATS.reach + MOVE_BEATS.hold + MOVE_BEATS.release) * BEAT;

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

/** Rides `target` in along the slant at `at` seconds, with a flash as it lands. */
export function laneIn(
  timeline: gsap.core.Timeline,
  target: gsap.TweenTarget,
  at: number,
  distance = 40,
): gsap.core.Timeline {
  return timeline
    .fromTo(
      target,
      { autoAlpha: 0, x: distance, skewX: -20 },
      { autoAlpha: 1, x: 0, skewX: 0, duration: 0.1, ease: 'power2.out', immediateRender: false },
      at,
    )
    .fromTo(
      target,
      { filter: 'brightness(2.4)' },
      { filter: 'brightness(1)', duration: 0.16, ease: 'none', immediateRender: false },
      at + 0.1,
    );
}

/** Lights `target` for the beat that starts at `at`: a hard on with a flash, no travel. */
export function flashOn(timeline: gsap.core.Timeline, target: gsap.TweenTarget, at: number): gsap.core.Timeline {
  return timeline
    .set(target, { autoAlpha: 1 }, at)
    .fromTo(
      target,
      { filter: 'brightness(2.4)' },
      { filter: 'brightness(1)', duration: 0.14, ease: 'none', immediateRender: false },
      at,
    );
}

/**
 * Arms from rest to the pose and back over one move, on a figure whose arm
 * angles are the custom properties --arm-l and --arm-r.
 */
export function moveArms(
  timeline: gsap.core.Timeline,
  figure: gsap.TweenTarget,
  rest: number,
  pose: number,
  offset = 0,
): gsap.core.Timeline {
  const reach = MOVE_BEATS.reach * BEAT;
  const release = MOVE_BEATS.release * BEAT;
  return timeline
    .fromTo(
      figure,
      { '--arm-l': rest, '--arm-r': rest },
      { '--arm-l': pose, '--arm-r': pose, duration: reach, ease: 'power2.inOut', immediateRender: false },
      offset,
    )
    .to(
      figure,
      { '--arm-l': rest, '--arm-r': rest, duration: release, ease: 'power2.inOut' },
      offset + reach + MOVE_BEATS.hold * BEAT,
    );
}

/**
 * Rides each `[data-reveal]` inside `scope` in as it scrolls into view, once.
 * The attribute's value is the distance in pixels (negative comes from the left).
 */
export function revealOnScroll(scope: Element): void {
  for (const element of scope.querySelectorAll<HTMLElement>('[data-reveal]')) {
    const distance = Number(element.dataset.reveal) || 70;
    gsap.from(element, {
      x: distance,
      autoAlpha: 0,
      duration: 0.42,
      ease: 'power3.out',
      scrollTrigger: { trigger: element, start: 'top 88%', once: true },
    });
  }
}

/** Plays a looping animation only while its trigger is on screen. */
export function playWhileVisible(animation: gsap.core.Animation, trigger: Element): void {
  animation.pause();
  ScrollTrigger.create({
    trigger,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => (self.isActive ? animation.play() : animation.pause()),
  });
}

export { gsap, ScrollTrigger };
