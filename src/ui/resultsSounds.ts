import { useEffect } from 'react';
import { playSfx } from '../audio/sfx';

export interface ResultsSoundsInput {
  /** Stars earned, 0 to MAX_STARS. */
  stars: number;
  /** Whether the run had any scored moves. */
  scored: boolean;
  /** Whether the run took the player up a level. */
  leveledUp: boolean;
}

// In time with the Results screen's arrival timeline (seconds from mount).
const GRADE_AT = 0.12;
const STARS_AT = 0.5;
const STAR_GAP = 0.18;
const COUNT_FROM = 0.2;
const COUNT_UNTIL = 1.35;
const TICK_GAP = 0.07;
const LEVEL_AT = 1.8;

/**
 * The Results screen's sounds, timed to its animation: a ta-da, the grade
 * slamming down, a chime per star climbing the scale, ticks while the
 * numbers roll up, and a fanfare when the XP bar levels up.
 */
export function useResultsSounds({ stars, scored, leveledUp }: ResultsSoundsInput): void {
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (seconds: number, play: () => void) => timers.push(setTimeout(play, seconds * 1000));

    if (scored) at(0, () => playSfx('fanfare'));
    at(GRADE_AT, () => playSfx('slam'));
    for (let index = 0; index < stars; index++) {
      at(STARS_AT + index * STAR_GAP, () => playSfx('star', { step: index }));
    }
    if (scored) {
      for (let t = COUNT_FROM; t < COUNT_UNTIL; t += TICK_GAP) at(t, () => playSfx('tick', { volume: 0.7 }));
    }
    if (leveledUp) at(LEVEL_AT, () => playSfx('levelUp'));

    return () => timers.forEach(clearTimeout);
    // Once per Results screen: the run it shows does not change while it is up.
  }, []);
}
