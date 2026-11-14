import { describe, expect, it } from 'vitest';
import { hexPreview, sniffAudio } from './sniff';
import { encodeWav } from './testing/wav';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffAudio', () => {
  it('recognises the four audio formats', () => {
    expect(sniffAudio(text('ID3\u0004\u0000\u0000'))).toEqual({ audio: true, kind: 'mp3' });
    expect(sniffAudio(bytes(0xff, 0xfb, 0x90, 0x64))).toEqual({ audio: true, kind: 'mp3' }); // MPEG-1 layer III
    expect(sniffAudio(bytes(0xff, 0xf3, 0x48, 0xc4))).toEqual({ audio: true, kind: 'mp3' }); // MPEG-2 layer III
    expect(sniffAudio(encodeWav(new Float32Array(10), 44100, 1))).toEqual({ audio: true, kind: 'wav' });
    expect(sniffAudio(text('OggS\u0000\u0002'))).toEqual({ audio: true, kind: 'ogg' });
    expect(sniffAudio(text('fLaC\u0000\u0000\u0000"'))).toEqual({ audio: true, kind: 'flac' });
  });

  it('is not fooled by headers that only look similar', () => {
    expect(sniffAudio(bytes(0xff, 0xf1, 0x50, 0x80)).audio).toBe(false); // AAC ADTS: layer bits 00
    expect(sniffAudio(text('RIFF\u0000\u0000\u0000\u0000AVI ')).audio).toBe(false);
    expect(sniffAudio(bytes(0xff, 0xfb, 0xf0, 0x00)).audio).toBe(false); // bitrate index 1111
  });

  it('calls out a web page, the usual wrong download', () => {
    expect(sniffAudio(text('<!DOCTYPE html><html><head>'))).toEqual({ audio: false, looksLike: 'html' });
    expect(sniffAudio(text('﻿\r\n  <html lang="en">'))).toEqual({ audio: false, looksLike: 'html' });
    expect(sniffAudio(text('<head><title>Download</title>'))).toEqual({ audio: false, looksLike: 'html' });
    expect(sniffAudio(text('<?xml version="1.0"?><html>'))).toEqual({ audio: false, looksLike: 'html' });
  });

  it('tells text, nothing and unknown binary apart', () => {
    expect(sniffAudio(text('{"error": "not found"}'))).toEqual({ audio: false, looksLike: 'text' });
    expect(sniffAudio(new Uint8Array())).toEqual({ audio: false, looksLike: 'empty' });
    expect(sniffAudio(bytes(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70))).toEqual({ audio: false, looksLike: 'unknown' });
  });

  it('previews bytes as hex', () => {
    expect(hexPreview(bytes(0x49, 0x44, 0x33, 0x04, 0x00), 4)).toBe('49 44 33 04');
  });
});
