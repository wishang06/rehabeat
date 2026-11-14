// Screenshots of every page, for pull requests and design review.
//
//   node scripts/screens.mjs                    writes docs/screenshots/*.png
//   node scripts/screens.mjs --out some/folder
//   node scripts/screens.mjs --url http://localhost:5173   use a server that is already running
//
// It walks the landing page, the title, the song menu and its credits,
// calibration, the Play screen, the results and Stats with a synthetic camera,
// then the play HUD's named states from the mock frame (/hud), then the doctor
// loop in the demo clinic: the doctor's page, the patient's program card and
// the results of a program session.
//
// Chrome's synthetic camera sometimes opens and then delivers no frames, and the
// walk stops waiting for the Calibrate screen. That is the test camera, not the
// app: run the script again.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const outDir = path.resolve(root, option('--out', 'docs/screenshots'));
const externalUrl = option('--url');
const SONG = 'past-sadness';
const HUD_STATES = ['countin', 'reach', 'hold', 'perfect', 'good', 'miss', 'stepback', 'easeoff'];

async function launch() {
  const launchArgs = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio'];
  let lastError;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ channel, args: launchArgs });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No Chromium-based browser could be launched.\n${lastError}`);
}

const server = externalUrl ? null : await createServer({ root, logLevel: 'error', server: { port: 5197, strictPort: false } });
await server?.listen();
const base = (externalUrl ?? server.resolvedUrls.local[0]).replace(/\/$/, '');
await mkdir(outDir, { recursive: true });

const browser = await launch();
let exitCode = 0;
try {
  const shot = async (page, name, options = {}) => {
    await page.screenshot({ path: path.join(outDir, `${name}.png`), ...options });
    console.log(`  ${name}.png`);
  };
  // Motion is left on for the landing page so the screenshot shows it mid-loop; fonts must be in first.
  const settle = async (page, ms = 900) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(ms);
  };

  console.log(`Screenshots of ${base} into ${path.relative(root, outDir)}/`);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await settle(page, 2600);
  await shot(page, 'landing');
  // Scroll through once so every section has revealed before the full-page shot.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await settle(page, 700);
  await shot(page, 'landing-full', { fullPage: true });

  await page.goto(`${base}/play`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('title-screen').waitFor({ timeout: 20_000 });
  await settle(page);
  await shot(page, 'title');

  await page.getByTestId('title-start').click();
  await page.getByTestId('song-menu').waitFor({ timeout: 20_000 });
  await settle(page);
  await shot(page, 'song-select');

  await page.getByTestId('catalogue-tab-credits').click();
  await page.getByTestId('credits-view').waitFor({ timeout: 5_000 });
  await settle(page, 400);
  await shot(page, 'credits');

  await page.getByTestId('catalogue-tab-steady-flow').click();
  await page.getByTestId(`song-card-${SONG}`).click();
  await page.getByTestId('calibrate-screen').waitFor({ timeout: 90_000 });
  await settle(page, 1200);
  await shot(page, 'calibrate');

  await page.getByTestId('calibrate-skip').click();
  await page.getByTestId('play-screen').waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="phase-label"]')?.textContent === 'HOLD', null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(700);
  await shot(page, 'play');

  // Let two moves be scored so the results have something on them.
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="result-label"] span')?.textContent ?? -1) >= 0, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(7000);
  await page.getByTestId('finish-button').click();
  await page.getByTestId('results-screen').waitFor({ timeout: 10_000 });
  await settle(page, 2600);
  await shot(page, 'results');

  // Stats, over the title screen, with two believable weeks in the run log.
  await page.evaluate(() => {
    const perDay = [0, 1, 0, 2, 1, 0, 0, 3, 1, 1, 0, 2, 1, 2];
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const runs = [];
    const totals = { runs: 9, seconds: 1500, kcal: 67.1 };
    perDay.forEach((count, index) => {
      for (let run = 0; run < count; run++) {
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (perDay.length - 1 - index), 9 + run * 3);
        const seconds = 150 + ((index * 37 + run * 53) % 120);
        const kcal = Math.round((2.3 * 70 * seconds) / 36) / 100;
        runs.push({ at: at.getTime(), day: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, seconds, moves: 8, kcal });
        totals.runs += 1;
        totals.seconds += seconds;
        totals.kcal = Math.round((totals.kcal + kcal) * 100) / 100;
      }
    });
    localStorage.setItem('rehabeat.history.v1', JSON.stringify({ weightKg: null, unit: 'kg', totals, runs }));
  });
  await page.goto(`${base}/play`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('title-screen').waitFor({ timeout: 20_000 });
  await page.getByTestId('title-stats').click();
  await page.getByTestId('stats-panel').waitFor({ timeout: 5_000 });
  await page.getByTestId('stats-mode-kcal').click();
  await settle(page, 400);
  await shot(page, 'stats');

  for (const state of HUD_STATES) {
    await page.goto(`${base}/hud?state=${state}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('play-screen').waitFor({ timeout: 20_000 });
    await settle(page, 500);
    await shot(page, `hud-${state}`);
  }

  // The doctor loop, in the demo clinic. First the doctor's page, on a sample patient with history.
  await page.goto(`${base}/doctor?patient=sample-maya`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('problem-spots').waitFor({ timeout: 20_000 });
  await settle(page, 400);
  await shot(page, 'doctor', { fullPage: true });

  // Then the doctor gives You a program, so the game has one to show.
  await page.getByTestId('patient-you').click();
  await page.getByTestId('move-side-arm-raise').click();
  await page.getByTestId('move-overhead-arm-raise').click();
  await page.getByTestId('rx-rounds').fill('1');
  await page.getByTestId('limit-rightShoulder').getByText('Up to').click();
  await page.getByTestId('rx-note').fill('Good week. Keep your trunk tall, and stop at shoulder height on the overhead raise for now.');
  await page.getByTestId('rx-save').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="rx-status"]')?.textContent === 'Sent to You.', null, {
    timeout: 5_000,
  });

  await page.goto(`${base}/play`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('program-card').waitFor({ timeout: 20_000 });
  await settle(page);
  await shot(page, 'title-program');

  // A program session ends by itself after its last round.
  await page.getByTestId('program-start').click();
  await page.getByTestId('song-menu').waitFor({ timeout: 20_000 });
  await page.getByTestId('catalogue-tab-steady-flow').click();
  await page.getByTestId(`song-card-${SONG}`).click();
  await page.getByTestId('calibrate-screen').waitFor({ timeout: 90_000 });
  await page.getByTestId('calibrate-skip').click();
  await page.getByTestId('results-screen').waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('[data-testid="sent-status"]')?.textContent?.startsWith('Sent to'), null, {
    timeout: 5_000,
  });
  await settle(page, 2600);
  await shot(page, 'results-sent');
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  await small.goto(`${base}/`, { waitUntil: 'networkidle' });
  await settle(small, 2600);
  await shot(small, 'landing-phone');
  await small.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo(0, 0);
  });
  await settle(small, 700);
  await shot(small, 'landing-phone-full', { fullPage: true });
  await small.goto(`${base}/play`, { waitUntil: 'domcontentloaded' });
  await small.getByTestId('title-screen').waitFor({ timeout: 20_000 });
  await settle(small);
  await shot(small, 'title-phone');
  await small.getByTestId('title-start').click();
  await small.getByTestId('song-menu').waitFor({ timeout: 20_000 });
  await settle(small);
  await shot(small, 'song-select-phone');
  await small.goto(`${base}/doctor?patient=sample-maya`, { waitUntil: 'domcontentloaded' });
  await small.getByTestId('problem-spots').waitFor({ timeout: 20_000 });
  await settle(small, 400);
  await shot(small, 'doctor-phone', { fullPage: true });
  await phone.close();
} catch (error) {
  console.error('\nScreenshots aborted:', error);
  exitCode = 1;
} finally {
  await browser.close();
  await server?.close();
}
process.exit(exitCode);
