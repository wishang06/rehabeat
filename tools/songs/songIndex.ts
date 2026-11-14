/**
 * Pure updates to public/songs/index.json. Each returns a new index and leaves the old
 * one untouched; each refuses, with a SongToolError, anything that would break the rule
 * that a song is listed in exactly one catalogue.
 */
import { CATALOGUES, type CatalogueEntry, type SongIndex } from '../../src/songs/model';
import { SongToolError } from './errors';

/** The index a new library starts with: the three default catalogues, empty. */
export function defaultIndex(): SongIndex {
  return {
    catalogues: CATALOGUES.map(({ id, name, description }) => ({ id, name, description, songIds: [] })),
  };
}

export function listedIds(index: SongIndex): string[] {
  return index.catalogues.flatMap((catalogue) => catalogue.songIds);
}

export function catalogueOf(index: SongIndex, songId: string): CatalogueEntry | undefined {
  return index.catalogues.find((catalogue) => catalogue.songIds.includes(songId));
}

export function findCatalogue(index: SongIndex, catalogueId: string): CatalogueEntry {
  const catalogue = index.catalogues.find((entry) => entry.id === catalogueId);
  if (!catalogue) {
    const known = index.catalogues.map((entry) => entry.id).join(', ');
    throw new SongToolError(`There is no catalogue "${catalogueId}". The catalogues are: ${known}.`);
  }
  return catalogue;
}

function withSongIds(index: SongIndex, update: (catalogue: CatalogueEntry) => string[]): SongIndex {
  return {
    ...index,
    catalogues: index.catalogues.map((catalogue) => ({ ...catalogue, songIds: update(catalogue) })),
  };
}

/** Appends a song to the end of a catalogue's list. */
export function addToIndex(index: SongIndex, songId: string, catalogueId: string): SongIndex {
  const target = findCatalogue(index, catalogueId);
  const current = catalogueOf(index, songId);
  if (current) throw new SongToolError(`A song with the id "${songId}" is already listed in "${current.id}".`);
  return withSongIds(index, (catalogue) =>
    catalogue.id === target.id ? [...catalogue.songIds, songId] : [...catalogue.songIds],
  );
}

export function removeFromIndex(index: SongIndex, songId: string): { index: SongIndex; from: CatalogueEntry } {
  const from = catalogueOf(index, songId);
  if (!from) throw new SongToolError(unknownSongMessage(index, songId));
  return { index: withSongIds(index, (catalogue) => catalogue.songIds.filter((id) => id !== songId)), from };
}

/** Moves a song to the end of another catalogue's list. */
export function moveInIndex(
  index: SongIndex,
  songId: string,
  toCatalogueId: string,
): { index: SongIndex; from: CatalogueEntry; to: CatalogueEntry } {
  const from = catalogueOf(index, songId);
  if (!from) throw new SongToolError(unknownSongMessage(index, songId));
  const to = findCatalogue(index, toCatalogueId);
  if (from.id === to.id) throw new SongToolError(`"${songId}" is already in "${to.id}".`);
  const removed = removeFromIndex(index, songId).index;
  return { index: addToIndex(removed, songId, to.id), from, to };
}

export function unknownSongMessage(index: SongIndex, songId: string): string {
  const ids = listedIds(index);
  return ids.length === 0
    ? `There is no song "${songId}": the library is empty.`
    : `There is no song "${songId}". The songs are: ${ids.join(', ')}.`;
}

// ------------------------------------------------------------------ JSON files

/**
 * JSON with a 2-space indent and a trailing newline. An array of plain values that fits
 * on one line is written on one line, as index.json is written by hand
 * (`"songIds": ["past-sadness"]`), so a rewrite only changes the lines that changed.
 */
export function formatJson(value: unknown, width = 100): string {
  return `${formatValue(value, '', 0, width)}\n`;
}

function formatValue(value: unknown, indent: string, used: number, width: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const plain = value.every((item) => item === null || typeof item !== 'object');
    if (plain) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (used + inline.length <= width) return inline;
    }
    const inner = `${indent}  `;
    const items = value.map((item) => `${inner}${formatValue(item, inner, inner.length, width)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return '{}';
    const inner = `${indent}  `;
    const lines = entries.map(([key, item]) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return `${head}${formatValue(item, inner, head.length, width)}`;
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
