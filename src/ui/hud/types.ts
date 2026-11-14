/**
 * Every prop type of the play HUD, in one place.
 *
 * The HUD has two inputs. Per-frame data is the engine's FeedbackFrame, read
 * from a FeedbackStore: the real `feedbackStore` on the Play screen, a mock
 * one (src/ui/mockFeedback.ts) in the preview and in tests. Per-move data is
 * a HudRun, built from the scoring engine's stats.
 */
import type { Ref } from 'react';
import type { FeedbackStore } from '../../engine';
import type { BeatLabel, Move } from '../../types';
import type { FeedbackFrame, FeedbackPhase, MoveRef } from '../../types/ui';

export type { FeedbackFrame, FeedbackPhase, FeedbackStore, MoveRef };

/** The outcome of the last scored move. */
export interface HudResult {
  /** Counts up with every scored move, so the same label twice in a row still pops twice. */
  serial: number;
  label: BeatLabel;
  /** 0-100. */
  score: number;
  /** "In time", "0.4 s late", or null for a Miss. */
  timing: string | null;
}

/** The run so far: what has been scored, as opposed to what the player is doing this frame. */
export interface HudRun {
  points: number;
  /** Moves in a row that were not a Miss. */
  combo: number;
  /** Perfects in a row. */
  perfectStreak: number;
  /** Mean move score, 0-100, or null before the first move is scored. */
  accuracy: number | null;
  /** 1-based position in the routine, or 0 during the count-in. */
  moveNumber: number;
  moveCount: number;
  /** The round of a program session, or null in free play. */
  round: { current: number; total: number } | null;
  result: HudResult | null;
  /** A form cue from the scoring engine ("Keep your shoulders down"), or null. */
  formNote: string | null;
  /** True when the camera has not seen the player for a while. */
  bodyLost: boolean;
  /** "Ease off your right shoulder" while a limited joint is past its limit, or null. */
  easeOff: string | null;
}

export interface PlayHudProps {
  frames: FeedbackStore;
  run: HudRun;
  /** The moves being played, for the move cards' figures. A program's moves can differ from moves.json. */
  moves?: readonly Move[];
  /** The Play screen writes --pulse, --progress and --match on this element once per frame. */
  ref?: Ref<HTMLDivElement>;
}

/** The phase word, the beat pips under it and the count-in number. */
export interface PhaseCueProps {
  frames: FeedbackStore;
}

/** The current move and the one after it. */
export interface MoveCardsProps {
  frames: FeedbackStore;
  moveNumber: number;
  moveCount: number;
  round: HudRun['round'];
  moves: readonly Move[];
}

/** The match score as a ring, with marks at Good and Perfect. */
export interface HoldRingProps {
  frames: FeedbackStore;
}

export interface ResultPopProps {
  result: HudResult | null;
  /** The pop stays up through the release that follows the move it scored. */
  frames: FeedbackStore;
}

export interface ComboCounterProps {
  combo: number;
}

export interface RunStatsProps {
  points: number;
  accuracy: number | null;
  perfectStreak: number;
}

/**
 * "Step back": shown on low visibility, or when the player has left the
 * picture. Otherwise "Ease off" for a joint past its limit, and failing
 * that the form cue, if any.
 */
export interface StepBackBannerProps {
  frames: FeedbackStore;
  bodyLost: boolean;
  easeOff: string | null;
  formNote: string | null;
}

export interface FormNoteProps {
  note: string | null;
}
