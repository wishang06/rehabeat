import { describe, expect, it } from 'vitest';
import { ffprobeArgs, parseFfprobe, titleFromFileName } from './probe';

describe('parseFfprobe', () => {
  it('reads the duration and the title and artist tags', () => {
    const output = JSON.stringify({
      format: { duration: '213.394286', tags: { title: 'Past Sadness', artist: 'Kevin MacLeod', genre: 'Ambient' } },
    });
    expect(parseFfprobe(output)).toEqual({ durationSec: 213.394286, title: 'Past Sadness', artist: 'Kevin MacLeod' });
  });

  it('accepts tag names in any case', () => {
    expect(parseFfprobe({ format: { tags: { TITLE: 'Loud', ARTIST: 'Caps' } } })).toMatchObject({ title: 'Loud', artist: 'Caps' });
    expect(parseFfprobe({ format: { tags: { Title: 'Mixed', Artist: 'Case' } } })).toMatchObject({ title: 'Mixed', artist: 'Case' });
  });

  it('falls back to the album artist and to stream tags (where OGG keeps them)', () => {
    expect(parseFfprobe({ format: { tags: { album_artist: 'Band' } } }).artist).toBe('Band');
    const ogg = { format: { duration: '12.5' }, streams: [{ tags: { TITLE: 'Ogg Song', ARTIST: 'Ogg Artist' } }] };
    expect(parseFfprobe(ogg)).toEqual({ durationSec: 12.5, title: 'Ogg Song', artist: 'Ogg Artist' });
  });

  it('prefers the file tags to the stream tags, and trims', () => {
    const output = { format: { tags: { title: '  File  ' } }, streams: [{ tags: { title: 'Stream' } }] };
    expect(parseFfprobe(output).title).toBe('File');
  });

  it('returns nulls for missing, blank or malformed data', () => {
    expect(parseFfprobe('not json')).toEqual({ durationSec: null, title: null, artist: null });
    expect(parseFfprobe({ format: { duration: 'N/A', tags: { title: '   ' } } })).toEqual({ durationSec: null, title: null, artist: null });
    expect(parseFfprobe({ streams: 'nope' })).toEqual({ durationSec: null, title: null, artist: null });
  });

  it('asks ffprobe for exactly the duration and tags, as JSON', () => {
    expect(ffprobeArgs('C:\\My Song.mp3')).toEqual([
      '-v', 'error', '-show_entries', 'format=duration:format_tags:stream_tags', '-of', 'json', 'C:\\My Song.mp3',
    ]); // prettier-ignore
  });
});

describe('titleFromFileName', () => {
  it('uses the file name without its extension or underscores', () => {
    expect(titleFromFileName('C:\\Music\\My_Great_Song.mp3')).toBe('My Great Song');
    expect(titleFromFileName('/x/kevin-macleod-past-sadness.mp3')).toBe('kevin-macleod-past-sadness');
    expect(titleFromFileName('.mp3')).toBe('Untitled');
  });

  it('strips the folder of a Windows path on any platform (CI runs on Linux)', () => {
    expect(titleFromFileName('D:\\Downloads\\songs/Calm_Track.wav')).toBe('Calm Track');
    expect(titleFromFileName('\\\\server\\share\\Song.mp3')).toBe('Song');
  });
});
