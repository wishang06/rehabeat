# Rehabeat

Rehabeat turns rehab moves into a rhythm game. The player stands in front of a webcam and matches a target pose on the beat: reach for it, hold it, release it. Hold it well and the melody comes in.

It runs entirely in the browser: the camera video never leaves the laptop. The landing page is at `/` and the game is at `/play`. The design direction is written up in [`PRODUCT.md`](PRODUCT.md) and [`.interface-design/system.md`](.interface-design/system.md).

## Setup

You need Node 20 or newer, a webcam, and a Chromium-based browser (Chrome or Edge).

```bash
npm install
npm run dev        # http://localhost:5173
```

The first start downloads the pose model (about 6 MB) from Google's model storage, so it needs a network connection once. Everything else, including the pose runtime and the font, is served locally.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173 |
| `npm test` | Unit tests (Vitest) |
| `npm run smoke` | Browser smoke check with a fake camera (Playwright) |
| `npm run typecheck` | TypeScript, strict |
| `npm run build` | Typecheck and production build |
| `npm run songs` | Add, list, preview, move or remove songs (see [Song library](#song-library)) |
| `npm run moves` | Rebuild the yoga moves from the pose dataset (see [Moves from the pose dataset](#moves-from-the-pose-dataset)) |
| `npm run test:songs` | Adds a generated click track end to end with Demucs (needs the Python setup) |
| `node scripts/fps.mjs --headed` | Frame rate of the Play screen, for before and after a UI change |
| `node scripts/screens.mjs` | Screenshots of every page into `docs/screenshots/` |

### Smoke check

`npm run smoke` starts its own dev server, drives Chrome (or Edge) with a synthetic camera, and fails on any console error. It opens every catalogue in the song menu and the Credits view, picks Past Sadness, walks Calibrate and Play, opens the debug panel and runs a calibration pass. It then goes back to the menu with Esc and picks a song from another catalogue with the keyboard alone, and checks that a refused camera shows a recoverable message. Along the way it checks each song's credit on the start and Play screens, that no song's stems clip at the engine's gain, and that the loop seam is exactly one beat. Screenshots of each catalogue go to `test-results/menu-<catalogue>.png`. Options go after `--`:

| Option | Effect |
| --- | --- |
| `--headed` | Show the browser window |
| `--video clip.mjpeg` | Use a recorded clip as the camera (640x480 MJPEG or Y4M) |
| `--expect-hit` | With `--video`: require the clip to land a Good or Perfect hold |
| `--sound` | Play through the speakers (muted by default) |
| `--url http://localhost:5173` | Test a server that is already running |

Chrome's synthetic camera sometimes opens and then delivers no frames. The check detects that, relaunches the browser, and prints a `RETRY` line when it does.

## Playing

The landing page (`/`) explains the game; **Play now** goes to `/play`, which opens on the title screen with your level, XP and daily streak. **Start** (or Enter) opens the song menu.

1. **Pick a song.** The song menu lists the songs by catalogue. Hovering or focusing a song plays 10 s of its melody once you've clicked or pressed a key on the page. Arrows move, Enter picks, Esc goes back. Picking a song the first time starts the camera and sound; stand back until your head and knees are in the picture.
2. **Calibrate.** Four clicks play; raise one arm so it arrives on each click. The measured offset is shown and saved. You can skip this and use the saved value.
3. **Play.** The routine loops through the three moves. A gold figure shows the pose to hit, on your own body or, when its arms rest at its sides, beside you. It turns green when you are on it. Your own limbs are coloured green, amber or red by how far each is from its target, and a short hint ("left arm higher") points at the one to fix. If part of you is out of view, those limbs go grey and the screen tells you to step back. The dial counts the beats left in the current phase (REACH, HOLD, RELEASE) and pulses on the beat. Each hold is judged Perfect, Good or Miss.

Esc (or **Songs** in the top bar) returns to the menu; after the first calibration, picking another song goes straight to Play. **Finish run** ends the run and shows the results: a grade from S to C, up to three stars, the points, the Perfect / Good / Miss split, the best combo and the XP earned. **Play again** restarts the song and **Change song** goes back to the menu. Press **D** for the debug panel: FPS, detection time, pose latency (how far behind the audible beat each pose frame arrives), the camera's size and frame rate, calibration offset, song, audio mode, the current hint, and each joint's live angle, target, error and visibility.

## Architecture

```
                    frame times mapped onto the audio clock
                  ┌──────────────────────────────────────────┐
                  ▼                                          │
 webcam ──▶ src/pose ──PoseFrame──▶ src/scoring ──BeatResult──▶ src/ui
            angles from 3D          hold-window score,         HUD, overlay,
            world landmarks,        form guidance,             beat dial
            One Euro smoothing      combo / accuracy
                                         │ in the pose (PoseLock)
                                         ▼
                                    src/audio
                       AudioContext master clock, beat grid,
                       click track or drums + melody stems
```

The rule that holds it together: **`AudioContext.currentTime` is the only clock.** Audio is scheduled on it, video frames are stamped on it, and the visuals read it. Nothing compares a wall-clock time to an audio time.

### Pose (`src/pose/`)

- MediaPipe `PoseLandmarker`: lite model, GPU delegate (falls back to CPU if it can't be created), VIDEO mode, one pose, 640x480 webcam at 30 fps. The size and frame rate are asked for as `ideal`, so a camera that can't do them still opens, and one that offers several frame rates picks 30: every frame interval is time in which a beat can't be measured. (Chrome's fake test camera tops out at 20 fps unless started with `--use-fake-device-for-media-stream=fps=30`.)
- Detection runs inside `requestVideoFrameCallback`. Each frame is stamped with the callback's capture time (`captureTime`, falling back to `expectedDisplayTime`), then mapped onto the audio clock through `AudioContext.getOutputTimestamp()`, so a frame's time is the audio that was audible when it was captured.
- Joint angles come from `worldLandmarks` (3D, metres), not pixel positions, so they don't change with where you stand in the frame. A joint is measured once all three of its landmarks reach 0.6 visibility, and stays measured until one drops below 0.5 (`KEEP_MEASURED_VISIBILITY`), so a wrist or ankle hovering at the cutoff doesn't drop in and out of scoring from frame to frame.
- Angles are smoothed with a One Euro filter (`oneEuro.ts`, written for this repo and unit-tested) at `minCutoff 1.0`, `beta 0.05`, `dCutoff 1.0` (`angleSmoother.ts`). On a simulated reach with 2-4° of landmark noise, the smoothed angle crosses the Good line 18 ms (a 0.6 s reach) to 25 ms (a 1.2 s reach) after the real one; the earlier settings (1.5, 0.02) took 35 to 46 ms, for 4-10% less jitter at rest.
- Output per frame: `PoseFrame { t, angles, visible }`.

### Moves (`src/moves/`)

`moves.json` is the routine. See [Move format](#move-format-for-teammates) below. `ghost.ts` lays out a move's target limbs for the start screen's pose glyphs.

### Feedback (`src/engine/`)

Every display frame, the Play screen builds a `FeedbackFrame` and publishes it to `feedbackStore`. The frame holds:

- the phase and the beats until the next one;
- the current and next move;
- a status (green, amber, red or grey) and an angle error for each limb;
- the worst joint and a short hint for it;
- hold progress and the live score;
- whether a scored joint is out of view.

UI components read the frame with `useFeedbackFrame()`. The canvas overlay draws from it: the gold target figure (filled capsules anchored to the player's own shoulders, hips and limb lengths, or drawn beside them when its arms rest at its sides), the player's own limbs coloured by status, the hint arrow and the step-back warning. [`src/engine/README.md`](src/engine/README.md) documents the frame, the figure geometry, the placement rule and how to read the frame from a component.

### Scoring (`src/scoring/`)

- Each move is a cycle: reach for N beats, hold for N, release for N.
- **Frame score** (0-100) comes from the mean absolute angle error over the move's joints only: `100 - 40 × error / tolerance`, clamped. So an error equal to the move's `tolerance` scores exactly 60. A target joint that isn't visible counts as a zero-score error.
- **Move score** is the time-weighted mean frame score inside the hold window only, after shifting frames by the calibration offset. Each frame's score stands from its own time until the next frame, for at most 0.2 s (`MAX_FRAME_SPAN_SEC`, so a stalled camera can't stretch one frame), which judges the hold by time on the beat grid: a frame-rate dip in half of a hold doesn't re-weight it. 85 and up is Perfect, 60 and up is Good, anything else is a Miss.
- **In the pose** (`PoseLock`): the frame score has been Good for 100 ms, and hasn't since spent 150 ms under 50. The dwell keeps a limb sweeping through the pose from counting; the gap between 60 and 50 keeps a pose held right at the Good line from flickering. The scoring engine exposes it as `live.locked`.
- Output per move: `BeatResult { moveId, score, label, timingOffsetMs, formNote? }`. `timingOffsetMs` is how late (positive) or early (negative) the player first landed a Good pose relative to the first hold beat: the start of the first lock, placed between frames where the score crossed 60, so it is measured to a few milliseconds rather than to the frame. A pose landed too close to the end of the hold for the lock to engage still counts. If they never reached it, it is the length of the hold.
- **Form guidance** (guidance, never framed as safety): two rules, each flagged only after it has applied continuously for more than 500 ms.
  - `trunk-lean`: the shoulder midpoint tilts more than 15° sideways from the hip midpoint.
  - `shoulder-shrug`: the ear-to-shoulder distance shrinks more than 20% below the resting baseline captured during calibration. Without a calibration baseline this rule is off.
- Stats: **combo** is the current run of moves that weren't a Miss, **streak** is the current run of Perfects, **accuracy** is the mean move score.
- Hold windows close on the clock as well as on frames, so a stalled camera gives a Miss instead of freezing the game.

### Audio (`src/audio/`)

- Each song gets its own `BeatEngine`, loading `public/songs/<id>/beatmap.json` (`{ bpm, offset, beats }`) and the song's two stems, on one `AudioContext` shared with the menu's previews. If a beatmap is missing or malformed it falls back to a generated 72 BPM grid.
- **Stems mode**: the drums play throughout and the melody fades in over 300 ms only while you are in the pose. This is the "music follows you" mechanic (`melodyShouldPlay` and `MelodyGate`):
  - in a hold, it plays while you are in the pose (`live.locked`, and the frame score at Good or better, so arms sagging just under Good lose it even though the lock holds), whatever came before;
  - in a reach, it plays as soon as you land the next pose, or while the last move was Good or better, so a good hold carries it on;
  - in a release, it carries the result of the hold that just closed;
  - it comes in at once but only goes out after the rule has said no for half a beat, so landing a fraction late, letting go a fraction early or a wobble doesn't cut the tune; and a camera that stops sending frames can't keep it playing.
  - letting go a beat or so early in a hold that still scores Good drops the melody, and it comes back as the release starts, because the Good result carries it. That is on purpose: the drop tells you that you let go, and the carry keeps a good hold rewarded.

  In a simulation at 72 BPM it comes in within 0.25 s of a player who lands a beat late (the old rule, which followed the hold's running mean, took 1.2 s) and goes out within 0.8 s of one who lets go half-way (the old rule played on for 1.1 s). `src/scoring/rhythmSim.test.ts` runs a seeded player through the whole path from smoothing to the melody.
  - Both stems are raised 2.5x (`STEM_GAIN` in `beatEngine.ts`). `npm run songs` levels every song's stems so drums plus melody peak at -12 dBFS, so the mix peaks at about -4 dBFS whatever the song. `npm run smoke` fails if any song would clip.
  - The stems loop where the last full beat in `beatmap.json` ends, not at the end of the file. A song is rarely a whole number of beats long; looping the whole file made Past Sadness's beat at the seam 59 ms too long and left the grid off for every pass after.
- **Click mode** (when a song has no stems): a synthesized click on every beat, accented every fourth.
- **Sound effects** (`sfx.ts`, `uiSounds.ts`): arcade blips synthesized on their own `AudioContext`, no files. One set of document listeners gives every button, tab, link and song card a hover tick, a keyboard-navigation blip, a press click (a coin-in chirp for primary actions and song cards) and a downward chirp for Esc and back buttons; `data-sfx="<name>"` or `data-sfx="none"` overrides one. In play, `HudSounds` knocks the 3-2-1, shouts GO, whooshes each reach, pings each hold and the moment it hits Perfect, gives Perfect / Good / Miss their own sounds, climbs a run every fifth combo and beeps when you step out of frame. Results ta-da, slam the grade, chime each star, tick as the numbers roll and fanfare a level-up. **M** turns them off and on (remembered in `localStorage`).
- **Calibration**: four clicks; for each, the time the raised arm arrives is compared with the click time. The median difference is stored as `offsetMs` (in `localStorage`) and applied in scoring. It needs only the clock, so it runs before a song is loaded. The offset includes the smoothing filter's lag, so a calibration saved before the filter was retuned is about 20 ms generous until it is run again.

### UI (`src/ui/`, `src/landing/`)

Two routes (`react-router`): the landing page at `/` (`src/landing/`) and the game at `/play` (`src/App.tsx`). The game is loaded on demand, so the landing page does not download the pose model. `/hud` shows the play HUD on a blank stage for design work.

- **Landing page.** A hero with the gold figure looping an overhead raise on a silent beat, "How it works" in three animated steps, the adherence statistic with its source, the privacy note, the song catalogues (read from the song library) and the credits. Motion is GSAP with ScrollTrigger; with reduced motion the page rests in place.
- **Play HUD (`src/ui/hud/`).** DOM laid over the camera and its canvas, never drawn on them: the phase word and beat pips, a 3-2-1 count-in, the current and next move, a match ring with marks at 60 and 85, PERFECT / GOOD / MISS pops, the combo, the beat pulse and a "step back" banner. Per-frame values come from the engine's `FeedbackFrame` through `feedbackStore`; the beat pulse is a custom property the Play screen writes from the audio clock. Every prop type is in `src/ui/hud/types.ts`, and `src/ui/mockFeedback.ts` is a typed mock frame that drives the same HUD without a camera.
- **Progress (`src/progress/`).** The grade, stars, XP, levels and the daily streak: pure functions with tests, and a small store in `localStorage`. None of it feeds back into scoring.

Five game screens (title, the song menu, Calibrate, Play, results) over one persistent camera view, plus the debug panel. The menu (`src/ui/menu/`) is used up close with a mouse or keyboard: a rail of catalogues drawn as a metronome rod with a notch per song at its tempo, and song cards with a lamp blinking at the song's BPM. The Play screen is read from about two metres away, so it has one large focal element: the beat dial and the phase word.

## Accounts and leaderboard

Players sign in with Google through Supabase Auth (project `rkxqtgbcendomwvrfxjf`). Signing in is optional: anyone can play, and a finished run goes on the leaderboard only when the player is signed in. A run finished before signing in is kept across the Google redirect and saved on return.

- **Points:** a Perfect is worth 100, a Good 50, a Miss 0. Each move in an unbroken combo adds 10 more, up to +100, so a move is worth at most 200 (`src/scoring/points.ts`).
- **Finish run** on the Play screen ends the run and shows the results with the top five.
- **Title screen:** the top five sit beside the Start button, with sign-in under them. The header's Leaderboard button opens the full board from every other screen.
- **Critters:** every player is drawn as a critter (bear, cat, bunny, frog, chick or monster) in cyan, pink or white, picked from their user id so it is the same everywhere (`src/ui/avatar.ts`, `PlayerAvatar.tsx`).
- **Sample players:** `supabase/seed_sample_players.sql` adds eight demo players and their runs for an empty board, flagged `profiles.is_sample`. It is never run automatically; the file says how to remove them.
- **Schema:** `supabase/migrations/`. `profiles` is filled from the Google profile on sign-up, `scores` holds one row per run, and the `leaderboard` view ranks players by their best run. Row Level Security lets anyone read, and lets a signed-in player add only their own scores. Nobody can edit or delete a score from the app.
- **Config:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`). Without them the game runs with accounts switched off.

## Deployment

Every push to `main` deploys automatically. The workflow in `.github/workflows/deploy.yml` runs `npm ci`, `npm test` and `npm run build`, then rsyncs `dist/` to the EC2 server at `/var/www/rehabeat`, where nginx serves it. A failing test or typecheck stops the deploy, and the site keeps the previous version. To redeploy without a push, run the workflow by hand from the Actions tab.

The site has no rewrite rule, so the build writes a copy of `index.html` at `dist/play/` and `dist/hud/` (the `rehabeat-route-files` plugin in `vite.config.ts`): a reload of `/play` then finds a real file. On Vercel, `vercel.json` rewrites every route to `/index.html` instead.

The workflow reads three repository secrets: `DEPLOY_SSH_KEY`, `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`. On the server that key is limited to rsync into the web root (`rrsync`), so it can't open a shell. If the server's address changes, update `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`.

## Song library

Songs live in `public/songs/<id>/`: `meta.json`, `beatmap.json`, `drums.mp3` and `melody.mp3`. `public/songs/index.json` groups them into three catalogues by tempo:

| Catalogue | BPM | Difficulty |
| --- | --- | --- |
| Calm Stretch | 55 to 70 | gentle |
| Steady Flow | 70 to 85 | steady |
| Active Rehab | 85 to 100 | active |

Difficulty defaults from the BPM and can be set by hand. The game loads the index and every `meta.json` at start and validates them (`src/songs/library.ts`); a broken song is skipped with a warning rather than taking the menu down. A unit test checks the shipped library: every listed song has its files, a full credit line and a beat jitter under 10 ms.

The library ships with six songs:

| Catalogue | Song | Artist | Licence | BPM | Length | Beat jitter |
| --- | --- | --- | --- | --- | --- | --- |
| Calm Stretch | [Wetlands](https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/wetlands-lofi-calm-relaxed/) | HoliznaCC0 | CC0 1.0 | 60 | 2:44 | 3.2 ms |
| Calm Stretch | [Stealth Groover](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100690) | Kevin MacLeod | CC BY 4.0 | 69 | 3:20 | 2.1 ms |
| Steady Flow | [Past Sadness](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007) | Kevin MacLeod | CC BY 4.0 | 72 | 3:33 | 1.5 ms |
| Steady Flow | [Dreamy Reverie](https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/dreamy-reverie-lofi-nostalgic-chill/) | HoliznaCC0 | CC0 1.0 | 75 | 2:24 | 6.0 ms |
| Active Rehab | [Saturation](https://freemusicarchive.org/music/holiznacc0/public-domain-lofi/saturation-lofi-calm-relaxed/) | HoliznaCC0 | CC0 1.0 | 90 | 2:36 | 3.1 ms |
| Active Rehab | [Wallpaper](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100843) | Kevin MacLeod | CC BY 4.0 | 93 | 3:40 | 3.0 ms |

**Credits.** Every song's `creditLine` (for example `"Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.`) is shown under the camera view while the song is selected or playing, with its source and licence as links, and the menu's Credits view lists them all. `npm run songs` also writes them into the generated section of [`public/CREDITS.md`](public/CREDITS.md). Only CC0, CC BY and public domain songs are accepted: they allow sharing the audio and splitting it into stems.

**Adding a song** is one command, `npm run songs`, in PowerShell or Git Bash. It asks for a file or link, reads the title and artist from the file's tags, checks the licence, finds the beat grid and offers half or double tempo, suggests a catalogue and difficulty, splits the stems with Demucs, offers an ear check, and writes the song folder, `index.json` and `CREDITS.md`. Every step also works from flags with `--yes`. The Python setup and every option are in [`tools/README.md`](tools/README.md).

## Move format (for teammates)

Moves live in [`src/moves/moves.json`](src/moves/moves.json). This format is locked. Add or edit entries there and the app picks them up; the file is validated at load and a malformed move fails with a message naming the field.

```json
{
  "id": "side-arm-raise",
  "name": "Side Arm Raise",
  "joints": { "leftShoulder": 90, "rightShoulder": 90, "leftElbow": 175, "rightElbow": 175 },
  "tolerance": 20,
  "beats": { "reach": 2, "hold": 4, "release": 2 },
  "formRules": ["trunk-lean", "shoulder-shrug"]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique id, used in `BeatResult.moveId` |
| `name` | Shown to the player |
| `joints` | Target angle in degrees (0-180) for each joint that should be scored. Joints you leave out are ignored. |
| `tolerance` | Mean angle error, in degrees, at which a hold still counts as Good |
| `beats` | Whole beats for each phase. `hold` must be at least 1. |
| `formRules` | Form-guidance rule ids to check during this move: `trunk-lean`, `shoulder-shrug`, or none. Unknown ids are ignored. |

Joint names and how each angle is measured (left and right are the player's own):

| Joints | Angle between | Reads as |
| --- | --- | --- |
| `leftShoulder`, `rightShoulder` | hip, shoulder, elbow | 0 = arm at the side, 90 = level with the shoulder, 180 = straight overhead |
| `leftElbow`, `rightElbow` | shoulder, elbow, wrist | 180 = straight |
| `leftHip`, `rightHip` | shoulder, hip, knee | 180 = standing straight, 90 = thigh level |
| `leftKnee`, `rightKnee` | hip, knee, ankle | 180 = straight |

The first three moves in the file (overhead arm raise, side arm raise, standing knee raise) are placeholders. The eight after them come from the pose dataset.

### Moves from the pose dataset

`tools/moves/poses/` holds one CSV per yoga pose: about 60 photos each, with the 33 MediaPipe landmarks of every photo. `npm run moves` turns each CSV into a move and prints what it found; `npm run moves -- --write` merges the moves into `moves.json`, replacing moves with the same id and leaving the others alone. For each pose it:

1. measures the game's eight joint angles in every photo, in the image plane, from the landmark columns. The CSVs' own angle columns are measured differently and aren't used. The photos' z values are rough depth guesses, and with them straight limbs read as 30-40° bent.
2. mirrors photos of one-sided poses (tree, warrior, dancer, half moon) so they're all on the same side, the side most photos show.
3. scores only the joints that at least 60% of the photos show and whose middle half agree within 40°. The arms in Tree Pose (overhead in some photos, at the chest in others) and Goddess Pose aren't scored. Downward Dog photos are taken side-on, so only the right side is scored and the player has to stand with their right side to the camera.
4. sets the target to the median angle, and the tolerance so that 75% of the photos would hold at Good, between 20° and 35°.

Ids, names and form rules for each pose are in `POSES` in [`tools/moves/dataset.ts`](tools/moves/dataset.ts); to add a pose, add its CSV and a line there.

## Song tools (`tools/`)

`npm run songs` (TypeScript in `tools/songs/`) drives the Python pipeline: `tools/song_pipeline.py` over `tools/make_beatmap.py`, which finds the beat grid with librosa and splits stems with Demucs (`htdemucs`, two stems). It needs Python 3.11 and ffmpeg. Setup on Windows 11, from the repo root:

```powershell
py -3.11 -m venv tools\.venv
tools\.venv\Scripts\python.exe -m pip install -r tools\requirements.txt
winget install Gyan.FFmpeg     # if ffmpeg is not on PATH
```

The install is about 1 GB (Demucs and the CPU build of PyTorch). `npm run songs` checks all of this when it starts and prints the fix for anything missing. Step-by-step use, flags, the beatmap format and the Python tests are in [`tools/README.md`](tools/README.md).

## Layout

```
src/
  types.ts        Shared contracts: JointName, PoseFrame, Move, BeatResult
  types/ui.ts     FeedbackFrame and the other engine-to-UI types
  session.ts      Starts sound, camera and pose tracking on one clock; loads a song's engine
  engine/         FeedbackFrame building, hints, target-figure geometry and placement
  songs/          Song library: types, catalogues, licences, credit lines, index and meta loading
  pose/           Camera, pose tracker, joint angles, One Euro filter, skeleton overlay
  moves/          moves.json, validation, ghost limbs for the pose glyphs
  scoring/        Frame score, routine, scoring engine, form rules, stats
  audio/          Master clock, beatmap, beat grid, click track, stems, calibration
  ui/             Title, Calibrate, Play and Results screens, canvas overlay, beat dial, debug panel, credit strip
  ui/menu/        Song menu: catalogue rail, song cards, previews, credits view
  ui/hud/         The play HUD as DOM, its prop types, and the /hud preview
  ui/mockFeedback.ts  A typed mock FeedbackFrame for the HUD
  landing/        The landing page at / and its GSAP motion
  progress/       Grade, stars, XP, levels and the daily streak
  components/     The DOM gold figure and the shadcn/ui button
  styles/theme.css  Tailwind and the design tokens
public/songs/     The song library (index.json and one folder per song)
scripts/smoke.mjs Playwright smoke check
scripts/fps.mjs   Play screen frame rate
scripts/screens.mjs  Screenshots of every page
tools/songs/      npm run songs (TypeScript)
tools/            Beat tracking and stems (Python)
```

## Credits

### Libraries

Every component in this repo was written for it. These libraries are used as dependencies:

| Library | Used for | Licence |
| --- | --- | --- |
| [React](https://react.dev) and React DOM | The UI | MIT |
| [React Router](https://reactrouter.com) (`react-router`) | The `/` and `/play` routes | MIT |
| [Tailwind CSS](https://tailwindcss.com) v4 (`tailwindcss`, `@tailwindcss/vite`) | Design tokens and utilities | MIT |
| [shadcn/ui](https://ui.shadcn.com) | The button was scaffolded with its CLI (`src/components/ui/button.tsx`), then restyled | MIT |
| [cn](https://github.com/shadcn-ui/cn) | Class-name merging, installed by the shadcn/ui CLI | MIT |
| [Radix UI](https://www.radix-ui.com) (`radix-ui`) | `Slot`, used by the button | MIT |
| [class-variance-authority](https://cva.style) | Button variants | Apache-2.0 |
| [Motion](https://motion.dev) (`motion`) | Screen transitions and HUD pops | MIT |
| [GSAP](https://gsap.com) and `@gsap/react` | Landing page loop and scroll reveals, results count-ups | GSAP Standard "no charge" licence |
| [Lucide](https://lucide.dev) (`lucide-react`) | Icons | ISC |
| [Sonner](https://sonner.emilkowal.ski) (`sonner`) | Toasts for level-ups and streaks | MIT |
| [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) | Pose tracking | Apache-2.0 |
| [Supabase JS](https://supabase.com) | Sign-in and the leaderboard | MIT |

### Fonts

Served locally through [Fontsource](https://fontsource.org), all under the SIL Open Font License 1.1: Barlow Condensed and Barlow (Jeremy Tribby), Doto (Óliver Lalan), and Archivo (Omnibus-Type), which the canvas overlay uses for its hint labels.

### Music

Every song's credit and licence is in [`public/CREDITS.md`](public/CREDITS.md) and in the game's Credits view. The default song is "Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0, separated into drum and melody stems by the Rehabeat team.

## Current limits

- The landing page and the game screens were checked in Chromium at 1440 x 900 and at 390 px wide, with a synthetic camera. The play HUD has not yet been read from two metres by a real player on a real laptop.
- XP, levels and the daily streak live in `localStorage`: they do not follow a player to another browser, and clearing site data resets them.

- The moves, tolerances and form-rule thresholds are placeholders and have not been tuned on real players.
- So far the pose and scoring path has been exercised in the browser with a still photo of a person as the camera, not a moving person. Calibration (which needs real arm raises) has only been tested on synthetic frames.
- Loop points are checked against the beat grid, not by ear. The loop cuts the audio with no crossfade, so listen for a click where each song wraps.
- Song previews and in-game audio were checked in a muted browser; levels were measured, not listened to.
- The target figure draws arms in the image plane and legs as seen from the front. A knee raise is drawn with the thigh canted outward so it reads as a raise, which is not exactly how a straight-ahead knee raise looks on camera.
- MediaPipe often guesses landmarks just outside the frame with high confidence. The step-back warning only appears once a scored joint's visibility actually drops below the cutoff (0.6, or 0.5 for a joint that was already measured), which in testing needed a good part of a limb out of view.
- Only Chromium browsers have been tested.

---

Built with Claude Code and Cursor at HackPrinceton 2026.
