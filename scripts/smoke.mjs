// Browser smoke check: starts the dev server, drives the app in Chromium with
// a fake camera, and fails on console errors.
//
//   npm run smoke                 headless, synthetic test-pattern camera
//   npm run smoke -- --headed     visible window (uses the real GPU; use this for FPS numbers)
//   npm run smoke -- --video path/to/clip.mjpeg   feed a recorded clip as the camera
//   npm run smoke -- --video clip.mjpeg --expect-hit   also require the clip to land a Good or Perfect hold
//   npm run smoke -- --sound      let the browser play through the speakers (muted by default)
//   npm run smoke -- --url http://localhost:5173  use a server that is already running

import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'test-results');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const headed = flag('--headed');
const videoFile = option('--video');
const externalUrl = option('--url');
const expectHit = flag('--expect-hit');

// The song library as shipped in public/songs/. Every song has a beatmap and both stems.
const songsDir = path.join(root, 'public', 'songs');
const readJson = (...parts) => JSON.parse(readFileSync(path.join(songsDir, ...parts), 'utf8'));
const library = readJson('index.json');
const songIds = library.catalogues.flatMap((catalogue) => catalogue.songIds);
const DEFAULT_SONG = 'past-sadness';
const defaultCatalogue = readJson(DEFAULT_SONG, 'meta.json').catalogue;
// The first song outside the default song's catalogue, for the "pick from another catalogue" check.
const otherCatalogue = library.catalogues.find((catalogue) => catalogue.id !== defaultCatalogue && catalogue.songIds.length > 0);
const expectedAudio = 'stems, file beatmap';

// MediaPipe's WASM runtime writes its own log lines through console.error.
// They are status messages, not failures.
const BENIGN_CONSOLE = [/^INFO: /, /^[IWE]\d{4} /, /Created TensorFlow Lite XNNPACK delegate/, /gl_context/i, /OpenGL error checking is disabled/];
const isBenign = (text) => BENIGN_CONSOLE.some((pattern) => pattern.test(text));

// Chrome's fake camera sometimes opens and then delivers almost no frames
// (seen in about a third of headless launches on the machine this was written
// on, with a bare <video> and none of the app's code involved). That is the
// test camera failing, not the app, so the run is retried in a fresh browser.
const MAX_CAMERA_ATTEMPTS = 4;
class CameraStalled extends Error {}

/** Counts the frames the page's camera <video> presents over 1.5 s. */
function framesDelivered(page) {
  return page.getByTestId('camera').evaluate(
    (video) =>
      new Promise((resolve) => {
        let frames = 0;
        const count = () => {
          frames += 1;
          video.requestVideoFrameCallback(count);
        };
        video.requestVideoFrameCallback(count);
        setTimeout(() => resolve(frames), 1500);
      }),
  );
}

/**
 * A song's credit must be on screen wherever it plays: its credit line from
 * meta.json, with links to the source and to the licence.
 */
async function checkCredit(page, screenName, songId) {
  const found = await page.evaluate(async (id) => {
    const { LICENCES } = await import('/src/songs/model.ts');
    const meta = await (await fetch(`/songs/${id}/meta.json`)).json();
    const element = document.querySelector('[data-testid="music-credit"]');
    const box = element?.getBoundingClientRect();
    const hrefs = [...(element?.querySelectorAll('a') ?? [])].map((link) => link.href);
    return {
      visible: Boolean(box && box.width > 0 && box.height > 0 && box.bottom <= window.innerHeight + 1),
      text: element?.textContent ?? '',
      showsCreditLine: Boolean(element?.textContent?.includes(meta.creditLine)),
      linksSource: hrefs.includes(new URL(meta.sourceUrl).href),
      linksLicence: hrefs.includes(LICENCES[meta.licence].url),
    };
  }, songId).catch((error) => ({ visible: false, text: String(error).slice(0, 120) }));
  const passed = Boolean(found.visible && found.showsCreditLine && found.linksSource && found.linksLicence);
  check(`${songId} credit on the ${screenName} screen, linking the source and the licence`, passed, found.text.trim());
}

/**
 * Picks a song using only the keyboard: Tab into the open catalogue's cards,
 * arrow across to the song, Enter. Returns false if the song never got focus.
 */
async function pickWithKeyboard(page, songId) {
  const focused = () => page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? '');
  for (let i = 0; i < 12 && !(await focused()).startsWith('song-card-'); i++) await page.keyboard.press('Tab');
  for (let i = 0; i < 40 && (await focused()) !== `song-card-${songId}`; i++) await page.keyboard.press('ArrowRight');
  if ((await focused()) !== `song-card-${songId}`) return false;
  await page.keyboard.press('Enter');
  return true;
}

/** Decodes a song's stems in the page and measures the loudest sample of their sum at the engine's gain. */
function stemHeadroom(page, songId) {
  return page.evaluate(async (id) => {
    const { STEM_GAIN } = await import('/src/audio/index.ts');
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const load = async (name) => ctx.decodeAudioData(await (await fetch(`/songs/${id}/${name}.mp3`)).arrayBuffer());
    const [drums, melody] = await Promise.all([load('drums'), load('melody')]);
    const frames = Math.min(drums.length, melody.length);
    let peak = 0;
    for (let channel = 0; channel < drums.numberOfChannels; channel++) {
      const d = drums.getChannelData(channel);
      const m = melody.getChannelData(Math.min(channel, melody.numberOfChannels - 1));
      for (let i = 0; i < frames; i++) {
        const sample = Math.abs(d[i] + m[i]);
        if (sample > peak) peak = sample;
      }
    }
    return { gain: STEM_GAIN, peak: peak * STEM_GAIN, audioSeconds: Math.min(drums.duration, melody.duration) };
  }, songId);
}

const checks = [];
function check(name, passed, detail = '') {
  checks.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function launch(extraArgs) {
  const launchArgs = ['--use-fake-device-for-media-stream', ...extraArgs];
  if (!flag('--sound')) launchArgs.push('--mute-audio');
  if (videoFile) launchArgs.push(`--use-file-for-fake-video-capture=${path.resolve(videoFile)}`);
  let lastError;
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ channel, headless: !headed, args: launchArgs });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`No Chromium-based browser could be launched. Install Chrome or run "npx playwright install chromium".\n${lastError}`);
}

function watchConsole(page) {
  const errors = [];
  const ignored = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const source = message.location().url;
    (isBenign(message.text()) ? ignored : errors).push(source ? `${message.text()} [${source}]` : message.text());
  });
  page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`));
  // The console only says "Failed to load resource"; record which resource it was.
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} for ${response.url()}`);
  });
  page.on('requestfailed', (request) => {
    // An audio element aborts its stream whenever its source changes or it stops (song previews do both).
    if (request.resourceType() === 'media' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  return { errors, ignored };
}

/** Camera allowed: song menu -> Calibrate -> Play, debug panel, another catalogue's song, a calibration run. */
async function happyPath(url) {
  const browser = await launch(['--use-fake-ui-for-media-stream']);
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const log = watchConsole(page);
  const measured = {};

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    check('app loads', (await page.title()) === 'Rehabeat');
    await page.getByTestId('song-menu').waitFor({ timeout: 15_000 });
    check('song menu shown on the start screen', true);
    await checkCredit(page, 'start', DEFAULT_SONG);

    // Every catalogue, open in turn. An empty one must say so rather than vanish.
    for (const catalogue of library.catalogues) {
      await page.getByTestId(`catalogue-tab-${catalogue.id}`).click();
      const shown = catalogue.songIds.length === 0
        ? await page.getByTestId('menu-empty').isVisible()
        : (await Promise.all(catalogue.songIds.map((id) => page.getByTestId(`song-card-${id}`).isVisible()))).every(Boolean);
      check(`${catalogue.name} shows ${catalogue.songIds.length === 0 ? '"more songs coming"' : `its ${catalogue.songIds.length} song(s)`}`, shown);
      await page.screenshot({ path: path.join(outDir, `menu-${catalogue.id}.png`) });
    }
    await page.getByTestId('catalogue-tab-credits').click();
    const credited = await page.getByTestId('credits-view').evaluate(
      (view, ids) => ids.filter((id) => !view.textContent.includes(id)),
      songIds.map((id) => readJson(id, 'meta.json').creditLine),
    );
    check('Credits view lists every song\'s credit line', credited.length === 0, credited.join(' | '));
    await page.screenshot({ path: path.join(outDir, 'menu-credits.png') });
    await page.getByTestId(`catalogue-tab-${defaultCatalogue}`).click();
    await page.screenshot({ path: path.join(outDir, '1-menu.png') });

    // Picking a song starts the camera; the fake-UI flag answers "allow".
    await page.getByTestId(`song-card-${DEFAULT_SONG}`).click();
    const startError = await Promise.race([
      page.getByTestId('calibrate-screen').waitFor({ timeout: 90_000 }).then(() => null),
      page.getByTestId('start-error').waitFor({ timeout: 90_000 }).then(() => page.getByTestId('start-error').textContent()),
    ]);
    if (startError?.includes('sent no picture')) throw new CameraStalled(startError);
    check('camera permission granted and Calibrate screen shown', startError === null, startError ?? '');
    if (startError !== null) throw new Error(`The app did not start: ${startError}`);

    const frames = await framesDelivered(page);
    if (frames < 5) throw new CameraStalled(`the fake camera delivered ${frames} frame(s) in 1.5 s`);

    const camera = await page.getByTestId('camera').evaluate((video) => {
      const track = video.srcObject?.getVideoTracks()[0];
      return {
        playing: !video.paused && video.readyState >= 2,
        width: video.videoWidth,
        height: video.videoHeight,
        label: track?.label ?? '',
      };
    });
    check('camera stream is playing at 640x480', camera.playing && camera.width === 640 && camera.height === 480, `${camera.width}x${camera.height}, ${camera.label}`);
    await page.screenshot({ path: path.join(outDir, '2-calibrate.png') });

    await page.getByTestId('calibrate-skip').click();
    await page.getByTestId('play-screen').waitFor({ timeout: 10_000 });
    check('Play screen shown', true);
    await checkCredit(page, 'Play', DEFAULT_SONG);

    await page.keyboard.press('d');
    await page.getByTestId('debug-panel').waitFor({ timeout: 5_000 });
    check('D toggles the debug panel', true);

    const phase = page.getByTestId('phase-label');
    await page.waitForFunction(() => document.querySelector('[data-testid="phase-label"]')?.textContent === 'HOLD', null, { timeout: 20_000 });
    check('routine reaches the HOLD phase on the beat clock', (await phase.textContent()) === 'HOLD');
    await page.screenshot({ path: path.join(outDir, '3-play-hold.png') });

    const result = page.getByTestId('result-label');
    await result.waitFor({ state: 'attached', timeout: 20_000 });
    measured.firstResult = (await result.textContent())?.trim();
    check('a BeatResult is produced when the hold closes', Boolean(measured.firstResult), measured.firstResult);

    // Sample the readout for a few seconds: one frame's detection time is noisy.
    const fpsSamples = [];
    const detectSamples = [];
    for (let i = 0; i < 25; i++) {
      await page.waitForTimeout(200);
      fpsSamples.push(Number(await page.getByTestId('debug-fps').textContent()));
      detectSamples.push(Number(await page.getByTestId('debug-detect-ms').textContent()));
    }
    // The readout only changes when a frame is processed. If it never moved, the
    // camera stalled after it started, and the numbers are stale.
    if (new Set(detectSamples).size === 1 && new Set(fpsSamples).size === 1) {
      throw new CameraStalled('the pose readout did not change for 5 s');
    }
    const mean = (values) => Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
    measured.fps = mean(fpsSamples);
    measured.detectMs = mean(detectSamples);
    measured.detectMsRange = [Math.min(...detectSamples), Math.max(...detectSamples)];
    measured.webglRenderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    measured.audio = await page.getByTestId('debug-audio').textContent();
    measured.delegate = ((await page.getByTestId('debug-panel').textContent()) ?? '').match(/\((GPU|CPU)\)/)?.[1];
    measured.poseFound = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-testid="debug-panel"] tbody td:nth-child(2)')];
      return cells.some((cell) => cell.textContent !== '–');
    });
    check('pose loop is running', measured.fps > 5 && measured.detectMs > 0, `${measured.fps} fps, ${measured.detectMs} ms per detection, ${measured.delegate}`);
    if (videoFile) check('pose found in the camera clip', measured.poseFound);
    check(`beat engine reports "${expectedAudio}"`, (measured.audio ?? '').startsWith(expectedAudio), measured.audio ?? '');

    {
      measured.stemPeakDbfs = {};
      for (const id of songIds) {
        const headroom = await stemHeadroom(page, id);
        measured.stemPeakDbfs[id] = Math.round(200 * Math.log10(headroom.peak)) / 10;
        check(`${id} stems do not clip at x${headroom.gain}`, headroom.peak < 1, `drums + melody peak at ${measured.stemPeakDbfs[id]} dBFS`);
      }

      // The audio wraps after `loop` seconds. For the grid to carry straight on, the first
      // beat of the next pass has to land one beat after the last beat of this one.
      const headroom = await stemHeadroom(page, DEFAULT_SONG);
      const beatmap = readJson(DEFAULT_SONG, 'beatmap.json');
      const loop = Number.parseFloat((await page.getByTestId('debug-loop').textContent()) ?? '');
      const inLoop = beatmap.beats.filter((time) => time < loop);
      const seam = loop + inLoop[0] - inLoop[inLoop.length - 1];
      const beat = 60 / beatmap.bpm;
      measured.loop = { seconds: loop, beats: inLoop.length, audioSeconds: Math.round(headroom.audioSeconds * 1000) / 1000, seamMs: Math.round(seam * 1000), beatMs: Math.round(beat * 1000) };
      check('stems loop on the beat grid', Math.abs(seam - beat) < 0.002, `${loop} s loop of ${inLoop.length} beats in ${measured.loop.audioSeconds} s of audio; seam ${measured.loop.seamMs} ms, beat ${measured.loop.beatMs} ms`);
    }

    if (expectHit) {
      // The clip should land at least one hold; with stems, that brings the melody in.
      const hit = await page
        .waitForFunction(() => /^(Good|Perfect)/.test(document.querySelector('[data-testid="result-label"]')?.textContent ?? ''), null, { timeout: 45_000 })
        .then(() => true, () => false);
      measured.hit = hit ? (await result.textContent())?.trim() : 'none';
      check('the camera clip lands a Good or Perfect hold', hit, measured.hit);
      measured.melody = await page.getByTestId('debug-melody').textContent();
      check('melody stem is in after a Good hold', measured.melody === 'in', measured.melody ?? '');
    }
    await page.screenshot({ path: path.join(outDir, '4-play-debug.png') });

    // Run a real calibration pass. A synthetic camera has nobody in it, so the
    // expected outcome is the "didn't register" state; a clip of someone
    // raising an arm on the clicks would produce a measured offset instead.
    await page.keyboard.press('d');
    await page.getByRole('button', { name: 'Recalibrate' }).click();
    await page.getByTestId('calibrate-start').click();
    const outcome = await Promise.race([
      page.getByTestId('measured-offset').waitFor({ timeout: 20_000 }).then(() => 'measured'),
      page.getByText("That didn't register").waitFor({ timeout: 20_000 }).then(() => 'not registered'),
    ]);
    measured.calibration = outcome === 'measured' ? await page.getByTestId('measured-offset').textContent() : outcome;
    check('calibration run completes', true, measured.calibration);
    await page.screenshot({ path: path.join(outDir, '5-calibrate-result.png') });

    // Esc back to the menu (from Calibrate this time), then pick a song from another
    // catalogue with the keyboard alone. Calibration is done, so it goes straight to Play.
    await page.keyboard.press('Escape');
    await page.getByTestId('song-menu').waitFor({ timeout: 10_000 });
    check('Esc goes back to the song menu', true);
    await page.screenshot({ path: path.join(outDir, 'menu-after-play.png') });
    if (otherCatalogue) {
      const target = otherCatalogue.songIds[0];
      await page.getByTestId(`catalogue-tab-${otherCatalogue.id}`).click();
      const picked = await pickWithKeyboard(page, target);
      const reached = picked && (await page.getByTestId('play-screen').waitFor({ timeout: 30_000 }).then(() => true, () => false));
      if (reached) {
        await page.keyboard.press('d');
        await page.getByTestId('debug-panel').waitFor({ timeout: 5_000 });
      }
      const playing = reached ? await page.getByTestId('debug-song').textContent() : '';
      measured.otherSong = { catalogue: otherCatalogue.id, song: playing };
      check(`keyboard pick of "${target}" from ${otherCatalogue.name} reaches the Play screen`, playing === target, `playing ${playing || 'nothing'}`);
      if (reached) {
        await checkCredit(page, 'Play', target);
        measured.otherSong.audio = await page.getByTestId('debug-audio').textContent();
        await page.screenshot({ path: path.join(outDir, '6-play-other-catalogue.png') });
      }
    } else {
      check('a catalogue other than the default one has a song to pick', false, 'add one with npm run songs');
    }


    check('no console errors', log.errors.length === 0, log.errors.join(' | '));
  } finally {
    await browser.close();
  }
  return { measured, ignored: log.ignored };
}

/** Camera refused: the menu must explain what to do, and picking must still work. */
async function deniedPath(url) {
  // Without the fake-UI flag, headless Chromium refuses the camera prompt.
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] }).catch(() => launch(['--deny-permission-prompts']));
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`song-card-${DEFAULT_SONG}`).click();
    const error = page.getByTestId('start-error');
    await error.waitFor({ timeout: 30_000 });
    const text = (await error.textContent()) ?? '';
    check('refused camera shows a recoverable message', /Camera access is blocked/.test(text), text);
    // Picking again must try again (and fail the same way) rather than do nothing.
    await page.getByTestId(`song-card-${DEFAULT_SONG}`).click();
    const retried = await page.getByTestId('start-progress').or(page.getByTestId('start-error')).first().isVisible();
    check('songs can be picked again after a refusal', retried);
  } finally {
    await browser.close();
  }
}

await mkdir(outDir, { recursive: true });
const server = externalUrl ? null : await createServer({ root, logLevel: 'error', server: { port: 5199, strictPort: false } });
await server?.listen();
const url = externalUrl ?? server.resolvedUrls.local[0];
console.log(`Smoke check against ${url} (${headed ? 'headed' : 'headless'}${videoFile ? `, camera clip ${videoFile}` : ', synthetic camera'})\n`);

let exitCode = 1;
try {
  let outcome;
  for (let attempt = 1; !outcome; attempt++) {
    try {
      outcome = await happyPath(url);
    } catch (error) {
      if (!(error instanceof CameraStalled) || attempt === MAX_CAMERA_ATTEMPTS) throw error;
      console.log(`RETRY ${error.message}; relaunching the browser (attempt ${attempt + 1} of ${MAX_CAMERA_ATTEMPTS})\n`);
      checks.length = 0;
    }
  }
  const { measured, ignored } = outcome;
  await deniedPath(url);

  console.log('\nMeasured:', JSON.stringify(measured, null, 2));
  if (ignored.length > 0) console.log(`Ignored ${ignored.length} MediaPipe runtime log line(s) written via console.error, e.g. "${ignored[0]}"`);
  const failed = checks.filter((entry) => !entry.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots in test-results/.`);
  exitCode = failed.length === 0 ? 0 : 1;
} catch (error) {
  console.error('\nSmoke check aborted:', error);
} finally {
  await server?.close();
}
process.exit(exitCode);
