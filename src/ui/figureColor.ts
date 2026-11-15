/**
 * The colour the target figure is drawn in. The player picks it (the Figure
 * button on the Play screen) and it is remembered between visits. Green is
 * not on the list: the figure turns green when the player is in the pose.
 */
export interface FigureColor {
  id: string;
  name: string;
  /** #rrggbb */
  value: string;
}

export const FIGURE_COLORS: readonly FigureColor[] = [
  { id: 'black', name: 'Black', value: '#0b0b0d' },
  { id: 'white', name: 'White', value: '#ffffff' },
  { id: 'blue', name: 'Blue', value: '#2f7bff' },
  { id: 'pink', name: 'Pink', value: '#ff3d9a' },
  { id: 'orange', name: 'Orange', value: '#ff7a1a' },
];

export const DEFAULT_FIGURE_COLOR = FIGURE_COLORS[0];
export const FIGURE_COLOR_KEY = 'rehabeat.figureColor';

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The colour picked last time, or black. Never throws. */
export function loadFigureColor(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): FigureColor {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(FIGURE_COLOR_KEY) ?? null;
  } catch {
    // Storage that refuses reads (some private windows) counts as empty.
  }
  return FIGURE_COLORS.find((color) => color.id === stored) ?? DEFAULT_FIGURE_COLOR;
}

/** The colour after `current` in the list, going round to the first. */
export function nextFigureColor(current: FigureColor): FigureColor {
  const index = FIGURE_COLORS.findIndex((color) => color.id === current.id);
  return FIGURE_COLORS[(index + 1) % FIGURE_COLORS.length];
}

/** True for a colour that needs a dark edge to show against a bright picture; a dark colour needs a light one. */
export function isLight(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

export interface FigureColorStore {
  get(): FigureColor;
  /** Picks a colour and remembers it. Never throws. */
  set(color: FigureColor): void;
  subscribe(listener: () => void): () => void;
}

export function createFigureColorStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage()): FigureColorStore {
  let current = loadFigureColor(storage);
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(color) {
      current = color;
      try {
        storage?.setItem(FIGURE_COLOR_KEY, color.id);
      } catch {
        // Private windows can refuse writes; the pick then lasts for this visit only.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The one the app uses: the Figure button writes it and the canvas overlay reads it every frame. */
export const figureColorStore = createFigureColorStore();
