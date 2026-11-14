import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo this CLI lives in: tools/songs/ is two folders down. Python and the pipeline script come from here. */
export const CLI_REPO_ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

/** Where everything is under a repo root (the real repo, or a temp copy given with --root). */
export interface Layout {
  root: string;
  songsDir: string;
  indexPath: string;
  creditsPath: string;
  outDir: string;
  stagingDir: string;
  downloadsDir: string;
  separatedDir: string;
  checksDir: string;
  previewDir: string;
  tracksDir: string;
}

export function layout(root: string): Layout {
  const outDir = path.join(root, 'tools', 'out');
  return {
    root,
    songsDir: path.join(root, 'public', 'songs'),
    indexPath: path.join(root, 'public', 'songs', 'index.json'),
    creditsPath: path.join(root, 'public', 'CREDITS.md'),
    outDir,
    stagingDir: path.join(outDir, 'staging'),
    downloadsDir: path.join(outDir, 'downloads'),
    separatedDir: path.join(outDir, 'separated'),
    checksDir: path.join(outDir, 'checks'),
    previewDir: path.join(outDir, 'preview'),
    tracksDir: path.join(root, 'tools', 'tracks'),
  };
}

export function songFolder(where: Layout, id: string): string {
  return path.join(where.songsDir, id);
}

export function stagingFolder(where: Layout, id: string): string {
  return path.join(where.stagingDir, id);
}

/** A path relative to the repo root with forward slashes, as git and the docs write it. */
export function repoRelative(where: Layout, file: string): string {
  return path.relative(where.root, file).split(path.sep).join('/');
}

// ------------------------------------------------------------------ python

export interface PythonChoice {
  path: string;
  /** Where the path came from, for error messages. */
  from: 'flag' | 'env' | 'default';
}

export function defaultPython(repoRoot: string, platform: NodeJS.Platform): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return platform === 'win32'
    ? p.join(repoRoot, 'tools', '.venv', 'Scripts', 'python.exe')
    : p.join(repoRoot, 'tools', '.venv', 'bin', 'python');
}

/** --python, else REHABEAT_PYTHON, else the repo's tools/.venv. */
export function resolvePython(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  platform: NodeJS.Platform,
): PythonChoice {
  if (flag) return { path: flag, from: 'flag' };
  const fromEnv = env.REHABEAT_PYTHON?.trim();
  if (fromEnv) return { path: fromEnv, from: 'env' };
  return { path: defaultPython(repoRoot, platform), from: 'default' };
}

// ------------------------------------------------------------------ pasted paths

export function isHttpUrl(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function stripMatchingQuotes(text: string): { text: string; quote: string | null } {
  for (const quote of ['"', "'"]) {
    if (text.length >= 2 && text.startsWith(quote) && text.endsWith(quote)) {
      return { text: text.slice(1, -1), quote };
    }
  }
  return { text, quote: null };
}

/** /c/Users/x (Git Bash, MSYS, Cygwin) -> C:\Users\x. Other paths are returned unchanged. */
export function msysToWindows(text: string): string {
  const match = /^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?:\/(.*))?$/.exec(text);
  if (!match) return text;
  const rest = (match[2] ?? '').replace(/\//g, '\\');
  return `${match[1].toUpperCase()}:\\${rest}`;
}

/**
 * Turns whatever a terminal produced when a file was dragged or pasted in into a plain path:
 *
 * - PowerShell: `& 'C:\My Song.mp3'` or `'C:\Rock ''n'' Roll.mp3'`
 * - Explorer's "Copy as path": `"C:\My Song.mp3"`
 * - Git Bash / mintty: `/c/Users/x/My\ Song.mp3` or `'/c/Users/x/My Song.mp3'` (a Windows path on win32)
 * - `file:///C:/My%20Song.mp3`
 *
 * Text that is already a plain path comes back trimmed and otherwise unchanged.
 */
export function cleanInputPath(raw: string, platform: NodeJS.Platform = process.platform, home?: string): string {
  let text = raw.trim();
  if (text.startsWith('& ')) text = text.slice(2).trim();
  const unquoted = stripMatchingQuotes(text);
  text = unquoted.text;

  if (/^file:\/\//i.test(text)) {
    try {
      return fileURLToPath(text, { windows: platform === 'win32' });
    } catch {
      return text;
    }
  }

  if (unquoted.quote === "'" && platform === 'win32' && !text.startsWith('/')) {
    text = text.replace(/''/g, "'"); // PowerShell doubles a quote inside single quotes
  }
  if (unquoted.quote === null && (text.startsWith('/') || text.startsWith('~/'))) {
    text = text.replace(/\\(.)/g, '$1'); // a POSIX shell escapes spaces and brackets with backslashes
  }
  if (home && (text === '~' || text.startsWith('~/') || text.startsWith('~\\'))) {
    text = path.join(home, text.slice(2));
  }
  if (platform === 'win32') text = msysToWindows(text);
  return text;
}
