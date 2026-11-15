import { useFeedbackFrame } from '../../engine';
import type { BeatFrameProps, MoveBurstProps } from './types';
import './reactions.css';

/**
 * The beat, on the edge of the picture: the whole frame lights on every beat
 * in the colour of the phase (cyan to reach, gold to hold) and burns brighter
 * while the player is in the pose. The moment a phase starts, the edge takes
 * one harder hit, so "hold now" and "let go" are seen without reading
 * anything. It is all edge: nothing is drawn over the player.
 *
 * The beat itself is --pulse, which the Play screen writes on the HUD every
 * frame from the audio clock, so the light is on the music, not on a timer.
 */
export function BeatFrame({ frames }: BeatFrameProps) {
  const phase = useFeedbackFrame((frame) => frame?.phase ?? 'ready', frames);
  return (
    <>
      <div className="hud-frame" data-phase={phase} aria-hidden="true" />
      {/* Keyed by the phase, so it is a new element, and its one-shot animation runs, each time the phase changes. */}
      <div key={phase} className="hud-frame hud-frame--hit" data-phase={phase} aria-hidden="true" />
    </>
  );
}

/**
 * A finished move: the picture's edge flashes in the grade's colour, the glow
 * spilling into the rails, and the grade lands large at the top of the
 * picture for under a second before it drops away. The phase tag keeps the
 * grade and its score for the rest of the release.
 *
 * Keyed by the result's serial, so the same grade twice in a row still fires.
 */
export function MoveBurst({ result }: MoveBurstProps) {
  if (!result) return null;
  return (
    <div key={result.serial} className="hud-burst" data-label={result.label} aria-hidden="true">
      <span className="hud-burst__wash" />
      <span className="hud-burst__word display">{result.label}</span>
    </div>
  );
}
