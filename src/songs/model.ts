/**
 * Shared rules for the song library: used by the game (src/) and by the
 * `npm run songs` CLI (tools/songs/). Pure functions only, no DOM or Node APIs.
 */

export type Difficulty = 'gentle' | 'steady' | 'active';
export const DIFFICULTIES: readonly Difficulty[] = ['gentle', 'steady', 'active'];

/**
 * public/songs/<id>/meta.json. `licence` is a key of LICENCES. `catalogue` is
 * the id of the catalogue in index.json that lists the song.
 */
export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  licence: LicenceId;
  sourceUrl: string;
  creditLine: string;
  bpm: number;
  durationSec: number;
  catalogue: string;
  difficulty: Difficulty;
}

/** One catalogue in public/songs/index.json. */
export interface CatalogueEntry {
  id: string;
  name: string;
  description: string;
  songIds: string[];
}

/** public/songs/index.json. */
export interface SongIndex {
  catalogues: CatalogueEntry[];
}

export interface CatalogueDefinition {
  id: string;
  name: string;
  description: string;
  /** Inclusive lower bound. */
  minBpm: number;
  /** Exclusive upper bound, except for the last catalogue, which includes it. */
  maxBpm: number;
  difficulty: Difficulty;
}

/** The default catalogues, in tempo order. A song's BPM suggests one of these. */
export const CATALOGUES: readonly CatalogueDefinition[] = [
  {
    id: 'calm-stretch',
    name: 'Calm Stretch',
    description: 'Slow, gentle tempos for warming up and easy stretches. 55 to 70 BPM.',
    minBpm: 55,
    maxBpm: 70,
    difficulty: 'gentle',
  },
  {
    id: 'steady-flow',
    name: 'Steady Flow',
    description: 'An even, relaxed pace for most of a session. 70 to 85 BPM.',
    minBpm: 70,
    maxBpm: 85,
    difficulty: 'steady',
  },
  {
    id: 'active-rehab',
    name: 'Active Rehab',
    description: 'Brisker tempos for stronger, more active sets. 85 to 100 BPM.',
    minBpm: 85,
    maxBpm: 100,
    difficulty: 'active',
  },
];

export const MIN_BPM = CATALOGUES[0].minBpm;
export const MAX_BPM = CATALOGUES[CATALOGUES.length - 1].maxBpm;

/** The default catalogue for a tempo; outside 55-100 BPM, the nearest one. */
function definitionForBpm(bpm: number): CatalogueDefinition {
  const index = CATALOGUES.findIndex((catalogue) => bpm < catalogue.maxBpm);
  return CATALOGUES[index === -1 ? CATALOGUES.length - 1 : index];
}

export function catalogueForBpm(bpm: number): string {
  return definitionForBpm(bpm).id;
}

export function difficultyForBpm(bpm: number): Difficulty {
  return definitionForBpm(bpm).difficulty;
}

export function isPlayableBpm(bpm: number): boolean {
  return bpm >= MIN_BPM && bpm <= MAX_BPM;
}

/**
 * Beat trackers often lock on at half or double the felt tempo. For a tempo
 * outside 55-100 BPM, the octave that lands inside it, or null if neither does.
 */
export function tempoFix(bpm: number): { bpm: number; label: 'half' | 'double' } | null {
  if (isPlayableBpm(bpm)) return null;
  if (isPlayableBpm(bpm / 2)) return { bpm: bpm / 2, label: 'half' };
  if (isPlayableBpm(bpm * 2)) return { bpm: bpm * 2, label: 'double' };
  return null;
}

// ------------------------------------------------------------------ ids

const MAX_SLUG_LENGTH = 48;

/** A folder-safe id from a title: lowercase ASCII words joined by hyphens. */
export function slugify(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > MAX_SLUG_LENGTH) break;
    slug = next;
  }
  // A first word longer than the limit is cut rather than dropped.
  if (!slug && words.length > 0) slug = words[0].slice(0, MAX_SLUG_LENGTH);
  return slug || 'song';
}

/** `base`, or `base-2`, `base-3`, ... whichever is not taken. */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export const SONG_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ------------------------------------------------------------------ licences

/**
 * The licences a song may have. Each allows redistributing the audio and
 * making stems from it. NoDerivatives forbids the stems; NonCommercial and
 * ShareAlike are left out to keep every file in the repo under simple terms.
 */
export const LICENCES = {
  'CC0-1.0': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'CC-BY-3.0': { name: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/' },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  PD: { name: 'Public domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
} as const;

export type LicenceId = keyof typeof LICENCES;

export function isLicenceId(value: unknown): value is LicenceId {
  return typeof value === 'string' && Object.hasOwn(LICENCES, value);
}

export type LicenceCheck = { ok: true; id: LicenceId } | { ok: false; reason: string };

const ALLOWED_NAMES = Object.values(LICENCES)
  .map((licence) => licence.name)
  .join(', ');

/** Reads a licence as people write it ("CC BY 4.0", "cc0", "Public domain") and says whether a song may use it. */
export function checkLicence(input: string): LicenceCheck {
  const text = input
    .toUpperCase()
    .replace(/CREATIVE\s+COMMONS/g, 'CC')
    .replace(/ATTRIBUTION/g, 'BY')
    .replace(/NON-?COMMERCIAL/g, 'NC')
    .replace(/NO-?DERIVATIVES?|NO-?DERIVS/g, 'ND')
    .replace(/SHARE-?ALIKE/g, 'SA')
    .replace(/[\s_-]+/g, ' ')
    .trim();
  const tokens = new Set(text.split(' '));

  if (tokens.has('NC')) return { ok: false, reason: 'NonCommercial licences are not allowed in the repo.' };
  if (tokens.has('ND')) return { ok: false, reason: 'NoDerivatives forbids making stems from the song.' };
  if (tokens.has('SA')) return { ok: false, reason: 'ShareAlike licences are not allowed in the repo.' };

  if (/^CC ?0( 1\.0)?$/.test(text)) return { ok: true, id: 'CC0-1.0' };
  if (/^(PD|PDM|PUBLIC DOMAIN)( MARK)?( 1\.0)?$/.test(text)) return { ok: true, id: 'PD' };
  const by = /^CC BY( (\d\.\d))?$/.exec(text);
  if (by) {
    if (by[2] === '4.0') return { ok: true, id: 'CC-BY-4.0' };
    if (by[2] === '3.0') return { ok: true, id: 'CC-BY-3.0' };
    return { ok: false, reason: 'Say which version of CC BY: 3.0 or 4.0.' };
  }
  return { ok: false, reason: `"${input.trim()}" is not one of the allowed licences: ${ALLOWED_NAMES}.` };
}

// ------------------------------------------------------------------ credits

export const STEMS_NOTE = 'Separated into drum and melody stems by the Rehabeat team.';

function sourceSite(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    return sourceUrl;
  }
}

/**
 * The attribution shown in the game and in CREDITS.md. CC BY asks for the
 * title, the author, the source, the licence and a note of any changes.
 */
export function buildCreditLine(song: Pick<SongMeta, 'title' | 'artist' | 'sourceUrl' | 'licence'>): string {
  const licence = LICENCES[song.licence].name;
  return `"${song.title}" by ${song.artist} (${sourceSite(song.sourceUrl)}), ${licence}. ${STEMS_NOTE}`;
}

export interface CreditPart {
  text: string;
  href?: string;
}

/**
 * A credit line split into plain text and links: the source site links to the
 * song's source page and the licence name to the licence. A hand-written line
 * that names neither gets both links appended.
 */
export function creditParts(song: SongMeta): CreditPart[] {
  const licence = LICENCES[song.licence];
  const links = [
    { text: sourceSite(song.sourceUrl), href: song.sourceUrl },
    { text: licence.name, href: licence.url },
  ];

  const parts: CreditPart[] = [];
  let rest = song.creditLine;
  const missing: CreditPart[] = [];
  for (const link of links) {
    const at = rest.indexOf(link.text);
    if (at === -1) {
      missing.push(link);
      continue;
    }
    if (at > 0) parts.push({ text: rest.slice(0, at) });
    parts.push(link);
    rest = rest.slice(at + link.text.length);
  }
  if (rest) parts.push({ text: rest });
  for (const link of missing) parts.push({ text: ' ' }, link);
  return parts;
}

// ------------------------------------------------------------------ numbers

/**
 * Beat jitter: the standard deviation of the gaps between beats, in ms. The
 * same measure tools/make_beatmap.py prints. Null with fewer than two beats.
 */
export function jitterMs(beats: readonly number[]): number | null {
  if (beats.length < 2) return null;
  const gaps = beats.slice(1).map((time, i) => (time - beats[i]) * 1000);
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const variance = gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length;
  return Math.sqrt(variance);
}

/** 213.4 -> "3:33". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
