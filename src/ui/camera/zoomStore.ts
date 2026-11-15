import { useSyncExternalStore } from 'react';
import { DEFAULT_ZOOM, loadZoom, saveZoom } from './zoom';

/** The camera zoom for this visit, shared by the slider (Calibrate) and the stage (Calibrate and Play). */
let current: number | null = null;
const listeners = new Set<() => void>();

function read(): number {
  current ??= loadZoom();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sets the zoom (0 closest, 1 full frame), remembers it in this browser, and redraws the stage. */
export function setCameraZoom(zoom: number): void {
  if (!Number.isFinite(zoom)) return;
  // Kept here as well as in storage, so a blocked localStorage still zooms for this visit.
  current = Math.min(1, Math.max(0, zoom));
  saveZoom(current);
  for (const listener of listeners) listener();
}

export function useCameraZoom(): number {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_ZOOM);
}
