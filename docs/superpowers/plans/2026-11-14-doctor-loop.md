# Doctor Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A doctor's page and a recorded program session, so Rehabeat runs the loop prescribe → play → measure → adjust.

**Architecture:** Pure domain code in `src/scoring` (limits, hold detail) and `src/care` (prescriptions, sessions, analysis). One `CareStore` interface with two implementations: a demo clinic in `localStorage` and a real clinic on Supabase, chosen by sign-in state. The game reads a program through the store and plays it by handing ordinary `Move` objects to the existing `Routine`; the doctor's page at `/doctor` reads and writes through the same store.

**Tech Stack:** TypeScript (strict), React 19, React Router 7, Vitest (node environment, no DOM), Playwright smoke script, Supabase JS, Tailwind v4 theme tokens. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-doctor-loop-design.md`. Mock-ups: https://claude.ai/artifact/CqQepUM71DdkN8D6dC7GQR (desk look).

## Global Constraints

- `Move`, `PoseFrame`, `BeatResult` in `src/types.ts` and the `moves.json` format are locked. Do not change them.
- No video, images or landmarks are stored. Only scores and joint angles.
- No sample data in Supabase tables. Sample patients exist only in the demo clinic.
- A player with no program sees no change in the game.
- Patient-facing wording is guidance: no guarantees, no "safe", no clinical claims. The limit prompt says "Ease off".
- UI words: Doctor, Patient, Program, Session, Limit. Code: `Prescription`.
- Colours come only from the tokens in `src/styles/theme.css`. The doctor's page uses the desk look: no `.slab` skew, no italic display type, no `.led` digits; numerals are Barlow 600 with `tabular-nums`.
- Vitest runs in node: tests cover pure modules only. Screens are checked by `npm run smoke` and `npm run typecheck`.
- Thresholds are named exported constants.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MwGDHagwVbLDVWhvJDwQRq
  ```
  After each task's commit: `git push origin ccr-fa37b536-xnhnye`.
- Before each commit: `npm run typecheck && npm test` pass.

## Review Focus

1. **Stored demo data is corrupt or from an older shape** (`rehabeat.care.v1` holds bad JSON or wrong types): `/doctor` and `/play` open with the default demo clinic instead of crashing. Test in Task 7.
2. **A program leaves nothing to play** (its `moveIds` name moves no longer in `moves.json`, or the limits remove every move): the doctor cannot save it, and the game shows the card without a start button instead of building an empty `Routine`, which throws. Tests in Task 3; guard in Task 9.
3. **A scored joint is never in view during a hold**: its mean error is 0 with `seen` 0, never `NaN`; it is left out of joint findings and reported as out of view. Tests in Tasks 2 and 6.
4. **Days around midnight, month ends and the clock change**: a session's day is the patient's local day; weeks and "days since" are counted on day keys, so a 25-hour day does not shift a week. Test in Task 5.
5. **A save that fails or is retried** in the real clinic: the session keeps a client-made id, so a retry after an unclear failure does not create a second row, and a failure is shown with a retry. Tests in Tasks 4, 7 and 11.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/scoring/limits.ts` | `JointLimit`, movement ↔ game angle, `LimitWatcher` |
| `src/scoring/holdDetail.ts` | `HoldDetail`, `JointHold` types |
| `src/scoring/scoringEngine.ts` (modify) | Collects a `HoldDetail` per cycle; runs the limit watcher |
| `src/care/types.ts` | `Prescription`, `SessionRecord`, `Patient`, `PatientFile`, `MyProgram`, `CareStore` |
| `src/care/labels.ts` | Joint names and limit sentences in words |
| `src/care/days.ts` | Day-key arithmetic |
| `src/care/prescription.ts` | Bounds, defaults, validation, `applyPrescription`, `applyLimits` |
| `src/care/session.ts` | `buildSession` |
| `src/care/analysis/consistency.ts`, `quality.ts`, `findings.ts`, `index.ts` | The three analyses |
| `src/care/sampleClinic.ts` | Deterministic sample patients and history |
| `src/care/demoClinic.ts` | `CareStore` on `localStorage` |
| `src/care/supabaseClinic.ts` | `CareStore` on Supabase |
| `src/care/useCare.ts` | `careStoreFor`, `useMyProgram`, `usePatients` |
| `src/care/index.ts` | Public exports |
| `src/ui/ProgramCard.tsx`, `SentStrip.tsx`, `JoinCode.tsx` | Patient-side pieces |
| `src/doctor/*.tsx`, `src/doctor/doctor.css` | The doctor's page |
| `supabase/migrations/20261115090000_care.sql` | Tables, policies, join function |

---

### Task 1: Limits and the limit watcher

**Files:**
- Create: `src/scoring/limits.ts`, `src/scoring/limits.test.ts`
- Modify: `src/scoring/index.ts` (export everything below)

**Interfaces:**
- Produces:
  ```ts
  export type JointLimit = { kind: 'off' } | { kind: 'range'; maxDeg: number };
  export type JointLimits = Partial<Record<JointName, JointLimit>>;
  export const LIMIT_MARGIN_DEG = 10;
  export const LIMIT_PERSIST_MS = 500;
  /** Degrees moved from rest: shoulder = angle; elbow, hip, knee = 180 - angle. */
  export function movementOf(joint: JointName, angleDeg: number): number;
  export function angleForMovement(joint: JointName, movementDeg: number): number;
  export class LimitWatcher {
    constructor(limits: JointLimits, marginDeg?: number, persistMs?: number);
    /** Joints past limit + margin continuously for longer than persistMs, in JOINT_NAMES order. */
    update(t: number, angles: PoseFrame['angles']): JointName[];
    reset(): void;
  }
  ```

- [ ] **Step 1: Write the failing tests** in `src/scoring/limits.test.ts`

```ts
describe('movement', () => {
  it('reads a shoulder as its own angle', () => {
    expect(movementOf('rightShoulder', 90)).toBe(90);
    expect(angleForMovement('rightShoulder', 90)).toBe(90);
  });
  it('reads elbows, hips and knees as the bend from straight', () => {
    expect(movementOf('leftKnee', 120)).toBe(60);
    expect(angleForMovement('leftHip', 90)).toBe(90);
    expect(angleForMovement('leftElbow', 30)).toBe(150);
  });
});

describe('LimitWatcher', () => {
  const limits: JointLimits = { rightShoulder: { kind: 'range', maxDeg: 90 }, leftKnee: { kind: 'off' } };
  it('ignores movement inside the limit plus the margin', () => {
    const w = new LimitWatcher(limits);
    expect(w.update(0, { rightShoulder: 100 })).toEqual([]);
    expect(w.update(1, { rightShoulder: 100 })).toEqual([]);
  });
  it('flags a joint past the margin only after it persists', () => {
    const w = new LimitWatcher(limits);
    expect(w.update(0, { rightShoulder: 101 })).toEqual([]);
    expect(w.update(0.5, { rightShoulder: 120 })).toEqual([]);
    expect(w.update(0.51, { rightShoulder: 120 })).toEqual(['rightShoulder']);
  });
  it('starts over when the joint comes back or goes out of view', () => {
    const w = new LimitWatcher(limits);
    w.update(0, { rightShoulder: 120 });
    w.update(0.4, { rightShoulder: 80 });
    expect(w.update(0.8, { rightShoulder: 120 })).toEqual([]);
    w.update(1.0, {});
    expect(w.update(1.4, { rightShoulder: 120 })).toEqual([]);
  });
  it('never flags a joint that is off', () => {
    const w = new LimitWatcher(limits);
    w.update(0, { leftKnee: 40 });
    expect(w.update(2, { leftKnee: 40 })).toEqual([]);
  });
  it('watches a bend limit on a knee', () => {
    const w = new LimitWatcher({ leftKnee: { kind: 'range', maxDeg: 60 } });
    w.update(0, { leftKnee: 100 }); // 80 degrees of bend
    expect(w.update(0.6, { leftKnee: 100 })).toEqual(['leftKnee']);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/scoring/limits.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `src/scoring/limits.ts` to the signatures above (model `LimitWatcher` on `FormMonitor` in `formRules.ts`) and export from `src/scoring/index.ts`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat: joint limits as movement from rest, and a limit watcher`.

---

### Task 2: Hold detail from the scoring engine

**Files:**
- Create: `src/scoring/holdDetail.ts`
- Modify: `src/scoring/scoringEngine.ts`, `src/scoring/index.ts`
- Test: `src/scoring/scoringEngine.test.ts` (add a `describe('hold detail')`; reuse its `engine`, `play`, `sideRaise`, `ON_TARGET` helpers)

**Interfaces:**
- Consumes: `JointLimits`, `LimitWatcher` (Task 1).
- Produces:
  ```ts
  // holdDetail.ts
  export interface JointHold {
    target: number;      // game angle
    meanError: number;   // mean of (measured - target) over hold frames where the joint was visible; 0 when never visible
    seen: number;        // 0-1: share of hold frames in which it was visible; 0 when the hold had no frames
  }
  export interface HoldDetail {
    cycleIndex: number;
    moveId: string;
    score: number;
    label: BeatLabel;
    timingOffsetMs: number;
    joints: Partial<Record<JointName, JointHold>>;  // one entry per joint the move scores
    formFlags: string[];     // rule ids flagged in reach or hold, each once, in first-flagged order
    overLimit: JointName[];  // limited joints flagged by the watcher in any phase of the cycle, each once
  }
  // ScoringEngineOptions gains:  limits?: JointLimits
  // LiveState gains:             overLimit: JointName[]   (joints flagged on the latest frame; [] from tick())
  // ScoringEngine gains:         get details(): readonly HoldDetail[]   (one per finalized cycle, in order)
  ```
  `BeatResult`, `push`, `tick` and `lastResult` keep their behaviour. A cycle skipped with no frames still gets a `HoldDetail` (score 0, every joint `{ target, meanError: 0, seen: 0 }`). The watcher runs on every pushed frame, in every phase, and its flags are attributed to the cycle the frame falls in; it is not reset between cycles.

- [ ] **Step 1: Write the failing tests**

```ts
describe('hold detail', () => {
  it('records each scored joint with its signed mean error', () => {
    const e = engine();
    play(e, 0, 4, () => ({ leftShoulder: 80, rightShoulder: 104 }));
    const [d] = e.details;
    expect(d.moveId).toBe('side-arm-raise');
    expect(d.cycleIndex).toBe(0);
    expect(d.joints.leftShoulder).toEqual({ target: 90, meanError: -10, seen: 1 });
    expect(d.joints.rightShoulder?.meanError).toBeCloseTo(14);
    expect(d.score).toBeCloseTo(e.lastResult!.score);
  });
  it('gives a joint that was never in view an error of 0 and seen 0', () => {
    const e = engine();
    play(e, 0, 4, () => ({ leftShoulder: 90 }));
    expect(e.details[0].joints.rightShoulder).toEqual({ target: 90, meanError: 0, seen: 0 });
  });
  it('reports the share of the hold a joint was in view', () => {
    const e = engine();
    play(e, 0, 4, (t) => (t < 2 ? ON_TARGET : { leftShoulder: 90 }));
    expect(e.details[0].joints.rightShoulder?.seen).toBeCloseTo(0.5, 1);
  });
  it('lists form rules by id, once each', () => {
    const e = engine();
    play(e, 0, 4, () => ON_TARGET, () => ({ trunkLeanDeg: 30, shoulderEarRatio: 0.3 }));
    expect(e.details[0].formFlags).toEqual(['trunk-lean']);
  });
  it('marks a breach on the cycle it happened in, and shows it live', () => {
    const e = engine({ limits: { rightShoulder: { kind: 'range', maxDeg: 90 } } });
    play(e, 0, 2, () => ({ leftShoulder: 90, rightShoulder: 130 }));
    expect(e.live.overLimit).toEqual(['rightShoulder']);
    play(e, 2, 4.1, () => ON_TARGET);
    expect(e.details[0].overLimit).toEqual(['rightShoulder']);
    expect(e.live.overLimit).toEqual([]);
  });
  it('still gives a detail to a cycle with no frames', () => {
    const e = engine();
    e.tick(4.1);
    expect(e.details).toHaveLength(1);
    expect(e.details[0].joints.leftShoulder).toEqual({ target: 90, meanError: 0, seen: 0 });
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/scoring/scoringEngine.test.ts`. Expected: the new tests FAIL (`details` undefined).
- [ ] **Step 3:** Add `holdDetail.ts`; extend `ScoringEngine` (accumulate per-joint error sum, visible-frame count and hold-frame count alongside `holdSum`; keep a list of flagged rule ids; run the watcher in `push`; build the detail in `finalize`; clear per-cycle state in `advance`). Export the new types from `src/scoring/index.ts`.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS, including the untouched engine tests.
- [ ] **Step 5:** Commit `feat: the scoring engine records each hold's joint errors, form flags and limit breaches`.

---

### Task 3: Prescriptions and applying them to the moves

**Files:**
- Create: `src/care/types.ts`, `src/care/labels.ts`, `src/care/days.ts`, `src/care/prescription.ts`, `src/care/index.ts`
- Test: `src/care/prescription.test.ts`, `src/care/days.test.ts`

**Interfaces:**
- Consumes: `JointLimits`, `movementOf`, `angleForMovement` (Task 1); `HoldDetail` (Task 2); `Move`, `JointName`; `RunSummary`.
- Produces:
  ```ts
  // types.ts
  export interface PrescriptionBody {
    moveIds: string[]; rounds: number; holdBeats: number | null;
    sessionsPerWeek: number; weeks: number; startDate: string /* YYYY-MM-DD */;
    limits: JointLimits; note: string;
  }
  export interface Prescription extends PrescriptionBody { id: string; version: number; createdAt: string /* ISO */ }
  export interface HoldRecord extends HoldDetail { round: number /* 1-based */ }
  export interface SessionRecord {
    id: string; prescriptionId: string; startedAt: string /* ISO */; day: string /* local YYYY-MM-DD */;
    songId: string; durationSec: number; roundsPrescribed: number; roundsDone: number; completed: boolean;
    summary: RunSummary; holds: HoldRecord[];
  }
  export interface Patient { id: string; name: string; condition: string; joinCode: string | null; joined: boolean; sample: boolean }
  export interface PatientFile { patient: Patient; prescriptions: Prescription[]; sessions: SessionRecord[] } // both oldest first
  export interface MyProgram { doctorName: string; prescription: Prescription; sessions: SessionRecord[] }
  export interface CareStore {
    readonly kind: 'demo' | 'clinic';
    listPatients(): Promise<PatientFile[]>;
    addPatient(input: { name: string; condition: string }): Promise<Patient>;
    savePrescription(patientId: string, body: PrescriptionBody): Promise<Prescription>;
    myProgram(): Promise<MyProgram | null>;
    saveSession(session: SessionRecord): Promise<void>;   // saving the same id twice is a success, not a second row
    joinWithCode(code: string): Promise<void>;
    reset?(): void;                                         // demo only
  }
  export class CareSetupError extends Error {}             // the clinic tables are not there yet

  // days.ts  (day keys are local YYYY-MM-DD; reuse dayKey from src/progress/streak.ts)
  export function addDays(day: string, n: number): string;
  export function daysBetween(from: string, to: string): number;   // to - from, whole days

  // labels.ts
  export function jointLabel(joint: JointName): string;            // 'right shoulder'
  export function limitText(joint: JointName, limit: JointLimit): string;
  //   'Right shoulder: raise up to 90°' | 'Left knee: bend up to 60°' | 'Left knee: off'
  export const LIMIT_SLIDER: Record<'Shoulder' | 'Elbow' | 'Hip' | 'Knee', { min: number; max: number; step: number }>;
  //   Shoulder 20-180, Elbow 20-150, Hip 20-120, Knee 20-150, step 5

  // prescription.ts
  export const RX_BOUNDS = { rounds: [1, 10], holdBeats: [1, 16], sessionsPerWeek: [1, 7], weeks: [1, 52], note: 500 } as const;
  export function newPrescriptionBody(today: string): PrescriptionBody;
  //   { moveIds: [], rounds: 3, holdBeats: null, sessionsPerWeek: 5, weeks: 6, startDate: today, limits: {}, note: '' }
  export interface MoveChange { moveId: string; name: string; kind: 'removed' | 'scaled'; joint: JointName; text: string }
  //   text: 'Standing Knee Raise removed: left knee is off' | 'Overhead Arm Raise plays as a raise to 90°' | '… plays with a bend to 60°'
  export interface AppliedProgram { moves: Move[]; changes: MoveChange[] }
  export function applyLimits(moves: readonly Move[], limits: JointLimits): AppliedProgram;
  export function applyPrescription(all: readonly Move[], rx: Pick<PrescriptionBody, 'moveIds' | 'holdBeats' | 'limits'>): AppliedProgram;
  /** null when it can be saved, else one sentence for the doctor. */
  export function validatePrescription(body: PrescriptionBody, all: readonly Move[]): string | null;
  ```
  Rules: `applyPrescription` takes moves in `moveIds` order, skips unknown ids silently, sets `beats.hold` to `holdBeats` when not null, then applies limits. A move with any scored joint `off` is removed (one change, for the first such joint in `JOINT_NAMES` order). A scored joint whose target movement exceeds a range limit gets the target `angleForMovement(joint, maxDeg)` (one change per joint). Moves are copied, never mutated; ids and names are unchanged.

- [ ] **Step 1: Write the failing tests** (import `MOVES` from `../moves` for real moves)

```ts
const pick = (id: string) => MOVES.find((m) => m.id === id)!;

describe('applyPrescription', () => {
  it('plays the listed moves in the listed order and skips unknown ids', () => {
    const { moves, changes } = applyPrescription(MOVES, { moveIds: ['side-arm-raise', 'gone', 'overhead-arm-raise'], holdBeats: null, limits: {} });
    expect(moves.map((m) => m.id)).toEqual(['side-arm-raise', 'overhead-arm-raise']);
    expect(changes).toEqual([]);
    expect(moves[0]).toEqual(pick('side-arm-raise'));
  });
  it('scales a target past a range limit down to the limit', () => {
    const { moves, changes } = applyPrescription(MOVES, { moveIds: ['overhead-arm-raise'], holdBeats: null, limits: { rightShoulder: { kind: 'range', maxDeg: 90 } } });
    expect(moves[0].joints.rightShoulder).toBe(90);
    expect(moves[0].joints.leftShoulder).toBe(170);
    expect(changes).toEqual([{ moveId: 'overhead-arm-raise', name: 'Overhead Arm Raise', kind: 'scaled', joint: 'rightShoulder', text: 'Overhead Arm Raise plays as a raise to 90°' }]);
    expect(pick('overhead-arm-raise').joints.rightShoulder).toBe(170); // the source move is untouched
  });
  it('leaves a target inside the limit alone', () => {
    const { moves, changes } = applyPrescription(MOVES, { moveIds: ['side-arm-raise'], holdBeats: null, limits: { rightShoulder: { kind: 'range', maxDeg: 120 } } });
    expect(moves[0].joints.rightShoulder).toBe(90);
    expect(changes).toEqual([]);
  });
  it('scales a bend limit on a knee', () => {
    const { moves } = applyPrescription(MOVES, { moveIds: ['standing-knee-raise'], holdBeats: null, limits: { leftKnee: { kind: 'range', maxDeg: 60 } } });
    expect(moves[0].joints.leftKnee).toBe(120);
  });
  it('removes a move that scores a joint that is off', () => {
    const { moves, changes } = applyPrescription(MOVES, { moveIds: ['side-arm-raise', 'standing-knee-raise'], holdBeats: null, limits: { leftKnee: { kind: 'off' } } });
    expect(moves.map((m) => m.id)).toEqual(['side-arm-raise']);
    expect(changes[0]).toMatchObject({ kind: 'removed', joint: 'leftKnee', text: 'Standing Knee Raise removed: left knee is off' });
  });
  it('sets every hold to holdBeats', () => {
    const { moves } = applyPrescription(MOVES, { moveIds: ['standing-knee-raise'], holdBeats: 6, limits: {} });
    expect(moves[0].beats).toEqual({ reach: 2, hold: 6, release: 4 });
  });
});

describe('validatePrescription', () => {
  const ok = { ...newPrescriptionBody('2026-11-14'), moveIds: ['side-arm-raise'] };
  it('accepts a playable program', () => expect(validatePrescription(ok, MOVES)).toBeNull());
  it('needs a move', () => expect(validatePrescription({ ...ok, moveIds: [] }, MOVES)).toBe('Pick at least one move.'));
  it('refuses a program the limits empty out', () =>
    expect(validatePrescription({ ...ok, limits: { leftShoulder: { kind: 'off' } } }, MOVES)).toBe('The limits remove every move. Loosen a limit or pick other moves.'));
  it('refuses a program whose moves no longer exist', () =>
    expect(validatePrescription({ ...ok, moveIds: ['gone'] }, MOVES)).toBe('Pick at least one move.'));
  it('keeps numbers inside their bounds', () => {
    expect(validatePrescription({ ...ok, rounds: 0 }, MOVES)).toBe('Rounds must be between 1 and 10.');
    expect(validatePrescription({ ...ok, sessionsPerWeek: 8 }, MOVES)).toBe('Sessions a week must be between 1 and 7.');
    expect(validatePrescription({ ...ok, note: 'x'.repeat(501) }, MOVES)).toBe('The note is longer than 500 characters.');
  });
});

describe('limitText', () => {
  it('says limits the way a doctor does', () => {
    expect(limitText('rightShoulder', { kind: 'range', maxDeg: 90 })).toBe('Right shoulder: raise up to 90°');
    expect(limitText('leftKnee', { kind: 'range', maxDeg: 60 })).toBe('Left knee: bend up to 60°');
    expect(limitText('leftKnee', { kind: 'off' })).toBe('Left knee: off');
  });
});
```
`days.test.ts`:
```ts
it('counts whole days across a month end and the clock change', () => {
  expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
  expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);  // US clocks go back on 2026-11-01
  expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);  // and forward on 2026-03-08
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
});
```

- [ ] **Step 2:** Run `npx vitest run src/care`. Expected: FAIL, modules not found.
- [ ] **Step 3:** Implement the five files. `days.ts` works on `Date.UTC` of the key's parts, never on local midnight.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat: prescriptions, and applying one to the move list`.

---

### Task 4: Building a session record

**Files:**
- Create: `src/care/session.ts`, `src/care/session.test.ts`
- Modify: `src/care/index.ts`

**Interfaces:**
- Consumes: `Prescription`, `SessionRecord`, `HoldDetail`, `RunSummary`, `dayKey`.
- Produces:
  ```ts
  export function buildSession(input: {
    prescription: Prescription; moveCount: number; details: readonly HoldDetail[];
    summary: RunSummary; songId: string; startedAt: Date; newId?: () => string;   // default crypto.randomUUID
  }): SessionRecord | null;
  ```
  Null when `details` is empty or `moveCount` is 0. Holds are `details` cut to `rounds * moveCount`; `round` is `floor(i / moveCount) + 1`; `roundsDone` is whole rounds; `completed` is `roundsDone >= rounds`; `day` is `dayKey(startedAt)`; `durationSec` comes from `summary.durationSec`.

- [ ] **Step 1: Write the failing tests**

```ts
const rx = { ...newPrescriptionBody('2026-11-10'), moveIds: ['a', 'b'], rounds: 2, id: 'rx1', version: 1, createdAt: '2026-11-10T09:00:00.000Z' };
const detail = (i: number): HoldDetail => ({ cycleIndex: i, moveId: i % 2 ? 'b' : 'a', score: 70, label: 'Good', timingOffsetMs: 0, joints: {}, formFlags: [], overLimit: [] });
const summary = { points: 0, moves: 0, perfect: 0, good: 0, miss: 0, bestCombo: 0, accuracy: 70, durationSec: 42 };
const at = new Date(2026, 10, 14, 23, 59);
const build = (n: number) => buildSession({ prescription: rx, moveCount: 2, details: Array.from({ length: n }, (_, i) => detail(i)), summary, songId: 'past-sadness', startedAt: at, newId: () => 'id1' });

it('saves nothing when no hold was scored', () => expect(build(0)).toBeNull());
it('marks a full session completed and numbers the rounds', () => {
  const s = build(4)!;
  expect(s).toMatchObject({ id: 'id1', prescriptionId: 'rx1', day: '2026-11-14', songId: 'past-sadness', durationSec: 42, roundsPrescribed: 2, roundsDone: 2, completed: true });
  expect(s.holds.map((h) => h.round)).toEqual([1, 1, 2, 2]);
});
it('marks an early finish partial', () => expect(build(3)).toMatchObject({ roundsDone: 1, completed: false }));
it('drops holds scored after the last round', () => expect(build(6)!.holds).toHaveLength(4));
```

- [ ] **Step 2:** Run `npx vitest run src/care/session.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `buildSession`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: build a session record from a finished program session`.

---

### Task 5: Consistency

**Files:**
- Create: `src/care/analysis/consistency.ts`, `src/care/analysis/consistency.test.ts`, `src/care/analysis/index.ts`
- Modify: `src/care/index.ts`

**Interfaces:**
- Consumes: `Prescription`, `SessionRecord`, `addDays`, `daysBetween`.
- Produces:
  ```ts
  export const QUIET_AFTER_DAYS = 3;
  export type DayState = 'done' | 'partial' | 'empty';
  export interface DayCell { day: string; state: DayState; today: boolean; future: boolean }
  export interface WeekRow { index: number; days: DayCell[]; done: number; prescribed: number; extra: boolean }
  export type PatientStatus =
    | { kind: 'no-program' } | { kind: 'not-started' } | { kind: 'on-track' }
    | { kind: 'behind' } | { kind: 'quiet'; days: number } | { kind: 'finished' };
  export interface Consistency {
    weeks: WeekRow[];                                       // week 1 to the current week; [] with no program
    thisWeek: { done: number; prescribed: number } | null;
    programWeek: number;                                    // 1-based; 0 with no program
    programWeeks: number;
    status: PatientStatus;
    statusText: string;  // 'No program' | 'Not started' | 'On track' | 'Behind' | 'No sessions for 4 days' | 'Finished'
    warn: boolean;       // true for behind and quiet
  }
  export function consistency(prescriptions: readonly Prescription[], sessions: readonly SessionRecord[], today: string): Consistency;
  ```
  Rules:
  - The current program is the versions sharing the newest version's `startDate`. Only sessions on or after that date count here.
  - Week *i* is days `startDate + 7(i-1)` to `+6`. `programWeek = floor(daysBetween(startDate, today) / 7) + 1`. Rows run from 1 to `programWeek`; a row past `weeks` has `extra: true`.
  - A day is `done` if it has a completed session, else `partial` if it has any session, else `empty`. `done` for a week counts `done` days.
  - `prescribed` for a week is `sessionsPerWeek` of the newest current-program version whose `createdAt` local day is on or before the week's last day; the oldest one if none.
  - Status, first match wins: no prescriptions → `no-program`; `programWeek > weeks` → `finished`; no session since `startDate` → `not-started`; `daysBetween(last session day, today) >= 3` → `quiet` with that number; this week's `done` + days left in the week (today counts unless today is already `done`) `< prescribed` → `behind`; else `on-track`.

- [ ] **Step 1: Write the failing tests**

```ts
const rx = (over: Partial<Prescription> = {}): Prescription => ({ ...newPrescriptionBody('2026-10-26'), moveIds: ['a'], id: 'rx1', version: 1, createdAt: '2026-10-26T10:00:00', ...over });
const sess = (day: string, completed = true): SessionRecord => ({ id: day + completed, prescriptionId: 'rx1', startedAt: day + 'T18:00:00', day, songId: 's', durationSec: 60, roundsPrescribed: 3, roundsDone: completed ? 3 : 1, completed, summary: { points: 0, moves: 3, perfect: 0, good: 3, miss: 0, bestCombo: 3, accuracy: 70, durationSec: 60 }, holds: [] });

it('has nothing to show without a program', () => {
  expect(consistency([], [], '2026-11-14')).toMatchObject({ weeks: [], thisWeek: null, programWeek: 0, statusText: 'No program' });
});
it('lays weeks out from the start date, across the clock change', () => {
  // start Mon 2026-10-26; today Sat 2026-11-14 is day 19, so week 3
  const c = consistency([rx()], [sess('2026-10-26'), sess('2026-11-01'), sess('2026-11-02')], '2026-11-14');
  expect(c.programWeek).toBe(3);
  expect(c.weeks.map((w) => w.done)).toEqual([2, 1, 0]);
  expect(c.weeks[0].days[6]).toMatchObject({ day: '2026-11-01', state: 'done' });
  expect(c.weeks[1].days[0]).toMatchObject({ day: '2026-11-02', state: 'done' });
  expect(c.weeks[2].days[5]).toMatchObject({ day: '2026-11-14', today: true, future: false });
  expect(c.weeks[2].days[6].future).toBe(true);
});
it('counts a day once, and a partial session not at all', () => {
  const c = consistency([rx()], [sess('2026-11-09'), sess('2026-11-09'), sess('2026-11-10', false)], '2026-11-10');
  expect(c.thisWeek).toEqual({ done: 1, prescribed: 5 });
  expect(c.weeks[2].days[1].state).toBe('partial');
});
it('is on track while the week can still be reached', () => {
  // week 3 is Nov 9-15; 3 done by Fri 13th, today + Sat + Sun = 3 left, target 5
  const c = consistency([rx()], [sess('2026-11-09'), sess('2026-11-10'), sess('2026-11-11')], '2026-11-13');
  expect(c.statusText).toBe('On track');
  expect(c.warn).toBe(false);
});
it('is behind once the week cannot be reached', () => {
  const c = consistency([rx()], [sess('2026-11-09'), sess('2026-11-13')], '2026-11-14');
  expect(c.statusText).toBe('Behind');  // 2 done + 2 days left < 5
  expect(c.warn).toBe(true);
});
it('says how long it has been quiet', () => {
  expect(consistency([rx()], [sess('2026-11-10')], '2026-11-14').statusText).toBe('No sessions for 4 days');
});
it('is not started before the first session and finished after the last week', () => {
  expect(consistency([rx()], [], '2026-10-27').statusText).toBe('Not started');
  expect(consistency([rx({ weeks: 2 })], [sess('2026-10-27')], '2026-11-14')).toMatchObject({ statusText: 'Finished', programWeek: 3 });
  expect(consistency([rx({ weeks: 2 })], [sess('2026-10-27')], '2026-11-14').weeks[2].extra).toBe(true);
});
it('judges each week by the version in force at its end', () => {
  const v2 = rx({ id: 'rx2', version: 2, sessionsPerWeek: 3, createdAt: '2026-11-05T10:00:00' });
  expect(consistency([rx(), v2], [sess('2026-10-26')], '2026-11-14').weeks.map((w) => w.prescribed)).toEqual([5, 3, 3]);
});
it('starts over when a new program starts', () => {
  const next = rx({ id: 'rx2', version: 2, startDate: '2026-11-12', createdAt: '2026-11-12T10:00:00' });
  const c = consistency([rx(), next], [sess('2026-11-01'), sess('2026-11-13')], '2026-11-14');
  expect(c.programWeek).toBe(1);
  expect(c.weeks[0].done).toBe(1);
});
```

- [ ] **Step 2:** Run `npx vitest run src/care/analysis/consistency.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `consistency`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: consistency of a patient against their program`.

---

### Task 6: Quality and problem spots

**Files:**
- Create: `src/care/analysis/quality.ts`, `findings.ts`, `quality.test.ts`, `findings.test.ts`
- Modify: `src/care/analysis/index.ts`

**Interfaces:**
- Consumes: `SessionRecord`, `HoldRecord`, `Move`, `movementOf`, `jointLabel`, `addDays`.
- Produces:
  ```ts
  // quality.ts
  export interface MoveTrend { moveId: string; points: { day: string; score: number }[] }  // one point per session that held the move
  export interface Quality { average: number | null; previous: number | null; change: number | null; byMove: MoveTrend[] }
  /** average: mean hold score over sessions in the 7 days ending today; previous: the 7 days before. */
  export function quality(sessions: readonly SessionRecord[], today: string): Quality;

  // findings.ts
  export const RECENT_SESSIONS = 3;
  export const JOINT_REPORT_DEG = 8;      // report a joint this far short of or past its target
  export const JOINT_SEEN_MIN = 0.5;      // a hold counts for a joint finding only if the joint was seen this much
  export const FORM_REPORT_SHARE = 0.3;
  export const LATE_REPORT_MS = 300;
  export const VIEW_REPORT_SHARE = 0.2;
  export const TREND_STEP = 0.2;          // relative change that counts as better or worse
  export type FindingKind = 'breach' | 'joint' | 'form' | 'timing' | 'view';
  export type Trend = 'better' | 'worse' | 'same' | 'new';
  export interface Finding {
    kind: FindingKind; moveId: string | null; joint: JointName | null; ruleId: string | null;
    value: number; previous: number | null; trend: Trend;
    series: number[];   // the value per session, oldest first, over the last 6 sessions that have one
    text: string;
  }
  export function findings(sessions: readonly SessionRecord[], moves: readonly Move[]): Finding[];
  ```
  Definitions (recent = the last 3 sessions; before = the 3 before those; `previous` is null when before has no data):
  - **joint**, per move and joint: mean shortfall in movement over holds with `seen >= 0.5`, where shortfall = target movement − measured movement (shoulder: `-meanError`; others: `+meanError`). Positive is short, negative is past. Reported when `|value| >= 8`. Trend compares `|value|` with `|previous|`.
  - **form**, per move and rule: flagged holds ÷ holds of that move. Reported when `>= 0.3`.
  - **breach**, per joint: number of holds whose `overLimit` has it. Reported when `>= 1`.
  - **timing**: mean `timingOffsetMs` over holds that were not a Miss. Reported when `>= 300`.
  - **view**, per joint: mean of `1 - seen` over holds that score it. Reported when `>= 0.2`.
  - Trend: `new` when `previous` is null; `better` when the size fell by more than 20% of `previous`; `worse` when it rose by more than 20%; else `same`. For a breach with `previous` 0, any count is `worse`.
  - Order: breaches (count, high first), joints (`|value|`, high first), form (share, high first), timing, view (share, high first).
  - Text, with the move's name from `moves` (the id if it is gone) and numbers rounded:
    - `Side Arm Raise: right shoulder stops 14° short.` / `… goes 12° past.` then ` Was 25°.` for better or worse, ` No change.` for same, nothing for new.
    - `Side Arm Raise: trunk leans on 4 of 10 holds.` (`trunk-lean` → `trunk leans`, `shoulder-shrug` → `shoulders rise`, any other id as is.) Same suffix rule with the earlier share as `Was 6 of 10.` only when the hold counts match; otherwise no number.
    - `Right shoulder went past its limit on 2 holds.` (`1 hold`.)
    - `Arrives 0.4 s late on average.` then ` Was 0.7 s.` under the same rule.
    - `Left knee is out of view for 30% of the hold.`

- [ ] **Step 1: Write the failing tests.** Build sessions with this helper in both test files:

```ts
const hold = (over: Partial<HoldRecord> = {}): HoldRecord => ({ cycleIndex: 0, round: 1, moveId: 'side-arm-raise', score: 70, label: 'Good', timingOffsetMs: 0, joints: {}, formFlags: [], overLimit: [], ...over });
const session = (day: string, holds: HoldRecord[]): SessionRecord => ({ id: day, prescriptionId: 'rx1', startedAt: day + 'T18:00:00', day, songId: 's', durationSec: 60, roundsPrescribed: 1, roundsDone: 1, completed: true, summary: { points: 0, moves: holds.length, perfect: 0, good: holds.length, miss: 0, bestCombo: 0, accuracy: 70, durationSec: 60 }, holds });
const short = (deg: number) => hold({ joints: { rightShoulder: { target: 90, meanError: -deg, seen: 1 } } });
```
`findings.test.ts`:
```ts
it('reports a joint that stops short, with its trend', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-10', '2026-11-11', '2026-11-12'];
  const sessions = days.map((d, i) => session(d, [short(i < 3 ? 25 : 14)]));
  const [f] = findings(sessions, MOVES);
  expect(f).toMatchObject({ kind: 'joint', moveId: 'side-arm-raise', joint: 'rightShoulder', value: 14, previous: 25, trend: 'better' });
  expect(f.series).toEqual([25, 25, 25, 14, 14, 14]);
  expect(f.text).toBe('Side Arm Raise: right shoulder stops 14° short. Was 25°.');
});
it('says past for a knee that bends too far', () => {
  const s = session('2026-11-12', [hold({ moveId: 'standing-knee-raise', joints: { leftKnee: { target: 90, meanError: -12, seen: 1 } } })]);
  expect(findings([s], MOVES)[0].text).toBe('Standing Knee Raise: left knee goes 12° past.');
});
it('leaves out small errors and joints that were mostly out of view', () => {
  expect(findings([session('2026-11-12', [short(7)])], MOVES)).toEqual([]);
  const hidden = hold({ joints: { rightShoulder: { target: 90, meanError: 0, seen: 0 } } });
  const out = findings([session('2026-11-12', [hidden])], MOVES);
  expect(out.map((f) => f.kind)).toEqual(['view']);
  expect(out[0].text).toBe('Right shoulder is out of view for 100% of the hold.');
  expect(out.every((f) => Number.isFinite(f.value))).toBe(true);
});
it('reports a form rule flagged on enough holds', () => {
  const holds = Array.from({ length: 10 }, (_, i) => hold({ formFlags: i < 4 ? ['trunk-lean'] : [] }));
  expect(findings([session('2026-11-12', holds)], MOVES)[0]).toMatchObject({ kind: 'form', ruleId: 'trunk-lean', value: 0.4, trend: 'new', text: 'Side Arm Raise: trunk leans on 4 of 10 holds.' });
});
it('puts breaches first', () => {
  const s = session('2026-11-12', [short(20), hold({ overLimit: ['rightShoulder'] }), hold({ overLimit: ['rightShoulder'] })]);
  const out = findings([s], MOVES);
  expect(out[0]).toMatchObject({ kind: 'breach', joint: 'rightShoulder', value: 2, text: 'Right shoulder went past its limit on 2 holds.' });
  expect(out[1].kind).toBe('joint');
});
it('reports lateness, ignoring misses', () => {
  const s = session('2026-11-12', [hold({ timingOffsetMs: 400 }), hold({ timingOffsetMs: 400 }), hold({ label: 'Miss', score: 0, timingOffsetMs: 2000 })]);
  expect(findings([s], MOVES)[0]).toMatchObject({ kind: 'timing', value: 400, text: 'Arrives 0.4 s late on average.' });
});
it('finds nothing in no sessions', () => expect(findings([], MOVES)).toEqual([]));
```
`quality.test.ts`:
```ts
it('compares the last seven days with the seven before', () => {
  const q = quality([session('2026-11-03', [hold({ score: 60 })]), session('2026-11-10', [hold({ score: 70 }), hold({ score: 78 })])], '2026-11-14');
  expect(q).toMatchObject({ average: 74, previous: 60, change: 14 });
  expect(q.byMove).toEqual([{ moveId: 'side-arm-raise', points: [{ day: '2026-11-03', score: 60 }, { day: '2026-11-10', score: 74 }] }]);
});
it('has no average without recent sessions', () => {
  expect(quality([], '2026-11-14')).toEqual({ average: null, previous: null, change: null, byMove: [] });
});
```

- [ ] **Step 2:** Run `npx vitest run src/care/analysis`. Expected: the new files FAIL.
- [ ] **Step 3:** Implement `quality.ts` and `findings.ts`; export both from `analysis/index.ts`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: quality trends and problem spots from recorded holds`.

---

### Task 7: The demo clinic

**Files:**
- Create: `src/care/sampleClinic.ts`, `src/care/demoClinic.ts`, `src/care/demoClinic.test.ts`
- Modify: `src/care/index.ts`

**Interfaces:**
- Consumes: Tasks 3-6.
- Produces:
  ```ts
  // sampleClinic.ts
  export const DEMO_DOCTOR = 'Dr. Okafor';
  export const YOU_ID = 'you';
  /** Four sample patients with history ending relative to `today`. Same output for the same day. */
  export function samplePatients(today: string): PatientFile[];

  // demoClinic.ts
  export const CARE_KEY = 'rehabeat.care.v1';
  export function createDemoClinic(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, now?: () => Date): CareStore;
  ```
  Behaviour:
  - `listPatients()` returns **You** first (`id: 'you'`, name `You`, condition `This browser`, `sample: false`), then the four samples (`sample: true`), then patients the doctor added. `joinCode` is always null and `joined` always true.
  - Storage holds only what was changed: prescriptions saved (for any patient), sessions saved for You, patients added. Sample history is regenerated from `today` on every read and never stored.
  - `savePrescription` appends a version (`version` = last + 1, `id` unique, `createdAt` = now) after the sample's own versions.
  - `myProgram()` is You's newest prescription with `doctorName: 'Dr. Okafor'` and You's sessions, or null.
  - `saveSession` appends to You; a session whose `id` is already stored is ignored.
  - `joinWithCode` rejects with `Codes work once you are signed in.`
  - `reset()` removes the key.
  - Unreadable or wrongly shaped stored data is treated as empty. A storage that throws on write makes `savePrescription` and `saveSession` reject with `This browser would not save the change.`
  - Sample patients, all using real move ids, with status as seen on any `today`:

    | Name | Condition | Program | History |
    | --- | --- | --- | --- |
    | Maya Chen | Right shoulder | side-arm-raise, overhead-arm-raise; right shoulder limit 90°; 5 a week, 6 weeks; started 16 days ago | On track. Right shoulder shortfall on side-arm-raise falls from about 25° to about 14°. `trunk-lean` on about 4 in 10 side-arm-raise holds. Two right-shoulder breaches in the latest session. Timing falls from about 700 ms to about 400 ms. |
    | Sam Ortiz | Left knee | side-arm-raise, overhead-arm-raise; left knee off; 5 a week, 4 weeks; started 6 days ago | Two sessions, the last 4 days ago: "No sessions for 4 days". |
    | Priya Nair | Lower back | goddess-pose, warrior-ii; no limits; 4 a week, 8 weeks; started 30 days ago | On track, scores rising, no findings above the thresholds except one small joint shortfall. |
    | Jonah Reed | Right hip | standing-knee-raise, tree-pose; right hip limit 60°; 5 a week, 6 weeks; started 12 days ago | Behind this week (one completed session in week 2, the last one yesterday); one partial session. |

- [ ] **Step 1: Write the failing tests**

```ts
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}
const now = () => new Date(2026, 10, 14, 12, 0);
const body = { ...newPrescriptionBody('2026-11-14'), moveIds: ['side-arm-raise'] };

it('opens with You and four sample patients', async () => {
  const files = await createDemoClinic(memory(), now).listPatients();
  expect(files.map((f) => f.patient.name)).toEqual(['You', 'Maya Chen', 'Sam Ortiz', 'Priya Nair', 'Jonah Reed']);
  expect(files[0].prescriptions).toEqual([]);
  expect(files.slice(1).every((f) => f.patient.sample && f.sessions.length > 0)).toBe(true);
});
it('gives the samples the stories the page shows', async () => {
  const files = await createDemoClinic(memory(), now).listPatients();
  const status = (name: string) => { const f = files.find((x) => x.patient.name === name)!; return consistency(f.prescriptions, f.sessions, '2026-11-14').statusText; };
  expect(status('Maya Chen')).toBe('On track');
  expect(status('Sam Ortiz')).toBe('No sessions for 4 days');
  expect(status('Jonah Reed')).toBe('Behind');
  const maya = files[1];
  const spots = findings(maya.sessions, MOVES);
  expect(spots[0].kind).toBe('breach');
  expect(spots.find((f) => f.kind === 'joint')).toMatchObject({ joint: 'rightShoulder', trend: 'better' });
  expect(spots.some((f) => f.kind === 'form' && f.ruleId === 'trunk-lean')).toBe(true);
});
it('keeps sample history current and repeatable', () => {
  expect(samplePatients('2026-11-14')).toEqual(samplePatients('2026-11-14'));
  const last = (day: string) => samplePatients(day)[0].sessions.at(-1)!.day;
  expect(daysBetween(last('2026-11-14'), '2026-11-14')).toBe(daysBetween(last('2027-02-01'), '2027-02-01'));
});
it('carries a program from the doctor to the patient and a session back', async () => {
  const store = createDemoClinic(memory(), now);
  expect(await store.myProgram()).toBeNull();
  const rx = await store.savePrescription('you', body);
  expect(rx.version).toBe(1);
  const mine = await store.myProgram();
  expect(mine).toMatchObject({ doctorName: 'Dr. Okafor', prescription: { id: rx.id }, sessions: [] });
  const session = buildSession({ prescription: rx, moveCount: 1, details: [{ cycleIndex: 0, moveId: 'side-arm-raise', score: 70, label: 'Good', timingOffsetMs: 0, joints: {}, formFlags: [], overLimit: [] }], summary: { points: 50, moves: 1, perfect: 0, good: 1, miss: 0, bestCombo: 1, accuracy: 70, durationSec: 20 }, songId: 's', startedAt: now() })!;
  await store.saveSession(session);
  await store.saveSession(session); // a retry
  expect((await store.listPatients())[0].sessions).toHaveLength(1);
});
it('versions an edit to a sample patient and survives a reload', async () => {
  const storage = memory();
  const first = createDemoClinic(storage, now);
  const maya = (await first.listPatients())[1];
  const saved = await first.savePrescription(maya.patient.id, { ...maya.prescriptions.at(-1)!, note: 'Stop at shoulder height.' });
  expect(saved.version).toBe(maya.prescriptions.length + 1);
  const again = (await createDemoClinic(storage, now).listPatients())[1];
  expect(again.prescriptions.at(-1)!.note).toBe('Stop at shoulder height.');
});
it('adds a patient', async () => {
  const store = createDemoClinic(memory(), now);
  const p = await store.addPatient({ name: 'Ada', condition: 'Left elbow' });
  expect(p).toMatchObject({ name: 'Ada', condition: 'Left elbow', sample: false, joinCode: null });
  expect((await store.listPatients()).at(-1)!.patient.id).toBe(p.id);
});
it('falls back to the default clinic when stored data is unreadable', async () => {
  for (const bad of ['{not json', '[]', '{"prescriptions":7,"sessions":"x","patients":null}']) {
    const files = await createDemoClinic(memory({ [CARE_KEY]: bad }), now).listPatients();
    expect(files).toHaveLength(5);
    expect(files[0].prescriptions).toEqual([]);
  }
});
it('works with no storage, and says so when a write is refused', async () => {
  expect(await createDemoClinic(undefined, now).listPatients()).toHaveLength(5);
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => undefined };
  await expect(createDemoClinic(full, now).savePrescription('you', body)).rejects.toThrow('This browser would not save the change.');
});
it('resets', async () => {
  const store = createDemoClinic(memory(), now);
  await store.savePrescription('you', body);
  store.reset!();
  expect(await store.myProgram()).toBeNull();
});
```

- [ ] **Step 2:** Run `npx vitest run src/care/demoClinic.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `sampleClinic.ts` (a small seeded generator keyed on patient name and day offset; build `HoldRecord`s directly, with joint errors, flags and breaches chosen to produce the table's stories) and `demoClinic.ts`.
- [ ] **Step 4:** Run. Expected: PASS. Adjust the sample generator, not the thresholds, until the story test passes.
- [ ] **Step 5:** Commit `feat: a demo clinic in the browser with sample patients`.

---

### Task 8: Program sessions on the Play screen

**Files:**
- Modify: `src/ui/PlayScreen.tsx`, `src/ui/hud/types.ts`, `src/ui/hud/PlayHud.tsx`, `src/ui/hud/hud.css`, `src/ui/mockFeedback.ts` and `src/ui/hud/HudPreview.tsx` (new `HudRun` fields), `src/App.tsx`
- Test: `src/ui/playProgram.test.ts` for the pure helper below (create `src/ui/playProgram.ts`)

**Interfaces:**
- Consumes: `JointLimits`, `HoldDetail`, `ScoringEngine.details`, `LiveState.overLimit`, `jointLabel`.
- Produces:
  ```ts
  // src/ui/playProgram.ts
  /** What the Play screen is asked to play. Free play: every move, no end. */
  export interface PlayPlan { moves: readonly Move[]; rounds: number | null; limits: JointLimits }
  export function roundOf(cycleIndex: number, moveCount: number, rounds: number | null): { current: number; total: number } | null;
  /** True once the last round's last cycle has ended and its hold has been scored. */
  export function sessionOver(plan: PlayPlan, routine: Routine, beat: number, scored: number): boolean;
  export function easeOffText(joints: readonly JointName[]): string | null;   // 'Ease off your right shoulder'

  // PlayScreen props gain:   plan: PlayPlan;   onComplete: () => void
  // PlayRun gains:           details: readonly HoldDetail[]
  // HudRun gains:            round: { current: number; total: number } | null;   easeOff: string | null
  ```
  `PlayScreen` builds its `Routine` from `plan.moves` (replacing the `MOVES` import), passes `plan.limits` to `ScoringEngine`, copies `scoring.details` to `runRef.current.details` every frame, and calls `onComplete` once when `sessionOver` is true. The HUD banner order is: step back / body lost, then ease off, then the form note. The ease-off banner uses the step-back banner's markup with `data-testid="ease-off"`, the word `Ease off`, and the detail `Past the range your doctor set`. The move card reads `Now · 2 of 3 · Round 1 of 3` when `round` is set. In this task `App.tsx` passes `plan = { moves: MOVES, rounds: null, limits: {} }` and `onComplete = finish`, so free play is unchanged.

- [ ] **Step 1: Write the failing tests** in `src/ui/playProgram.test.ts`

```ts
const move = (id: string): Move => ({ id, name: id, joints: { leftShoulder: 90 }, tolerance: 20, beats: { reach: 2, hold: 4, release: 2 }, formRules: [] });
const plan: PlayPlan = { moves: [move('a'), move('b')], rounds: 2, limits: {} };
const routine = new Routine(plan.moves, 4); // 8 beats a move; the fourth cycle ends at beat 36

it('numbers rounds from 1 and stops at the last', () => {
  expect(roundOf(0, 2, 2)).toEqual({ current: 1, total: 2 });
  expect(roundOf(3, 2, 2)).toEqual({ current: 2, total: 2 });
  expect(roundOf(9, 2, 2)).toEqual({ current: 2, total: 2 });
  expect(roundOf(3, 2, null)).toBeNull();
});
it('ends only when the last cycle is over and scored', () => {
  expect(sessionOver(plan, routine, 35.9, 4)).toBe(false);
  expect(sessionOver(plan, routine, 36, 3)).toBe(false);
  expect(sessionOver(plan, routine, 36, 4)).toBe(true);
  expect(sessionOver({ ...plan, rounds: null }, routine, 999, 99)).toBe(false);
});
it('names the first joint to ease off', () => {
  expect(easeOffText([])).toBeNull();
  expect(easeOffText(['rightShoulder', 'leftKnee'])).toBe('Ease off your right shoulder');
});
```

- [ ] **Step 2:** Run `npx vitest run src/ui/playProgram.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `playProgram.ts`, then the `PlayScreen`, HUD and `App.tsx` changes above. Add an `easeoff` state to `HudPreview`'s named states.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run smoke`. Expected: all pass; the smoke check's existing free-play walk is unchanged. (If Chrome's synthetic camera delivers no frames the script prints `RETRY`; that is the test camera.)
- [ ] **Step 5:** Commit `feat: the Play screen plays a plan of moves, rounds and limits`.

---

### Task 9: The patient's side

**Files:**
- Create: `src/care/useCare.ts`, `src/ui/ProgramCard.tsx`, `src/ui/SentStrip.tsx`, `src/care/programView.ts`, `src/care/programView.test.ts`
- Modify: `src/App.tsx`, `src/ui/TitleScreen.tsx`, `src/ui/ResultsScreen.tsx`, `src/ui/screens.css`, `src/care/index.ts`

**Interfaces:**
- Consumes: `CareStore`, `MyProgram`, `createDemoClinic`, `applyPrescription`, `applyLimits`, `buildSession`, `consistency`, `findings`, `limitText`, `PlayPlan`, `AuthState`, `supabase`.
- Produces:
  ```ts
  // useCare.ts
  /** Null until auth is ready. The demo clinic when signed out or Supabase is off; the real clinic when signed in (from Task 11; until then, the demo clinic). */
  export function careStoreFor(auth: AuthState): CareStore | null;
  export function useMyProgram(store: CareStore | null): { program: MyProgram | null; loading: boolean; reload: () => void };
  //   reloads on mount, on window focus, and when reload() is called; a store error is logged and read as no program

  // programView.ts (pure: everything the card and the strip show)
  export interface ProgramView {
    doctorName: string; moveNames: string[]; rounds: number; limits: string[];   // limitText for each limited joint
    week: { done: number; prescribed: number } | null; doneToday: boolean; finished: boolean;
    note: string; playable: boolean;   // false when the applied program has no moves
    plan: PlayPlan;                    // for a program session
  }
  export function programView(program: MyProgram, all: readonly Move[], today: string): ProgramView;
  export function freePlan(program: MyProgram | null, all: readonly Move[]): PlayPlan;   // every move, through the patient's limits; rounds null
  export interface SentView { average: number; holds: number; week: { done: number; prescribed: number } | null; workOn: string | null; partial: boolean }
  /** What the results strip says. `week` counts this session as saved. `workOn` is the first finding of this session alone. */
  export function sentView(program: MyProgram, session: SessionRecord, all: readonly Move[], today: string): SentView;
  ```
  Screens:
  - **Title.** With a program, `ProgramCard` (`data-testid="program-card"`) sits in the right-hand column above the high scores (or alone there when accounts are off). It shows `Your program · {doctorName}`, the move names, `{rounds} rounds`, each limit sentence, `{done}/{prescribed} sessions this week`, the note, and a primary button `Start today's session` (`data-testid="program-start"`). When `doneToday`: the line `Done for today` and the button reads `Play it again`. When `finished`: the line `This program has finished. Ask {doctorName} what is next.` When not `playable`: no button and the line `Nothing in this program can be played with your limits. Ask {doctorName}.` With a playable program the title's `Start` button becomes the quiet `Free play` and Enter starts the program session.
  - **App.** New state `mode: 'free' | 'program'`. `program-start` sets `'program'` and opens the song menu; `Start`/`Free play` sets `'free'`. The plan passed to `PlayScreen` is `programView(...).plan` or `freePlan(...)`. If `freePlan(...).moves` is empty, free play is not offered. `PlayScreen` gets `key={song.id + mode}`.
  - **Leaving.** In program mode: `Recalibrate` is not rendered; Esc and `Songs` on the Play screen call `finish()` when at least one hold is scored, else go to the menu; `finish()` also calls `buildSession` (with the prescription and move count the session started with) and keeps the result in state for the results screen.
  - **Results.** `ResultsScreen` takes `care: { store: CareStore; program: MyProgram; session: SessionRecord } | null`. `SentStrip` (`data-testid="sent-strip"`) saves once on mount through `store.saveSession`, and shows: `Sent to {doctorName}` (or `Sending…`; on failure `Not sent.` with a `Try again` button, `data-testid="sent-retry"`), the average, the holds, `{done}/{prescribed} this week`, `Work on: {workOn}` when there is one, `Ended early: this session does not count toward your week.` when partial, and `Only scores and joint angles are sent. The camera picture never leaves this laptop.` After a save it calls `reload()` so the title card is current.
  - A player with no program sees no card, no strip and the same buttons as today.

- [ ] **Step 1: Write the failing tests** in `src/care/programView.test.ts`

```ts
const rx: Prescription = { ...newPrescriptionBody('2026-11-09'), moveIds: ['side-arm-raise', 'overhead-arm-raise', 'standing-knee-raise'], rounds: 3, limits: { rightShoulder: { kind: 'range', maxDeg: 90 }, leftKnee: { kind: 'off' } }, note: 'Keep your trunk tall.', id: 'rx1', version: 1, createdAt: '2026-11-09T09:00:00' };
const program = (sessions: SessionRecord[] = []): MyProgram => ({ doctorName: 'Dr. Okafor', prescription: rx, sessions });

it('describes the program in the patient\'s words', () => {
  const v = programView(program(), MOVES, '2026-11-14');
  expect(v).toMatchObject({ doctorName: 'Dr. Okafor', moveNames: ['Side Arm Raise', 'Overhead Arm Raise'], rounds: 3, limits: ['Right shoulder: raise up to 90°', 'Left knee: off'], week: { done: 0, prescribed: 5 }, doneToday: false, finished: false, note: 'Keep your trunk tall.', playable: true });
  expect(v.plan.rounds).toBe(3);
  expect(v.plan.moves.map((m) => m.id)).toEqual(['side-arm-raise', 'overhead-arm-raise']);
  expect(v.plan.moves[1].joints.rightShoulder).toBe(90);
  expect(v.plan.limits).toEqual(rx.limits);
});
it('is not playable when the limits leave nothing', () => {
  const none = { ...program(), prescription: { ...rx, moveIds: ['standing-knee-raise'] } };
  expect(programView(none, MOVES, '2026-11-14').playable).toBe(false);
});
it('runs free play through the limits, and unchanged with no program', () => {
  expect(freePlan(null, MOVES)).toEqual({ moves: MOVES, rounds: null, limits: {} });
  const plan = freePlan(program(), MOVES);
  expect(plan.moves.some((m) => m.id === 'standing-knee-raise')).toBe(false);
  expect(plan.moves.find((m) => m.id === 'overhead-arm-raise')!.joints.rightShoulder).toBe(90);
});
it('says what was sent', () => {
  const hold: HoldRecord = { cycleIndex: 0, round: 1, moveId: 'side-arm-raise', score: 78, label: 'Good', timingOffsetMs: 0, joints: { rightShoulder: { target: 90, meanError: -12, seen: 1 } }, formFlags: [], overLimit: [] };
  const session: SessionRecord = { id: 's1', prescriptionId: 'rx1', startedAt: '2026-11-14T18:00:00', day: '2026-11-14', songId: 's', durationSec: 60, roundsPrescribed: 3, roundsDone: 3, completed: true, summary: { points: 0, moves: 1, perfect: 0, good: 1, miss: 0, bestCombo: 1, accuracy: 78, durationSec: 60 }, holds: [hold] };
  expect(sentView(program(), session, MOVES, '2026-11-14')).toEqual({ average: 78, holds: 1, week: { done: 1, prescribed: 5 }, workOn: 'Side Arm Raise: right shoulder stops 12° short.', partial: false });
  expect(sentView(program(), { ...session, completed: false }, MOVES, '2026-11-14')).toMatchObject({ week: { done: 0, prescribed: 5 }, partial: true });
});
```

- [ ] **Step 2:** Run `npx vitest run src/care/programView.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `programView.ts` and `useCare.ts` (one demo clinic instance on `window.localStorage`), then the card, the strip and the `App`, title and results changes. Style the card and strip in `screens.css` with the existing `.slab`, `.slab-edge`, `.label`, `.led` and button classes (the game keeps Attract Mode).
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run smoke`. Expected: pass; with empty storage the smoke walk sees no card.
- [ ] **Step 5:** Commit `feat: the patient's program card, program sessions and what was sent`.

---

### Task 10: The doctor's page

**Files:**
- Create: `src/doctor/DoctorPage.tsx`, `PatientList.tsx`, `PatientDetail.tsx`, `ProgramEditor.tsx`, `LimitsEditor.tsx`, `WeekGrid.tsx`, `ProblemSpots.tsx`, `Sparkline.tsx`, `doctor.css`, `src/doctor/editor.ts`, `src/doctor/editor.test.ts`
- Modify: `src/main.tsx` (lazy route `/doctor/*`), `vite.config.ts` (`ROUTES` gains `'doctor'`), `src/landing/Landing.tsx` (nav link `For doctors` to `/doctor`), `src/care/useCare.ts`

**Interfaces:**
- Consumes: everything in `src/care`; `MOVES`; `useAuth`; `AccountButton`.
- Produces:
  ```ts
  // useCare.ts
  export function usePatients(store: CareStore | null): { files: PatientFile[] | null; error: 'setup' | 'failed' | null; reload: () => void };
  //   reloads on mount, on window focus and on reload(); a CareSetupError gives 'setup'

  // editor.ts (pure: the program editor's state changes)
  export function draftFor(file: PatientFile, today: string): PrescriptionBody;   // newest version's body, or newPrescriptionBody(today)
  export function toggleMove(body: PrescriptionBody, moveId: string): PrescriptionBody;        // adds at the end, or removes
  export function moveUp(body: PrescriptionBody, moveId: string): PrescriptionBody;
  export function moveDown(body: PrescriptionBody, moveId: string): PrescriptionBody;
  export function setLimit(body: PrescriptionBody, joint: JointName, limit: JointLimit | null): PrescriptionBody;  // null removes
  export function startNewProgram(body: PrescriptionBody, today: string): PrescriptionBody;    // startDate = today
  export function isDirty(body: PrescriptionBody, file: PatientFile, today: string): boolean;
  export function sparkPoints(series: readonly number[], width: number, height: number, pad: number): [number, number][];
  //   scaled to max(1, largest |value|); a single value sits at the right-hand end
  ```
  Layout, following the mock-up's doctor page, with these test ids:
  - A top bar: `Rehabeat` (link to `/`), `Doctor`, and on the right `AccountButton` when Supabase is configured.
  - Demo banner (`data-testid="demo-banner"`) when `store.kind === 'demo'`: `Demo clinic. These are sample patients, saved in this browser only.` with `Reset demo clinic` (`data-testid="demo-reset"`), plus `Sign in to treat real patients.` when Supabase is configured.
  - `error === 'setup'`: `The clinic is not set up yet. The database change in supabase/migrations has to be applied first.` `error === 'failed'`: `The patients could not be loaded.` with `Try again`.
  - Patient list: one button per patient (`data-testid="patient-{id}"`) with name, condition and `Week {programWeek} of {programWeeks}` when there is a program, and the status pill (pink when `warn`). The selected patient is in the URL as `/doctor/{id}`; the first patient is shown when there is none. Below: `Add patient` with name and condition fields (`data-testid="add-patient"`). In the real clinic a patient who has not joined shows `Join code: {joinCode}`.
  - Detail (`data-testid="patient-detail"`): header; three tiles (`This week {done}/{prescribed} sessions`, `Average score {average}` with `up 6` / `down 3` / nothing, `Past a limit {n} times` counting breach findings' values); `WeekGrid` (`data-testid="week-grid"`; lamps done, partial, empty, with today outlined; each row ends `{done}/{prescribed}`); `ProblemSpots` (`data-testid="problem-spots"`; each finding's text with a `Sparkline` of its series; `Nothing stands out in the last sessions.` when empty; `No sessions yet.` with no sessions).
  - `ProgramEditor` (`data-testid="program-editor"`): every move in `MOVES` as a checkbox (`data-testid="move-{id}"`), ticked moves first in program order with up and down buttons; number inputs for rounds (`data-testid="rx-rounds"`), sessions a week, weeks; a hold select (`Each move's own` or 1-16 beats); `Start a new program` (shown when the patient already has one); the live preview list `What {name} will play` from `applyPrescription(...).changes`.
  - `LimitsEditor`: one row per joint in `JOINT_NAMES`, each with a three-way choice `No limit` / `Up to` / `Off` (`data-testid="limit-{joint}"`); `Up to` shows a range input with `LIMIT_SLIDER` bounds and the sentence from `limitText`.
  - Note textarea (`data-testid="rx-note"`, with a `{n}/500` counter) and `Save and send` (`data-testid="rx-save"`), disabled when not dirty; the `validatePrescription` message is shown beside it and blocks the save. After a save: `Sent to {name}.` and the list reloads.
  - `Earlier versions`: date and note of each version, newest first.
  - `doctor.css`: desk look. Panels are `--color-deck` on `--color-void` with no borders; labels use `.label`; one gold button; pink only for warnings; focus rings as in the theme. Two columns from 860 px wide, one below; no horizontal scroll at 390 px.

- [ ] **Step 1: Write the failing tests** in `src/doctor/editor.test.ts`

```ts
const body = { ...newPrescriptionBody('2026-11-14'), moveIds: ['a', 'b', 'c'] };
const file = (prescriptions: Prescription[] = []): PatientFile => ({ patient: { id: 'p', name: 'P', condition: '', joinCode: null, joined: true, sample: false }, prescriptions, sessions: [] });

it('ticks a move on at the end and off again', () => {
  expect(toggleMove(body, 'd').moveIds).toEqual(['a', 'b', 'c', 'd']);
  expect(toggleMove(body, 'b').moveIds).toEqual(['a', 'c']);
});
it('reorders, and stays put at the ends', () => {
  expect(moveUp(body, 'c').moveIds).toEqual(['a', 'c', 'b']);
  expect(moveUp(body, 'a').moveIds).toEqual(['a', 'b', 'c']);
  expect(moveDown(body, 'a').moveIds).toEqual(['b', 'a', 'c']);
  expect(moveDown(body, 'c').moveIds).toEqual(['a', 'b', 'c']);
});
it('sets and clears a limit without touching the others', () => {
  const one = setLimit(body, 'leftKnee', { kind: 'off' });
  const two = setLimit(one, 'rightShoulder', { kind: 'range', maxDeg: 90 });
  expect(two.limits).toEqual({ leftKnee: { kind: 'off' }, rightShoulder: { kind: 'range', maxDeg: 90 } });
  expect(setLimit(two, 'leftKnee', null).limits).toEqual({ rightShoulder: { kind: 'range', maxDeg: 90 } });
  expect(body.limits).toEqual({});
});
it('drafts from the newest version, or a new program', () => {
  expect(draftFor(file(), '2026-11-14')).toEqual(newPrescriptionBody('2026-11-14'));
  const v1 = { ...body, id: 'rx1', version: 1, createdAt: '2026-11-10T09:00:00', startDate: '2026-11-10' };
  const draft = draftFor(file([v1]), '2026-11-14');
  expect(draft.startDate).toBe('2026-11-10');
  expect('id' in draft).toBe(false);
  expect(isDirty(draft, file([v1]), '2026-11-14')).toBe(false);
  expect(isDirty({ ...draft, note: 'x' }, file([v1]), '2026-11-14')).toBe(true);
  expect(startNewProgram(draft, '2026-11-14').startDate).toBe('2026-11-14');
});
it('scales a trend line to its box', () => {
  expect(sparkPoints([25, 14], 96, 34, 5)).toEqual([[5, 5], [91, 15.56]]);
  expect(sparkPoints([0, 0], 96, 34, 5)).toEqual([[5, 29], [91, 29]]);
  expect(sparkPoints([3], 96, 34, 5)).toEqual([[91, 5]]);
  expect(sparkPoints([], 96, 34, 5)).toEqual([]);
});
```
(`sparkPoints` rounds each coordinate to 2 decimals; y = `height - pad - (|v| / max) * (height - 2 * pad)`.)

- [ ] **Step 2:** Run `npx vitest run src/doctor/editor.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `editor.ts`, `usePatients`, the components and `doctor.css`; add the route, the route file and the landing link.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run build`. Expected: pass, and `dist/doctor/index.html` exists. Then open `/doctor` in the dev server with Playwright at 1440 x 900 and 390 px wide, in the demo clinic, and look at a screenshot of each: no console errors, no horizontal scroll, Maya Chen's findings and week grid are filled.
- [ ] **Step 5:** Commit `feat: the doctor's page`.

---

### Task 11: The real clinic on Supabase

**Files:**
- Create: `supabase/migrations/20261115090000_care.sql`, `src/care/supabaseClinic.ts`, `src/care/supabaseClinic.test.ts`, `src/ui/JoinCode.tsx`
- Modify: `src/lib/database.types.ts` (by hand, to match the migration), `src/care/useCare.ts`, `src/ui/TitleScreen.tsx`

**Interfaces:**
- Consumes: `CareStore`, `CareSetupError`, `supabase`, `AuthState`.
- Produces:
  ```ts
  export function createSupabaseClinic(client: SupabaseClient<Database>, userId: string): CareStore;   // kind: 'clinic'
  // pure helpers, exported for tests:
  export function isMissingTable(error: { code?: string } | null): boolean;    // 'PGRST205' or '42P01'
  export function isDuplicate(error: { code?: string } | null): boolean;       // '23505'
  export function prescriptionFromRow(row: { id: string; version: number; created_at: string; body: unknown }): Prescription | null;
  export function sessionFromRow(row: { id: string; body: unknown }): SessionRecord | null;
  ```
  `careStoreFor` returns `createSupabaseClinic(supabase, auth.user.id)` when Supabase is configured and a user is signed in (memoised per user id).

  Migration (no table has a public or anon policy):
  - `care_patients`: `id uuid pk default gen_random_uuid()`, `doctor_id uuid not null default auth.uid() references profiles(id) on delete cascade`, `patient_id uuid unique references profiles(id) on delete set null`, `display_name text not null` (1-60 chars), `condition text not null default ''` (up to 80), `join_code text not null unique default public.new_care_code()`, `created_at timestamptz not null default now()`.
  - `care_prescriptions`: `id uuid pk default gen_random_uuid()`, `care_patient_id uuid not null references care_patients(id) on delete cascade`, `version integer not null check (version >= 1)`, `body jsonb not null`, `created_at timestamptz not null default now()`, `unique (care_patient_id, version)`.
  - `care_sessions`: `id uuid pk` (client-made), `care_patient_id uuid not null references care_patients(id) on delete cascade`, `prescription_id uuid not null references care_prescriptions(id)`, `day date not null`, `completed boolean not null`, `body jsonb not null`, `created_at timestamptz not null default now()`. Index on `(care_patient_id, day)`.
  - `new_care_code()`: six characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
  - `is_care_doctor(uuid)` and `is_care_patient(uuid)`: `security definer`, `stable`, `set search_path = ''`, true when `auth.uid()` is that row's `doctor_id` / `patient_id`. Policies call these, so no policy selects from a table that has policies of its own.
  - Policies, `to authenticated` only: `care_patients` select where doctor or patient, insert and update where `doctor_id = auth.uid()`; `care_prescriptions` select for the doctor or the patient of the row, insert for the doctor; `care_sessions` select for the doctor or the patient, insert for the patient. No update or delete on prescriptions or sessions.
  - `claim_care_code(code text) returns uuid`, `security definer`: raises `Sign in first` with no user; raises `You already have a doctor` if the caller is a patient somewhere; sets `patient_id = auth.uid()` on the row whose `join_code = upper(trim(code))` and `patient_id is null`; raises `No program found for that code` if none. Granted to `authenticated` only. A doctor may claim their own code.

  Store behaviour: `listPatients` reads the doctor's `care_patients`, then their prescriptions and sessions, and groups them; a missing table throws `CareSetupError`. `savePrescription` reads the highest version for the patient and inserts the next. `myProgram` reads the caller's patient row (null if none or no prescription yet), its prescriptions and sessions, and the doctor's `profiles.display_name` (fallback `Your doctor`). `saveSession` inserts with the session's own `id`; a duplicate-key error is a success. `joinWithCode` calls the function and rejects with its message. Rows whose `body` does not parse are skipped.

  `JoinCode` (`data-testid="join-code"`): on the title screen's board foot when the store is the clinic, the player is signed in and has no program. A six-character input and `Join`; errors shown beneath; success reloads the program.

- [ ] **Step 1: Write the failing tests** in `src/care/supabaseClinic.test.ts`

```ts
it('recognises a missing table and a duplicate row', () => {
  expect(isMissingTable({ code: 'PGRST205' })).toBe(true);
  expect(isMissingTable({ code: '42P01' })).toBe(true);
  expect(isMissingTable({ code: '23505' })).toBe(false);
  expect(isMissingTable(null)).toBe(false);
  expect(isDuplicate({ code: '23505' })).toBe(true);
  expect(isDuplicate({})).toBe(false);
});
it('reads a prescription row, taking id, version and date from the columns', () => {
  const body = { ...newPrescriptionBody('2026-11-14'), moveIds: ['side-arm-raise'], id: 'wrong', version: 99 };
  expect(prescriptionFromRow({ id: 'rx1', version: 2, created_at: '2026-11-14T09:00:00Z', body })).toMatchObject({ id: 'rx1', version: 2, createdAt: '2026-11-14T09:00:00Z', moveIds: ['side-arm-raise'], rounds: 3 });
});
it('skips rows it cannot read', () => {
  expect(prescriptionFromRow({ id: 'rx1', version: 1, created_at: 'x', body: null })).toBeNull();
  expect(prescriptionFromRow({ id: 'rx1', version: 1, created_at: 'x', body: { moveIds: 'no' } })).toBeNull();
  expect(sessionFromRow({ id: 's1', body: { holds: 'no' } })).toBeNull();
});
```
`saveSession` treats `isDuplicate(error)` as success; that one line is what makes a retry safe, and the test above pins the code it looks for.

- [ ] **Step 2:** Run `npx vitest run src/care/supabaseClinic.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Write the migration, update `database.types.ts`, implement the store, `JoinCode` and the `careStoreFor` switch.
- [ ] **Step 4:** Run `npm run typecheck && npm test && npm run smoke`. Expected: pass. The smoke check runs signed out, so it exercises the demo clinic only. Read the migration once more against the policy list above.
- [ ] **Step 5:** Commit `feat: the real clinic on Supabase, with a join code for patients`.

---

### Task 12: Smoke check, screenshots and documents

**Files:**
- Modify: `scripts/smoke.mjs`, `scripts/screens.mjs`, `README.md`, `PRODUCT.md`, `.interface-design/system.md`
- Create: `docs/screenshots/doctor.png`, `doctor-phone.png`, `title-program.png`, `results-sent.png` (from the script)

**Interfaces:**
- Consumes: the test ids from Tasks 8-10.

- [ ] **Step 1: Add the demo loop to `scripts/smoke.mjs`** as `doctorLoop(url)`, run after `happyPath` in a fresh browser context, with these checks:
  1. `/doctor` shows the demo banner and five patients; the first sample's detail shows a week grid and at least one problem spot.
  2. Pick `patient-you`; tick `move-side-arm-raise`; set `rx-rounds` to 1; type a note; `rx-save`; the page says `Sent to You.`
  3. `/play` shows `program-card` with the note; `program-start` opens the song menu; pick the default song; skip calibration.
  4. The session ends by itself: `results-screen` appears within 60 s without pressing `finish-button`, and `sent-strip` says `Sent to Dr. Okafor`.
  5. Back on `/doctor`, `patient-you` shows `1/5` for this week.
  6. `demo-reset` returns You to no program, and `/play` then shows no `program-card`.
  7. No console errors.
- [ ] **Step 2:** Run `npm run smoke`. Expected: every check passes, old and new.
- [ ] **Step 3: Add to `scripts/screens.mjs`**: `/doctor` at 1440 x 900 (`doctor.png`) and 390 px (`doctor-phone.png`) on Maya Chen; the title screen with a program (`title-program.png`); the results screen with the strip (`results-sent.png`). Run it and look at each new image.
- [ ] **Step 4: Update the documents.**
  - `README.md`: a section **Doctors and programs** after "Accounts and leaderboard" covering the loop, `/doctor`, the demo clinic and how to reset it, the program fields, limits as movement from rest, what a session records, the three analyses with their constants, the three tables and policies, and **how to apply the migration** (Supabase SQL editor or `supabase db push`). Add the new folders to "Layout", the new routes to the intro, and to "Current limits": the thresholds are untuned; the real clinic has not been exercised end to end by the smoke check; closing the tab loses a session; anyone signed in can act as a doctor.
  - `PRODUCT.md`: "Who it is for" gains the doctor; a section **Two rooms** (the game is Attract Mode read from two metres; the doctor's page is a desk tool); "What it does not say" gains the limit wording rule; "Privacy" says a patient's scores and joint angles, never the picture, go to their doctor, and that the demo clinic stays in the browser.
  - `.interface-design/system.md`: a **Desk look** section with the rules from Global Constraints, and `/doctor` in the Screens table.
- [ ] **Step 5:** Run `npm run typecheck && npm test && npm run build`. Expected: pass. Commit `docs: the doctor loop in the README, product notes and design system; smoke check covers the demo loop`.
