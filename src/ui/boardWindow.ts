/**
 * Which rows a short leaderboard shows when the player is on it: the top few,
 * then the player with one neighbour either side, and a gap wherever rows
 * were left out between them.
 */

/** One line of the board: a player's row, or a gap where rows were left out. */
export type BoardEntry<Row> = { kind: 'row'; row: Row } | { kind: 'gap'; after: number };

/** How many of the top players are always shown. */
export const BOARD_TOP = 3;

/**
 * The entries to show from `rows` (already in rank order). With the player
 * on the board: the top `top`, a gap, the row above the player, the player
 * and the row below, merged where they touch or overlap. Without the player
 * (signed out, or no run yet): simply the first `fallback` rows.
 */
export function boardWindow<Row extends { userId: string }>(
  rows: readonly Row[],
  userId: string | null | undefined,
  fallback: number,
  top = BOARD_TOP,
): BoardEntry<Row>[] {
  const me = userId ? rows.findIndex((row) => row.userId === userId) : -1;
  if (me < 0) return rows.slice(0, fallback).map((row) => ({ kind: 'row', row }));

  const wanted = new Set<number>();
  for (let index = 0; index < top; index++) wanted.add(index);
  for (const index of [me - 1, me, me + 1]) wanted.add(index);
  const shown = [...wanted].filter((index) => index >= 0 && index < rows.length).sort((a, b) => a - b);

  const entries: BoardEntry<Row>[] = [];
  shown.forEach((index, position) => {
    const previous = shown[position - 1];
    if (position > 0 && index - previous > 1) entries.push({ kind: 'gap', after: previous });
    entries.push({ kind: 'row', row: rows[index] });
  });
  return entries;
}
