/**
 * The generated part of public/CREDITS.md. Everything outside the two markers is the
 * team's hand-written text and is never changed; everything between them is rewritten
 * from index.json and the songs' meta.json on every add, remove and move.
 */
import { LICENCES, sourceSite, type SongMeta } from '../../src/songs/model';
import { SongToolError } from './errors';

export const CREDITS_START = '<!-- songs:start -->';
export const CREDITS_END = '<!-- songs:end -->';

export interface CreditsEntry {
  song: SongMeta;
  catalogueName: string;
}

/** Escapes the characters that would turn plain text into Markdown formatting or break a table cell. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|]/g, (char) => `\\${char}`);
}

function link(text: string, url: string): string {
  return `[${escapeMarkdown(text)}](${url.replace(/[()\s]/g, (char) => encodeURIComponent(char))})`;
}

/** The section, markers included, for songs in catalogue order. */
export function renderCreditsSection(entries: readonly CreditsEntry[], eol = '\n'): string {
  const lines = [
    CREDITS_START,
    '## Song library',
    '',
    'Every song in `public/songs/`, written by `npm run songs`: it rewrites this section on every',
    'add, remove or move, so change the songs with that command rather than here.',
    '',
  ];
  if (entries.length === 0) {
    lines.push('No songs in the library yet.');
  } else {
    lines.push('| Song | Artist | Catalogue | Licence | Source |', '| --- | --- | --- | --- | --- |');
    for (const { song, catalogueName } of entries) {
      const licence = LICENCES[song.licence];
      lines.push(
        `| ${escapeMarkdown(song.title)} | ${escapeMarkdown(song.artist)} | ${escapeMarkdown(catalogueName)} | ` +
          `${link(licence.name, licence.url)} | ${link(sourceSite(song.sourceUrl), song.sourceUrl)} |`,
      );
    }
    lines.push('', 'Credit lines, as the game shows them:', '');
    for (const { song } of entries) {
      lines.push(`- \`${song.id}\`: ${escapeMarkdown(song.creditLine)}`);
    }
  }
  lines.push(CREDITS_END);
  return lines.join(eol);
}

/**
 * Puts the section into a CREDITS.md. Replaces the text between the markers when both are
 * there; appends the section at the end when neither is; refuses a file with only one, or
 * with them out of order, rather than guess which hand-written text is safe to replace.
 * `existing` null means the file does not exist yet.
 */
export function upsertCreditsSection(existing: string | null, entries: readonly CreditsEntry[]): string {
  if (existing === null) {
    return `# Music credits\n\n${renderCreditsSection(entries)}\n`;
  }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  const section = renderCreditsSection(entries, eol);
  const start = existing.indexOf(CREDITS_START);
  const end = existing.indexOf(CREDITS_END);

  if (start === -1 && end === -1) {
    if (existing.trim() === '') return `${section}${eol}`;
    const gap = existing.endsWith(eol) ? eol : `${eol}${eol}`;
    return `${existing}${gap}${section}${eol}`;
  }
  const twice =
    (start !== -1 && existing.indexOf(CREDITS_START, start + 1) !== -1) ||
    (end !== -1 && existing.indexOf(CREDITS_END, end + 1) !== -1);
  if (start === -1 || end === -1 || end < start || twice) {
    throw new SongToolError(
      `public/CREDITS.md has a broken generated section: it needs exactly one ${CREDITS_START} ` +
        `followed by one ${CREDITS_END}. Fix the markers by hand, then run the command again.`,
    );
  }
  return existing.slice(0, start) + section + existing.slice(end + CREDITS_END.length);
}
