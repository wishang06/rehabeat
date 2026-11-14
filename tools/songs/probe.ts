import { spawn } from 'node:child_process';
import path from 'node:path';
import { SongToolError } from './errors';

export interface ProbeInfo {
  durationSec: number | null;
  title: string | null;
  artist: string | null;
}

/** The ffprobe call: duration plus the tags of the file and its streams (OGG keeps its tags on the stream). */
export function ffprobeArgs(file: string): string[] {
  return ['-v', 'error', '-show_entries', 'format=duration:format_tags:stream_tags', '-of', 'json', file];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A tag by name in any case: TITLE, title and Title are the same tag. */
function tag(tags: Record<string, unknown>[], names: string[]): string | null {
  for (const name of names) {
    for (const group of tags) {
      for (const [key, value] of Object.entries(group)) {
        if (key.toLowerCase() === name && typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  }
  return null;
}

/** Reads ffprobe's JSON output. Anything missing or malformed comes back as null. */
export function parseFfprobe(output: string | unknown): ProbeInfo {
  let data: unknown = output;
  if (typeof output === 'string') {
    try {
      data = JSON.parse(output);
    } catch {
      return { durationSec: null, title: null, artist: null };
    }
  }
  const format = isRecord(data) && isRecord(data.format) ? data.format : {};
  const streams = isRecord(data) && Array.isArray(data.streams) ? data.streams.filter(isRecord) : [];
  const tags = [format.tags, ...streams.map((stream) => stream.tags)].filter(isRecord);

  const duration = Number(format.duration);
  return {
    durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
    title: tag(tags, ['title']),
    artist: tag(tags, ['artist', 'album_artist', 'albumartist', 'performer']),
  };
}

/** A title to offer when the file has no title tag: the file name, without the extension or underscores. */
export function titleFromFileName(file: string): string {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  return base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

export async function ffprobe(file: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ffprobeArgs(file), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        new SongToolError(
          error.code === 'ENOENT' ? 'ffprobe is not on PATH (it comes with ffmpeg).' : `ffprobe failed: ${error.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve(parseFfprobe(stdout));
      else {
        const reason = stderr.trim().split(/\r?\n/).pop() || `exit code ${code}`;
        reject(new SongToolError(`ffprobe could not read ${path.basename(file)}: ${reason}`));
      }
    });
  });
}
