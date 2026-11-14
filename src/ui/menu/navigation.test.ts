import { describe, expect, it } from 'vitest';
import { columnsFromTops, moveSelection, type MenuFocus, type MenuLayout } from './navigation';

// Three catalogues and Credits; the shown catalogue has 5 cards in rows of 3.
function layout(overrides: Partial<MenuLayout> = {}): MenuLayout {
  return {
    railCount: 4,
    cardCount: 5,
    columns: 3,
    railPlacement: 'side',
    contentFocusable: true,
    canGoBack: true,
    ...overrides,
  };
}

const onRail = (rail: number, card = 0): MenuFocus => ({ zone: 'rail', rail, card });
const onCard = (card: number, rail = 1): MenuFocus => ({ zone: 'content', rail, card });

describe('moveSelection on a side rail', () => {
  it('moves between rail items with Up and Down, stopping at the ends', () => {
    expect(moveSelection(onRail(1), 'ArrowDown', layout())).toEqual({ focus: onRail(2), effect: 'focus', handled: true });
    expect(moveSelection(onRail(1), 'ArrowUp', layout())).toEqual({ focus: onRail(0), effect: 'focus', handled: true });
    expect(moveSelection(onRail(0), 'ArrowUp', layout())).toEqual({ focus: onRail(0), effect: 'none', handled: true });
    expect(moveSelection(onRail(3), 'ArrowDown', layout())).toEqual({ focus: onRail(3), effect: 'none', handled: true });
  });

  it('jumps to the first and last rail item with Home and End', () => {
    expect(moveSelection(onRail(2), 'Home', layout()).focus.rail).toBe(0);
    expect(moveSelection(onRail(0), 'End', layout()).focus.rail).toBe(3);
  });

  it('opens the cards with Enter or Right, on the card it last had', () => {
    expect(moveSelection(onRail(1, 2), 'Enter', layout())).toEqual({ focus: onCard(2), effect: 'focus', handled: true });
    expect(moveSelection(onRail(1, 2), 'ArrowRight', layout())).toEqual({ focus: onCard(2), effect: 'focus', handled: true });
  });

  it('clamps the remembered card to the cards there are', () => {
    expect(moveSelection(onRail(1, 9), 'Enter', layout()).focus.card).toBe(4);
  });

  it('opens a view without cards (credits) when it can take focus', () => {
    const credits = layout({ cardCount: 0 });
    expect(moveSelection(onRail(3), 'Enter', credits)).toEqual({ focus: { zone: 'content', rail: 3, card: 0 }, effect: 'focus', handled: true });
  });

  it('leaves Enter to the tab when there is nothing to open', () => {
    const bare = layout({ cardCount: 0, contentFocusable: false });
    expect(moveSelection(onRail(0), 'Enter', bare)).toEqual({ focus: onRail(0), effect: 'none', handled: false });
    expect(moveSelection(onRail(0), 'ArrowRight', bare).effect).toBe('none');
  });

  it('goes back with Esc only when there is somewhere to go', () => {
    expect(moveSelection(onRail(1), 'Escape', layout())).toEqual({ focus: onRail(1), effect: 'back', handled: true });
    expect(moveSelection(onRail(1), 'Escape', layout({ canGoBack: false }))).toEqual({
      focus: onRail(1),
      effect: 'none',
      handled: false,
    });
  });

  it('ignores Left and other keys on the rail', () => {
    expect(moveSelection(onRail(1), 'ArrowLeft', layout()).handled).toBe(false);
    expect(moveSelection(onRail(1), 'a', layout()).handled).toBe(false);
    expect(moveSelection(onRail(1), 'Tab', layout()).handled).toBe(false);
  });
});

describe('moveSelection on a top tab strip', () => {
  const top = layout({ railPlacement: 'top' });

  it('moves between tabs with Left and Right', () => {
    expect(moveSelection(onRail(1), 'ArrowRight', top).focus.rail).toBe(2);
    expect(moveSelection(onRail(1), 'ArrowLeft', top).focus.rail).toBe(0);
  });

  it('opens the cards with Down', () => {
    expect(moveSelection(onRail(1, 1), 'ArrowDown', top)).toEqual({ focus: onCard(1), effect: 'focus', handled: true });
  });

  it('goes up from the first row of cards to the tabs', () => {
    expect(moveSelection(onCard(2), 'ArrowUp', top)).toEqual({ focus: onRail(1, 2), effect: 'focus', handled: true });
  });

  it('stops at the first card on Left instead of leaving the grid', () => {
    expect(moveSelection(onCard(0), 'ArrowLeft', top)).toEqual({ focus: onCard(0), effect: 'none', handled: true });
  });
});

describe('moveSelection in the card grid', () => {
  // Rows: [0 1 2] [3 4]
  it('moves to neighbours with Left and Right, across rows', () => {
    expect(moveSelection(onCard(1), 'ArrowRight', layout()).focus.card).toBe(2);
    expect(moveSelection(onCard(2), 'ArrowRight', layout()).focus.card).toBe(3);
    expect(moveSelection(onCard(3), 'ArrowLeft', layout()).focus.card).toBe(2);
  });

  it('stops at the last card', () => {
    expect(moveSelection(onCard(4), 'ArrowRight', layout())).toEqual({ focus: onCard(4), effect: 'none', handled: true });
  });

  it('leaves the first card for the side rail on Left, remembering the card', () => {
    expect(moveSelection(onCard(0), 'ArrowLeft', layout())).toEqual({ focus: onRail(1, 0), effect: 'focus', handled: true });
  });

  it('moves by a row with Up and Down', () => {
    expect(moveSelection(onCard(1), 'ArrowDown', layout()).focus.card).toBe(4);
    expect(moveSelection(onCard(4), 'ArrowUp', layout()).focus.card).toBe(1);
  });

  it('lands on the last card when the row below is short', () => {
    expect(moveSelection(onCard(2), 'ArrowDown', layout()).focus.card).toBe(4);
  });

  it('stays put going down from the last row or up from the first beside a side rail', () => {
    expect(moveSelection(onCard(3), 'ArrowDown', layout())).toEqual({ focus: onCard(3), effect: 'none', handled: true });
    expect(moveSelection(onCard(1), 'ArrowUp', layout())).toEqual({ focus: onCard(1), effect: 'none', handled: true });
  });

  it('moves by one with Up and Down in a single column', () => {
    const column = layout({ columns: 1 });
    expect(moveSelection(onCard(2), 'ArrowDown', column).focus.card).toBe(3);
    expect(moveSelection(onCard(2), 'ArrowUp', column).focus.card).toBe(1);
    expect(moveSelection(onCard(4), 'ArrowDown', column).effect).toBe('none');
  });

  it('jumps to the first and last card with Home and End', () => {
    expect(moveSelection(onCard(3), 'Home', layout()).focus.card).toBe(0);
    expect(moveSelection(onCard(0), 'End', layout()).focus.card).toBe(4);
  });

  it('picks the card with Enter', () => {
    expect(moveSelection(onCard(3), 'Enter', layout())).toEqual({ focus: onCard(3), effect: 'pick', handled: true });
  });

  it('goes back to the rail with Esc', () => {
    expect(moveSelection(onCard(3), 'Escape', layout())).toEqual({ focus: onRail(1, 3), effect: 'focus', handled: true });
  });

  it('leaves Space to the button, which clicks it', () => {
    expect(moveSelection(onCard(3), ' ', layout()).handled).toBe(false);
  });

  it('treats a nonsense column count as one column', () => {
    expect(moveSelection(onCard(0), 'ArrowDown', layout({ columns: 0 })).focus.card).toBe(1);
  });
});

describe('moveSelection in the credits or empty view', () => {
  const view = layout({ cardCount: 0 });

  it('goes back to the rail with Esc, or Left beside a side rail', () => {
    const inView: MenuFocus = { zone: 'content', rail: 3, card: 0 };
    expect(moveSelection(inView, 'Escape', view)).toEqual({ focus: { zone: 'rail', rail: 3, card: 0 }, effect: 'focus', handled: true });
    expect(moveSelection(inView, 'ArrowLeft', view).effect).toBe('focus');
  });

  it('leaves the other arrows for scrolling', () => {
    const inView: MenuFocus = { zone: 'content', rail: 3, card: 0 };
    expect(moveSelection(inView, 'ArrowDown', view).handled).toBe(false);
    expect(moveSelection(inView, 'ArrowUp', layout({ cardCount: 0, railPlacement: 'top' })).handled).toBe(false);
    expect(moveSelection(inView, 'ArrowLeft', layout({ cardCount: 0, railPlacement: 'top' })).handled).toBe(false);
  });
});

describe('columnsFromTops', () => {
  it('counts the cards on the first row', () => {
    expect(columnsFromTops([10, 10, 10, 200, 200])).toBe(3);
  });

  it('is 1 for a single column, a single card or no cards', () => {
    expect(columnsFromTops([0, 180, 360])).toBe(1);
    expect(columnsFromTops([42])).toBe(1);
    expect(columnsFromTops([])).toBe(1);
  });

  it('tolerates sub-pixel differences along a row', () => {
    expect(columnsFromTops([100, 100.4, 99.7, 300])).toBe(3);
  });
});
