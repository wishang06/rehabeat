/**
 * Recovers the arguments of `npm run songs -- add x --title "T"` typed in Windows PowerShell.
 *
 * There `npm` is npm.ps1, a PowerShell script, and PowerShell removes the `--` before a
 * script sees it. npm then reads `--title`, `--yes` and the rest as its own (unknown)
 * options: it sets npm_config_title=true and so on, and hands the script only the
 * values, without their flag names. The order of the flags is lost with them.
 *
 * The telltale is an npm_config_<flag> variable for one of this CLI's flags while argv
 * lacks that flag. The original arguments are still on npm's own command line (node
 * npm-cli.js run songs add x --title "T"), so they are read back from the process tree.
 */
import { spawnSync } from 'node:child_process';
import { BOOLEAN_FLAGS, STRING_FLAGS } from './args';

const ALL_FLAGS = [...STRING_FLAGS, ...BOOLEAN_FLAGS];

/** True when npm swallowed one of this CLI's flags. */
export function npmAteFlags(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  if (!env.npm_lifecycle_event) return false;
  return ALL_FLAGS.some((name) => {
    const fromNpm = env[`npm_config_${name.replace(/-/g, '_')}`];
    const inArgv = argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    return fromNpm !== undefined && fromNpm !== '' && !inArgv;
  });
}

/** Splits a Windows command line the way CommandLineToArgvW and the C runtime do. */
export function splitWindowsCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let started = false;
  let i = 0;
  while (i < line.length) {
    const char = line[i];
    if (char === '\\') {
      // Backslashes are literal unless they come before a quote: then each pair is one
      // backslash, and an odd one out makes the quote literal.
      let slashes = 0;
      while (line[i] === '\\') {
        slashes += 1;
        i += 1;
      }
      if (line[i] === '"') {
        current += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2 === 1) {
          current += '"';
          i += 1;
        }
      } else {
        current += '\\'.repeat(slashes);
      }
      started = true;
    } else if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'; // "" inside quotes is a literal quote
        i += 2;
      } else {
        inQuotes = !inQuotes;
        i += 1;
      }
      started = true;
    } else if ((char === ' ' || char === '\t') && !inQuotes) {
      if (started) args.push(current);
      current = '';
      started = false;
      i += 1;
    } else {
      current += char;
      started = true;
      i += 1;
    }
  }
  if (started) args.push(current);
  return args;
}

/** npm's own options that people put after the script name; npm acted on them, so they are not ours. */
const NPM_FLAGS = new Set(['--silent', '-s', '--quiet', '-q', '--verbose', '-d', '-dd', '-ddd', '--if-present', '--foreground-scripts']);
const NPM_FLAGS_WITH_VALUE = new Set(['--loglevel']);

/** From npm's own argv (node npm-cli.js run songs ...), the arguments meant for the script. */
export function scriptArgsFromNpm(npmArgv: readonly string[], scriptName: string): string[] | null {
  const cli = npmArgv.findIndex((arg) => /npm-cli\.js$/i.test(arg));
  if (cli === -1) return null;
  const rest = npmArgv.slice(cli + 1);
  const run = rest.findIndex((arg) => ['run', 'run-script', 'rum', 'urn'].includes(arg));
  if (run === -1) return null;
  const name = rest.findIndex((arg, i) => i > run && arg === scriptName);
  if (name === -1) return null;
  const args = rest.slice(name + 1);
  const ours: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    if (NPM_FLAGS.has(arg) || [...NPM_FLAGS_WITH_VALUE].some((flag) => arg.startsWith(`${flag}=`))) continue;
    if (NPM_FLAGS_WITH_VALUE.has(arg)) {
      i += 1; // and its value
      continue;
    }
    ours.push(arg);
  }
  return ours;
}

/** npm's command line, found by walking up from this process (tsx and cmd.exe sit in between). Windows only. */
export function readNpmCommandLine(pid: number = process.pid): string | null {
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$id = ${Math.trunc(pid)}`,
    'for ($i = 0; $i -lt 12; $i++) {',
    '  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction SilentlyContinue',
    '  if ($null -eq $p) { break }',
    "  if ($p.CommandLine -match 'npm-cli\\.js') { [Console]::Out.Write($p.CommandLine); break }",
    '  $id = $p.ParentProcessId',
    '}',
  ].join('\n');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
  });
  const text = result.status === 0 ? result.stdout.trim() : '';
  return text || null;
}

export interface Recovered {
  argv: string[];
  /** Set when npm ate flags and they could not be recovered. */
  warning?: string;
}

export function recoverNpmArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  readCommandLine: () => string | null = () => readNpmCommandLine(),
): Recovered {
  if (!npmAteFlags(argv, env)) return { argv: [...argv] };
  const commandLine = platform === 'win32' ? readCommandLine() : null;
  const recovered = commandLine ? scriptArgsFromNpm(splitWindowsCommandLine(commandLine), env.npm_lifecycle_event ?? '') : null;
  if (recovered) return { argv: recovered };
  return {
    argv: [...argv],
    warning:
      'npm took this command\'s --flags as its own (PowerShell drops the "--" in "npm run songs -- ..."). ' +
      'Run it as: npm.cmd run songs -- <command> ...',
  };
}
