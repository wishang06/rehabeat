import type { FormMetrics } from '../types';

/** A rule only counts once it has held continuously for longer than this. */
export const FORM_PERSIST_MS = 500;
/** Sideways trunk tilt, in degrees, beyond which the trunk-lean rule applies. */
export const TRUNK_LEAN_LIMIT_DEG = 15;
/**
 * How far the ear-to-shoulder distance must shrink below the calibration
 * baseline, as a fraction, before the shoulder-shrug rule applies.
 */
export const SHRUG_DROP_FRACTION = 0.2;

export interface FormContext {
  /** FormMetrics.shoulderEarRatio measured at rest during calibration, or null if never measured. */
  shoulderEarBaseline: number | null;
}

interface FormRule {
  /** Form guidance shown to the player. Guidance, not a safety warning. */
  note: string;
  applies: (metrics: FormMetrics, context: FormContext) => boolean;
}

/** The rule ids a move may list in `formRules`. Ids not listed here are ignored. */
export const FORM_RULES: Readonly<Record<string, FormRule>> = {
  'trunk-lean': {
    note: 'Stay tall through your trunk instead of leaning to the side',
    applies: (metrics) =>
      metrics.trunkLeanDeg !== null && metrics.trunkLeanDeg > TRUNK_LEAN_LIMIT_DEG,
  },
  'shoulder-shrug': {
    note: 'Let your shoulders settle down, away from your ears',
    applies: (metrics, context) =>
      context.shoulderEarBaseline !== null &&
      metrics.shoulderEarRatio !== null &&
      metrics.shoulderEarRatio < context.shoulderEarBaseline * (1 - SHRUG_DROP_FRACTION),
  },
};

export function formNoteFor(ruleId: string): string | undefined {
  return FORM_RULES[ruleId]?.note;
}

/** Tracks how long each rule has applied without a break and reports the ones that persist. */
export class FormMonitor {
  private readonly since = new Map<string, number>();

  constructor(
    private readonly context: FormContext,
    private readonly persistMs = FORM_PERSIST_MS,
  ) {}

  /**
   * Feed one frame's metrics at time `t` (seconds) for the active move's rules.
   * Returns the rule ids that have now applied continuously for longer than
   * the persistence window, in the order given.
   */
  update(t: number, metrics: FormMetrics, ruleIds: readonly string[]): string[] {
    const flagged: string[] = [];
    for (const id of ruleIds) {
      const rule = FORM_RULES[id];
      if (!rule) continue;

      if (!rule.applies(metrics, this.context)) {
        this.since.delete(id);
        continue;
      }
      const start = this.since.get(id);
      if (start === undefined) {
        this.since.set(id, t);
      } else if ((t - start) * 1000 > this.persistMs) {
        flagged.push(id);
      }
    }
    return flagged;
  }

  reset(): void {
    this.since.clear();
  }
}
