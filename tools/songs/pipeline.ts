/**
 * The bridge to tools/song_pipeline.py: beat analysis and Demucs. The Python side prints
 * progress on stderr and its result as one sentinel line on stdout.
 */
import { spawn } from 'node:child_process';
import { trackChild } from './cleanup';
import { SongToolError } from './errors';
import type { PythonChoice } from './paths';
import { parseDemucsProgress, type DemucsProgress } from './progress';

export const RESULT_SENTINEL = 'REHABEAT_RESULT';

export interface PreflightReport {
  python: string;
  executable: string;
  packages: Record<string, string | null>;
  commands: { ffmpeg: boolean; ffprobe: boolean; ffplay: boolean };
}

export interface AnalyzeReport {
  source: string;
  bpm: number;
  bpmHint: number | null;
  detectedTempo: number;
  tempo: number;
  beatCount: number;
  firstBeat: number | null;
  lastBeat: number | null;
  meanGapMs: number | null;
  jitterMs: number | null;
  durationSec: number;
  beatmapPath: string;
  clickPath: string | null;
}

export interface StemsReport {
  drums: string;
  melody: string;
  demucsSeconds: number;
  gainDb: number;
  sumPeakBeforeDbfs: number;
  sumPeakDbfs: number;
  targetDbfs: number;
}

export interface AnalyzeOptions {
  outDir: string;
  bpmHint?: number;
  click?: string;
}

export interface StemsOptions {
  outDir: string;
  separatedDir?: string;
  onProgress?: (progress: DemucsProgress) => void;
}

/** What the CLI needs from Python. The add flow takes one of these, so tests can fake it. */
export interface Pipeline {
  preflight(): Promise<PreflightReport>;
  analyze(audio: string, options: AnalyzeOptions): Promise<AnalyzeReport>;
  stems(audio: string, options: StemsOptions): Promise<StemsReport>;
}

/** The result line from the pipeline's stdout: the last line that starts with the sentinel. */
export function parseResultLine(stdout: string): Record<string, unknown> | null {
  const line = stdout
    .split(/\r?\n/)
    .filter((text) => text.startsWith(`${RESULT_SENTINEL} `))
    .at(-1);
  if (!line) return null;
  try {
    const value: unknown = JSON.parse(line.slice(RESULT_SENTINEL.length + 1));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ requirements

const ANALYSIS_PACKAGES = ['librosa', 'soundfile'];
const STEM_PACKAGES = ['demucs', 'torch', 'torchaudio'];

function slash(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): '\\' | '/' {
  // Git Bash eats backslashes, so print forward slashes there. PowerShell and cmd take either.
  return platform === 'win32' && !env.MSYSTEM ? '\\' : '/';
}

function venvFix(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { create: string; install: string } {
  const s = slash(platform, env);
  const python = platform === 'win32' ? `tools${s}.venv${s}Scripts${s}python.exe` : 'tools/.venv/bin/python';
  return {
    create: platform === 'win32' ? `py -3.11 -m venv tools${s}.venv` : 'python3.11 -m venv tools/.venv',
    install: `${python} -m pip install -r tools${s}requirements.txt`,
  };
}

function ffmpegFix(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'winget install Gyan.FFmpeg (then open a new terminal)';
  if (platform === 'darwin') return 'brew install ffmpeg';
  return 'sudo apt install ffmpeg (or your system\'s package manager)';
}

/** One line for a Python that would not start, naming it and the fix. */
export function missingPythonMessage(python: PythonChoice, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (python.from !== 'default') {
    const where = python.from === 'flag' ? '--python' : 'REHABEAT_PYTHON';
    return `Python not found at ${python.path} (from ${where}). Fix: point ${where} at a Python 3.11 with tools/requirements.txt installed.`;
  }
  const fix = venvFix(platform, env);
  return `The Python environment tools/.venv is missing. Fix (from the repo root): ${fix.create} then ${fix.install}`;
}

/**
 * One line per missing requirement, each with the exact fix. Empty when everything is there.
 * `stems` adds Demucs and PyTorch, which only the add command needs.
 */
export function missingRequirements(
  report: PreflightReport,
  needs: { stems: boolean },
  python: PythonChoice,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string[] {
  const problems: string[] = [];
  const wanted = needs.stems ? [...ANALYSIS_PACKAGES, ...STEM_PACKAGES] : ANALYSIS_PACKAGES;
  const missing = wanted.filter((name) => !report.packages[name]);
  if (missing.length > 0) {
    const install =
      python.from === 'default'
        ? venvFix(platform, env).install
        : `${python.path} -m pip install -r tools${slash(platform, env)}requirements.txt`;
    const names = missing.join(', ');
    problems.push(`${names} ${missing.length === 1 ? 'is' : 'are'} not installed in ${report.executable}. Fix: ${install}`);
  }
  const commands = (['ffmpeg', 'ffprobe'] as const).filter((name) => !report.commands[name]);
  if (commands.length > 0) {
    problems.push(`${commands.join(' and ')} ${commands.length === 1 ? 'is' : 'are'} not on PATH. Fix: ${ffmpegFix(platform)}`);
  }
  return problems;
}

// ------------------------------------------------------------------ running Python

export interface RunHooks {
  /** Each chunk of the pipeline's stderr (Demucs's progress bar included). */
  onStderr?: (chunk: string) => void;
}

/** Spawns the pipeline with an argument array (no shell; paths may hold spaces) and returns its result. */
export function runPipeline(
  python: PythonChoice,
  script: string,
  args: string[],
  hooks: RunHooks = {},
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(python.path, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: platform !== 'win32', // its own process group, so cleanup can stop Demucs with it
      env: { ...env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    });
    trackChild(child);
    let stdout = '';
    let stderrTail = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-8000);
      hooks.onStderr?.(chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new SongToolError(
          error.code === 'ENOENT' ? missingPythonMessage(python, platform, env) : `Could not start Python: ${error.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      const result = parseResultLine(stdout);
      if (code === 0 && result?.ok === true) {
        resolve(result);
        return;
      }
      const lastLine = stderrTail
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      const reason = typeof result?.error === 'string' ? result.error : lastLine?.replace(/^error:\s*/, '');
      reject(new SongToolError(reason ? `${reason}` : `song_pipeline.py stopped with exit code ${code}`));
    });
  });
}

export function pythonPipeline(python: PythonChoice, script: string): Pipeline {
  return {
    async preflight() {
      return (await runPipeline(python, script, ['preflight'])) as unknown as PreflightReport;
    },
    async analyze(audio, options) {
      const args = ['analyze', audio, '--out-dir', options.outDir];
      if (options.bpmHint !== undefined) args.push('--bpm-hint', String(options.bpmHint));
      if (options.click) args.push('--click', options.click);
      return (await runPipeline(python, script, args)) as unknown as AnalyzeReport;
    },
    async stems(audio, options) {
      const args = ['stems', audio, '--out-dir', options.outDir];
      if (options.separatedDir) args.push('--separated-dir', options.separatedDir);
      let tail = '';
      const result = await runPipeline(python, script, args, {
        onStderr(chunk) {
          tail = (tail + chunk).slice(-400); // a bar can be split across chunks
          const progress = parseDemucsProgress(tail);
          if (progress) options.onProgress?.(progress);
        },
      });
      return result as unknown as StemsReport;
    },
  };
}
