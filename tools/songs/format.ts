/** Small text helpers for the CLI's output. */

export function bpmText(bpm: number): string {
  return bpm.toFixed(1);
}

export function jitterText(jitterMs: number | null): string {
  return jitterMs === null ? 'n/a' : `${jitterMs.toFixed(2)} ms`;
}

export function signedDb(db: number): string {
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Label/value lines with the values lined up. */
export function fieldLines(fields: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(...fields.map(([label]) => label.length));
  return fields.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');
}

/** A plain-text table: a header, a rule, and the rows, columns padded to their widest cell. */
export function renderTable(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd();
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
