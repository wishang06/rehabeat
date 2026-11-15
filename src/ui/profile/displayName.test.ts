import { describe, expect, it } from 'vitest';
import { MAX_DISPLAY_NAME, validateDisplayName } from './displayName';

describe('validateDisplayName', () => {
  it('allows up to 20 characters', () => {
    expect(MAX_DISPLAY_NAME).toBe(20);
  });

  it('trims the name it accepts', () => {
    expect(validateDisplayName('  Maya  ')).toEqual({ ok: true, name: 'Maya' });
  });

  it('folds runs of spaces inside the name into one', () => {
    expect(validateDisplayName('Leo \t  Park')).toEqual({ ok: true, name: 'Leo Park' });
  });

  it('refuses an empty name, or one of only spaces', () => {
    expect(validateDisplayName('')).toEqual({ ok: false, error: 'Enter a name.' });
    expect(validateDisplayName('   \n ')).toEqual({ ok: false, error: 'Enter a name.' });
  });

  it('accepts exactly 20 characters and refuses 21', () => {
    expect(validateDisplayName('a'.repeat(20))).toEqual({ ok: true, name: 'a'.repeat(20) });
    expect(validateDisplayName('a'.repeat(21))).toEqual({ ok: false, error: '20 characters at most.' });
  });

  it('counts the length after trimming', () => {
    expect(validateDisplayName(`  ${'b'.repeat(20)}  `)).toEqual({ ok: true, name: 'b'.repeat(20) });
  });

  it('counts an emoji as one character, as Postgres does', () => {
    expect(validateDisplayName('🔥'.repeat(20)).ok).toBe(true);
    expect(validateDisplayName('🔥'.repeat(21)).ok).toBe(false);
  });
});
