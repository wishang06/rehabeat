// A contact sheet of the target figure for every move, drawn by the real
// overlay over a synthetic standing player, with the player's floor line.
// For checking that no pose floats: the figure's lowest point should sit on
// the line in every tile (a pose that stands on its feet is left on the
// player's hips, so it is on the line as far as their legs match). The synthetic test camera has nobody in it, so the
// Play screen itself cannot show this.
//
//   node scripts/figure-shots.mjs              writes docs/screenshots/play-layout/figures.png
//   node scripts/figure-shots.mjs --out dir
//
// It also prints, per move, whether the pose is put on the floor, and how far
// it would hang above it (or sink below) drawn from the player's standing hips.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/screenshots/play-layout');

const server = await createServer({ root, logLevel: 'error', server: { port: 5191, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
await mkdir(outDir, { recursive: true });
let browser;
for (const channel of ['chrome', 'msedge', undefined]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    // Try the next browser.
  }
}

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${base}/hud?state=hold`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('play-screen').waitFor({ timeout: 20_000 });

  const report = await page.evaluate(async () => {
    const [{ PlayOverlay }, { MOVES }, engine, { LIMBS }, { LM }, { mockFeedbackFrame }, { FIGURE_COLORS }] = await Promise.all([
      import('/src/ui/overlay.ts'),
      import('/src/moves/index.ts'),
      import('/src/engine/index.ts'),
      import('/src/engine/limbs.ts'),
      import('/src/pose/landmarks.ts'),
      import('/src/ui/mockFeedback.ts'),
      import('/src/ui/figureColor.ts'),
    ]);
    const { viewForMove } = await import('/src/engine/moveViews.ts');

    const TILE = { width: 300, height: 400 };
    // Someone standing square to the camera, whole body in the picture.
    const at = (x, y) => ({ x, y, z: 0, visibility: 1 });
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
    Object.assign(landmarks, {
      [LM.nose]: at(0.5, 0.2),
      [LM.leftShoulder]: at(0.585, 0.3),
      [LM.rightShoulder]: at(0.415, 0.3),
      [LM.leftElbow]: at(0.6, 0.42),
      [LM.rightElbow]: at(0.4, 0.42),
      [LM.leftWrist]: at(0.605, 0.53),
      [LM.rightWrist]: at(0.395, 0.53),
      [LM.leftHip]: at(0.555, 0.53),
      [LM.rightHip]: at(0.445, 0.53),
      [LM.leftKnee]: at(0.555, 0.735),
      [LM.rightKnee]: at(0.445, 0.735),
      [LM.leftAnkle]: at(0.555, 0.937),
      [LM.rightAnkle]: at(0.445, 0.937),
    });
    const floorY = 0.937 * TILE.height;

    document.body.innerHTML = '';
    document.body.style.cssText = 'margin:0;padding:16px;background:#05060c;display:grid;grid-template-columns:repeat(4,max-content);gap:12px;font:600 14px Barlow,sans-serif;color:#eef2ff';
    const rows = [];
    for (const move of MOVES) {
      const cell = document.createElement('figure');
      cell.style.cssText = 'margin:0;display:grid;gap:6px';
      const canvas = document.createElement('canvas');
      canvas.width = TILE.width;
      canvas.height = TILE.height;
      const ctx = canvas.getContext('2d');
      const surface = { ctx, width: TILE.width, height: TILE.height, ratio: 1, mirrored: false };

      // A plain room, and the floor line under the player's feet.
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(0, 0, TILE.width, TILE.height);
      ctx.fillStyle = '#9aa0ad';
      ctx.fillRect(0, floorY, TILE.width, TILE.height - floorY);
      ctx.strokeStyle = '#ff2e88';
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, floorY);
      ctx.lineTo(TILE.width, floorY);
      ctx.stroke();
      ctx.setLineDash([]);

      const joints = {};
      const limbs = {};
      for (const { limb, joint } of LIMBS) {
        const target = move.joints[joint];
        if (target !== undefined) joints[joint] = target;
        limbs[limb] = { limb, joint, status: 'idle', scored: false, errorDeg: null, currentDeg: null, targetDeg: target ?? null, visibility: 1 };
      }
      const frame = mockFeedbackFrame({ phase: 'hold', move: { id: move.id, name: move.name }, limbs, onTarget: false, hint: null });
      const overlay = new PlayOverlay({ get: () => FIGURE_COLORS[0] });
      overlay.draw(surface, frame, landmarks, null, 1000);

      // What the pose would do drawn from the standing hips, as it was before.
      const body = new engine.FigureAnchor().update(landmarks, null, TILE, 0);
      const raw = engine.stickPoints(viewForMove(move.id, joints), body);
      const gap = Math.round(floorY - engine.lowestPoint(raw));
      rows.push({
        move: move.id,
        grounded: !engine.standsOnItsFeet(raw, body),
        fromHips: Math.abs(gap) <= 1 ? 'on the floor' : gap > 0 ? `${gap} px above the floor` : `${-gap} px below the floor`,
      });

      const caption = document.createElement('figcaption');
      caption.textContent = move.name;
      cell.append(canvas, caption);
      document.body.append(cell);
    }
    return rows;
  });

  console.log('Each pose drawn from the standing hips (as before), on a 400 px tall picture:');
  for (const row of report) console.log(`  ${row.move.padEnd(22)} ${row.fromHips.padEnd(24)} ${row.grounded ? 'now put on the floor' : 'stands on its feet: left on the hips'}`);
  await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => {
    const box = document.body.getBoundingClientRect();
    return { width: Math.ceil(box.width), height: Math.ceil(document.body.scrollHeight) };
  });
  await page.setViewportSize({ width: Math.max(600, sheet.width), height: Math.max(400, sheet.height) });
  await page.screenshot({ path: path.join(outDir, 'figures.png'), fullPage: true });
  console.log(`\n  figures.png  (${report.length} moves; the dashed line is the player's floor)`);
} catch (error) {
  console.error('Figure sheet aborted:', error);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
