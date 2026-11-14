/** Playing audio for the click check and previews: ffplay if it is installed, else the OS default player. */
import { spawn, spawnSync } from 'node:child_process';
import { trackChild } from './cleanup';

/** Whether a program (ffplay, ffmpeg) starts: `<name> -version` exits 0. */
export function hasCommand(name: string): boolean {
  const result = spawnSync(name, ['-version'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
  return result.status === 0;
}

export interface PlayOptions {
  startSec?: number;
  durationSec?: number;
  fadeSec?: number;
}

export interface PlayHandle {
  /** "ffplay" or "the default player". */
  via: string;
  /** Resolves when playback ends (at once for the default player, which runs on its own). */
  done: Promise<void>;
  stop(): void;
}

export interface Player {
  play(file: string, options?: PlayOptions): PlayHandle;
}

export function ffplayArgs(file: string, options: PlayOptions = {}): string[] {
  const args = ['-nodisp', '-autoexit', '-loglevel', 'error'];
  if (options.startSec !== undefined) args.push('-ss', options.startSec.toFixed(2));
  if (options.durationSec !== undefined) args.push('-t', String(options.durationSec));
  if (options.fadeSec && options.durationSec) {
    // asetpts restarts the clock at the seek point, so the fades are timed from 0.
    const fade = options.fadeSec;
    const outAt = Math.max(0, options.durationSec - fade);
    args.push('-af', `asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${outAt}:d=${fade}`);
  }
  args.push(file);
  return args;
}

/** How to open a file in the OS's default app. On Windows `start` is a cmd built-in, quoted by hand. */
export function openCommand(
  file: string,
  platform: NodeJS.Platform,
): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/d', '/c', 'start', '""', `"${file}"`], windowsVerbatimArguments: true };
  }
  if (platform === 'darwin') return { command: 'open', args: [file] };
  return { command: 'xdg-open', args: [file] };
}

export function systemPlayer(hasFfplay: boolean, platform: NodeJS.Platform = process.platform): Player {
  return {
    play(file, options = {}) {
      if (hasFfplay) {
        const child = spawn('ffplay', ffplayArgs(file, options), { stdio: 'ignore', windowsHide: true });
        trackChild(child);
        const done = new Promise<void>((resolve) => {
          child.on('close', () => resolve());
          child.on('error', () => resolve());
        });
        return { via: 'ffplay', done, stop: () => child.exitCode === null && child.kill() };
      }
      const open = openCommand(file, platform);
      const child = spawn(open.command, open.args, {
        stdio: 'ignore',
        windowsHide: true,
        detached: platform !== 'win32',
        windowsVerbatimArguments: open.windowsVerbatimArguments,
      });
      child.on('error', () => undefined);
      child.unref();
      return { via: 'the default player', done: Promise.resolve(), stop: () => undefined };
    },
  };
}
