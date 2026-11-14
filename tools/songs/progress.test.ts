import { describe, expect, it } from 'vitest';
import { describeStemsProgress, parseDemucsProgress, remainingSec, roughStemsSec } from './progress';

// What Demucs 4's tqdm bar looks like on stderr (redrawn with \r), and torch.hub's model download.
const bar = (percent: number) =>
  `\r${String(percent).padStart(3)}%|${'#'.repeat(Math.round(percent / 5)).padEnd(20)}| 23.4/52.0 [00:10<00:12,  2.21seconds/s]`;

describe('parseDemucsProgress', () => {
  it('reads the percentage from a tqdm bar', () => {
    expect(parseDemucsProgress(bar(45))).toEqual({ percent: 45, phase: 'separating' });
    expect(parseDemucsProgress('100%|##########| 52.0/52.0 [00:22<00:00,  2.31seconds/s]\n')).toEqual({
      percent: 100,
      phase: 'separating',
    });
  });

  it('takes the latest bar when a chunk holds several redraws', () => {
    expect(parseDemucsProgress(`${bar(5)}${bar(12)}${bar(19)}`)?.percent).toBe(19);
  });

  it('keeps the last complete bar when a chunk ends half way through the next', () => {
    expect(parseDemucsProgress(`${bar(30)}\r 3`)?.percent).toBe(30);
  });

  it('ignores the rest of what Demucs prints', () => {
    expect(parseDemucsProgress('Selected model is a bag of 1 models. You will see that many progress bars per track.\n')).toBeNull();
    expect(parseDemucsProgress('Separated tracks will be stored in C:\\out\\htdemucs\n')).toBeNull();
    expect(parseDemucsProgress('')).toBeNull();
  });

  it('tells the first-run model download apart from the separation', () => {
    const download = '\r 37%|███▋      | 29.7M/80.2M [00:02<00:03, 14.9MB/s]';
    expect(parseDemucsProgress(download)).toEqual({ percent: 37, phase: 'downloading' });
    expect(parseDemucsProgress('\r  0%|          | 0.00/80.2M [00:00<?, ?B/s]')?.phase).toBe('downloading');
  });
});

describe('estimates', () => {
  it('projects the time left from the pace so far', () => {
    expect(remainingSec(30, 25)).toBe(90);
    expect(remainingSec(60, 100)).toBe(0);
    expect(remainingSec(10, 0)).toBeNull();
  });

  it('guesses from the song length before there is any progress', () => {
    expect(roughStemsSec(20)).toBe(54);
    expect(roughStemsSec(213)).toBeGreaterThan(150); // tools/README.md: 2.5 to 10 minutes for 3.5 minutes
    expect(roughStemsSec(213)).toBeLessThan(600);
  });

  it('describes each stage for the spinner', () => {
    expect(describeStemsProgress(5, null, 20)).toBe('Separating stems · 0:05 elapsed · usually about 0:54 for a 0:20 song');
    expect(describeStemsProgress(30, { percent: 25, phase: 'separating' }, 20)).toBe(
      'Separating stems: 25% · 0:30 elapsed · about 1:30 left',
    );
    expect(describeStemsProgress(4, { percent: 40, phase: 'downloading' }, 20)).toContain('Downloading the Demucs model');
  });
});
