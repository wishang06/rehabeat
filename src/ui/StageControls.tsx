import { Maximize, Minimize } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { figureColorStore, nextFigureColor } from './figureColor';
import './stageControls.css';

/** Steps the target figure through its colours. The pick is remembered between visits. */
export function FigureColorButton() {
  const color = useSyncExternalStore(figureColorStore.subscribe, figureColorStore.get, figureColorStore.get);
  return (
    <button
      type="button"
      className="button button--quiet stage-control"
      onClick={() => figureColorStore.set(nextFigureColor(color))}
      aria-label={`Figure colour: ${color.name}. Change colour`}
      title="Change the colour of the target figure"
      data-testid="figure-color"
      data-color={color.id}
    >
      <span className="stage-control__swatch" style={{ background: color.value }} aria-hidden="true" />
      <span className="stage-control__label">Figure</span>
    </button>
  );
}

/**
 * Puts the whole game full screen, so the camera view fills the display, and
 * takes it back out. F does the same; Esc leaves full screen, as in any
 * browser. Leaving the game (the button unmounting) leaves full screen too.
 * Renders nothing where the browser has no full-screen mode.
 */
export function FullscreenButton() {
  const [on, setOn] = useState(() => document.fullscreenElement !== null);

  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const toggle = useCallback(() => {
    // Either can be refused (an embedded page without permission); the game then just stays as it is.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.key.toLowerCase() === 'f') toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  if (!document.fullscreenEnabled) return null;
  return (
    <button
      type="button"
      className="button button--quiet stage-control"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Exit full screen' : 'Full screen'}
      title={on ? 'Exit full screen (F)' : 'Full screen (F)'}
      data-testid="fullscreen-button"
    >
      {on ? <Minimize size={18} aria-hidden="true" /> : <Maximize size={18} aria-hidden="true" />}
      <span className="stage-control__label">
        {on ? 'Exit full screen' : 'Full screen'} <kbd>F</kbd>
      </span>
    </button>
  );
}
