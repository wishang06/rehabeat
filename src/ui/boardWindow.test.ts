import { describe, expect, it } from 'vitest';
import { boardWindow } from './boardWindow';

/** A board of `count` players, p1 first. */
const board = (count: number) => Array.from({ length: count }, (_, index) => ({ userId: `p${index + 1}` }));

/** The entries as text: a player's id, or "..." for a gap. */
const shown = (count: number, userId: string | null, fallback = 5) =>
  boardWindow(board(count), userId, fallback).map((entry) => (entry.kind === 'row' ? entry.row.userId : '...'));

describe('boardWindow', () => {
  it('shows the top three, a gap, then the player with one neighbour either side', () => {
    expect(shown(20, 'p12')).toEqual(['p1', 'p2', 'p3', '...', 'p11', 'p12', 'p13']);
  });

  it('leaves the gap out when the player sits right under the top three', () => {
    expect(shown(20, 'p4')).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(shown(20, 'p5')).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    // One row is skipped between the third and the player's neighbour: that is a gap.
    expect(shown(20, 'p6')).toEqual(['p1', 'p2', 'p3', '...', 'p5', 'p6', 'p7']);
  });

  it('does not repeat rows when the player is in the top three', () => {
    expect(shown(20, 'p1')).toEqual(['p1', 'p2', 'p3']);
    expect(shown(20, 'p3')).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('has nobody below a player who is last', () => {
    expect(shown(9, 'p9')).toEqual(['p1', 'p2', 'p3', '...', 'p8', 'p9']);
  });

  it('copes with a board shorter than the top three', () => {
    expect(shown(2, 'p2')).toEqual(['p1', 'p2']);
    expect(shown(0, 'p1')).toEqual([]);
  });

  it('shows the first rows when the player is not on the board', () => {
    expect(shown(20, null)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(shown(20, 'someone-else', 4)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('says which row each gap follows', () => {
    const gap = boardWindow(board(20), 'p12', 5).find((entry) => entry.kind === 'gap');
    expect(gap).toEqual({ kind: 'gap', after: 2 });
  });
});
