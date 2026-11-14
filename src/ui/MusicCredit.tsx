import { TRACK_CREDIT } from '../audio/trackCredit';

/** The CC BY attribution for the shipped track. Links open in a new tab so a running session is not lost. */
export function MusicCredit() {
  const { title, artist, sourceName, sourceUrl, licenceName, licenceUrl, changes } = TRACK_CREDIT;
  return (
    <p className="credit" data-testid="music-credit">
      <span className="credit__tag">Music</span> “{title}” by {artist} (
      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
        {sourceName}
      </a>
      ),{' '}
      <a href={licenceUrl} target="_blank" rel="noopener noreferrer">
        {licenceName}
      </a>
      . {changes}
    </p>
  );
}
