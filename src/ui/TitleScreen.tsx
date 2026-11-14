import { useEffect } from 'react';
import { Link } from 'react-router';
import { Figure } from '@/components/Figure';
import { playSfx } from '../audio/sfx';
import { ProgressMeters } from './ProgressMeters';
import './screens.css';

interface TitleScreenProps {
  /** Go to the song menu. */
  onStart: () => void;
}

/**
 * The first screen of the game: the name, the player's level and daily
 * streak, and one button. Enter or Space starts from anywhere on it.
 */
export function TitleScreen({ onStart }: TitleScreenProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // A focused button or link handles its own key press.
      if (event.target instanceof Element && event.target.closest('button, a')) return;
      event.preventDefault();
      playSfx('confirm');
      onStart();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStart]);

  return (
    <section className="title" data-testid="title-screen">
      <div className="title__lanes" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>

      <div className="title__copy">
        <h1 className="title__name display">Rehabeat</h1>
        <p className="title__tag">Match the gold figure on the beat. The music plays while your form holds.</p>
        <button
          type="button"
          className="button button--primary title__start"
          onClick={onStart}
          data-testid="title-start"
          autoFocus
        >
          Start <kbd>Enter</kbd>
        </button>
        <ProgressMeters className="title__meters" />
        <p className="title__more">
          <Link to="/">How it works</Link>
        </p>
      </div>

      <div className="title__figure">
        <Figure pose="overhead" label="The gold figure with both arms raised" />
      </div>
    </section>
  );
}
