import { describe, expect, it } from 'vitest';
import { parseCli } from './args';
import { UsageError } from './errors';
import { npmAteFlags, recoverNpmArgs, scriptArgsFromNpm, splitWindowsCommandLine } from './npmArgs';

describe('parseCli', () => {
  it('reads add with every flag', () => {
    const args = parseCli([
      'add', 'C:\\My Song.mp3',
      '--title', 'Click 72', '--artist', 'Rehabeat test', '--licence', 'CC BY 4.0',
      '--source-url', 'https://example.org/x', '--id', 'click-72', '--catalogue', 'steady-flow',
      '--difficulty', 'gentle', '--bpm-hint', '70', '--max-jitter', '8', '--keep-source', '--yes',
      '--root', 'C:\\tmp\\root', '--python', 'C:\\py.exe',
    ]); // prettier-ignore
    expect(args).toMatchObject({
      command: 'add',
      positionals: ['C:\\My Song.mp3'],
      title: 'Click 72',
      artist: 'Rehabeat test',
      licence: 'CC BY 4.0',
      sourceUrl: 'https://example.org/x',
      id: 'click-72',
      catalogue: 'steady-flow',
      difficulty: 'gentle',
      bpmHint: 70,
      maxJitter: 8,
      keepSource: true,
      yes: true,
      root: 'C:\\tmp\\root',
      python: 'C:\\py.exe',
    });
  });

  it('has defaults, a menu with no command, and accepts the US spellings', () => {
    expect(parseCli([])).toMatchObject({ command: null, maxJitter: 10, yes: false, keepSource: false });
    expect(parseCli(['add', 'x', '--license', 'CC0', '--catalog', 'calm-stretch'])).toMatchObject({
      licence: 'CC0',
      catalogue: 'calm-stretch',
    });
    expect(parseCli(['remove', 'x', '-y']).yes).toBe(true);
    expect(parseCli(['help']).help).toBe(true);
  });

  it.each([
    [['dance'], /Unknown command "dance"/],
    [['list', 'extra'], /takes no arguments/],
    [['move', 'a', 'b', 'c'], /at most 2/],
    [['add', 'x', '--bpm-hint', 'fast'], /--bpm-hint needs a positive number/],
    [['add', 'x', '--max-jitter', '0'], /--max-jitter needs a positive number/],
    [['add', 'x', '--difficulty', 'hard'], /--difficulty must be one of gentle, steady, active/],
    [['add', 'x', '--colour', 'red'], /colour/],
    [['add', 'x', '--title', '  '], /--title needs a value/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCli(argv)).toThrow(UsageError);
    expect(() => parseCli(argv)).toThrow(message);
  });
});

describe('recovering flags that PowerShell and npm swallowed', () => {
  // What `npm run songs -- add "C:\My Song.mp3" --title "Click 72" --yes` gives the script in
  // Windows PowerShell (npm.ps1 loses the "--", so npm keeps the flags and passes only values).
  const mangledArgv = ['add', 'C:\\My Song.mp3', 'Click 72'];
  const mangledEnv = { npm_lifecycle_event: 'songs', npm_config_title: 'true', npm_config_yes: 'true' };
  const npmCommandLine =
    '"C:\\Program Files\\nodejs/node.exe" "C:\\Program Files\\nodejs/node_modules/npm/bin/npm-cli.js" ' +
    'run songs add "C:\\My Song.mp3" --title "Click 72" --yes';

  it('spots the flags npm took', () => {
    expect(npmAteFlags(mangledArgv, mangledEnv)).toBe(true);
    expect(npmAteFlags(['add', 'x', '--title', 'T'], { npm_lifecycle_event: 'songs', npm_config_title: 'true' })).toBe(false);
    expect(npmAteFlags(['list'], { npm_lifecycle_event: 'songs', npm_config_cache: 'C:\\cache' })).toBe(false);
    expect(npmAteFlags(['add', 'x'], { npm_config_yes: 'true' })).toBe(false); // not run by npm
  });

  it('splits a Windows command line like the C runtime', () => {
    expect(splitWindowsCommandLine(npmCommandLine)).toEqual([
      'C:\\Program Files\\nodejs/node.exe',
      'C:\\Program Files\\nodejs/node_modules/npm/bin/npm-cli.js',
      'run', 'songs', 'add', 'C:\\My Song.mp3', '--title', 'Click 72', '--yes',
    ]); // prettier-ignore
    expect(splitWindowsCommandLine('a "b c" d\\e "f\\"g" "h""i" \\\\"j k"')).toEqual(['a', 'b c', 'd\\e', 'f"g', 'h"i', '\\j k']);
    expect(splitWindowsCommandLine('  spaced   out  ""  ')).toEqual(['spaced', 'out', '']);
  });

  it("takes the script's arguments from npm's own", () => {
    const npmArgv = splitWindowsCommandLine(npmCommandLine);
    expect(scriptArgsFromNpm(npmArgv, 'songs')).toEqual(['add', 'C:\\My Song.mp3', '--title', 'Click 72', '--yes']);
    expect(scriptArgsFromNpm(['node', 'npm-cli.js', 'run', 'songs', '--', 'list'], 'songs')).toEqual(['list']);
    expect(scriptArgsFromNpm(['node', 'other.js', 'run', 'songs'], 'songs')).toBeNull();
  });

  it("drops npm's own options, which npm already acted on", () => {
    // `npm run songs --silent -- move x calm-stretch --root R` in PowerShell (the "--" is gone).
    const npmArgv = ['node', 'npm-cli.js', 'run', 'songs', '--silent', 'move', 'x', 'calm-stretch', '--root', 'R'];
    expect(scriptArgsFromNpm(npmArgv, 'songs')).toEqual(['move', 'x', 'calm-stretch', '--root', 'R']);
    expect(scriptArgsFromNpm(['node', 'npm-cli.js', 'run', 'songs', '--loglevel', 'warn', '-s', 'list'], 'songs')).toEqual(['list']);
    expect(scriptArgsFromNpm(['node', 'npm-cli.js', 'run', 'songs', '--loglevel=warn', 'list'], 'songs')).toEqual(['list']);
  });

  it('puts the recovered arguments through, or warns when it cannot', () => {
    expect(recoverNpmArgs(mangledArgv, mangledEnv, 'win32', () => npmCommandLine)).toEqual({
      argv: ['add', 'C:\\My Song.mp3', '--title', 'Click 72', '--yes'],
    });
    const failed = recoverNpmArgs(mangledArgv, mangledEnv, 'win32', () => null);
    expect(failed.argv).toEqual(mangledArgv);
    expect(failed.warning).toContain('npm.cmd run songs --');
    expect(recoverNpmArgs(['list'], {}, 'win32', () => 'unused')).toEqual({ argv: ['list'] });
  });
});
