/** The longest display name the profile menu saves. The database allows 40, for names from Google. */
export const MAX_DISPLAY_NAME = 20;

export type DisplayNameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * A name typed in the profile menu, ready to save: trimmed, with runs of
 * whitespace folded to one space, 1 to 20 characters. Characters are counted
 * as code points, the way Postgres counts char_length.
 */
export function validateDisplayName(raw: string): DisplayNameCheck {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length === 0) return { ok: false, error: 'Enter a name.' };
  if ([...name].length > MAX_DISPLAY_NAME) return { ok: false, error: `${MAX_DISPLAY_NAME} characters at most.` };
  return { ok: true, name };
}
