// Screenshots of every page, for pull requests and design review.
//
//   node scripts/screens.mjs                    writes docs/screenshots/*.png
//   node scripts/screens.mjs --out some/folder
//   node scripts/screens.mjs --url http://localhost:5173   use a server that is already running
//
// It walks the landing page, the title, the song menu and its credits,
// calibration, the Play screen and the results with a synthetic camera, then
// the play HUD's named states from the mock frame (/hud).
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
const HUD_STATES = ['countin', 'reach', 'hold', 'perfect', 'good', 'miss', 'stepback'];

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

  for (const state of HUD_STATES) {
    await page.goto(`${base}/hud?state=${state}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('play-screen').waitFor({ timeout: 20_000 });
    await settle(page, 500);
    await shot(page, `hud-${state}`);
  }
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
  await phone.close();
} catch (error) {
  console.error('\nScreenshots aborted:', error);
  exitCode = 1;
} finally {
  await browser.close();
  await server?.close();
}
process.exit(exitCode);
