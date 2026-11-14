import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanInputPath, defaultPython, isHttpUrl, msysToWindows, resolvePython } from './paths';

describe('cleanInputPath: what a terminal pastes when a file is dragged in', () => {
  it.each([
    // PowerShell / Windows Terminal
    ["& 'C:\\Users\\x\\My Song.mp3'", 'C:\\Users\\x\\My Song.mp3'],
    ['& "C:\\Users\\x\\My Song.mp3"', 'C:\\Users\\x\\My Song.mp3'],
    ["'C:\\Users\\x\\My Song.mp3'", 'C:\\Users\\x\\My Song.mp3'],
    ["'C:\\Music\\Rock ''n'' Roll.mp3'", "C:\\Music\\Rock 'n' Roll.mp3"],
    // Explorer's "Copy as path"
    ['"C:\\Users\\x\\My Song.mp3"', 'C:\\Users\\x\\My Song.mp3'],
    // Git Bash / mintty
    ['/c/Users/x/My\\ Song.mp3', 'C:\\Users\\x\\My Song.mp3'],
    ["'/c/Users/x/My Song.mp3'", 'C:\\Users\\x\\My Song.mp3'],
    ['/d/Music/Song\\ \\(Live\\).wav', 'D:\\Music\\Song (Live).wav'],
    ['/cygdrive/c/Music/a.mp3', 'C:\\Music\\a.mp3'],
    // file:/// links
    ['file:///C:/Users/x/My%20Song.mp3', 'C:\\Users\\x\\My Song.mp3'],
    // Already plain: only trimmed
    ['  C:\\Users\\x\\song.mp3 \n', 'C:\\Users\\x\\song.mp3'],
    ['C:/Users/x/song.mp3', 'C:/Users/x/song.mp3'],
  ])('win32: %s', (raw, expected) => {
    expect(cleanInputPath(raw, 'win32')).toBe(expected);
  });

  it('keeps backslashes in an unquoted Windows path (they are separators, not escapes)', () => {
    expect(cleanInputPath('C:\\Users\\x\\a\\ b.mp3', 'win32')).toBe('C:\\Users\\x\\a\\ b.mp3');
  });

  it.each([
    ['/home/x/My\\ Song.mp3', '/home/x/My Song.mp3'],
    ["'/home/x/My Song.mp3'", '/home/x/My Song.mp3'],
    ['"/home/x/My Song.mp3"', '/home/x/My Song.mp3'],
    ['file:///home/x/My%20Song.mp3', '/home/x/My Song.mp3'],
    ['/c/Users/x/song.mp3', '/c/Users/x/song.mp3'], // only Windows turns /c/ into C:\
  ])('linux: %s', (raw, expected) => {
    expect(cleanInputPath(raw, 'linux')).toBe(expected);
  });

  it('expands ~ when given a home folder', () => {
    expect(cleanInputPath('~/Music/a.mp3', 'linux', '/home/x')).toBe(path.join('/home/x', 'Music/a.mp3'));
  });

  it('leaves a lone quote alone', () => {
    expect(cleanInputPath('"C:\\a.mp3', 'win32')).toBe('"C:\\a.mp3');
  });
});

describe('msysToWindows', () => {
  it('maps drive folders and leaves other POSIX paths', () => {
    expect(msysToWindows('/c')).toBe('C:\\');
    expect(msysToWindows('/e/x/y.mp3')).toBe('E:\\x\\y.mp3');
    expect(msysToWindows('/tmp/x.mp3')).toBe('/tmp/x.mp3');
    expect(msysToWindows('/usr/bin')).toBe('/usr/bin');
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) addresses only', () => {
    expect(isHttpUrl('https://example.org/a.mp3')).toBe(true);
    expect(isHttpUrl('HTTP://example.org')).toBe(true);
    expect(isHttpUrl('ftp://example.org/a.mp3')).toBe(false);
    expect(isHttpUrl('example.org/a.mp3')).toBe(false);
    expect(isHttpUrl('https://')).toBe(false);
  });
});

describe('resolvePython', () => {
  it('prefers --python, then REHABEAT_PYTHON, then the repo venv', () => {
    expect(resolvePython('C:\\py\\python.exe', { REHABEAT_PYTHON: 'other' }, 'C:\\repo', 'win32')).toEqual({
      path: 'C:\\py\\python.exe',
      from: 'flag',
    });
    expect(resolvePython(undefined, { REHABEAT_PYTHON: ' C:\\env\\python.exe ' }, 'C:\\repo', 'win32')).toEqual({
      path: 'C:\\env\\python.exe',
      from: 'env',
    });
    expect(resolvePython(undefined, {}, 'C:\\repo', 'win32')).toEqual({
      path: 'C:\\repo\\tools\\.venv\\Scripts\\python.exe',
      from: 'default',
    });
  });

  it('uses bin/python outside Windows', () => {
    expect(defaultPython('/repo', 'darwin')).toBe('/repo/tools/.venv/bin/python');
    expect(defaultPython('C:\\My Repo', 'win32')).toBe('C:\\My Repo\\tools\\.venv\\Scripts\\python.exe');
  });
});
