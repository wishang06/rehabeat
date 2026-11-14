/**
 * The calorie estimate: a published rate for gentle yoga and stretching,
 * times body weight, times the time played. It is an estimate for fun, not
 * a measurement.
 */

/**
 * Energy cost as a multiple of resting rate. The 2024 Adult Compendium of
 * Physical Activities lists both "yoga, Hatha" (02150) and "stretching,
 * mild" (02101) at 2.3 MET.
 */
export const STRETCH_MET = 2.3;

/** The weight used until the player enters their own. */
export const DEFAULT_WEIGHT_KG = 70;
export const MIN_WEIGHT_KG = 30;
export const MAX_WEIGHT_KG = 200;

export type WeightUnit = 'kg' | 'lb';

const KG_PER_LB = 0.45359237;

/** A body weight the estimate accepts. */
export function isWeightKg(value: unknown): value is number {
  return typeof value === 'number' && value >= MIN_WEIGHT_KG && value <= MAX_WEIGHT_KG;
}

/** Estimated kilocalories for `durationSec` of play. A null weight means the default. */
export function estimateKcal(durationSec: number, weightKg: number | null): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return (STRETCH_MET * (weightKg ?? DEFAULT_WEIGHT_KG) * durationSec) / 3600;
}

export type WeightReading = { ok: true; kg: number | null } | { ok: false };

/** Plain digits with at most one decimal point or comma: no signs, exponents or units. */
const WEIGHT_TEXT = /^\d+(?:[.,]\d+)?$/;

/**
 * Reads what was typed in the weight field. An empty field means "no
 * weight"; anything that is not a number in range is refused.
 */
export function readWeight(text: string, unit: WeightUnit): WeightReading {
  const typed = text.trim();
  if (typed === '') return { ok: true, kg: null };
  if (!WEIGHT_TEXT.test(typed)) return { ok: false };
  const value = Number(typed.replace(',', '.'));
  const kg = unit === 'lb' ? value * KG_PER_LB : value;
  return isWeightKg(kg) ? { ok: true, kg } : { ok: false };
}

/** A weight in the player's unit, to one decimal at most. */
export function showWeight(kg: number, unit: WeightUnit): string {
  const value = unit === 'lb' ? kg / KG_PER_LB : kg;
  return String(Math.round(value * 10) / 10);
}
