import { describe, expect, it } from 'vitest';
import { parseIndex, parseMeta } from './library';
import { CATALOGUES, STEMS_NOTE, buildCreditLine, jitterMs } from './model';

/*
 * Checks the library shipped in public/songs/ the way the game will read it,
 * so a hand edit or a half-finished `npm run songs` cannot slip through.
 */

const indexJson = Object.values(
  import.meta.glob<unknown>('/public/songs/index.json', { eager: true, import: 'default' }),
)[0];
const metas = import.meta.glob<unknown>('/public/songs/*/meta.json', { eager: true, import: 'default' });
const beatmaps = import.meta.glob<{ bpm: number; beats: number[] }>('/public/songs/*/beatmap.json', {
  eager: true,
  import: 'default',
});
const credits = Object.values(
  import.meta.glob<string>('/public/CREDITS.md', { eager: true, query: '?raw', import: 'default' }),
)[0];
// Not eager: only the file names are needed.
const stems = Object.keys(import.meta.glob('/public/songs/*/*.mp3'));

const folderOf = (path: string) => path.split('/')[3];

describe('the shipped song library', () => {
  const index = parseIndex(indexJson);
  const listed = index.catalogues.flatMap((catalogue) =>
    catalogue.songIds.map((songId) => ({ songId, catalogue: catalogue.id })),
  );

  it('has the three catalogues, in tempo order', () => {
    expect(index.catalogues.map((catalogue) => catalogue.id)).toEqual(CATALOGUES.map((catalogue) => catalogue.id));
  });

  it('starts with Past Sadness in Steady Flow', () => {
    expect(listed).toContainEqual({ songId: 'past-sadness', catalogue: 'steady-flow' });
  });

  it('lists every song folder, and has a folder for every song it lists', () => {
    const folders = Object.keys(metas).map(folderOf).sort();
    expect(listed.map((entry) => entry.songId).sort()).toEqual(folders);
  });

  describe.each(listed)('$songId', ({ songId, catalogue }) => {
    const meta = parseMeta(metas[`/public/songs/${songId}/meta.json`], songId);

    it('has a valid meta.json in the catalogue that lists it', () => {
      expect(meta.catalogue).toBe(catalogue);
    });

    it('has a beatmap and both stems', () => {
      expect(beatmaps[`/public/songs/${songId}/beatmap.json`]?.beats.length).toBeGreaterThan(8);
      expect(stems).toContain(`/public/songs/${songId}/drums.mp3`);
      expect(stems).toContain(`/public/songs/${songId}/melody.mp3`);
    });

    it('credits the song in full, including the stem separation', () => {
      expect(meta.creditLine).toContain(`"${meta.title}" by ${meta.artist}`);
      expect(meta.creditLine).toContain(STEMS_NOTE);
      expect(meta.creditLine).toBe(buildCreditLine(meta));
    });

    it("is listed with its credit line in CREDITS.md's song library section", () => {
      const section = credits.slice(credits.indexOf('<!-- songs:start -->'), credits.indexOf('<!-- songs:end -->'));
      expect(section).toContain(`\`${songId}\`: ${meta.creditLine}`);
      expect(section).toContain(meta.sourceUrl);
    });

    it('has a steady beat grid (jitter under 10 ms)', () => {
      expect(jitterMs(beatmaps[`/public/songs/${songId}/beatmap.json`].beats)).toBeLessThan(10);
    });

    it("gives the beatmap's tempo, in a catalogue that exists", () => {
      const beatmap = beatmaps[`/public/songs/${songId}/beatmap.json`];
      expect(meta.bpm).toBeCloseTo(beatmap.bpm, 0);
      expect(CATALOGUES.map((definition) => definition.id)).toContain(meta.catalogue);
    });
  });
});
