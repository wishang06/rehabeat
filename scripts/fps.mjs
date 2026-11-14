// Frame rate of the Play screen, for before/after comparisons of UI changes.
//
//   node scripts/fps.mjs                 headless (software GL: only good for comparing two runs on one machine)
//   node scripts/fps.mjs --headed        visible window on the real GPU (use this for numbers worth quoting)
//   node scripts/fps.mjs --seconds 15    how long to count display frames (default 10)
//   node scripts/fps.mjs --runs 3        repeat and report each run and the mean (default 3)
//   node scripts/fps.mjs --url http://localhost:5173 --path /play
//
// It reports two things:
//   display fps   requestAnimationFrame callbacks per second while the Play screen is up (HUD + canvas overlay)
//   pose fps      the pose loop's own readout from the debug panel, as `npm run smoke` reports it

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const headed = flag('--headed');
const seconds = Number(option('--seconds', '10'));
const runs = Number(option('--runs', '3'));
const externalUrl = option('--url');
const SONG = 'past-sadness';

const mean = (values) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

async function launch() {
  const launchArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio'];
  let lastError;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ channel, headless: !headed, args: launchArgs });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No Chromium-based browser could be launched.\n${lastError}`);
}

/** One visit: start screen (if there is one) -> song -> skip calibration -> Play. Null when the test camera stalls. */
async function measure(url) {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Builds with a title screen show it first; older ones open on the song menu.
    const first = await Promise.race([
      page.getByTestId('title-start').waitFor({ timeout: 15_000 }).then(() => 'title'),
      page.getByTestId('song-menu').waitFor({ timeout: 15_000 }).then(() => 'menu'),
    ]);
    if (first === 'title') await page.getByTestId('title-start').click();
    await page.getByTestId(`song-card-${SONG}`).click();
    await page.getByTestId('calibrate-screen').waitFor({ timeout: 90_000 });
    await page.getByTestId('calibrate-skip').click();
    await page.getByTestId('play-screen').waitFor({ timeout: 10_000 });
    // Let the count-in pass so the HUD is in its busiest state: a move in progress.
    await page.waitForFunction(() => document.querySelector('[data-testid="phase-label"]')?.textContent === 'HOLD', null, {
      timeout: 30_000,
    });

    const display = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          let frames = 0;
          let worstGap = 0;
          let last = performance.now();
          const start = last;
          const tick = (now) => {
            frames += 1;
            worstGap = Math.max(worstGap, now - last);
            last = now;
            if (now - start < ms) requestAnimationFrame(tick);
            else resolve({ fps: (frames * 1000) / (now - start), worstGapMs: worstGap });
          };
          requestAnimationFrame(tick);
        }),
      seconds * 1000,
    );

    await page.keyboard.press('d');
    await page.getByTestId('debug-panel').waitFor({ timeout: 5_000 });
    const pose = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(200);
      pose.push(Number(await page.getByTestId('debug-fps').textContent()));
    }
    if (new Set(pose).size === 1) return null;
    return { displayFps: Math.round(display.fps * 10) / 10, worstGapMs: Math.round(display.worstGapMs), poseFps: mean(pose) };
  } finally {
    await browser.close();
  }
}

const server = externalUrl ? null : await createServer({ root, logLevel: 'error', server: { port: 5198, strictPort: false } });
await server?.listen();
const base = (externalUrl ?? server.resolvedUrls.local[0]).replace(/\/$/, '');
const url = base + option('--path', '/');
console.log(`Play screen frame rate at ${url} (${headed ? 'headed, real GPU' : 'headless'}), ${runs} run(s) of ${seconds} s\n`);

const results = [];
let exitCode = 0;
try {
  for (let attempt = 0; results.length < runs && attempt < runs + 4; attempt++) {
    const result = await measure(url);
    if (!result) {
      console.log('  (test camera stalled, retrying)');
      continue;
    }
    results.push(result);
    console.log(`  run ${results.length}: display ${result.displayFps} fps (worst gap ${result.worstGapMs} ms), pose ${result.poseFps} fps`);
  }
  if (results.length === 0) throw new Error('the test camera stalled on every attempt');
  console.log(
    `\nMean: display ${mean(results.map((r) => r.displayFps))} fps, pose ${mean(results.map((r) => r.poseFps))} fps`,
  );
} catch (error) {
  console.error('\nMeasurement aborted:', error);
  exitCode = 1;
} finally {
  await server?.close();
}
process.exit(exitCode);
