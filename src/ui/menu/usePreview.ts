import { useCallback, useEffect, useRef, useState } from 'react';
import { STEM_GAIN } from '../../audio';
import type { SongMeta } from '../../songs/model';
import { ACTIVATION_EVENTS, isActivationEvent, pageHasBeenActive } from './activation';
import { loadDownbeats } from './downbeats';
import { PreviewPlayer } from './previewPlayer';

export interface Preview {
  /**
   * Plays `song`'s preview after a short delay, fading out any other first.
   * Asking again for the song already starting or playing does nothing. Null fades out.
   */
  request(song: SongMeta | null): void;
  /** Fades out quickly and forgets the request: call it when a song is picked. */
  stop(): void;
  /** The song whose preview is audible, or null. */
  playingId: string | null;
  /** False until the page has had a click, tap or key press. Previews wait for it. */
  activated: boolean;
}

/**
 * Song previews for the menu. Plays through `getAudioContext()`, which is first
 * called inside the page's first click or key press (or later, when a preview
 * starts). Previews stop with a quick fade when the page is hidden and when
 * the component using this unmounts.
 */
export function usePreview(getAudioContext: () => AudioContext): Preview {
  const latestGetContext = useRef(getAudioContext);
  useEffect(() => {
    latestGetContext.current = getAudioContext;
  });

  const playerRef = useRef<PreviewPlayer | null>(null);
  // The last request, kept here so a player rebuilt by a remount (StrictMode does
  // one in development) picks up the card that was focused before it existed.
  const wantedRef = useRef<SongMeta | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activated, setActivated] = useState(() => pageHasBeenActive(false));

  useEffect(() => {
    const player = new PreviewPlayer({
      getContext: () => latestGetContext.current(),
      createAudio: () => new Audio(),
      loadDownbeats,
      // The level the game plays the stems at, so a preview is as loud as play.
      level: STEM_GAIN,
      onChange: setPlayingId,
    });
    playerRef.current = player;
    if (wantedRef.current) player.request(wantedRef.current);

    let seen = false;
    const stopListening = () => {
      for (const type of ACTIVATION_EVENTS) window.removeEventListener(type, onInput, true);
    };
    function onInput(event: Event) {
      seen ||= isActivationEvent({
        type: event.type,
        key: 'key' in event ? String(event.key) : undefined,
        pointerType: 'pointerType' in event ? String(event.pointerType) : undefined,
      });
      if (!pageHasBeenActive(seen)) return;
      stopListening();
      // Still inside the gesture, where browsers let an AudioContext start.
      player.warmUp();
      player.setEnabled(true);
      setActivated(true);
    }

    if (pageHasBeenActive(false)) {
      player.setEnabled(true);
      setActivated(true);
    } else {
      for (const type of ACTIVATION_EVENTS) window.addEventListener(type, onInput, true);
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') player.stop();
    };
    const onPageHide = () => player.stop();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      stopListening();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
    };
  }, []);

  const request = useCallback((song: SongMeta | null) => {
    wantedRef.current = song;
    playerRef.current?.request(song);
  }, []);
  const stop = useCallback(() => {
    wantedRef.current = null;
    playerRef.current?.stop();
  }, []);

  return { request, stop, playingId, activated };
}
