import { describe, expect, it } from 'vitest';
import type { CatalogueGroup } from '../../songs/library';
import type { SongMeta } from '../../songs/model';
import {
  beatPeriod,
  bpmRangeLabel,
  catalogueIndexOf,
  definitionFor,
  emptyReason,
  initialRail,
  missingNote,
  nearestStocked,
  rodMarks,
  rodPosition,
  rovingCard,
  songCountLabel,
} from './menuModel';

function song(id: string, bpm: number, catalogue: string): SongMeta {
  return {
    id,
    title: id,
    artist: 'Someone',
    licence: 'CC-BY-4.0',
    sourceUrl: 'https://example.org/song',
    creditLine: `"${id}" by Someone (example.org), CC BY 4.0.`,
    bpm,
    durationSec: 180,
    catalogue,
    difficulty: 'steady',
  };
}

function group(id: string, songs: SongMeta[], songIds = songs.map((s) => s.id)): CatalogueGroup {
  return { catalogue: { id, name: id, description: `${id}.`, songIds }, songs };
}

const shipped: CatalogueGroup[] = [
  group('calm-stretch', []),
  group('steady-flow', [song('past-sadness', 72, 'steady-flow')]),
  group('active-rehab', []),
];

describe('initialRail', () => {
  it("opens on the selected song's catalogue", () => {
    expect(initialRail(shipped, 'past-sadness')).toBe(1);
  });

  it('opens on the first catalogue with songs when the selected song is not loaded', () => {
    expect(initialRail(shipped, 'gone')).toBe(1);
  });

  it('opens on the first catalogue when none has songs', () => {
    expect(initialRail([group('a', []), group('b', [])], 'gone')).toBe(0);
    expect(initialRail([], 'gone')).toBe(0);
  });
});

describe('catalogueIndexOf and rovingCard', () => {
  it('finds the catalogue holding a song', () => {
    expect(catalogueIndexOf(shipped, 'past-sadness')).toBe(1);
    expect(catalogueIndexOf(shipped, 'gone')).toBe(-1);
  });

  it('gives Tab focus to the selected card, else the first', () => {
    const songs = [song('a', 72, 'x'), song('b', 75, 'x')];
    expect(rovingCard(songs, 'b')).toBe(1);
    expect(rovingCard(songs, 'gone')).toBe(0);
    expect(rovingCard([], 'gone')).toBe(0);
  });
});

describe('rodPosition', () => {
  const steady = definitionFor('steady-flow');

  it('places a tempo within its catalogue band', () => {
    expect(rodPosition(70, 1, steady)).toBe(1);
    expect(rodPosition(77.5, 1, steady)).toBe(1.5);
    expect(rodPosition(72, 1, steady)).toBeCloseTo(1 + 2 / 15);
  });

  it('keeps a tempo outside the band on its catalogue', () => {
    expect(rodPosition(60, 1, steady)).toBe(1);
    expect(rodPosition(120, 1, steady)).toBe(2);
  });

  it('puts every song mid-band for a catalogue without a tempo band', () => {
    expect(rodPosition(72, 3, undefined)).toBe(3.5);
    expect(rodPosition(72, 0, { minBpm: 80, maxBpm: 80 })).toBe(0.5);
  });
});

describe('rodMarks', () => {
  it('marks every catalogue boundary with its tempo', () => {
    expect(rodMarks(shipped)).toEqual([
      { position: 0, bpm: 55 },
      { position: 1, bpm: 70 },
      { position: 2, bpm: 85 },
      { position: 3, bpm: 100 },
    ]);
  });

  it('has no marks when a catalogue has no tempo band', () => {
    expect(rodMarks([...shipped, group('favourites', [])])).toEqual([]);
    expect(rodMarks([])).toEqual([]);
  });
});

describe('labels', () => {
  it('counts songs', () => {
    expect(songCountLabel(0)).toBe('No songs yet');
    expect(songCountLabel(1)).toBe('1 song');
    expect(songCountLabel(4)).toBe('4 songs');
  });

  it('gives a tempo range', () => {
    expect(bpmRangeLabel(definitionFor('calm-stretch'))).toBe('55–70 BPM');
    expect(bpmRangeLabel(undefined)).toBeNull();
  });

  it('gives a beat period as a CSS time', () => {
    expect(beatPeriod(60)).toBe('1s');
    expect(beatPeriod(72)).toBe('0.8333s');
    expect(beatPeriod(0)).toBe('1s');
    expect(beatPeriod(Number.NaN)).toBe('1s');
  });
});

describe('emptyReason', () => {
  it("explains an empty catalogue with its tempo band", () => {
    expect(emptyReason(shipped[0])).toBe(
      'None have been added yet. Each one needs a tempo of 55 to 70 BPM and a licence that lets us split it into drum and melody stems.',
    );
  });

  it('leaves the tempo out for a catalogue without a band', () => {
    expect(emptyReason(group('favourites', []))).toBe(
      'None have been added yet. Each one needs a licence that lets us split it into drum and melody stems.',
    );
  });

  it('says when its songs failed to load', () => {
    expect(emptyReason(group('calm-stretch', [], ['drift']))).toBe(
      "The song listed here couldn't be loaded. The browser console says why.",
    );
    expect(emptyReason(group('calm-stretch', [], ['drift', 'tide']))).toBe(
      "The 2 songs listed here couldn't be loaded. The browser console says why.",
    );
  });
});

describe('missingNote', () => {
  it('notes songs that failed to load beside ones that did', () => {
    const loaded = song('past-sadness', 72, 'steady-flow');
    expect(missingNote(group('steady-flow', [loaded], ['past-sadness', 'drift']))).toBe(
      "1 more song listed here couldn't be loaded.",
    );
    expect(missingNote(group('steady-flow', [loaded], ['past-sadness', 'a', 'b']))).toBe(
      "2 more songs listed here couldn't be loaded.",
    );
  });

  it('is null when everything loaded, or nothing did', () => {
    expect(missingNote(shipped[1])).toBeNull();
    expect(missingNote(group('calm-stretch', [], ['drift']))).toBeNull();
  });
});

describe('nearestStocked', () => {
  it('suggests the nearest catalogue that has songs', () => {
    expect(nearestStocked(shipped, 0)).toBe(1);
    expect(nearestStocked(shipped, 2)).toBe(1);
  });

  it('prefers the slower neighbour on a tie, and never the catalogue itself', () => {
    const both = [group('a', [song('x', 60, 'a')]), group('b', []), group('c', [song('y', 90, 'c')])];
    expect(nearestStocked(both, 1)).toBe(0);
    expect(nearestStocked(both, 0)).toBe(2);
  });

  it('is -1 when no other catalogue has songs', () => {
    expect(nearestStocked([group('a', []), group('b', [])], 0)).toBe(-1);
  });
});
