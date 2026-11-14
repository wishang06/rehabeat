/** A problem to show the user as a plain message (no stack trace), ending with exit code 1. */
export class SongToolError extends Error {
  override name = 'SongToolError';
}

/** The command line was wrong: the message is followed by the usage text. */
export class UsageError extends SongToolError {
  override name = 'UsageError';
}

/** The user pressed Ctrl+C or Esc at a prompt. Not an error: nothing is written. */
export class CancelledError extends Error {
  override name = 'CancelledError';
  constructor(message = 'Cancelled.') {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
