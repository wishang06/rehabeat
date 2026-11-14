# Rehabeat

Rehabeat turns rehab moves into a rhythm game. The player stands in front of a webcam and matches a target pose on the beat: reach for it, hold it, release it. Hold it well and the melody comes in.

This repo currently holds **Part 1: the pose scoring and beat engine**. It runs entirely in the browser; there is no backend.

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
| `npm run test:songs` | Adds a generated click track end to end with Demucs (needs the Python setup) |

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

1. **Pick a song.** The start screen lists the songs by catalogue. Hovering or focusing a song plays 10 s of its melody once you've clicked or pressed a key on the page. Arrows move, Enter picks, Esc goes back. Picking a song the first time starts the camera and sound; stand back until your head and knees are in the picture.
2. **Calibrate.** Four clicks play; raise one arm so it arrives on each click. The measured offset is shown and saved. You can skip this and use the saved value.
3. **Play.** The routine loops through the three moves. The glowing guide shows the target and turns green when you are on it. The dial counts the beats left in the current phase (REACH, HOLD, RELEASE) and pulses on the beat. Each hold is judged Perfect, Good or Miss.

Esc (or **Songs** in the top bar) returns to the menu; after the first calibration, picking another song goes straight to Play. Press **D** for the debug panel: FPS, detection time, calibration offset, song, audio mode, and live joint angles against the current targets.

## Architecture

```
                    frame times mapped onto the audio clock
                  ┌──────────────────────────────────────────┐
                  ▼                                          │
 webcam ──▶ src/pose ──PoseFrame──▶ src/scoring ──BeatResult──▶ src/ui
            angles from 3D          hold-window score,         HUD, ghost,
            world landmarks,        form guidance,             beat dial
            One Euro smoothing      combo / accuracy
                                         │ hold score ≥ 60
                                         ▼
                                    src/audio
                       AudioContext master clock, beat grid,
                       click track or drums + melody stems
```

The rule that holds it together: **`AudioContext.currentTime` is the only clock.** Audio is scheduled on it, video frames are stamped on it, and the visuals read it. Nothing compares a wall-clock time to an audio time.

### Pose (`src/pose/`)

- MediaPipe `PoseLandmarker`: lite model, GPU delegate (falls back to CPU if it can't be created), VIDEO mode, one pose, 640x480 webcam.
- Detection runs inside `requestVideoFrameCallback`. Each frame is stamped with the callback's capture time (`captureTime`, falling back to `expectedDisplayTime`), then mapped onto the audio clock through `AudioContext.getOutputTimestamp()`, so a frame's time is the audio that was audible when it was captured.
- Joint angles come from `worldLandmarks` (3D, metres), not pixel positions, so they don't change with where you stand in the frame. A joint is skipped when any of its three landmarks has visibility below 0.6.
- Angles are smoothed with a One Euro filter (`oneEuro.ts`, written for this repo and unit-tested).
- Output per frame: `PoseFrame { t, angles, visible }`.

### Moves (`src/moves/`)

`moves.json` is the routine. See [Move format](#move-format-for-teammates) below. `ghost.ts` draws the target pose as limbs attached to the player's own live shoulders and hips, using their own measured limb lengths, so the guide fits any body.

### Scoring (`src/scoring/`)

- Each move is a cycle: reach for N beats, hold for N, release for N.
- **Frame score** (0-100) comes from the mean absolute angle error over the move's joints only: `100 - 40 × error / tolerance`, clamped. So an error equal to the move's `tolerance` scores exactly 60. A target joint that isn't visible counts as a zero-score error.
- **Move score** is the mean frame score inside the hold window only, after shifting frames by the calibration offset. 85 and up is Perfect, 60 and up is Good, anything else is a Miss.
- Output per move: `BeatResult { moveId, score, label, timingOffsetMs, formNote? }`. `timingOffsetMs` is how late (positive) or early (negative) the player first reached a Good pose relative to the first hold beat; if they never reached it, it is the length of the hold.
- **Form guidance** (guidance, never framed as safety): two rules, each flagged only after it has applied continuously for more than 500 ms.
  - `trunk-lean`: the shoulder midpoint tilts more than 15° sideways from the hip midpoint.
  - `shoulder-shrug`: the ear-to-shoulder distance shrinks more than 20% below the resting baseline captured during calibration. Without a calibration baseline this rule is off.
- Stats: **combo** is the current run of moves that weren't a Miss, **streak** is the current run of Perfects, **accuracy** is the mean move score.
- Hold windows close on the clock as well as on frames, so a stalled camera gives a Miss instead of freezing the game.

### Audio (`src/audio/`)

- Each song gets its own `BeatEngine`, loading `public/songs/<id>/beatmap.json` (`{ bpm, offset, beats }`) and the song's two stems, on one `AudioContext` shared with the menu's previews. If a beatmap is missing or malformed it falls back to a generated 72 BPM grid.
- **Stems mode**: the drums play throughout and the melody fades in over 300 ms only while the hold score is 60 or above. This is the "music follows you" mechanic. Between holds the melody follows the last move's result, so a good hold carries it through the release and the next reach.
  - Both stems are raised 2.5x (`STEM_GAIN` in `beatEngine.ts`). `npm run songs` levels every song's stems so drums plus melody peak at -12 dBFS, so the mix peaks at about -4 dBFS whatever the song. `npm run smoke` fails if any song would clip.
  - The stems loop where the last full beat in `beatmap.json` ends, not at the end of the file. A song is rarely a whole number of beats long; looping the whole file made Past Sadness's beat at the seam 59 ms too long and left the grid off for every pass after.
- **Click mode** (when a song has no stems): a synthesized click on every beat, accented every fourth.
- **Calibration**: four clicks; for each, the time the raised arm arrives is compared with the click time. The median difference is stored as `offsetMs` (in `localStorage`) and applied in scoring. It needs only the clock, so it runs before a song is loaded.

### UI (`src/ui/`)

Three screens (the song menu, Calibrate, Play) over one persistent camera view, plus the debug panel. The menu (`src/ui/menu/`) is used up close with a mouse or keyboard: a rail of catalogues drawn as a metronome rod with a notch per song at its tempo, and song cards with a lamp blinking at the song's BPM. The Play screen is read from about two metres away, so it has one large focal element: the beat dial and the phase word.

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

The three moves in the file now (overhead arm raise, side arm raise, standing knee raise) are placeholders.

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
  session.ts      Starts sound, camera and pose tracking on one clock; loads a song's engine
  songs/          Song library: types, catalogues, licences, credit lines, index and meta loading
  pose/           Camera, pose tracker, joint angles, One Euro filter, skeleton overlay
  moves/          moves.json, validation, ghost
  scoring/        Frame score, routine, scoring engine, form rules, stats
  audio/          Master clock, beatmap, beat grid, click track, stems, calibration
  ui/             Calibrate and Play screens, beat dial, debug panel, credit strip
  ui/menu/        Song menu: catalogue rail, song cards, previews, credits view
public/songs/     The song library (index.json and one folder per song)
scripts/smoke.mjs Playwright smoke check
tools/songs/      npm run songs (TypeScript)
tools/            Beat tracking and stems (Python)
```

## Current limits

- The moves, tolerances and form-rule thresholds are placeholders and have not been tuned on real players.
- So far the pose and scoring path has been exercised in the browser with a still photo of a person as the camera, not a moving person. Calibration (which needs real arm raises) has only been tested on synthetic frames.
- Loop points are checked against the beat grid, not by ear. The loop cuts the audio with no crossfade, so listen for a click where each song wraps.
- Song previews and in-game audio were checked in a muted browser; levels were measured, not listened to.
- The ghost draws arms in the image plane and legs as seen from the front, so a knee raise shows as the foot coming up rather than the thigh swinging forward.
- Only Chromium browsers have been tested.

---

Built with Claude Code and Cursor at HackPrinceton 2026.
