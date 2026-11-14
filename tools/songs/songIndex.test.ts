import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIndex, parseMeta } from '../../src/songs/library';
import { CATALOGUES, checkLicence, STEMS_NOTE } from '../../src/songs/model';
import { buildMeta, suggestCatalogue, suggestId, validateId } from './add';
import { SongToolError } from './errors';
import { CLI_REPO_ROOT } from './paths';
import { addToIndex, catalogueOf, defaultIndex, formatJson, listedIds, moveInIndex, removeFromIndex } from './songIndex';

const withSongs = () => {
  let index = defaultIndex();
  index = addToIndex(index, 'past-sadness', 'steady-flow');
  index = addToIndex(index, 'slow-one', 'calm-stretch');
  return index;
};

describe('the default index', () => {
  it('has the three catalogues from the shared model, empty, and passes parseIndex', () => {
    const index = defaultIndex();
    expect(index.catalogues.map((catalogue) => catalogue.id)).toEqual(CATALOGUES.map((catalogue) => catalogue.id));
    expect(index.catalogues.every((catalogue) => catalogue.songIds.length === 0)).toBe(true);
    expect(parseIndex(JSON.parse(formatJson(index)))).toEqual(index);
  });
});

describe('index.json updates', () => {
  it('appends a new song to the end of its catalogue and keeps catalogue order', () => {
    const index = addToIndex(withSongs(), 'new-song', 'steady-flow');
    expect(index.catalogues.map((catalogue) => catalogue.id)).toEqual(['calm-stretch', 'steady-flow', 'active-rehab']);
    expect(catalogueOf(index, 'new-song')?.songIds).toEqual(['past-sadness', 'new-song']);
  });

  it('does not change the index it was given', () => {
    const before = withSongs();
    const snapshot = JSON.stringify(before);
    addToIndex(before, 'x', 'active-rehab');
    removeFromIndex(before, 'past-sadness');
    moveInIndex(before, 'past-sadness', 'calm-stretch');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses an unknown catalogue, naming the real ones', () => {
    expect(() => addToIndex(withSongs(), 'x', 'fast-dance')).toThrow(
      'There is no catalogue "fast-dance". The catalogues are: calm-stretch, steady-flow, active-rehab.',
    );
    expect(() => moveInIndex(withSongs(), 'past-sadness', 'nope')).toThrow(SongToolError);
  });

  it('refuses a duplicate id, even into another catalogue', () => {
    expect(() => addToIndex(withSongs(), 'past-sadness', 'active-rehab')).toThrow(
      'A song with the id "past-sadness" is already listed in "steady-flow".',
    );
  });

  it('removes a song and says where it was', () => {
    const { index, from } = removeFromIndex(withSongs(), 'past-sadness');
    expect(from.id).toBe('steady-flow');
    expect(listedIds(index)).toEqual(['slow-one']);
    expect(() => removeFromIndex(index, 'past-sadness')).toThrow('There is no song "past-sadness". The songs are: slow-one.');
  });

  it('moves a song to the end of another catalogue', () => {
    const start = addToIndex(withSongs(), 'another-slow', 'calm-stretch');
    const { index, from, to } = moveInIndex(start, 'past-sadness', 'calm-stretch');
    expect([from.id, to.id]).toEqual(['steady-flow', 'calm-stretch']);
    expect(catalogueOf(index, 'past-sadness')?.songIds).toEqual(['slow-one', 'another-slow', 'past-sadness']);
    expect(index.catalogues[1].songIds).toEqual([]);
    expect(() => moveInIndex(index, 'past-sadness', 'calm-stretch')).toThrow('already in');
    expect(() => moveInIndex(index, 'ghost', 'calm-stretch')).toThrow('There is no song "ghost"');
    parseIndex(index); // still valid: each song in exactly one catalogue
  });
});

describe('formatJson', () => {
  it('writes a 2-space indent with a trailing newline', () => {
    expect(formatJson({ a: 1, b: { c: 'x' } })).toBe('{\n  "a": 1,\n  "b": {\n    "c": "x"\n  }\n}\n');
  });

  it('keeps short lists of plain values on one line and breaks long ones', () => {
    expect(formatJson({ ids: ['a', 'b'], empty: [] })).toBe('{\n  "ids": ["a", "b"],\n  "empty": []\n}\n');
    const long = Array.from({ length: 30 }, (_, i) => `song-number-${i}`);
    const text = formatJson({ ids: long });
    // {, "ids": [, one line per id, ], }, and the empty string after the final newline
    expect(text.split('\n')).toHaveLength(long.length + 5);
    expect(JSON.parse(text)).toEqual({ ids: long });
  });

  it("rewrites the shipped index.json byte for byte, so the CLI's edits are minimal diffs", () => {
    const shipped = readFileSync(path.join(CLI_REPO_ROOT, 'public', 'songs', 'index.json'), 'utf8').replace(/\r\n/g, '\n');
    expect(formatJson(parseIndex(JSON.parse(shipped)))).toBe(shipped);
  });
});

describe('ids, credit lines and licences, as the add command uses them', () => {
  it('slugs the title and makes it unique against the ids in use', () => {
    expect(suggestId('Past Sadness', [])).toBe('past-sadness');
    expect(suggestId('Past Sadness', ['past-sadness'])).toBe('past-sadness-2');
    expect(suggestId('Past Sadness', ['past-sadness', 'past-sadness-2'])).toBe('past-sadness-3');
    expect(suggestId('Café del Mar & Friends!', [])).toBe('cafe-del-mar-and-friends');
    expect(suggestId('???', [])).toBe('song');
  });

  it('validates a typed id', () => {
    expect(validateId('my-song', ['other'])).toBeUndefined();
    expect(validateId('My Song', [])).toMatch(/lowercase/);
    expect(validateId('my--song', [])).toMatch(/lowercase/);
    expect(validateId('taken', ['taken'])).toBe('"taken" is already used; "taken-2" is free.');
  });

  it('builds the credit line from the song fields and passes parseMeta', () => {
    const meta = buildMeta({
      id: 'past-sadness',
      title: 'Past Sadness',
      artist: 'Kevin MacLeod',
      licence: 'CC-BY-4.0',
      sourceUrl: 'https://www.incompetech.com/music/x',
      bpm: 72,
      durationSec: 213.39,
      catalogue: 'steady-flow',
      difficulty: 'steady',
    });
    expect(meta.creditLine).toBe(`"Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. ${STEMS_NOTE}`);
    expect(Object.keys(meta)).toEqual([
      'id', 'title', 'artist', 'licence', 'sourceUrl', 'creditLine', 'bpm', 'durationSec', 'catalogue', 'difficulty',
    ]); // prettier-ignore
    expect(parseMeta(JSON.parse(formatJson(meta)), 'past-sadness')).toEqual(meta);
  });

  it('gates licences the way the add command does', () => {
    expect(checkLicence('CC BY 4.0')).toEqual({ ok: true, id: 'CC-BY-4.0' });
    expect(checkLicence('cc0')).toEqual({ ok: true, id: 'CC0-1.0' });
    expect(checkLicence('CC BY-NC 4.0')).toMatchObject({ ok: false, reason: expect.stringMatching(/NonCommercial/) });
    expect(checkLicence('CC BY-ND 4.0')).toMatchObject({ ok: false, reason: expect.stringMatching(/stems/) });
    expect(checkLicence('All rights reserved')).toMatchObject({ ok: false });
  });

  it('suggests the catalogue for a tempo, falling back to the first one the index has', () => {
    expect(suggestCatalogue(defaultIndex(), 60)).toBe('calm-stretch');
    expect(suggestCatalogue(defaultIndex(), 72)).toBe('steady-flow');
    expect(suggestCatalogue(defaultIndex(), 140)).toBe('active-rehab');
    const custom = { catalogues: [{ id: 'everything', name: 'Everything', description: '', songIds: [] }] };
    expect(suggestCatalogue(custom, 72)).toBe('everything');
  });
});
