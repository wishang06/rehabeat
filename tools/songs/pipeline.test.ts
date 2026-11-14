import { describe, expect, it } from 'vitest';
import { missingPythonMessage, missingRequirements, parseResultLine, RESULT_SENTINEL, type PreflightReport } from './pipeline';

const report = (overrides: Partial<PreflightReport> = {}): PreflightReport => ({
  python: '3.11.9',
  executable: 'C:\\repo\\tools\\.venv\\Scripts\\python.exe',
  packages: { librosa: '0.11.0', soundfile: '0.14.0', demucs: '4.0.1', torch: '2.8.0', torchaudio: '2.8.0' },
  commands: { ffmpeg: true, ffprobe: true, ffplay: true },
  ...overrides,
});
const venv = { path: 'C:\\repo\\tools\\.venv\\Scripts\\python.exe', from: 'default' as const };

describe('parseResultLine', () => {
  it('finds the sentinel line among what Demucs prints on the same stdout', () => {
    const stdout = [
      'Selected model is a bag of 1 models. You will see that many progress bars per track.',
      'Separated tracks will be stored in C:\\out\\htdemucs',
      `${RESULT_SENTINEL} {"ok": true, "command": "stems", "demucsSeconds": 61.9}`,
      '',
    ].join('\r\n');
    expect(parseResultLine(stdout)).toEqual({ ok: true, command: 'stems', demucsSeconds: 61.9 });
  });

  it('returns null without a valid result line', () => {
    expect(parseResultLine('Traceback (most recent call last):\n')).toBeNull();
    expect(parseResultLine(`${RESULT_SENTINEL} {not json`)).toBeNull();
    expect(parseResultLine(`${RESULT_SENTINEL} [1, 2]`)).toBeNull();
  });
});

describe('missingRequirements', () => {
  it('is empty when everything is installed', () => {
    expect(missingRequirements(report(), { stems: true }, venv, 'win32', {})).toEqual([]);
  });

  it('names missing packages with the pip command, in PowerShell form', () => {
    const problems = missingRequirements(
      report({ packages: { librosa: null, soundfile: '0.14.0', demucs: null, torch: '2.8.0', torchaudio: '2.8.0' } }),
      { stems: true },
      venv,
      'win32',
      {},
    );
    expect(problems).toEqual([
      'librosa, demucs are not installed in C:\\repo\\tools\\.venv\\Scripts\\python.exe. ' +
        'Fix: tools\\.venv\\Scripts\\python.exe -m pip install -r tools\\requirements.txt',
    ]);
  });

  it('prints forward slashes in Git Bash, which eats backslashes', () => {
    const problems = missingRequirements(report({ packages: { librosa: null } }), { stems: false }, venv, 'win32', {
      MSYSTEM: 'MINGW64',
    });
    expect(problems[0]).toContain('Fix: tools/.venv/Scripts/python.exe -m pip install -r tools/requirements.txt');
  });

  it('only needs Demucs and PyTorch for stems', () => {
    const noDemucs = report({ packages: { librosa: '0.11.0', soundfile: '0.14.0', demucs: null, torch: null, torchaudio: null } });
    expect(missingRequirements(noDemucs, { stems: false }, venv, 'win32', {})).toEqual([]);
    expect(missingRequirements(noDemucs, { stems: true }, venv, 'win32', {})[0]).toMatch(/^demucs, torch, torchaudio are not installed/);
  });

  it('names a missing ffmpeg with the install command for the platform', () => {
    const noFfmpeg = report({ commands: { ffmpeg: false, ffprobe: false, ffplay: false } });
    expect(missingRequirements(noFfmpeg, { stems: true }, venv, 'win32', {})).toEqual([
      'ffmpeg and ffprobe are not on PATH. Fix: winget install Gyan.FFmpeg (then open a new terminal)',
    ]);
    expect(missingRequirements(noFfmpeg, { stems: true }, venv, 'darwin', {})[0]).toContain('brew install ffmpeg');
  });

  it('uses the custom Python in the fix when --python was given', () => {
    const custom = { path: 'D:\\py311\\python.exe', from: 'flag' as const };
    expect(missingRequirements(report({ packages: {} }), { stems: false }, custom, 'win32', {})[0]).toContain(
      'Fix: D:\\py311\\python.exe -m pip install -r tools\\requirements.txt',
    );
  });
});

describe('missingPythonMessage', () => {
  it('gives the venv commands for a missing tools/.venv, on one line', () => {
    const message = missingPythonMessage(venv, 'win32', {});
    expect(message).toBe(
      'The Python environment tools/.venv is missing. Fix (from the repo root): py -3.11 -m venv tools\\.venv ' +
        'then tools\\.venv\\Scripts\\python.exe -m pip install -r tools\\requirements.txt',
    );
    expect(message.includes('\n')).toBe(false);
  });

  it('names the setting a custom Python came from', () => {
    expect(missingPythonMessage({ path: 'X:\\python.exe', from: 'env' }, 'win32', {})).toContain('REHABEAT_PYTHON');
    expect(missingPythonMessage({ path: 'X:\\python.exe', from: 'flag' }, 'win32', {})).toContain('--python');
  });
});
