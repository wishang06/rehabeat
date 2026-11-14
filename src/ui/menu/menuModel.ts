import type { CatalogueGroup } from '../../songs/library';
import { CATALOGUES, type CatalogueDefinition, type Difficulty, type SongMeta } from '../../songs/model';

/*
 * What the song menu shows, worked out from the library. Pure functions only.
 */

export const DIFFICULTY_LEVEL: Record<Difficulty, number> = { gentle: 1, steady: 2, active: 3 };
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { gentle: 'Gentle', steady: 'Steady', active: 'Active' };

/** The tempo band behind a catalogue id, if it is one of the default catalogues. */
export function definitionFor(catalogueId: string): CatalogueDefinition | undefined {
  return CATALOGUES.find((definition) => definition.id === catalogueId);
}

/** The catalogue that lists `songId` (and loaded it), or -1. */
export function catalogueIndexOf(groups: readonly CatalogueGroup[], songId: string): number {
  return groups.findIndex((group) => group.songs.some((song) => song.id === songId));
}

/** The rail item the menu opens on: the selected song's catalogue, else the first with songs, else the first. */
export function initialRail(groups: readonly CatalogueGroup[], selectedId: string): number {
  const holding = catalogueIndexOf(groups, selectedId);
  if (holding !== -1) return holding;
  const stocked = groups.findIndex((group) => group.songs.length > 0);
  return stocked === -1 ? 0 : stocked;
}

/** The card that takes Tab focus in a catalogue: the selected song, else the first. */
export function rovingCard(songs: readonly SongMeta[], selectedId: string): number {
  return Math.max(0, songs.findIndex((song) => song.id === selectedId));
}

/**
 * Where a tempo sits on the rail's rod, in rail items from the top: catalogue
 * `index` spans index to index + 1, from its slowest tempo to its fastest.
 * A catalogue without a tempo band puts every song at its middle.
 */
export function rodPosition(bpm: number, index: number, definition: Pick<CatalogueDefinition, 'minBpm' | 'maxBpm'> | undefined): number {
  if (!definition || !(definition.maxBpm > definition.minBpm) || !Number.isFinite(bpm)) return index + 0.5;
  const through = (bpm - definition.minBpm) / (definition.maxBpm - definition.minBpm);
  return index + Math.min(1, Math.max(0, through));
}

/**
 * The BPM marks along the rod, one at each catalogue boundary: the first
 * band's slowest tempo, each band's start, the last band's fastest tempo.
 * Empty unless every catalogue has a tempo band.
 */
export function rodMarks(groups: readonly CatalogueGroup[]): { position: number; bpm: number }[] {
  const definitions = groups.map((group) => definitionFor(group.catalogue.id));
  if (definitions.length === 0 || definitions.some((definition) => definition === undefined)) return [];
  const bands = definitions as CatalogueDefinition[];
  return [
    ...bands.map((band, index) => ({ position: index, bpm: band.minBpm })),
    { position: bands.length, bpm: bands[bands.length - 1].maxBpm },
  ];
}

export function songCountLabel(count: number): string {
  if (count === 0) return 'No songs yet';
  return count === 1 ? '1 song' : `${count} songs`;
}

export function bpmRangeLabel(definition: Pick<CatalogueDefinition, 'minBpm' | 'maxBpm'> | undefined): string | null {
  return definition ? `${definition.minBpm}–${definition.maxBpm} BPM` : null;
}

/** A song's beat period as a CSS time, for the beat lamp on its card. */
export function beatPeriod(bpm: number): string {
  const seconds = Number.isFinite(bpm) && bpm > 0 ? 60 / bpm : 1;
  return `${Number(seconds.toFixed(4))}s`;
}

/** Why a catalogue shows no cards, in a sentence or two. */
export function emptyReason(group: CatalogueGroup): string {
  const failed = group.catalogue.songIds.length - group.songs.length;
  if (failed > 0) {
    const songs = failed === 1 ? 'The song listed here' : `The ${failed} songs listed here`;
    return `${songs} couldn't be loaded. The browser console says why.`;
  }
  const band = definitionFor(group.catalogue.id);
  const tempo = band ? `a tempo of ${band.minBpm} to ${band.maxBpm} BPM and ` : '';
  return `None have been added yet. Each one needs ${tempo}a licence that lets us split it into drum and melody stems.`;
}

/** A note for a catalogue that shows some songs but failed to load others, or null. */
export function missingNote(group: CatalogueGroup): string | null {
  const failed = group.catalogue.songIds.length - group.songs.length;
  if (failed <= 0 || group.songs.length === 0) return null;
  return `${failed === 1 ? '1 more song' : `${failed} more songs`} listed here couldn't be loaded.`;
}

/** The catalogue to suggest from an empty one: the nearest catalogue that has songs. */
export function nearestStocked(groups: readonly CatalogueGroup[], from: number): number {
  let best = -1;
  groups.forEach((group, index) => {
    if (group.songs.length === 0 || index === from) return;
    if (best === -1 || Math.abs(index - from) < Math.abs(best - from)) best = index;
  });
  return best;
}
