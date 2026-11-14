import { describe, expect, it } from 'vitest';
import { CREDITS_END, CREDITS_START, escapeMarkdown, renderCreditsSection, upsertCreditsSection, type CreditsEntry } from './credits';
import { sampleMeta, TEAM_CREDITS } from './testing/fakes';

const pastSadness: CreditsEntry = { song: sampleMeta({ id: 'past-sadness' }), catalogueName: 'Steady Flow' };
const other: CreditsEntry = {
  song: sampleMeta({
    id: 'dirty-shoes-blues',
    title: 'Dirty shoes blues',
    artist: 'Loyalty Freak Music',
    licence: 'CC0-1.0',
    sourceUrl: 'https://freemusicarchive.org/music/Loyalty_Freak_Music/x',
  }),
  catalogueName: 'Calm Stretch',
};

describe('renderCreditsSection', () => {
  it('lists every song with its licence link, source link and credit line, between the markers', () => {
    const section = renderCreditsSection([pastSadness, other]);
    const lines = section.split('\n');
    expect(lines[0]).toBe(CREDITS_START);
    expect(lines.at(-1)).toBe(CREDITS_END);
    expect(section).toContain(
      '| Past Sadness | Kevin MacLeod | Steady Flow | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | ' +
        '[incompetech.com](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007) |',
    );
    expect(section).toContain('[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)');
    expect(section).toContain('[freemusicarchive.org](https://freemusicarchive.org/music/Loyalty_Freak_Music/x)');
    expect(section).toContain(`- \`past-sadness\`: ${pastSadness.song.creditLine}`);
    expect(section).toContain('- `dirty-shoes-blues`: "Dirty shoes blues" by Loyalty Freak Music (freemusicarchive.org), CC0 1.0.');
    expect(section.indexOf('Past Sadness')).toBeLessThan(section.indexOf('Dirty shoes blues')); // given order
  });

  it('says so when the library is empty', () => {
    expect(renderCreditsSection([])).toContain('No songs in the library yet.');
  });

  it('escapes Markdown in titles so a | cannot break the table', () => {
    expect(escapeMarkdown('A | B *c* [d] <e> _f_')).toBe('A \\| B \\*c\\* \\[d\\] \\<e\\> \\_f\\_');
    const odd = { song: sampleMeta({ id: 'odd', title: 'Pipe | Dream' }), catalogueName: 'Steady Flow' };
    expect(renderCreditsSection([odd])).toContain('| Pipe \\| Dream |');
  });
});

describe('upsertCreditsSection', () => {
  it("appends the section when the markers are missing, leaving the team's text as it was", () => {
    const next = upsertCreditsSection(TEAM_CREDITS, [pastSadness]);
    expect(next.startsWith(TEAM_CREDITS)).toBe(true);
    expect(next.slice(TEAM_CREDITS.length)).toBe(`\n${renderCreditsSection([pastSadness])}\n`);
  });

  it('adds a blank line before the section when the file does not end with a newline', () => {
    expect(upsertCreditsSection('# Credits', [])).toBe(`# Credits\n\n${renderCreditsSection([])}\n`);
  });

  it('replaces only what is between the markers, keeping the text before and after', () => {
    const before = `${TEAM_CREDITS}\n`;
    const after = '\n\n## Notes written after the section\n\nStill mine.\n';
    const file = `${before}${CREDITS_START}\nold generated text\n${CREDITS_END}${after}`;
    const next = upsertCreditsSection(file, [pastSadness, other]);
    expect(next).toBe(`${before}${renderCreditsSection([pastSadness, other])}${after}`);
    // Running it again changes nothing.
    expect(upsertCreditsSection(next, [pastSadness, other])).toBe(next);
  });

  it('keeps Windows line endings when the file has them', () => {
    const file = TEAM_CREDITS.replace(/\n/g, '\r\n');
    const next = upsertCreditsSection(file, [pastSadness]);
    expect(next.startsWith(file)).toBe(true);
    expect(next.slice(file.length).replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('creates the file when there is none', () => {
    expect(upsertCreditsSection(null, [pastSadness])).toBe(`# Music credits\n\n${renderCreditsSection([pastSadness])}\n`);
  });

  it('refuses broken markers instead of guessing', () => {
    expect(() => upsertCreditsSection(`a\n${CREDITS_START}\nb`, [])).toThrow(/broken generated section/);
    expect(() => upsertCreditsSection(`${CREDITS_END}\n${CREDITS_START}`, [])).toThrow(/broken/);
    expect(() => upsertCreditsSection(`${CREDITS_START}${CREDITS_END}${CREDITS_START}${CREDITS_END}`, [])).toThrow(/broken/);
  });
});
