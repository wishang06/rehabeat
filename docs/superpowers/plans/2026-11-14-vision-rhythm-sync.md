# Vision ↔ Rhythm Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pose pipeline answer on the beat: the melody follows what the player is doing *now*, arrival timing is measured to the millisecond rather than to the frame, holds are judged by time on the beat grid rather than by frame count, and the smoothing filter adds half the lag it does today.

**Architecture:** The pose side (`src/pose`) gets a lower-lag filter, a visibility hysteresis so joints don't flicker in and out of scoring, and an explicit 30 fps camera request. The scoring side (`src/scoring`) integrates frame scores over clock time, adds a `PoseLock` (the player is in the pose: Good for 100 ms, out once below 50 for 150 ms) that drives both arrival timing and the melody, and a `MelodyGate` that only drops the melody after half a beat of "no". A seeded rhythm simulation pushes a synthetic player through filter → scoring → gate to prove the whole path.

**Tech Stack:** TypeScript (strict), Vitest, React 19, MediaPipe Tasks Vision, Web Audio.

**Spec:** this document. The user asked for "another optimization run of the vision part, make sure it fits well the music rhythm aspect". The measurements below are the spec's evidence; every number was produced in this session.

## Evidence (measured before planning)

| What | Today | Source |
| --- | --- | --- |
| Melody comes in after a player arrives 1 beat late in a 4-beat hold (72 BPM) | **1.48 beats (1.23 s) after arrival** | `ScoringEngine` + `melodyShouldPlay` on a synthetic step pose |
| Melody keeps playing after the player drops the pose half-way through the hold | **1.32 beats (1.10 s)** | same |
| Player misses, then lands the next pose early in the reach | melody waits for the hold (1 beat) | same |
| One Euro lag at arrival (min-jerk reach 10→90°, 30 fps, 2° noise) | **35 ms (0.6 s move) / 46 ms (1.2 s move)** | `OneEuroFilter`, 300 seeded trials |
| Same with `minCutoff 1.0, beta 0.05, dCutoff 1.0` | **18 ms / 25 ms**, rest jitter 104% (2° noise), 110% (4°) | same grid search |
| `getOutputTimestamp` perf→audio mapping jitter (Chromium) | 0.06 ms sd: **no work needed** | Playwright probe |
| Camera frame rate with no `frameRate` constraint (Chromium fake camera) | 20 fps, but that is the fake device's maximum; with a 30 fps-capable fake device, `ideal: 30` gets 30. Real webcams were not available to test the default | `track.getSettings()`, `getCapabilities()` |
| Hold score | mean over **frame count**, so a frame-rate dip re-weights the hold | code reading |
| Arrival time | first single frame ≥ 60: quantised to the frame (33 ms) and set off by a pass-through | code reading |

## Global Constraints

- `PoseFrame`, `Move` and `BeatResult` in `src/types.ts` are LOCKED: no field added, removed or retyped.
- `AudioContext.currentTime` stays the only clock. Nothing new compares wall-clock to audio time.
- Score formula unchanged: frame score `100 - 40 × error / tolerance`; Perfect ≥ 85, Good ≥ 60 (`GOOD_SCORE`, `PERFECT_SCORE`).
- `BeatResult.timingOffsetMs` keeps its meaning: arrival minus first hold beat, positive = late; never arriving reports the hold length.
- Commit messages end with the session attribution lines; no model identifiers in code, comments or commits.
- `npm test`, `npm run typecheck` and `npm run build` pass after every task.

## Review Focus

1. **Low-end laptop: CPU delegate at 15 fps.** Lock dwell (100 ms) is 1–2 frames and the frame-span cap (0.2 s) is above the 67 ms interval, so an on-time player must still lock and score Perfect. → Task 7, `15 fps player`.
2. **Camera stalls mid-hold while locked.** No frames means `live.locked` freezes `true`; the melody must not play on through a dead camera. → Task 6 gates the rule on sample freshness in `PlayScreen`; Task 6 test `MelodyGate drops after the hold-off once the rule goes quiet`.
3. **A move with `reach: 0`.** A frame span can straddle the end of one cycle and the hold of the next. → Task 4, `integrates a span that crosses into the next cycle's hold`.
4. **Landmark visibility hovering between 0.5 and 0.6** (wrists and ankles near the frame edge). The joint must stay measured, and must still drop out (grey limb, step-back) once it goes under 0.5. → Task 2, `drops a kept joint once visibility falls below 0.5`.
5. **Calibration saved before this change** already contains about 20 ms of filter lag the new filter no longer adds. The effect is ~0.6% of a 4-beat hold; README tells players a re-calibration tightens it. → Task 8.

## Out of scope (considered and rejected)

- Moving detection to a Web Worker: large, risky, and not a timing problem (frames are stamped at capture).
- Smoothing the perf→audio clock mapping: measured at 0.06 ms jitter.
- Quantising melody fades to the beat grid: the stems are continuous and already phase-locked, so a fade at any moment is in time.
- Changing what Perfect/Good/Miss mean, or making early arrival cost points.

---

### Task 1: Lower-lag joint smoothing

**Files:**
- Modify: `src/pose/angleSmoother.ts` (the three `ANGLE_*` constants and their doc comment)
- Test: `src/pose/angleSmoother.test.ts`

**Interfaces:**
- Produces: `ANGLE_MIN_CUTOFF = 1.0`, `ANGLE_BETA = 0.05`, `ANGLE_D_CUTOFF = 1.0` (unchanged names).

- [ ] **Step 1: Write the failing tests**
  - Update `exports the default filter parameters` to expect `1.0`, `0.05`, `1.0`.
  - Add `follows a reach to within 25 ms of the true arrival`: no noise, min-jerk 10°→90° over 0.8 s starting at t = 1 s, 30 fps; interpolate when the smoothed angle crosses 70°; compare with the analytic crossing of the clean curve; `expect(lagMs).toBeLessThan(25)` and `expect(lagMs).toBeGreaterThan(0)`.
  - Add `still settles jitter at rest`: seeded Gaussian noise (sd 2°) on a constant 90° for 3 s at 30 fps; standard deviation of the output over the last 2 s `< 1.0`.
- [ ] **Step 2: Run** `npx vitest run src/pose/angleSmoother.test.ts` — expect the parameter test and the lag test to FAIL (today's lag ≈ 40 ms).
- [ ] **Step 3: Change the constants;** doc comment states the measured numbers (lag 18–25 ms, rest jitter about +5% vs before).
- [ ] **Step 4: Run** the file and the whole suite — PASS.
- [ ] **Step 5: Commit** `perf(pose): halve the smoothing lag at arrival`.

### Task 2: Visibility hysteresis for scored joints

**Files:**
- Modify: `src/pose/landmarks.ts` (add `KEEP_VISIBILITY = 0.5`), `src/pose/angles.ts`, `src/pose/poseSample.ts`, `src/pose/poseTracker.ts`
- Test: `src/pose/angles.test.ts`, `src/pose/poseSample.test.ts`, `src/pose/poseTracker.test.ts`

**Interfaces:**
- Produces: `computeJointAngles(world: Landmark[], minVisibility = MIN_VISIBILITY, measuredBefore: ReadonlySet<JointName> = new Set()): JointAngles` — a joint in `measuredBefore` only needs `Math.min(minVisibility, KEEP_VISIBILITY)`.
- Produces: `PoseSampleInput.previousVisible?: readonly JointName[]` (default `[]`), passed to `computeJointAngles` as a set.
- Tracker keeps `lastVisible` from the previous sample; cleared on `start()` and on a frame without a pose.

- [ ] **Step 1: Write the failing tests**
  - angles: `keeps a joint it measured last frame down to 0.5 visibility` (a pose with left wrist at 0.55: not visible with no history, visible with `new Set(['leftElbow'])`).
  - angles: `drops a kept joint once visibility falls below 0.5` (wrist 0.45 with history → not visible).
  - poseSample: `uses the previous frame's visible joints as hysteresis` (wrist 0.55, `previousVisible: ['leftElbow']` → `frame.visible` contains `leftElbow`).
  - tracker: `keeps a joint measured while its visibility hovers between 0.5 and 0.6` (frame 1 wrist 0.9, frame 2 wrist 0.55 → `leftElbow` angle present in both samples; a fresh tracker given only the 0.55 frame → absent).
- [ ] **Step 2: Run** the three files — FAIL.
- [ ] **Step 3: Implement** the signature above and the tracker state.
- [ ] **Step 4: Run** the pose tests and the whole suite — PASS.
- [ ] **Step 5: Commit** `feat(pose): visibility hysteresis so joints stop flickering out of scoring`.

### Task 3: Ask for 30 fps, and show pose latency on the audio clock

**Files:**
- Modify: `src/pose/camera.ts` (constraints), `src/pose/frameTime.ts`, `src/session.ts`, `src/ui/DebugPanel.tsx`
- Test: `src/pose/camera.test.ts`, `src/pose/frameTime.test.ts`

**Interfaces:**
- Produces: constraints `video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }` (`ideal`, so no camera is refused).
- Produces: `smoothLatency(previousMs: number | null, sampleMs: number, weight = LATENCY_SMOOTHING): number | null` in `frameTime.ts`, `LATENCY_SMOOTHING = 0.1`. `null` means no estimate yet; a non-finite sample returns `previousMs` unchanged.
- Produces: `Session.latencyMs(): number | null` — smoothed `(clock.audibleNow() - sample.frame.t) × 1000` taken as each sample arrives.
- DebugPanel rows: `Pose latency` (`data-testid="debug-latency"`, `NN ms`) and `Camera` (`data-testid="debug-camera"`, `W×H @ F fps` from the track's settings).

- [ ] **Step 1: Write the failing tests**
  - camera: the constraints assertion includes `frameRate: { ideal: 30 }`.
  - frameTime: `smoothLatency` — first sample is taken as is; then moves 10% toward each new one (`smoothLatency(50, 60) === 51`); a non-finite sample keeps the previous value; `smoothLatency(null, NaN) === null`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; DebugPanel reads `session.latencyMs()` and `session.stream.getVideoTracks()[0]?.getSettings()`.
- [ ] **Step 4: Run** suite + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(pose): request 30 fps and show pose latency in the debug panel`.

### Task 4: Hold score integrated over clock time

**Files:**
- Modify: `src/scoring/scoringEngine.ts`
- Test: `src/scoring/scoringEngine.test.ts`

**Interfaces:**
- Produces: `export const MAX_FRAME_SPAN_SEC = 0.2` from `scoringEngine.ts` (and `index.ts`).
- Internal: the engine keeps `previous: { t: number; frame: PoseFrame } | null` (offset-corrected `t`), `holdWeighted`, `holdCovered`.
- Rule (zero-order hold): each frame's score stands from its own time until the next frame, but for at most `MAX_FRAME_SPAN_SEC`. On every `push`, the span `[previous.t, min(t, previous.t + MAX_FRAME_SPAN_SEC)]` is clipped to the open hold window and added as `score(previous.frame, window's move) × overlap`. This runs before `closeUpTo` (so the span that crosses `holdEnd` counts toward the closing hold), and again for the new cycle if `closeUpTo` advanced (reach 0). Frames before the routine start still update `previous`.
- `live.holdScore` = `holdWeighted / holdCovered` while in the hold, or the current frame score while nothing is covered yet. Final score = `holdWeighted / holdCovered`, `0` when nothing was covered.

- [ ] **Step 1: Write the failing tests**
  - `weights each frame by the time it covers, not by count`: hold `[1, 3)`; frames at 60 fps on target for `[1, 2)`, at 15 fps with arms down for `[2, 3)` → `score ≈ 50` (`toBeCloseTo(50, 0)`); frame-count mean would be 80.
  - `does not stretch one frame across a camera stall`: hold `[1, 3)`; on target for `[0, 1.5)`, no frames in `[1.5, 2.5)`, arms down for `[2.5, 4)`. The last frame before the stall (t = 44/30 s) covers only 0.2 s, so the hold sees on-target time `44/30 + 0.2 - 1` and 0.5 s off: `score = on / (on + 0.5) × 100` ≈ 57.14 (`toBeCloseTo(57.14, 1)`).
  - `integrates a span that crosses into the next cycle's hold`: a two-move routine whose second move has `reach: 0`; frames at 0.1 s spacing straddle the boundary; the second hold scores 100 with the pose held.
  - Every existing test passes unchanged (uniform 30 fps gives the frame-count mean exactly).
- [ ] **Step 2: Run** — the new tests FAIL.
- [ ] **Step 3: Implement** the rule above.
- [ ] **Step 4: Run** suite — PASS.
- [ ] **Step 5: Commit** `fix(scoring): judge a hold by time on the beat grid, not by frame count`.

### Task 5: PoseLock and sub-frame arrival timing

**Files:**
- Create: `src/scoring/poseLock.ts`
- Modify: `src/scoring/scoringEngine.ts`, `src/scoring/index.ts`, `src/engine/feedback.test.ts` (LiveState literals gain `locked: false`)
- Test: `src/scoring/poseLock.test.ts`, `src/scoring/scoringEngine.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LOCK_ENTER_SCORE = GOOD_SCORE;   // 60
  export const LOCK_EXIT_SCORE = 50;
  export const LOCK_ENTER_SEC = 0.1;
  export const LOCK_EXIT_SEC = 0.15;
  export interface ScoredSample { t: number; score: number }
  export class PoseLock {
    get locked(): boolean;
    /** Start of the run of Good-or-better frames behind the lock (or the pending one), interpolated between frames; null without one. */
    get since(): number | null;
    update(sample: ScoredSample, previous: ScoredSample | null): void;
    reset(): void;
  }
  ```
  - A run starts on the first frame ≥ 60; `since` is the linear crossing of 60 between `previous` and this frame when `previous.score < 60`, else this frame's `t`. A frame < 60 before the lock clears the run. The lock engages once `t - since ≥ LOCK_ENTER_SEC`. Once locked, a frame ≥ 50 clears the exit timer; frames < 50 for `LOCK_EXIT_SEC` release the lock and clear the run.
- Produces: `LiveState.locked: boolean`.
- Engine: one `PoseLock`, reset on `advance()`. Each frame is scored against the current move, and so is `previous.frame` for the lock's `previous`. `arrivedAt` = `lock.since` the first time `lock.locked` is true in the cycle. At `finalize`, if no arrival yet and `lock.since !== null && lock.since < holdEnd`, that pending run counts. `tick()` sets `locked: false` when it moves to a new cycle.

- [ ] **Step 1: Write the failing tests**
  - poseLock: `locks once the score has stayed Good for 100 ms`; `ignores a pass-through shorter than 100 ms`; `reports the interpolated start of the run` (previous 40 at t=0, current 80 at t=0.04 → `since ≈ 0.02`); `stays locked through a dip that stays above 50`; `unlocks after 150 ms below 50`; `reset clears the lock and the run`.
  - engine: `measures arrival between frames on a continuous reach` (both arms min-jerk 10°→90° over 0.6 s arriving at the hold start, 30 fps; truth = analytic time the angle reaches 70°, where the score crosses 60; `|timingOffsetMs - truthMs| < 3`).
  - engine: `does not count a pass-through as arriving` (on target for 2 frames in the reach, then off until 2.0 s → `timingOffsetMs ≈ 1000` within one frame).
  - engine: `live.locked follows the pose with hysteresis`.
  - Existing step-pose timing tests change to "within one frame" (`Math.abs(x - expected) < 1000 / FPS`), since the crossing is now interpolated.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** suite + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(scoring): PoseLock, and arrival timing between frames`.

### Task 6: Melody that follows the player now

**Files:**
- Create: `src/scoring/melodyGate.ts`
- Modify: `src/scoring/scoringEngine.ts` (`melodyShouldPlay`), `src/scoring/index.ts`, `src/ui/PlayScreen.tsx`
- Test: `src/scoring/melodyGate.test.ts`, `src/scoring/scoringEngine.test.ts`

**Interfaces:**
- Consumes: `LiveState.locked` (Task 5).
- Produces: `melodyShouldPlay(live: LiveState, lastResult: BeatResult | null): boolean` — `hold`: `live.locked`; `reach`: `live.locked || carried`; `release`: `carried`; `null`: `false`; where `carried = (lastResult?.score ?? 0) >= GOOD_SCORE`.
- Produces:
  ```ts
  export const MELODY_HOLD_OFF_BEATS = 0.5;
  export class MelodyGate {
    constructor(holdOffSec: number);
    /** Turns on as soon as `wanted` is true; turns off only once it has been false for holdOffSec. */
    update(now: number, wanted: boolean): boolean;
    reset(): void;
  }
  ```
- PlayScreen: `new MelodyGate(MELODY_HOLD_OFF_BEATS * engine.grid.secondsPerBeat)`; each display frame `engine.setMelodyActive(gate.update(engine.clock.audibleNow(), fresh && melodyShouldPlay(scoring.live, scoring.lastResult)))`, where `fresh` is the existing "a sample arrived in the last 500 ms" check, hoisted above the call.

- [ ] **Step 1: Write the failing tests**
  - melodyGate: `turns on at once`; `stays on through a no shorter than the hold-off`; `drops after the hold-off once the rule goes quiet`; `a yes in between restarts the hold-off`; `reset turns it off`.
  - scoringEngine `melodyShouldPlay`: replace the hold-score cases with a phase table (hold locked/unlocked × carried/not; reach locked → true with a Miss behind it; release follows the result only; no phase → false).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**, and wire `PlayScreen`.
- [ ] **Step 4: Run** suite + typecheck — PASS.
- [ ] **Step 5: Commit** `feat(audio): the melody follows the pose you're in now, with half a beat of grace`.

### Task 7: Rhythm simulation of the whole vision → scoring → melody path

**Files:**
- Create: `src/scoring/rhythmSim.test.ts` (test-only; a small seeded player model lives in the file)

**Interfaces:**
- Consumes: `AngleSmoother` (Task 1), `ScoringEngine`, `PoseLock` via `live.locked`, `melodyShouldPlay`, `MelodyGate` (Tasks 4–6).
- Player model: 72 BPM, routine `[side raise (both shoulders 90°, tolerance 20, 2/4/2 beats)]`, 4 cycles. The player moves with a 0.6 s min-jerk between 10° and 90°, timed so the arm reaches 90° at `holdStart + lateBeats × spb` and leaves at `holdEnd + releaseEarlyBeats × spb`, plus seeded 2° noise; frames at a given fps with optional ±30% interval jitter. Each frame: smoother → `engine.push` → `gate.update(t, melodyShouldPlay(...))`, recording melody on/off changes in beats.

- [ ] **Step 1: Write the tests** (they pass only with Tasks 1–6 in place):
  - `an on-time player scores Perfect every cycle and keeps the melody on from the first hold`: labels all Perfect; `|timingOffsetMs| < 80` (smoothing plus noise); after first turning on, the melody never turns off.
  - `the melody comes in within 0.25 s of a player who arrives a beat late` (was 1.23 s).
  - `the melody drops within 0.8 s of a player who lets go half-way through the hold` (half a beat 0.42 s + exit 0.15 s + filter; was 1.10 s).
  - `releasing a quarter beat early after a good hold leaves no gap in the melody`.
  - `a player who missed gets the melody back as soon as they land the next pose in the reach`.
  - `15 fps player` (Review Focus 1): on-time player at 15 fps scores Perfect every cycle.
  - `irregular frame intervals do not change an on-time player's result` (±30% interval jitter at 30 fps).
- [ ] **Step 2: Run** `npx vitest run src/scoring/rhythmSim.test.ts` — PASS (if not, the defect is in Tasks 1–6: fix it there).
- [ ] **Step 3: Commit** `test: simulate a player through the whole pose-to-melody path`.

### Task 8: Docs and full verification

**Files:**
- Modify: `README.md` (Pose, Scoring, Audio "Stems mode", Playing → debug panel, Current limits), `src/engine/README.md` (`holdScore` row: time-weighted)

- [ ] **Step 1:** README states: the filter values and measured lag; the 0.6 / 0.5 visibility hysteresis; the 30 fps request; time-weighted hold score with the 0.2 s cap; arrival = start of the first held run (Good for 100 ms), interpolated between frames; the melody rule (hold: in the pose now; reach: in the pose or carrying a Good; release: carries the result; off only after half a beat); the debug panel's pose latency and camera rows; and that a calibration saved before this change is about 20 ms generous until re-run.
- [ ] **Step 2: Verify:** `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke` (with Playwright pointed at the preinstalled Chromium) — all pass, and the smoke log shows the new debug rows render without console errors.
- [ ] **Step 3: Commit** `docs: describe the rhythm-synced pose pipeline`, then push the branch.
