import { describe, expect, it } from 'vitest';
import {
  CATALOGUES,
  LICENCES,
  buildCreditLine,
  catalogueForBpm,
  checkLicence,
  creditParts,
  difficultyForBpm,
  formatDuration,
  jitterMs,
  slugify,
  tempoFix,
  uniqueSlug,
  type SongMeta,
} from './model';

const pastSadness: SongMeta = {
  id: 'past-sadness',
  title: 'Past Sadness',
  artist: 'Kevin MacLeod',
  licence: 'CC-BY-4.0',
  sourceUrl: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007',
  creditLine:
    '"Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.',
  bpm: 72,
  durationSec: 213.39,
  catalogue: 'steady-flow',
  difficulty: 'steady',
};

describe('catalogues and difficulty from BPM', () => {
  it('defines the three catalogues in tempo order', () => {
    expect(CATALOGUES.map((c) => [c.id, c.name, c.minBpm, c.maxBpm, c.difficulty])).toEqual([
      ['calm-stretch', 'Calm Stretch', 55, 70, 'gentle'],
      ['steady-flow', 'Steady Flow', 70, 85, 'steady'],
      ['active-rehab', 'Active Rehab', 85, 100, 'active'],
    ]);
  });

  it.each([
    [55, 'calm-stretch', 'gentle'],
    [69.99, 'calm-stretch', 'gentle'],
    [70, 'steady-flow', 'steady'],
    [72, 'steady-flow', 'steady'],
    [84.9, 'steady-flow', 'steady'],
    [85, 'active-rehab', 'active'],
    [100, 'active-rehab', 'active'],
  ])('puts %s BPM in %s as %s', (bpm, catalogue, difficulty) => {
    expect(catalogueForBpm(bpm)).toBe(catalogue);
    expect(difficultyForBpm(bpm)).toBe(difficulty);
  });

  it('falls back to the nearest catalogue outside 55-100 BPM', () => {
    expect(catalogueForBpm(40)).toBe('calm-stretch');
    expect(difficultyForBpm(40)).toBe('gentle');
    expect(catalogueForBpm(140)).toBe('active-rehab');
    expect(difficultyForBpm(140)).toBe('active');
  });

  it('offers half or double tempo when that lands inside 55-100 BPM', () => {
    expect(tempoFix(144)).toEqual({ bpm: 72, label: 'half' });
    expect(tempoFix(45)).toEqual({ bpm: 90, label: 'double' });
    expect(tempoFix(72)).toBeNull();
    // Neither half nor double of 210 or 20 lands in range.
    expect(tempoFix(210)).toBeNull();
    expect(tempoFix(20)).toBeNull();
  });
});

describe('slugify', () => {
  it.each([
    ['Past Sadness', 'past-sadness'],
    ['  Lo-Fi   Morning  ', 'lo-fi-morning'],
    ['Café Délice', 'cafe-delice'],
    ['Rock & Roll', 'rock-and-roll'],
    ["Don't Stop (Remix)", 'dont-stop-remix'],
    ['The Past (8 Bit Lofi Hip Hop)', 'the-past-8-bit-lofi-hip-hop'],
    ['!!!', 'song'],
    ['', 'song'],
  ])('turns %j into %j', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it('keeps slugs to 48 characters, cut at a word', () => {
    const slug = slugify('A very long title that goes on and on well past any sensible length for a folder');
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toBe('a-very-long-title-that-goes-on-and-on-well-past');
  });

  it('adds a number when the slug is taken', () => {
    expect(uniqueSlug('past-sadness', [])).toBe('past-sadness');
    expect(uniqueSlug('past-sadness', ['past-sadness'])).toBe('past-sadness-2');
    expect(uniqueSlug('past-sadness', ['past-sadness', 'past-sadness-2'])).toBe('past-sadness-3');
  });
});

describe('checkLicence', () => {
  it.each([
    ['CC-BY-4.0', 'CC-BY-4.0'],
    ['CC BY 4.0', 'CC-BY-4.0'],
    ['cc by 4.0', 'CC-BY-4.0'],
    ['Creative Commons Attribution 4.0', 'CC-BY-4.0'],
    ['CC BY 3.0', 'CC-BY-3.0'],
    ['CC0', 'CC0-1.0'],
    ['CC0 1.0', 'CC0-1.0'],
    ['cc0-1.0', 'CC0-1.0'],
    ['Public domain', 'PD'],
    ['PD', 'PD'],
  ])('accepts %j as %s', (input, id) => {
    expect(checkLicence(input)).toEqual({ ok: true, id });
  });

  it.each([
    ['CC BY-NC 4.0', /NonCommercial/],
    ['CC BY-NC-SA 3.0', /NonCommercial/],
    ['CC BY-ND 4.0', /NoDerivatives/],
    ['CC BY-SA 4.0', /ShareAlike/],
    ['CC BY', /version/],
    ['Pixabay License', /not one of/],
    ['All rights reserved', /not one of/],
    ['', /not one of/],
  ])('refuses %j', (input, reason) => {
    const result = checkLicence(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  it('only lists licences that allow stems and redistribution', () => {
    expect(Object.keys(LICENCES).sort()).toEqual(['CC-BY-3.0', 'CC-BY-4.0', 'CC0-1.0', 'PD']);
  });
});

describe('credit lines', () => {
  it('builds the full CC BY credit, naming the source site and the stem separation', () => {
    expect(
      buildCreditLine({
        title: 'Past Sadness',
        artist: 'Kevin MacLeod',
        sourceUrl: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007',
        licence: 'CC-BY-4.0',
      }),
    ).toBe(pastSadness.creditLine);
  });

  it('drops a leading www. from the source site', () => {
    expect(
      buildCreditLine({ title: 'Song', artist: 'Someone', sourceUrl: 'https://www.example.org/a/b', licence: 'CC0-1.0' }),
    ).toBe('"Song" by Someone (example.org), CC0 1.0. Separated into drum and melody stems by the Rehabeat team.');
  });

  it('splits a credit line into text and links to the source and the licence', () => {
    expect(creditParts(pastSadness)).toEqual([
      { text: '"Past Sadness" by Kevin MacLeod (' },
      { text: 'incompetech.com', href: pastSadness.sourceUrl },
      { text: '), ' },
      { text: 'CC BY 4.0', href: 'https://creativecommons.org/licenses/by/4.0/' },
      { text: '. Separated into drum and melody stems by the Rehabeat team.' },
    ]);
  });

  it('appends the links when a hand-written credit line does not mention them', () => {
    const parts = creditParts({ ...pastSadness, creditLine: 'Music by Kevin MacLeod.' });
    expect(parts[0]).toEqual({ text: 'Music by Kevin MacLeod.' });
    expect(parts.filter((part) => part.href).map((part) => part.href)).toEqual([
      pastSadness.sourceUrl,
      'https://creativecommons.org/licenses/by/4.0/',
    ]);
  });
});

describe('jitterMs', () => {
  it('is the standard deviation of the gaps between beats, in ms', () => {
    // Gaps of 0.8, 0.9 and 0.85 s: mean 850 ms, population standard deviation 40.82 ms.
    expect(jitterMs([0, 0.8, 1.7, 2.55])).toBeCloseTo(40.8248, 3);
  });

  it('is 0 on a perfectly even grid and null with fewer than two beats', () => {
    expect(jitterMs([1, 1.5, 2, 2.5])).toBeCloseTo(0, 9);
    expect(jitterMs([1])).toBeNull();
    expect(jitterMs([])).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [213.39, '3:33'],
    [59.6, '1:00'],
    [5, '0:05'],
    [3600, '60:00'],
  ])('formats %s s as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
