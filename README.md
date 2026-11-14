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

### Smoke check

`npm run smoke` starts its own dev server, drives Chrome (or Edge) with a synthetic camera, and fails on any console error. It walks Welcome, Calibrate and Play, opens the debug panel, runs a calibration pass, and checks that a refused camera shows a recoverable message. When stems are shipped it also checks the music credit on the start and Play screens, that the stems don't clip at the engine's gain, and that the loop seam is exactly one beat. Options go after `--`:

| Option | Effect |
| --- | --- |
| `--headed` | Show the browser window |
| `--video clip.mjpeg` | Use a recorded clip as the camera (640x480 MJPEG or Y4M) |
| `--expect-hit` | With `--video`: require the clip to land a Good or Perfect hold |
| `--sound` | Play through the speakers (muted by default) |
| `--url http://localhost:5173` | Test a server that is already running |

Chrome's synthetic camera sometimes opens and then delivers no frames. The check detects that, relaunches the browser, and prints a `RETRY` line when it does.

## Playing

1. **Start camera and sound.** Stand back until your head and knees are in the picture.
2. **Calibrate.** Four clicks play; raise one arm so it arrives on each click. The measured offset is shown and saved. You can skip this and use the saved value.
3. **Play.** The routine loops through the three moves. The glowing guide shows the target and turns green when you are on it. The dial counts the beats left in the current phase (REACH, HOLD, RELEASE) and pulses on the beat. Each hold is judged Perfect, Good or Miss.

Press **D** for the debug panel: FPS, detection time, calibration offset, audio mode, and live joint angles against the current targets.

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

- Loads `public/beatmap.json` (`{ bpm, offset, beats }`). If it's missing or malformed, it falls back to a generated 72 BPM grid. The repo ships the beatmap and stems for "Past Sadness" (see [Music](#music)).
- **Stems mode**: if `public/stems/drums.mp3` and `public/stems/melody.mp3` both exist, the drums play throughout and the melody fades in over 300 ms only while the hold score is 60 or above. This is the "music follows you" mechanic. Between holds the melody follows the last move's result, so a good hold carries it through the release and the next reach.
  - Both stems are raised 2.5x (`STEM_GAIN` in `beatEngine.ts`). The track peaks at about -12 dBFS, so the mix peaks at about -4 dBFS. `npm run smoke` fails if the stems would clip.
  - The stems loop where the last full beat in `beatmap.json` ends, not at the end of the file. The track is not a whole number of beats long, so looping the whole file would make the beat at the seam 59 ms too long and leave the grid off for every pass after.
- **Click mode** (when there are no stems): a synthesized click on every beat, accented every fourth.
- **Calibration**: four clicks; for each, the time the raised arm arrives is compared with the click time. The median difference is stored as `offsetMs` (in `localStorage`) and applied in scoring.

A small Vite plugin (in `vite.config.ts`) tells the app which of those optional files exist, so it never requests a missing one. In dev, adding or removing `beatmap.json` or a stem reloads the page.

### UI (`src/ui/`)

Three screens (Welcome, Calibrate, Play) over one persistent camera view, plus the debug panel. The interface is meant to be read from about two metres away, so the Play screen has one large focal element: the beat dial and the phase word.

## Music

The game plays "Past Sadness" by Kevin MacLeod ([incompetech.com](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1900007)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), separated into drum and melody stems by the Rehabeat team. The licence requires that credit, so it is shown under the camera view on the start and Play screens (`src/audio/trackCredit.ts`). [`public/CREDITS.md`](public/CREDITS.md) records the sources and licences of all three tracks in `tools/tracks/`; a unit test keeps the in-game credit in step with it.

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

## Beatmap script (`tools/`)

`tools/make_beatmap.py` turns a song into `public/beatmap.json`, the beat grid the game plays against. It can also write a click-track file for checking the grid by ear, and split the song into drum and melody stems with Demucs. [`tools/README.md`](tools/README.md) has the full instructions, the output format, how to check a grid by ear, and the track list.

**Setup** (Windows 11, PowerShell, from the repo root). You need Python 3.11 (`winget install Python.Python.3.11`) and ffmpeg on `PATH` (`winget install Gyan.FFmpeg`).

```powershell
py -3.11 -m venv tools\.venv
tools\.venv\Scripts\python.exe -m pip install --upgrade pip
tools\.venv\Scripts\python.exe -m pip install -r tools\requirements.txt
```

The install is about 1 GB, because `requirements.txt` includes Demucs and the CPU build of PyTorch. The first `--stems` run also downloads the Demucs model (80 MB).

**Run.** This is the command that produced the files in `public/`:

```powershell
tools\.venv\Scripts\python.exe tools\make_beatmap.py tools\tracks\kevin-macleod-past-sadness.mp3 --bpm-hint 72 --click --stems
```

| Flag | What it does |
| --- | --- |
| `--bpm-hint N` | Rough tempo, for when the grid comes out at double or half speed. It only moves the result by factors of two, so the song's real tempo is kept. |
| `--click` | Also writes `tools/out/check.wav`: the song with a click on every beat, higher and louder on downbeats. |
| `--stems` | Also runs Demucs (`htdemucs`, two stems) and writes `public/stems/drums.mp3` and `public/stems/melody.mp3` (everything except the drums). It runs on the CPU: 2.5 to 10 minutes for this 3.5-minute song. |
| `--out PATH` | Write the beatmap somewhere other than `public/beatmap.json`. |

`public/beatmap.json` holds `bpm`, `offset`, `beats`, `downbeats` and `source`. The game reads `bpm`, `offset` and `beats`, and ignores the other two for now. Times are measured on the source song, and the stems start at the same instant, so the grid applies to them unchanged.

**Tests:** `tools\.venv\Scripts\python.exe -m pytest tools` builds 72 BPM click tracks and checks the detected grid against them. It takes about 10 seconds and never runs Demucs.

## Layout

```
src/
  types.ts        Shared contracts: JointName, PoseFrame, Move, BeatResult
  session.ts      Starts sound, camera and pose tracking on one clock
  pose/           Camera, pose tracker, joint angles, One Euro filter, skeleton overlay
  moves/          moves.json, validation, ghost
  scoring/        Frame score, routine, scoring engine, form rules, stats
  audio/          Master clock, beatmap, beat grid, click track, stems, calibration
  ui/             Welcome, Calibrate and Play screens, beat dial, debug panel
scripts/smoke.mjs Playwright smoke check
tools/            Beatmap and stems script (Python)
```

## Current limits

- The moves, tolerances and form-rule thresholds are placeholders and have not been tuned on real players.
- So far the pose and scoring path has been exercised in the browser with a still photo of a person as the camera, not a moving person. Calibration (which needs real arm raises) has only been tested on synthetic frames.
- The loop point is checked against the beat grid, not by ear. It cuts the audio with no crossfade, so listen for a click every 3 min 33 s.
- The ghost draws arms in the image plane and legs as seen from the front, so a knee raise shows as the foot coming up rather than the thigh swinging forward.
- Only Chromium browsers have been tested.

---

Built with Claude Code and Cursor at HackPrinceton 2026.
