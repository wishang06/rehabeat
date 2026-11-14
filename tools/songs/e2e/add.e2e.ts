/**
 * The real thing, end to end: `songs add ... --yes` as a child process, with the real
 * Python pipeline, Demucs and ffmpeg, into a temporary repo root. Slow (a minute or
 * more for Demucs), so it is not part of `npm test`; run it with `npm run test:songs`.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseIndex, parseMeta } from '../../../src/songs/library';
import { jitterMs } from '../../../src/songs/model';
import { CLI_REPO_ROOT } from '../paths';
import { clickTrackWav } from '../testing/wav';

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');
const CLI = path.join(CLI_REPO_ROOT, 'tools', 'songs', 'cli.ts');
const TEAM_TEXT = '# Music credits\n\nWritten by hand. Leave this alone.\n';

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
  seconds: number;
}

function runCli(args: string[]): Promise<Result> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI, ...args], {
      cwd: CLI_REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, seconds: (Date.now() - started) / 1000 }));
  });
}

/** Decodes an audio file to interleaved stereo float samples with ffmpeg. */
function decode(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', '44100', '-'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not decode ${file}`));
      const bytes = new Uint8Array(Buffer.concat(chunks)); // a copy, aligned for Float32Array
      resolve(new Float32Array(bytes.buffer, 0, Math.floor(bytes.length / 4)));
    });
  });
}

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe('songs add --yes, end to end', () => {
  it('adds a generated 72 BPM click track to a fresh library', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rehabeat-e2e-'));
    roots.push(root);
    // A minimal repo root: no index.json (the CLI creates it) and a hand-written CREDITS.md.
    await mkdir(path.join(root, 'public'), { recursive: true });
    await writeFile(path.join(root, 'public', 'CREDITS.md'), TEAM_TEXT);
    const wav = path.join(root, 'incoming', 'click 72.wav');
    await mkdir(path.dirname(wav), { recursive: true });
    await writeFile(wav, clickTrackWav({ bpm: 72, seconds: 20 }));

    const result = await runCli([
      'add', wav, '--root', root,
      '--title', 'Click 72', '--artist', 'Rehabeat test', '--licence', 'CC0',
      '--source-url', 'https://example.org/click-72', '--yes',
    ]); // prettier-ignore

    expect(result.code, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    const demucs = /^\s*Demucs\s+([\d.]+) s$/m.exec(result.stdout)?.[1];
    console.log(`songs add took ${result.seconds.toFixed(1)} s in all; Demucs ${demucs} s.`);
    expect(demucs).toBeDefined();

    const folder = path.join(root, 'public', 'songs', 'click-72');
    for (const file of ['meta.json', 'beatmap.json', 'drums.mp3', 'melody.mp3']) {
      expect(existsSync(path.join(folder, file)), file).toBe(true);
    }

    const meta = parseMeta(JSON.parse(await readFile(path.join(folder, 'meta.json'), 'utf8')), 'click-72');
    expect(meta).toMatchObject({ title: 'Click 72', artist: 'Rehabeat test', licence: 'CC0-1.0', catalogue: 'steady-flow' });
    expect(Math.abs(meta.bpm - 72)).toBeLessThanOrEqual(1);
    expect(meta.durationSec).toBeCloseTo(20, 1);

    const beatmap = JSON.parse(await readFile(path.join(folder, 'beatmap.json'), 'utf8'));
    expect(Object.keys(beatmap).sort()).toEqual(['beats', 'bpm', 'downbeats', 'offset', 'source']);
    expect(beatmap.bpm).toBe(meta.bpm);
    expect(jitterMs(beatmap.beats)).toBeLessThan(10);

    const index = parseIndex(JSON.parse(await readFile(path.join(root, 'public', 'songs', 'index.json'), 'utf8')));
    expect(index.catalogues.find((catalogue) => catalogue.id === 'steady-flow')?.songIds).toEqual(['click-72']);
    expect(index.catalogues.map((catalogue) => catalogue.id)).toEqual(['calm-stretch', 'steady-flow', 'active-rehab']);

    const credits = await readFile(path.join(root, 'public', 'CREDITS.md'), 'utf8');
    expect(credits.startsWith(TEAM_TEXT)).toBe(true);
    expect(credits).toContain(meta.creditLine);

    // The stems are levelled together: drums + melody peak at about -12 dBFS.
    const [drums, melody] = await Promise.all([decode(path.join(folder, 'drums.mp3')), decode(path.join(folder, 'melody.mp3'))]);
    let peak = 0;
    for (let i = 0; i < Math.min(drums.length, melody.length); i += 1) peak = Math.max(peak, Math.abs(drums[i] + melody[i]));
    const peakDbfs = 20 * Math.log10(peak);
    console.log(`drums + melody peak at ${peakDbfs.toFixed(2)} dBFS`);
    expect(Math.abs(peakDbfs - -12)).toBeLessThan(0.5);

    expect(result.stdout).toContain('To commit it: git add public/songs/click-72 public/songs/index.json public/CREDITS.md');
    expect(existsSync(path.join(root, 'tools', 'out', 'checks', 'click-72.wav'))).toBe(true);
    expect(existsSync(path.join(root, 'tools', 'out', 'staging', 'click-72'))).toBe(false);
  });
});
