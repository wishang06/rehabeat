/** The command line: `npm run songs -- <command> [args] [--flags]`. */
import { parseArgs } from 'node:util';
import { DIFFICULTIES, type Difficulty } from '../../src/songs/model';
import { UsageError } from './errors';

export const COMMANDS = ['add', 'list', 'preview', 'remove', 'move', 'help'] as const;
export type Command = (typeof COMMANDS)[number];

export const STRING_FLAGS = [
  'root',
  'python',
  'title',
  'artist',
  'licence',
  'license',
  'source-url',
  'id',
  'catalogue',
  'catalog',
  'difficulty',
  'bpm-hint',
  'max-jitter',
] as const;
export const BOOLEAN_FLAGS = ['keep-source', 'yes', 'help'] as const;

export const DEFAULT_MAX_JITTER_MS = 10;

export interface CliArgs {
  command: Command | null;
  positionals: string[];
  root?: string;
  python?: string;
  title?: string;
  artist?: string;
  licence?: string;
  sourceUrl?: string;
  id?: string;
  catalogue?: string;
  difficulty?: Difficulty;
  bpmHint?: number;
  maxJitter: number;
  keepSource: boolean;
  yes: boolean;
  help: boolean;
}

export const USAGE = `Rehabeat song library

  npm run songs                          menu (needs an interactive terminal)
  npm run songs -- list                  every song with its BPM, beat jitter and licence
  npm run songs -- add <file-or-url> [add options]
  npm run songs -- preview <id>          play 10 s of the song's melody stem
  npm run songs -- remove <id> [--yes]
  npm run songs -- move <id> <catalogue-id> [--difficulty D]

add options (with --yes, nothing is asked: --title, --artist, --licence and --source-url are required)
  --title T  --artist A          default: the file's tags
  --licence L                    CC0, CC BY 3.0, CC BY 4.0 or Public domain
  --source-url U                 the page the song came from (default: the download address)
  --id ID                        folder name in public/songs/ (default: from the title)
  --catalogue C                  calm-stretch, steady-flow, active-rehab (default: from the BPM)
  --difficulty D                 gentle, steady or active (default: from the BPM)
  --bpm-hint N                   the tempo you hear, when the beat grid comes out at half or double speed
  --max-jitter MS                with --yes, refuse a beat grid this unsteady or worse (default ${DEFAULT_MAX_JITTER_MS})
  --keep-source                  also copy the source audio to tools/tracks/<id>.<ext>
  --yes                          no questions, no audible check (the check file's path is printed)

everywhere
  --root DIR                     the repo to work in (default: the one this CLI is in)
  --python PATH                  the Python for tools/song_pipeline.py (or set REHABEAT_PYTHON;
                                 default: tools/.venv)`;

const ARG_COUNTS: Record<Command, [number, number]> = {
  add: [0, 1],
  list: [0, 0],
  preview: [0, 1],
  remove: [0, 1],
  move: [0, 2],
  help: [0, 0],
};

function positiveNumber(flag: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) throw new UsageError(`--${flag} needs a positive number, not "${text}".`);
  return value;
}

export function parseCli(argv: readonly string[]): CliArgs {
  const options = Object.fromEntries([
    ...STRING_FLAGS.map((name) => [name, { type: 'string' as const }]),
    ...BOOLEAN_FLAGS.map((name) => [name, { type: 'boolean' as const, ...(name === 'yes' ? { short: 'y' } : {}), ...(name === 'help' ? { short: 'h' } : {}) }]),
  ]);
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message.replace(/\. To specify.*$/s, '.') : String(error));
  }
  const values = parsed.values as Record<string, string | boolean | undefined>;
  const text = (name: string) => (typeof values[name] === 'string' ? (values[name] as string) : undefined);
  const flag = (name: string) => values[name] === true;

  const [first, ...rest] = parsed.positionals;
  let command: Command | null = null;
  if (first !== undefined) {
    if (!(COMMANDS as readonly string[]).includes(first)) {
      throw new UsageError(`Unknown command "${first}". The commands are: ${COMMANDS.join(', ')}.`);
    }
    command = first as Command;
    const [min, max] = ARG_COUNTS[command];
    if (rest.length < min || rest.length > max) {
      throw new UsageError(`"${command}" takes ${max === 0 ? 'no arguments' : `at most ${max}`}, but got: ${rest.join(' ')}`);
    }
  }

  const difficulty = text('difficulty');
  if (difficulty !== undefined && !DIFFICULTIES.includes(difficulty as Difficulty)) {
    throw new UsageError(`--difficulty must be one of ${DIFFICULTIES.join(', ')}, not "${difficulty}".`);
  }
  for (const name of STRING_FLAGS) {
    if (text(name)?.trim() === '') throw new UsageError(`--${name} needs a value.`);
  }

  return {
    command,
    positionals: rest,
    root: text('root'),
    python: text('python'),
    title: text('title')?.trim(),
    artist: text('artist')?.trim(),
    licence: text('licence') ?? text('license'),
    sourceUrl: text('source-url')?.trim(),
    id: text('id')?.trim(),
    catalogue: text('catalogue') ?? text('catalog'),
    difficulty: difficulty as Difficulty | undefined,
    bpmHint: positiveNumber('bpm-hint', text('bpm-hint')),
    maxJitter: positiveNumber('max-jitter', text('max-jitter')) ?? DEFAULT_MAX_JITTER_MS,
    keepSource: flag('keep-source'),
    yes: flag('yes'),
    help: flag('help') || command === 'help',
  };
}
