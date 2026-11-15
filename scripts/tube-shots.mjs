// Screenshots of the score tube in the play HUD's preview (/hud), for review:
// empty, half full, full (SUPERSTAR), and "+points" on its way in.
//
//   node scripts/tube-shots.mjs              writes docs/screenshots/score-tube/*.png
//   node scripts/tube-shots.mjs --out dir

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = path.resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/screenshots/score-tube');

const server = await createServer({ root, logLevel: 'error', server: { port: 5195, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
await mkdir(outDir, { recursive: true });
let browser;
for (const channel of ['chrome', 'msedge', undefined]) {
  try {
    browser = await chromium.launch({ channel, args: ['--mute-audio'] });
    break;
  } catch {
    // Try the next browser.
  }
}

let exitCode = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const shot = async (name, query, check) => {
    await page.goto(`${base}/hud?${query}`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('score-tube').waitFor({ timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    const tube = await page.getByTestId('score-tube').evaluate((element) => ({ fill: element.dataset.fill, stars: element.dataset.stars, super: element.dataset.super }));
    console.log(`  ${name}.png  fill ${tube.fill}, ${tube.stars} stars${tube.super === 'true' ? ', SUPERSTAR' : ''}`);
    if (check && !check(tube)) {
      console.log(`  FAIL ${name}: unexpected tube state`);
      exitCode = 1;
    }
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  };
  await shot('tube-0', 'state=hold&tube=0', (tube) => tube.stars === '0' && tube.super === 'false');
  await shot('tube-mid', 'state=hold&tube=0.5', (tube) => tube.stars === '3' && tube.super === 'false');
  await shot('tube-full', 'state=hold&tube=1', (tube) => tube.stars === '5' && tube.super === 'true');

  // The looping preview: catch the first Perfect's points on their way into the tube.
  await page.goto(`${base}/hud`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tube-flyer', { timeout: 30_000 });
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(outDir, 'tube-flying.png') });
  console.log('  tube-flying.png');
  await page.waitForFunction(() => document.querySelector('[data-testid="score-tube"]')?.dataset.stars !== '0', null, { timeout: 30_000 });
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(outDir, 'tube-star-lit.png') });
  console.log('  tube-star-lit.png');
} catch (error) {
  console.error('Tube screenshots aborted:', error);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
