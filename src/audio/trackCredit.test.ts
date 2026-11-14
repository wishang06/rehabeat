import { describe, expect, it } from 'vitest';
import { TRACK_CREDIT } from './trackCredit';

// public/CREDITS.md is the record of where the music came from; the in-game credit must agree with it.
const creditsFile = Object.values(
  import.meta.glob<string>('/public/CREDITS.md', { eager: true, query: '?raw', import: 'default' }),
)[0];

describe('TRACK_CREDIT', () => {
  it('credits "Past Sadness" by Kevin MacLeod under CC BY 4.0', () => {
    expect(TRACK_CREDIT).toMatchObject({
      title: 'Past Sadness',
      artist: 'Kevin MacLeod',
      sourceName: 'incompetech.com',
      licenceName: 'CC BY 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    });
  });

  it('links the source on incompetech.com', () => {
    expect(new URL(TRACK_CREDIT.sourceUrl).hostname).toBe('incompetech.com');
  });

  it('says how the track was changed, as CC BY asks', () => {
    expect(TRACK_CREDIT.changes).toBe('Separated into drum and melody stems by the Rehabeat team.');
  });

  it.runIf(creditsFile !== undefined)('matches public/CREDITS.md', () => {
    expect(creditsFile).toContain(`"${TRACK_CREDIT.title}" by ${TRACK_CREDIT.artist}`);
    expect(creditsFile).toContain(TRACK_CREDIT.sourceUrl);
    expect(creditsFile).toContain(TRACK_CREDIT.licenceUrl);
  });
});
