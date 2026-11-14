export type AudioKind = 'mp3' | 'wav' | 'ogg' | 'flac';

export type Sniff =
  | { audio: true; kind: AudioKind }
  | { audio: false; looksLike: 'html' | 'text' | 'empty' | 'unknown' };

/** Enough bytes to see past leading whitespace before an HTML tag. */
export const SNIFF_BYTES = 512;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function isMp3FrameSync(bytes: Uint8Array): boolean {
  if (bytes.length < 3 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false;
  const version = (bytes[1] >> 3) & 0b11;
  const layer = (bytes[1] >> 1) & 0b11;
  const bitrate = bytes[2] >> 4;
  // 01 is a reserved version, 00 a reserved layer (AAC's ADTS header has it) and 1111 a bad bitrate.
  return version !== 0b01 && layer !== 0b00 && bitrate !== 0b1111;
}

/**
 * What the first bytes of a download are: one of the audio formats the pipeline reads
 * (an ID3 tag or an MP3 frame, RIFF/WAVE, OggS, fLaC) or, for the usual mistake of
 * downloading a song's web page instead of the song, HTML.
 */
export function sniffAudio(bytes: Uint8Array): Sniff {
  if (bytes.length === 0) return { audio: false, looksLike: 'empty' };
  if (ascii(bytes, 0, 3) === 'ID3' || isMp3FrameSync(bytes)) return { audio: true, kind: 'mp3' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return { audio: true, kind: 'wav' };
  if (ascii(bytes, 0, 4) === 'OggS') return { audio: true, kind: 'ogg' };
  if (ascii(bytes, 0, 4) === 'fLaC') return { audio: true, kind: 'flac' };

  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, SNIFF_BYTES))
    .replace(/^﻿/, '')
    .trimStart()
    .toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || /^<(head|body|meta|script|title)\b/.test(head)) {
    return { audio: false, looksLike: 'html' };
  }
  if (head.startsWith('<') && head.includes('<html')) return { audio: false, looksLike: 'html' };
  const sample = bytes.subarray(0, Math.min(bytes.length, 64));
  const printable = sample.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127));
  return { audio: false, looksLike: printable ? 'text' : 'unknown' };
}

/** "49 44 33 04" style, for an error message about an unknown file. */
export function hexPreview(bytes: Uint8Array, count = 8): string {
  return [...bytes.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
}
