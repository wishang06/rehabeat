export type ErrorSink = (message: string, error?: unknown) => void;

/** Distinct messages logged before the logger goes quiet. */
export const MAX_DISTINCT_ERRORS = 20;

/**
 * Returns a logger for errors thrown inside a per-frame loop. Each distinct
 * message is reported once, so one recurring failure cannot flood the console
 * at 30 messages a second. Messages that embed changing values would defeat
 * that, hence the cap on distinct messages.
 */
export function createErrorLogger(
  sink: ErrorSink = (message, error) => console.error(message, error),
  maxDistinct: number = MAX_DISTINCT_ERRORS,
): (error: unknown) => void {
  const seen = new Set<string>();
  return (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (seen.has(message) || seen.size >= maxDistinct) return;
    seen.add(message);
    sink(`[pose] ${message}`, error);
    if (seen.size === maxDistinct) {
      sink(`[pose] ${maxDistinct} distinct errors logged; further errors are not shown`);
    }
  };
}
