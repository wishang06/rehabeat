# Rehabeat

Rehabeat turns rehab moves into a rhythm game. The player stands in front of a webcam and matches a target pose on the beat: reach for it, hold it, release it. Hold it well and the melody comes in.

This repo currently holds **Part 1: the pose scoring and beat engine**. It runs entirely in the browser; there is no backend.

## Setup

You need Node 20 or newer, a webcam, and a Chromium-based browser (Chrome or Edge).

```bash
npm install
npm run dev        # http://localhost:5173
```

The first start downloads the pose model (about 6 MB) from Google's model storage, so it needs a network connection once.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 5173 |
| `npm test` | Unit tests (Vitest) |
| `npm run smoke` | Browser smoke check with a fake camera (Playwright) |
| `npm run typecheck` | TypeScript, strict |
| `npm run build` | Typecheck and production build |

`npm run smoke` drives Chrome or Edge with a synthetic camera, so it needs one of them installed. Add `-- --headed` to watch it, or `-- --video clip.mjpeg` to feed a recorded clip as the camera.

## Playing

1. **Start camera and sound.** Stand back until your head and knees are in the picture.
2. **Calibrate.** Four clicks play; raise one arm so it arrives on each click. The measured offset is shown and saved. You can skip this and use the saved value.
3. **Play.** The routine loops through the three moves. The glowing guide shows the target, the ring shows the phase (REACH, HOLD, RELEASE) and pulses on the beat, and each hold is judged Perfect, Good or Miss.

Press **D** for the debug panel: FPS, detection time, calibration offset, and live joint angles against the current targets.

## Architecture

```
                    frame times mapped onto the audio clock
                  ┌──────────────────────────────────────────┐
                  ▼                                          │
 webcam ──▶ src/pose ──PoseFrame──▶ src/scoring ──BeatResult──▶ UI
            angles from 3D          hold-window score,         HUD, ghost,
            world landmarks,        form guidance,             beat ring
            One Euro smoothing      combo / accuracy
                                         │ hold score ≥ 60
                                         ▼
                                    src/audio
                       AudioContext master clock, beat grid,
                       click track or drums + melody stems
```

The rule that holds it together: **`AudioContext.currentTime` is the only clock.** Audio is scheduled on it, video frames are stamped on it, and the visuals read it. Nothing compares a `Date.now()` to an audio time.

### Pose (`src/pose/`)

- MediaPipe `PoseLandmarker`: lite model, GPU delegate (falls back to CPU), VIDEO mode, one pose, 640x480 webcam.
- Detection runs inside `requestVideoFrameCallback`. Each frame is stamped with the callback's capture time (`captureTime`, falling back to `expectedDisplayTime`), then mapped onto the audio clock.
- Joint angles come from `worldLandmarks` (3D, metres), not pixel positions, so they don't change with where you stand in the frame. A joint is skipped when any of its three landmarks has visibility below 0.6.
- Angles are smoothed with a One Euro filter (`oneEuro.ts`, written for this repo and unit-tested).
- Output per frame: `PoseFrame { t, angles, visible }`.

### Moves (`src/moves/`)

`moves.json` is the routine. See [Move format](#move-format-for-teammates) below. `ghost.ts` draws the target pose as limbs attached to the player's own live shoulders and hips, using their own measured limb lengths, so the guide fits any body.

### Scoring (`src/scoring/`)

- Each move is a cycle: reach for N beats, hold for N, release for N.
- **Frame score** (0-100) comes from the mean absolute angle error over the move's joints only: `100 - 40 × error / tolerance`, clamped. So an error equal to the move's `tolerance` scores exactly 60. A target joint that isn't visible counts as a zero-score error.
- **Move score** is the mean frame score inside the hold window only, after shifting frames by the calibration offset. 85 and up is Perfect, 60 and up is Good, anything else is a Miss.
- Output per move: `BeatResult { moveId, score, label, timingOffsetMs, formNote? }`. `timingOffsetMs` is how late (positive) or early (negative) the player first reached a Good pose relative to the first hold beat.
- **Form guidance** (never framed as safety): two rules, each flagged only after it has applied continuously for more than 500 ms.
  - `trunk-lean`: the shoulder midpoint tilts more than 15° sideways from the hip midpoint.
  - `shoulder-shrug`: the ear-to-shoulder distance shrinks more than 20% below the resting baseline captured during calibration. Without a calibration baseline this rule is off.
- Stats: **combo** is the current run of moves that weren't a Miss, **streak** is the current run of Perfects, **accuracy** is the mean move score.

### Audio (`src/audio/`)

- Loads `public/beatmap.json` (`{ bpm, offset, beats }`). If it's missing or malformed, it falls back to a generated 72 BPM grid.
- **Click mode** (default): a synthesized click on every beat, accented every fourth.
- **Stems mode**: if `public/stems/drums.mp3` and `public/stems/melody.mp3` both exist, the drums loop at full volume and the melody fades in over 300 ms only while the hold score is 60 or above. This is the "music follows you" mechanic. Between holds the melody follows the last move's result, so a good hold carries it through the release and the next reach.
- **Calibration**: four clicks; for each, the time the raised arm arrives is compared with the click time. The median difference is stored as `offsetMs` (in `localStorage`) and applied in scoring.

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

`tools/make_beatmap.py` runs `librosa.beat.beat_track` on an audio file and writes `public/beatmap.json`. With `--stems` it also runs Demucs (`htdemucs`, two stems) and copies the drums and everything-else stems into `public/stems/` as `drums.mp3` and `melody.mp3`.

```bash
python -m venv .venv && .venv/Scripts/activate      # Windows; use source .venv/bin/activate elsewhere
pip install -r tools/requirements.txt
python tools/make_beatmap.py path/to/song.mp3
python tools/make_beatmap.py path/to/song.mp3 --stems   # also needs tools/requirements-stems.txt
```

Details and troubleshooting are in [`tools/README.md`](tools/README.md).

## Layout

```
src/
  types.ts        Shared contracts: JointName, PoseFrame, Move, BeatResult
  pose/           Camera, pose tracker, joint angles, One Euro filter, skeleton overlay
  moves/          moves.json, validation, ghost
  scoring/        Frame score, routine, scoring engine, form rules, stats
  audio/          Master clock, beatmap, beat grid, click track, stems, calibration
  ui/             Welcome, Calibrate and Play screens, debug panel
scripts/smoke.mjs Playwright smoke check
tools/            Beatmap and stems script (Python)
```

## Current limits

- The moves, tolerances and form-rule thresholds are placeholders and have not been tuned on real players.
- The ghost draws arms in the image plane and legs as seen from the front, so a knee raise shows as the foot coming up rather than the thigh swinging forward.
- The pose model is fetched from Google's model storage on first load. The WASM runtime is served locally.

---

Built with Claude Code and Cursor at HackPrinceton 2026.
