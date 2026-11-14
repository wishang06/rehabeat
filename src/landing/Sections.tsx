import { VideoOff } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { groupByCatalogue, type Library } from '../songs/library';
import { CATALOGUES, creditParts, type SongMeta } from '../songs/model';

export const SOURCE_URL = 'https://pubmed.ncbi.nlm.nih.gov/27097761/';
export const GITHUB_URL = 'https://github.com/wishang06/rehabeat';
/** The people who built it, by GitHub handle. */
const TEAM = ['wishang06', 'LegoDori'];

/**
 * The attribution CC BY 4.0 asks for, word for word as the game shows it.
 * Used until the song library has loaded; after that the line comes from the song itself.
 */
const PAST_SADNESS_CREDIT =
  '"Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.';

/** The one statistic on the page, with its source. */
export function Problem() {
  return (
    <section className="lp-why">
      <p className="lp-why__num led" aria-hidden="true" data-reveal="-80">
        70<span>%</span>
      </p>
      <div>
        <h2 className="lp-statement">Up to 70% of patients don't stick with their home exercises</h2>
        <p className="lp-source">
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            Source: PubMed 27097761
          </a>
        </p>
        <p className="lp-why__us">
          Rehabeat puts the routine on a beat. The next session is a song you pick, not a sheet of paper you have to
          find.
        </p>
      </div>
    </section>
  );
}

export function Privacy() {
  return (
    <section id="privacy" className="lp-privacy slab" data-reveal="90">
      <VideoOff strokeWidth={1.6} aria-hidden="true" />
      <div>
        <h2 className="display">Runs in your browser.</h2>
        <p>Your camera video never leaves your laptop.</p>
      </div>
    </section>
  );
}

const range = (id: string, fallback: string) => {
  const band = CATALOGUES.find((catalogue) => catalogue.id === id);
  return band ? `${band.minBpm} to ${band.maxBpm} BPM` : fallback;
};

/** The catalogues as three lanes, slow to fast, with each song's tempo in LED digits. */
export function Songs({ library }: { library: Library | null }) {
  const groups = library
    ? groupByCatalogue(library)
    : CATALOGUES.map((catalogue) => ({ catalogue: { ...catalogue, songIds: [] }, songs: [] as SongMeta[] }));

  return (
    <section id="songs" className="lp-songs">
      <div className="lp-songs__lede">
        <h2 className="display">Song select</h2>
        <Button asChild>
          <Link to="/play">Browse the songs</Link>
        </Button>
      </div>
      <div className="lp-lanes3">
        {groups.map(({ catalogue, songs }, index) => (
          <article key={catalogue.id} className="lp-lane slab slab-edge" data-reveal={60 + index * 30}>
            <h3 className="display">{catalogue.name}</h3>
            <p className="lp-lane__range label">{range(catalogue.id, catalogue.description)}</p>
            <ul>
              {songs.map((song) => (
                <li key={song.id}>
                  <b>{song.title}</b>
                  <span>{song.artist}</span>
                  <i className="led" aria-label={`${Math.round(song.bpm)} beats per minute`}>
                    {Math.round(song.bpm)}
                  </i>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}

/** The team, the code, and the music credit. */
export function Footer({ library }: { library: Library | null }) {
  const song = library?.songs['past-sadness'];

  return (
    <footer className="lp-foot">
      <div className="lp-foot__cols">
        <div>
          <h2 className="display">Team</h2>
          <p>Built in a weekend at HackPrinceton by</p>
          <ul>
            {TEAM.map((handle) => (
              <li key={handle}>
                <a href={`https://github.com/${handle}`} target="_blank" rel="noopener noreferrer">
                  @{handle}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="display">Code</h2>
          <p>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              github.com/wishang06/rehabeat
            </a>
          </p>
        </div>
        <div>
          <h2 className="display">Music</h2>
          <p data-testid="landing-credit">
            <span className="lp-credit__tag">Music</span>
            {song
              ? creditParts(song).map((part, index) =>
                  part.href ? (
                    <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
                      {part.text}
                    </a>
                  ) : (
                    <span key={index}>{part.text}</span>
                  ),
                )
              : PAST_SADNESS_CREDIT}
          </p>
          <p>
            Every song and its licence is listed in <Link to="/play">Credits</Link>.
          </p>
        </div>
      </div>
      <p className="lp-foot__wordmark" aria-hidden="true">
        Rehabeat
      </p>
    </footer>
  );
}
