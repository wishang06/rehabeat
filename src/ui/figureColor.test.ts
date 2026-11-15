import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FIGURE_COLOR,
  FIGURE_COLORS,
  FIGURE_COLOR_KEY,
  createFigureColorStore,
  isLight,
  loadFigureColor,
  nextFigureColor,
} from './figureColor';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const refusing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('figure colour', () => {
  it('is black until the player picks another', () => {
    expect(DEFAULT_FIGURE_COLOR.id).toBe('black');
    expect(loadFigureColor(memoryStorage())).toBe(DEFAULT_FIGURE_COLOR);
    expect(loadFigureColor(undefined)).toBe(DEFAULT_FIGURE_COLOR);
  });

  it('comes back as the colour picked last time', () => {
    expect(loadFigureColor(memoryStorage({ [FIGURE_COLOR_KEY]: 'pink' })).id).toBe('pink');
  });

  it('falls back to black for a colour that is no longer offered, or storage that refuses', () => {
    expect(loadFigureColor(memoryStorage({ [FIGURE_COLOR_KEY]: 'gold' }))).toBe(DEFAULT_FIGURE_COLOR);
    expect(loadFigureColor(refusing)).toBe(DEFAULT_FIGURE_COLOR);
  });

  it('does not offer green, which means "you are in the pose"', () => {
    expect(FIGURE_COLORS.map((color) => color.id)).not.toContain('green');
  });

  it('steps through every colour and back to the first', () => {
    let color = DEFAULT_FIGURE_COLOR;
    const seen = [color.id];
    for (let i = 1; i < FIGURE_COLORS.length; i++) seen.push((color = nextFigureColor(color)).id);
    expect(new Set(seen).size).toBe(FIGURE_COLORS.length);
    expect(nextFigureColor(color)).toBe(DEFAULT_FIGURE_COLOR);
  });

  it('knows which colours need a dark edge', () => {
    expect(isLight('#ffffff')).toBe(true);
    expect(isLight('#0b0b0d')).toBe(false);
    expect(isLight('#86dba6')).toBe(true);
  });
});

describe('createFigureColorStore', () => {
  it('remembers a pick and tells its listeners', () => {
    const storage = memoryStorage();
    const store = createFigureColorStore(storage);
    let calls = 0;
    const stop = store.subscribe(() => calls++);
    store.set(FIGURE_COLORS[2]);
    expect(store.get()).toBe(FIGURE_COLORS[2]);
    expect(storage.data.get(FIGURE_COLOR_KEY)).toBe(FIGURE_COLORS[2].id);
    expect(calls).toBe(1);
    stop();
    store.set(FIGURE_COLORS[1]);
    expect(calls).toBe(1);
  });

  it('still changes colour when storage refuses the write', () => {
    const store = createFigureColorStore(refusing);
    store.set(FIGURE_COLORS[3]);
    expect(store.get()).toBe(FIGURE_COLORS[3]);
  });
});
