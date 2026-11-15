// Screenshots of every /play screen at desktop sizes, signed in, with the
// profile menu and the camera zoom at both ends. Each screen is checked to
// fit the window with nothing scrolling (scripts/lib/fit.mjs) and the walk
// fails if one does not.
//
//   node scripts/polish-shots.mjs                     writes docs/screenshots/polish-2/*.png
//   node scripts/polish-shots.mjs --out some/folder
//   node scripts/polish-shots.mjs --sizes 1440x900,1280x720,1024x768
//
// Accounts need Supabase, so the walk runs the dev server against a stand-in:
// Playwright answers the Supabase requests itself (a signed-in player, demo
// players on the board) and nothing leaves the machine.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { scrollProblems } from './lib/fit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const outDir = path.resolve(root, option('--out', 'docs/screenshots/polish-2'));
const sizes = option('--sizes', '1440x900,1280x720')
  .split(',')
  .map((size) => size.split('x').map(Number));
const SONG = 'past-sadness';

// The stand-in Supabase project. The game reads these at build time.
const SUPABASE = 'https://rehabeat-demo.supabase.co';
process.env.VITE_SUPABASE_URL = SUPABASE;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_screenshots';
const STORAGE_KEY = 'sb-rehabeat-demo-auth-token';

const PLAYER_ID = '5a1e0c7e-0000-4000-b000-00000000beef';
const SAMPLE = [
  ['Maya R.', 'crown', 4380],
  ['Leo Park', 'bolt', 4120],
  ['Priya S.', 'star', 3760],
  ['Jonas', 'eq', 3240],
  ['Aiko T.', 'flame', 2870],
  ['Sam Rivera', 'note', 2260],
];

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: PLAYER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'player@example.com',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Robin Avery' },
    created_at: new Date().toISOString(),
  };
  const token = `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ sub: PLAYER_ID, role: 'authenticated', aud: 'authenticated', exp: now + 7200 })}.c2lnbmF0dXJl`;
  return { access_token: token, token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, refresh_token: 'refresh', user };
}

/** Answers the game's Supabase calls: one player, a board with demo players, and every write accepted. */
async function standInSupabase(context, state) {
  const session = fakeSession();
  await context.addInitScript(
    ([key, value]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(session)],
  );
  await context.route(`${SUPABASE}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        },
      });
    }
    if (url.pathname.startsWith('/auth/v1/user')) return json(session.user);
    if (url.pathname.startsWith('/auth/v1/token')) return json(session);
    if (url.pathname.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

    const table = url.pathname.replace('/rest/v1/', '');
    const single = (request.headers().accept ?? '').includes('vnd.pgrst.object');
    if (table === 'profiles' && request.method() === 'GET') {
      const row = { id: PLAYER_ID, display_name: state.name, avatar_url: null, avatar_id: state.avatarId };
      return json(single ? row : [row]);
    }
    if (table === 'profiles' && request.method() === 'PATCH') {
      const patch = request.postDataJSON();
      state.patches.push(patch);
      if (patch.display_name !== undefined) state.name = patch.display_name;
      if (patch.avatar_id !== undefined) state.avatarId = patch.avatar_id;
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (table === 'leaderboard') {
      const rows = SAMPLE.map(([name, avatar, points], index) => ({
        user_id: `00000000-0000-4000-a000-00000000000${index + 1}`,
        display_name: name,
        avatar_url: null,
        avatar_id: avatar,
        is_sample: true,
        best_points: points,
        total_points: points,
        runs: 1,
      }));
      rows.splice(2, 0, { user_id: PLAYER_ID, display_name: state.name, avatar_url: null, avatar_id: state.avatarId, is_sample: false, best_points: 3980, total_points: 9100, runs: 4 });
      const limit = Number(url.searchParams.get('limit') ?? rows.length);
      return json(rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 })));
    }
    if (request.method() === 'POST' || request.method() === 'PATCH') return json(null, 201);
    // The doctor loop's tables: this player has no doctor.
    return json(single ? null : []);
  });
}

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

const server = await createServer({ root, logLevel: 'error', server: { port: 5198, strictPort: false } });
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
await mkdir(outDir, { recursive: true });
const browser = await launch();

const failures = [];
const report = (label, problems) => {
  if (problems.length === 0) return console.log(`  fits    ${label}`);
  failures.push(label);
  console.log(`  FAIL    ${label}\n${problems.map((problem) => `            ${problem}`).join('\n')}`);
};
const expect = (label, passed, detail = '') => {
  console.log(`  ${passed ? 'ok' : 'FAIL'}      ${label}${detail ? `  (${detail})` : ''}`);
  if (!passed) failures.push(label);
};

class CameraStalled extends Error {}

async function walk([width, height], first) {
  const tag = `${width}x${height}`;
  const state = { name: 'Robin Avery', avatarId: 'figure', patches: [] };
  const context = await browser.newContext({ viewport: { width, height } });
  await standInSupabase(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const settle = async (ms = 900) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(ms);
  };
  const screen = async (name, ms) => {
    await settle(ms);
    report(`${name} at ${tag}`, await scrollProblems(page));
    await page.screenshot({ path: path.join(outDir, `${name}-${tag}.png`) });
  };

  try {
    console.log(`\n${tag}`);
    await page.goto(`${base}/play`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('title-screen').waitFor({ timeout: 20_000 });
    await page.getByTestId('profile-button').waitFor({ timeout: 10_000 });
    await page.getByTestId('demo-tag').first().waitFor({ timeout: 10_000 });
    await screen('title');

    if (first) {
      const demoRows = await page.locator('.board__row[data-sample="true"]').count();
      const tags = await page.getByTestId('demo-tag').count();
      const mine = await page.locator('.board__row[data-me="true"] [data-testid="demo-tag"]').count();
      expect('every demo row on the board is tagged, and the real player is not', demoRows > 0 && tags === demoRows && mine === 0, `${tags} tags on ${demoRows} demo rows`);
    }

    // The profile menu, then rename and a new avatar, both saved to the profile.
    await page.getByTestId('profile-button').click();
    await page.getByTestId('profile-menu').waitFor();
    await screen('profile-menu', 300);
    if (first) {
      await page.getByTestId('profile-rename').click();
      await page.getByTestId('rename-input').fill('   ');
      await page.getByTestId('rename-save').click();
      expect('an empty name is refused', (await page.getByTestId('rename-error').textContent()) === 'Enter a name.');
      await page.getByTestId('rename-input').fill('A name far too long for the board');
      await page.getByTestId('rename-save').click();
      expect('a name over 20 characters is refused', (await page.getByTestId('rename-error').textContent()) === '20 characters at most.');
      await page.getByTestId('rename-input').fill('  Robin the Bendy  ');
      await screen('profile-rename', 200);
      await page.getByTestId('rename-save').click();
      await page.getByTestId('profile-rename').waitFor();
      expect(
        'rename saves the trimmed name to the profile and shows it',
        state.patches.some((patch) => patch.display_name === 'Robin the Bendy') && (await page.getByTestId('profile-name').textContent()) === 'Robin the Bendy',
        JSON.stringify(state.patches),
      );
      await page.getByTestId('profile-avatar').click();
      await page.getByTestId('avatar-grid').waitFor();
      await screen('profile-avatars', 300);
      await page.getByTestId('avatar-crown').click();
      await page.getByTestId('profile-rename').waitFor();
      const drawn = await page.getByTestId('profile-button').locator('svg').getAttribute('data-avatar');
      expect('a new avatar is saved and drawn in the marquee', state.avatarId === 'crown' && drawn === 'crown', drawn ?? '');
      await page.keyboard.press('Escape');
      await page.getByTestId('profile-menu').waitFor({ state: 'detached', timeout: 2_000 });
      expect('Esc closes the profile menu and leaves the screen alone', await page.getByTestId('title-screen').isVisible());
    } else {
      await page.keyboard.press('Escape');
    }

    await page.getByTestId('title-start').click();
    await page.getByTestId('song-menu').waitFor({ timeout: 20_000 });
    await screen('song-select');

    await page.getByTestId('catalogue-tab-credits').click();
    await page.getByTestId('credits-view').waitFor({ timeout: 5_000 });
    await screen('credits', 400);

    await page.getByTestId('catalogue-tab-steady-flow').click();
    await page.getByTestId(`song-card-${SONG}`).click();
    const started = await Promise.race([
      page.getByTestId('calibrate-screen').waitFor({ timeout: 90_000 }).then(() => true),
      page.getByTestId('start-error').waitFor({ timeout: 90_000 }).then(() => false),
    ]);
    if (!started) throw new CameraStalled(await page.getByTestId('start-error').textContent());
    await screen('calibrate', 1200);

    // The zoom at both ends: the closest view, then the camera's full frame.
    const slider = page.getByTestId('zoom-slider');
    expect('the zoom starts in the middle', (await slider.inputValue()) === '0.5', await slider.inputValue());
    const frameAt = () => page.getByTestId('camera-frame').evaluate((frame) => frame.getBoundingClientRect().toJSON());
    const stageBox = await page.locator('.stage__picture').evaluate((stage) => stage.getBoundingClientRect().toJSON());
    await slider.fill('0');
    await settle(300);
    await page.screenshot({ path: path.join(outDir, `zoom-close-${tag}.png`) });
    const close = await frameAt();
    await slider.fill('1');
    await settle(300);
    await page.screenshot({ path: path.join(outDir, `zoom-full-${tag}.png`) });
    const full = await frameAt();
    const covers = close.left <= stageBox.left + 1 && close.right >= stageBox.right - 1 && close.top <= stageBox.top + 1 && close.bottom >= stageBox.bottom - 1;
    const inside = full.left >= stageBox.left - 1 && full.right <= stageBox.right + 1 && full.top >= stageBox.top - 1 && full.bottom <= stageBox.bottom + 1;
    expect('closest covers the picture area; full frame fits inside it', covers && inside, `stage ${Math.round(stageBox.width)}x${Math.round(stageBox.height)}, close ${Math.round(close.width)}x${Math.round(close.height)}, full ${Math.round(full.width)}x${Math.round(full.height)}`);
    const canvasMatches = await page.evaluate(() => {
      const video = document.querySelector('.stage__video').getBoundingClientRect();
      const canvas = document.querySelector('.stage__canvas').getBoundingClientRect();
      return ['left', 'top', 'width', 'height'].every((key) => Math.abs(video[key] - canvas[key]) < 0.5);
    });
    expect('the overlay canvas sits exactly on the video', canvasMatches);
    await slider.fill('0.5');
    if (first) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const kept = await page.evaluate(() => localStorage.getItem('rehabeat.cameraZoom'));
      expect('the zoom is kept in localStorage', kept === '0.5', kept ?? 'nothing');
      return { state, errors, reloaded: true };
    }

    await page.getByTestId('calibrate-skip').click();
    await page.getByTestId('play-screen').waitFor({ timeout: 10_000 });
    await page.waitForFunction(() => document.querySelector('[data-testid="phase-label"]')?.textContent === 'HOLD', null, { timeout: 30_000 });
    await screen('play', 700);

    await page.getByTestId('result-label').waitFor({ state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(5000);
    await page.getByTestId('finish-button').click();
    await page.getByTestId('results-screen').waitFor({ timeout: 10_000 });
    await screen('results', 2600);
    const barButtons = await page.locator('.app__actions button').allTextContents();
    expect('the results bar has no Leaderboard or Songs button', !barButtons.some((text) => /Leaderboard|Songs/.test(text)), barButtons.join(', '));
    expect('no page errors', errors.length === 0, errors.join(' | '));
    return { state, errors };
  } finally {
    await context.close();
  }
}

let exitCode = 0;
try {
  console.log(`Screens of ${base} into ${path.relative(root, outDir)}/`);
  for (const [index, size] of sizes.entries()) {
    // The first size also walks the profile menu's rename and avatar, and checks the zoom is kept.
    // Then it walks again from the title for Play and the results.
    const passes = index === 0 ? [true, false] : [false];
    for (const first of passes) {
      for (let attempt = 1; ; attempt++) {
        try {
          await walk(size, first);
          break;
        } catch (error) {
          if (!(error instanceof CameraStalled) || attempt === 3) throw error;
          console.log(`  RETRY   the fake camera stalled (${error.message})`);
        }
      }
    }
  }
  if (failures.length > 0) {
    console.log(`\n${failures.length} problem(s): ${failures.join('; ')}`);
    exitCode = 1;
  } else console.log('\nEvery screen fits.');
} catch (error) {
  console.error('\nScreenshots aborted:', error);
  exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
process.exit(exitCode);
