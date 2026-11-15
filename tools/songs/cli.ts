/**
 * `npm run songs`: add, list, preview, remove and move the game's songs.
 *
 *   npm run songs                        menu (needs an interactive terminal)
 *   npm run songs -- <command> [...]     see USAGE in args.ts, or `npm run songs -- help`
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SongLibraryError } from '../../src/songs/library';
import { addSong, type AddDeps, type AddOptions } from './add';
import { parseCli, USAGE, type CliArgs } from './args';
import { installCleanupHandlers } from './cleanup';
import { listSongs, moveSong, pickSong, previewSong, removeSong } from './commands';
import { CancelledError, errorMessage, SongToolError, UsageError } from './errors';
import { recoverNpmArgs } from './npmArgs';
import { CLI_REPO_ROOT, layout, resolvePython, type Layout } from './paths';
import { missingRequirements, pythonPipeline } from './pipeline';
import { hasCommand, systemPlayer } from './player';
import { ffprobe } from './probe';
import { clackPrompter, plainPrompter, type Prompter } from './prompts';
import { loadIndex } from './store';

const out = (line: string) => process.stdout.write(`${line}\n`);
const err = (line: string) => process.stderr.write(`${line}\n`);

export function noTerminalMessage(env: NodeJS.ProcessEnv): string {
  const lines = [
    'npm run songs asks its questions in an interactive terminal, and this one is not (input or output is redirected).',
    'Run it in PowerShell, cmd or Git Bash directly, or use a command instead:',
    '  npm run songs -- list',
    '  npm run songs -- add <file-or-url> --title T --artist A --licence "CC BY 4.0" --source-url U --yes',
    '  npm run songs -- help',
  ];
  if (env.MSYSTEM) lines.push("In Git Bash's own window (mintty), this works: winpty npm.cmd run songs");
  return lines.join('\n');
}

interface Context {
  args: CliArgs;
  where: Layout;
  env: NodeJS.ProcessEnv;
  terminal: boolean;
}

function addDeps(context: Context, ui: Prompter): AddDeps {
  const python = resolvePython(context.args.python, context.env, CLI_REPO_ROOT, process.platform);
  return {
    layout: context.where,
    ui,
    pipeline: pythonPipeline(python, path.join(CLI_REPO_ROOT, 'tools', 'song_pipeline.py')),
    requirementProblems: (report) => missingRequirements(report, { stems: true }, python, process.platform, context.env),
    probe: ffprobe,
    player: (hasFfplay) => systemPlayer(hasFfplay),
    home: os.homedir(),
  };
}

function addOptions(args: CliArgs, input: string | undefined): AddOptions {
  return {
    input,
    title: args.title,
    artist: args.artist,
    licence: args.licence,
    sourceUrl: args.sourceUrl,
    id: args.id,
    catalogue: args.catalogue,
    difficulty: args.difficulty,
    bpmHint: args.bpmHint,
    maxJitter: args.maxJitter,
    keepSource: args.keepSource,
    yes: args.yes,
  };
}

function previewDeps(ui: Prompter) {
  const hasFfplay = hasCommand('ffplay');
  return { ui, player: systemPlayer(hasFfplay), hasFfplay, hasFfmpeg: hasFfplay || hasCommand('ffmpeg') };
}

async function pickCatalogue(ui: Prompter, where: Layout, songId: string): Promise<string> {
  const index = await loadIndex(where);
  const current = index.catalogues.find((catalogue) => catalogue.songIds.includes(songId));
  return ui.select({
    message: 'Move it to',
    options: index.catalogues
      .filter((catalogue) => catalogue.id !== current?.id)
      .map((catalogue) => ({ value: catalogue.id, label: catalogue.name, hint: catalogue.description })),
  });
}

async function menu(context: Context): Promise<number> {
  const ui = clackPrompter();
  ui.intro('Rehabeat songs');
  for (;;) {
    let action: 'add' | 'list' | 'preview' | 'remove' | 'move' | 'quit';
    try {
      action = await ui.select({
        message: 'What would you like to do?',
        options: [
          { value: 'add', label: 'Add a song' },
          { value: 'list', label: 'List songs' },
          { value: 'preview', label: 'Preview a song' },
          { value: 'remove', label: 'Remove a song' },
          { value: 'move', label: 'Move to another catalogue' },
          { value: 'quit', label: 'Quit' },
        ],
      });
    } catch (error) {
      if (error instanceof CancelledError) action = 'quit';
      else throw error;
    }
    if (action === 'quit') {
      ui.outro('Bye.');
      return 0;
    }
    try {
      if (action === 'add') {
        const deps = addDeps(context, ui);
        await addSong(addOptions({ ...context.args, yes: false }, undefined), {
          ...deps,
          // Inside the menu's frame: no second intro, and an outro or a discard does not close it.
          ui: { ...ui, intro: (title) => ui.info(title), outro: (message) => ui.success(message), cancel: (message) => ui.warn(message) },
        });
      } else if (action === 'list') {
        await listSongs(context.where, out);
      } else if (action === 'preview') {
        await previewSong(context.where, await pickSong(ui, context.where, 'Preview which song?'), previewDeps(ui));
      } else if (action === 'remove') {
        await removeSong(context.where, await pickSong(ui, context.where, 'Remove which song?'), { ui, yes: false });
      } else {
        const id = await pickSong(ui, context.where, 'Move which song?');
        await moveSong(context.where, id, await pickCatalogue(ui, context.where, id), { ui, difficulty: context.args.difficulty });
      }
    } catch (error) {
      if (error instanceof CancelledError) ui.info('Cancelled. Nothing was changed.');
      else if (error instanceof SongToolError || error instanceof SongLibraryError) ui.error(error.message);
      else throw error;
    }
  }
}

async function run(context: Context): Promise<number> {
  const { args, where, terminal } = context;
  const [first, second] = args.positionals;
  const interactiveUi = (yes: boolean) => (terminal && !yes ? clackPrompter() : plainPrompter(out, err));

  switch (args.command) {
    case null:
      if (!terminal) {
        err(noTerminalMessage(context.env));
        return 1;
      }
      return menu(context);

    case 'help':
      out(USAGE);
      return 0;

    case 'list':
      await listSongs(where, out);
      return 0;

    case 'add': {
      if (!args.yes && !terminal) {
        throw new UsageError(
          'add asks questions, so it needs an interactive terminal. To add a song without one, give --title, --artist, --licence and --source-url, and add --yes.',
        );
      }
      const ui = interactiveUi(args.yes);
      await addSong(addOptions(args, first), addDeps(context, ui)); // a discard is not an error
      return 0;
    }

    case 'preview': {
      const ui = interactiveUi(false);
      if (!first && !ui.interactive) throw new UsageError('preview needs a song id: npm run songs -- preview <id>');
      const id = first ?? (await pickSong(ui, where, 'Preview which song?'));
      await previewSong(where, id, previewDeps(ui));
      return 0;
    }

    case 'remove': {
      const ui = interactiveUi(args.yes);
      if (!first && !ui.interactive) throw new UsageError('remove needs a song id: npm run songs -- remove <id> --yes');
      const id = first ?? (await pickSong(ui, where, 'Remove which song?'));
      await removeSong(where, id, { ui, yes: args.yes });
      return 0;
    }

    case 'move': {
      const ui = interactiveUi(false);
      if (!second && !ui.interactive) {
        throw new UsageError('move needs a song id and a catalogue id: npm run songs -- move <id> <catalogue-id>');
      }
      const id = first ?? (await pickSong(ui, where, 'Move which song?'));
      const to = second ?? (await pickCatalogue(ui, where, id));
      await moveSong(where, id, to, { ui, difficulty: args.difficulty });
      return 0;
    }
  }
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  // Existing terminals (including VS Code) can retain PATH from before winget installed FFmpeg.
  // Add winget's command links for this process and every audio subprocess it starts.
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const links = path.join(localAppData, 'Microsoft', 'WinGet', 'Links');
    if (existsSync(links)) {
      const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
      const current = process.env[pathKey] ?? '';
      if (!current.split(';').some((entry) => entry.toLowerCase() === links.toLowerCase())) {
        process.env[pathKey] = current ? `${current};${links}` : links;
      }
    }
  }
  installCleanupHandlers();
  const recovered = recoverNpmArgs(argv, env, process.platform);
  if (recovered.warning) err(`warning: ${recovered.warning}`);

  let args: CliArgs;
  try {
    args = parseCli(recovered.argv);
  } catch (error) {
    err(`error: ${errorMessage(error)}\n\n${USAGE}`);
    return 1;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  const root = path.resolve(args.root ?? CLI_REPO_ROOT);
  if (!existsSync(root)) {
    err(`error: --root ${root} does not exist.`);
    return 1;
  }
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  try {
    return await run({ args, where: layout(root), env, terminal });
  } catch (error) {
    if (error instanceof CancelledError) {
      err('Cancelled. Nothing was changed.');
      return 0;
    }
    if (error instanceof UsageError) {
      err(`error: ${error.message}\n\nRun "npm run songs -- help" for the commands and options.`);
      return 1;
    }
    if (error instanceof SongToolError || error instanceof SongLibraryError) {
      for (const line of error.message.split('\n')) err(`error: ${line}`);
      return 1;
    }
    err(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
  // Let pending output drain, but do not wait on anything left running.
  setTimeout(() => process.exit(code), 1000).unref();
});
