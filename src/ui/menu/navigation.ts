/*
 * The song menu's keyboard model, as a pure function. The menu has two zones:
 * the rail (catalogues, then Credits) and the content beside or below it
 * (the song cards, or the credits / empty view when there are no cards).
 * SongMenu reads where focus is, asks moveSelection what a key does, and
 * moves real focus to match.
 */

export type MenuZone = 'rail' | 'content';

export interface MenuFocus {
  zone: MenuZone;
  /** The rail item: a catalogue index, or the Credits item after them. */
  rail: number;
  /** The card within the shown catalogue. Kept while focus is on the rail, so returning lands on it. */
  card: number;
}

export interface MenuLayout {
  /** Rail items, Credits included. */
  railCount: number;
  /** Cards in the shown view; 0 for an empty catalogue or the credits view. */
  cardCount: number;
  /** Cards per row as laid out; 1 for a single column. */
  columns: number;
  /** 'side': a vertical rail left of the cards. 'top': a tab strip above them. */
  railPlacement: 'side' | 'top';
  /** Whether a view without cards (credits, empty) can take focus. */
  contentFocusable: boolean;
  /** Whether Esc on the rail has somewhere to go back to. */
  canGoBack: boolean;
}

/**
 * - 'focus': move real focus to the element `focus` describes (and, on the
 *   rail, show that catalogue).
 * - 'pick': play the card at `focus.card`.
 * - 'back': leave the menu.
 */
export type MenuEffect = 'none' | 'focus' | 'pick' | 'back';

export interface MenuMove {
  focus: MenuFocus;
  effect: MenuEffect;
  /** Whether the key was used, so the browser's default (scrolling, a click) should be prevented. */
  handled: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function result(focus: MenuFocus, effect: MenuEffect, handled = true): MenuMove {
  return { focus, effect, handled };
}

function railMove(focus: MenuFocus, key: string, layout: MenuLayout): MenuMove {
  const last = Math.max(0, layout.railCount - 1);
  const side = layout.railPlacement === 'side';
  const toRail = (rail: number): MenuMove =>
    rail === focus.rail ? result(focus, 'none') : result({ ...focus, rail }, 'focus');

  const previous = side ? 'ArrowUp' : 'ArrowLeft';
  const next = side ? 'ArrowDown' : 'ArrowRight';
  const into = side ? 'ArrowRight' : 'ArrowDown';

  switch (key) {
    case previous:
      return toRail(clamp(focus.rail - 1, 0, last));
    case next:
      return toRail(clamp(focus.rail + 1, 0, last));
    case 'Home':
      return toRail(0);
    case 'End':
      return toRail(last);
    case 'Enter':
    case into: {
      if (layout.cardCount > 0) {
        return result({ ...focus, zone: 'content', card: clamp(focus.card, 0, layout.cardCount - 1) }, 'focus');
      }
      if (layout.contentFocusable) return result({ ...focus, zone: 'content', card: 0 }, 'focus');
      // Nothing to go into: let Enter click the tab as usual.
      return result(focus, 'none', key !== 'Enter');
    }
    case 'Escape':
      return layout.canGoBack ? result(focus, 'back') : result(focus, 'none', false);
    default:
      return result(focus, 'none', false);
  }
}

function cardMove(focus: MenuFocus, key: string, layout: MenuLayout): MenuMove {
  const count = layout.cardCount;
  const columns = Math.max(1, Math.floor(layout.columns));
  const card = clamp(focus.card, 0, count - 1);
  const side = layout.railPlacement === 'side';
  const toCard = (next: number): MenuMove =>
    next === card ? result({ ...focus, card }, 'none') : result({ ...focus, card: next }, 'focus');
  const toRail = (): MenuMove => result({ ...focus, zone: 'rail', card }, 'focus');
  const row = (index: number) => Math.floor(index / columns);

  switch (key) {
    case 'ArrowLeft':
      if (card > 0) return toCard(card - 1);
      return side ? toRail() : toCard(card);
    case 'ArrowRight':
      return toCard(Math.min(card + 1, count - 1));
    case 'ArrowUp':
      if (card - columns >= 0) return toCard(card - columns);
      return side ? toCard(card) : toRail();
    case 'ArrowDown':
      if (card + columns < count) return toCard(card + columns);
      // From a full row onto a shorter last row: land on its last card.
      return toCard(row(card) < row(count - 1) ? count - 1 : card);
    case 'Home':
      return toCard(0);
    case 'End':
      return toCard(count - 1);
    case 'Enter':
      return result({ ...focus, card }, 'pick');
    case 'Escape':
      return toRail();
    default:
      return result(focus, 'none', false);
  }
}

function viewMove(focus: MenuFocus, key: string, layout: MenuLayout): MenuMove {
  // The credits and empty views keep arrow keys for scrolling, except the way back to a side rail.
  if (key === 'Escape' || (key === 'ArrowLeft' && layout.railPlacement === 'side')) {
    return result({ ...focus, zone: 'rail' }, 'focus');
  }
  return result(focus, 'none', false);
}

/** What `key` does with focus at `focus`, in a menu laid out as `layout`. */
export function moveSelection(focus: MenuFocus, key: string, layout: MenuLayout): MenuMove {
  if (focus.zone === 'rail') return railMove(focus, key, layout);
  return layout.cardCount > 0 ? cardMove(focus, key, layout) : viewMove(focus, key, layout);
}

/**
 * Cards per row, from the top edge of each card in order: the cards that share
 * the first card's row. Tolerates a pixel of rounding.
 */
export function columnsFromTops(tops: readonly number[]): number {
  if (tops.length === 0) return 1;
  let columns = 1;
  while (columns < tops.length && Math.abs(tops[columns] - tops[0]) < 1) columns += 1;
  return columns;
}
