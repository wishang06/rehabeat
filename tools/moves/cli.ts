/**
 * npm run moves                 report the moves the dataset gives, change nothing
 * npm run moves -- --write      merge them into src/moves/moves.json
 * npm run moves -- --dir <path> read the CSVs from another folder
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMoves } from '../../src/moves/index';
import { POSES, deriveMove, formatMoves, mergeMoves, parseCsv, type DerivedMove } from './dataset';

const here = fileURLToPath(new URL('.', import.meta.url));
const MOVES_FILE = resolve(here, '../../src/moves/moves.json');

function readArgs(argv: string[]): { dir: string; write: boolean } {
  let dir = resolve(here, 'poses');
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--write') write = true;
    else if (argv[i] === '--dir' && argv[i + 1]) dir = resolve(argv[++i]);
    else throw new Error(`unknown option "${argv[i]}" (expected --write or --dir <path>)`);
  }
  return { dir, write };
}

function report(derived: DerivedMove): string {
  const { move } = derived;
  const lines = [
    `${move.name} (${move.id}): ${derived.photos} photos, ${derived.mirrored} mirrored to match, ` +
      `tolerance ${move.tolerance}°, ${Math.round(derived.goodShare * 100)}% of photos hold at Good or better`,
  ];
  for (const j of derived.joints) {
    const seen = `${Math.round(j.coverage * 100)}% visible`.padStart(12);
    if (Number.isNaN(j.median)) {
      lines.push(`  ${j.joint.padEnd(14)}    -              ${seen}  skipped: not visible enough`);
      continue;
    }
    const angle = `${Math.round(j.median)}°`.padStart(5);
    const spread = `±${Math.round(j.spread / 2)}°`.padStart(5);
    const status = j.dropped ? `skipped: ${j.dropped}` : 'scored';
    lines.push(`  ${j.joint.padEnd(14)} ${angle}  spread ${spread}  ${seen}  ${status}`);
  }
  return lines.join('\n');
}

function main(): void {
  const { dir, write } = readArgs(process.argv.slice(2));
  const derived: DerivedMove[] = [];
  for (const spec of POSES) {
    const path = join(dir, spec.file);
    if (!existsSync(path)) {
      console.warn(`skipping ${spec.name}: ${path} not found`);
      continue;
    }
    derived.push(deriveMove(spec, parseCsv(readFileSync(path, 'utf8'))));
  }
  console.log(derived.map(report).join('\n\n'));

  if (!write) {
    console.log('\nNothing written. Run with --write to merge these into src/moves/moves.json.');
    return;
  }
  const existing = parseMoves(JSON.parse(readFileSync(MOVES_FILE, 'utf8')));
  const merged = mergeMoves(existing, derived.map((d) => d.move));
  // Validate with the game's own loader before touching the file.
  parseMoves(merged);
  writeFileSync(MOVES_FILE, formatMoves(merged));
  console.log(`\nWrote ${merged.length} moves to src/moves/moves.json.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
