import { creditParts, type SongMeta } from '../songs/model';

/**
 * A song's attribution, with its source site and licence as links. Links open
 * in a new tab so a running session is not lost.
 */
export function MusicCredit({ song }: { song: SongMeta }) {
  return (
    <p className="credit" data-testid="music-credit" data-song={song.id}>
      <span className="credit__tag">Music</span>{' '}
      {creditParts(song).map((part, index) =>
        part.href ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
