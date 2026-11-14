import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { hasPendingRun } from '../lib/scores';
import { loadLibrary, type Library } from '../songs/library';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { Footer, Privacy, Problem, Songs } from './Sections';
import { MOTION_OK, gsap, revealOnScroll } from './motion';
import './landing.css';

/**
 * True when the browser has just come back from Google sign-in. Supabase sends
 * the player to the site's root if /play is not on its list of allowed
 * addresses, so the landing page passes them on to the game.
 */
function isSignInReturn(location: Location): boolean {
  const query = new URLSearchParams(location.search);
  return query.has('code') || query.has('error_description') || /access_token=|error_description=/.test(location.hash);
}

/** The landing page at `/`. The game itself is at `/play`. */
export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [library, setLibrary] = useState<Library | null>(null);

  useEffect(() => {
    if (isSignInReturn(window.location) || hasPendingRun()) {
      void navigate(
        { pathname: '/play', search: window.location.search, hash: window.location.hash },
        { replace: true },
      );
    }
  }, [navigate]);

  // The catalogue strip and the credit show the real library. The page reads fine without it.
  useEffect(() => {
    let current = true;
    loadLibrary().then(
      (loaded) => current && setLibrary(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  useGSAP(
    () => {
      gsap.matchMedia().add(MOTION_OK, () => {
        if (root.current) revealOnScroll(root.current);
      });
    },
    // The catalogue lanes are only complete once the library is in.
    { scope: root, dependencies: [library !== null], revertOnUpdate: true },
  );

  return (
    <div ref={root} className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-wordmark">
          Rehabeat
        </Link>
        <nav aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#songs">Songs</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <span className="lp-freeplay led" aria-hidden="true">
          FREE PLAY
        </span>
        <Button asChild variant="gold">
          <Link to="/play">Play now</Link>
        </Button>
      </header>
      <div className="lp-bulbs" aria-hidden="true" />

      <main>
        <Hero />
        <HowItWorks />
        <Problem />
        <Privacy />
        <Songs library={library} />
      </main>
      <Footer library={library} />
    </div>
  );
}
