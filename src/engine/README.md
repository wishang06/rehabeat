# `src/engine`: player feedback

Turns the pose, the beat and the scoring engine's live state into one `FeedbackFrame` per display frame. A frame says what pose to hit, whether the player is hitting it, and what to fix. The canvas overlay draws from it (`src/ui/overlay.ts`). Screens, HUD panels and side cards can read the same frame instead of recomputing anything.

Nothing here changes scoring. The engine reads `ScoringEngine.live` and the move targets and reports them; the scoring maths, tolerances, timing and audio are untouched.

## Reading the frame

The Play screen builds a frame every display frame and publishes it to `feedbackStore`. Outside the Play screen the store holds `null`.

In a React component:

```tsx
import { useFeedbackFrame } from '../engine';

// Re-renders only when the hint text changes.
const hint = useFeedbackFrame((f) => f?.hint?.text ?? null);

// Re-renders on every frame (up to 60 times a second).
const frame = useFeedbackFrame();
```

Pass a selector that returns a primitive, or a value taken straight off the frame. A selector that builds a new object or array re-renders on every frame.

Outside React:

```ts
import { feedbackStore } from '../engine';

const stop = feedbackStore.subscribe((frame) => { /* frame is FeedbackFrame | null */ });
const latest = feedbackStore.getSnapshot();
```

The types live in `src/types/ui.ts` (`FeedbackFrame`, `LimbFeedback`, `LimbStatus`, `LimbName`, `FeedbackHint`, `FeedbackPhase`, `MoveRef`). `src/engine` re-exports them.

## `FeedbackFrame`

| Field | Meaning |
| --- | --- |
| `t` | Audible master-clock time in seconds (`AudioContext` timeline) |
| `phase` | `ready` (the count-in), `reach`, `hold` or `release`. It follows the audible beat, as the HUD does. |
| `phaseProgress` | 0 to 1 through the current phase |
| `beatsToNextPhase` | Beats until the next phase, fractional. `Math.ceil` it for a countdown. |
| `move` | `{ id, name }` of the move being performed. `null` during the count-in. |
| `nextMove` | The move after it. During the count-in, this is the first move. |
| `limbs` | One `LimbFeedback` per limb, keyed by `LimbName` (see below) |
| `worstJoint` | The scored, measured joint furthest from its target, even when it is within tolerance. `null` when no scored joint is measured. |
| `hint` | `{ joint, limb, text, status }` once a joint has been out of tolerance for 300 ms in a reach or hold. `text` is 2 to 4 words, such as "left arm higher" or "straighten right elbow". `null` in a release, during the count-in, and while `lowVisibility` is set. |
| `holdProgress` | 0 before the hold, rising to 1 through it, and 1 after it |
| `score` | 0-100. The scoring engine's live frame score, while it is on the same move as `move`; 0 otherwise. |
| `holdScore` | Time-weighted mean frame score over the hold so far (from the scoring engine). `null` outside the hold. |
| `onTarget` | True in a reach or hold while `score` is Good (60) or better. The figure turns green on this. |
| `lowVisibility` | True once any joint the move scores has been under the visibility cutoff (0.6, or 0.5 for a joint already being measured) for more than 500 ms |
| `hiddenJoints` | Those joints |

### Limbs

Each limb is driven by one scored joint, so `limbs` covers every joint:

| Limb | Joint |
| --- | --- |
| `leftUpperArm`, `rightUpperArm` | `leftShoulder`, `rightShoulder` |
| `leftForearm`, `rightForearm` | `leftElbow`, `rightElbow` |
| `leftThigh`, `rightThigh` | `leftHip`, `rightHip` |
| `leftShin`, `rightShin` | `leftKnee`, `rightKnee` |

`LimbFeedback` holds `status`, `scored`, `errorDeg` (`|current - target|`), `currentDeg`, `targetDeg` and `visibility`. `visibility` is the lowest visibility of the three landmarks that measure the joint; scoring needs at least 0.6 to start measuring a joint and 0.5 to keep measuring it.

`status` is one of:

- `green`: within the move's tolerance. On its own, that joint would still score Good.
- `amber`: within two tolerances.
- `red`: further off than two tolerances.
- `grey`: scored, but under the visibility cutoff. A limb that drops out briefly keeps its last colour for up to 500 ms, then turns grey.
- `idle`: not judged right now. Either the move doesn't score this joint, or the phase is the count-in or a release.

### Hints

The hint names the worst out-of-tolerance joint. Once a joint is the hint, another joint has to be 8° worse to take over, so the hint doesn't flicker between two similar errors. The 300 ms wait restarts whenever the error clears, and at the start of each move.

| Joint | Below target | Above target |
| --- | --- | --- |
| shoulder | "left arm higher" | "left arm lower" |
| elbow | "straighten left elbow" | "bend left elbow" |
| hip | "left knee lower" | "left knee higher" (a smaller hip angle is a higher knee) |
| knee | "straighten left knee" | "bend left knee" |

Left and right are the player's own. In the mirrored stage that is also the side of the screen they appear on.

## Building frames

`FeedbackTracker` keeps the timers between frames:

```ts
const tracker = new FeedbackTracker(routine);
const frame = tracker.update({ now, beat, frame: sample?.frame ?? null, world: sample?.worldLandmarks ?? null, live: scoring.live });
```

Under it, `buildFeedbackFrame(routine, input, state)` is pure: it returns the frame and the next state. Pass `frame: null` when the latest sample is stale; that counts as every joint hidden.

## The target figure

`silhouette.ts` is pure geometry; it never touches a canvas. A side card can draw the same figure the overlay does:

```ts
import { buildSilhouette, capsuleOutline, poseForMove, standardBody } from '../engine';

const body = standardBody({ center: { x: 60, y: 50 }, shoulderWidth: 36 }); // mirrored like the stage by default
const figure = buildSilhouette(poseForMove(move), body);
// figure.capsules: { part, a, b, ra, rb }[]: tapered capsules for the limbs and neck
// figure.torso: Point[], wound clockwise
// figure.head: { center, radius }
```

- **Shapes.** Every shape is wound clockwise, so filling all of them as one path paints their union once. That is how the overlay gets a single solid figure at 55% opacity with no darker seams where shapes overlap. `capsuleOutline(capsule)` gives the arcs for tracing a tapered capsule; the overlay's `traceCapsule` uses it.
- **Widths.** They come from the body scale (about shoulder width). Upper arms are about 0.26 shoulder widths across, thighs about 0.38, and every segment narrows toward its end.
- **Arms.** They are laid out so that, measured the way scoring measures (hip-shoulder-elbow, shoulder-elbow-wrist), they read exactly as the targets.
- **Legs.** They hang along the body's midline. A thigh lifting toward the camera is canted outward and its knee end swells, so a knee raise reads from the front.
- **Rest.** Joints a move doesn't score take `REST_POSE`, with the arms 16° off the sides so the hands don't merge into the hips.

### Placement (`placement.ts`)

The figure is drawn on the player's own body, anchored to their live shoulders and hips and scaled to their measured limb lengths. When the figure's arms would lie against its torso (hands at the sides, arms across the chest), it would vanish into the player. In that case it is drawn beside them instead, on the side with more room, clear of their body, and inside the canvas.

The test is `armTorsoOverlap`: the fraction of either arm that comes within 0.12 body scales of the torso outline. Above 0.35 means draw beside. It is judged on a standard body, so it depends only on the pose and can't flicker as the player moves. In the current routine:

- The standing knee raise is drawn beside the player, since its arms rest at the sides.
- The overhead and side arm raises are drawn on the body.

### Motion (`ease.ts`)

`FigureEaser` eases the figure's joint angles, and its on-body/beside offset, over 150 ms whenever the target changes. The figure shows:

| Phase | Pose | Opacity |
| --- | --- | --- |
| Count-in | The first move's target | 0.4 |
| Reach | The target | 0.6 rising to 1 |
| Hold | The target | 1 |
| Release | The rest pose, which is where the player is going back to | 1 falling to 0.45 |

## The canvas overlay (`src/ui/overlay.ts`)

`PlayOverlay.draw(surface, frame, landmarks, world, nowMs)` draws, in order:

1. **The target figure.** A gold fill at 55%, a 3 px brighter edge and a soft glow. It turns green while `onTarget`.
   - The glow and edge are fills of grown copies of the silhouette (`inflateSilhouette`). The real silhouette is then cut out with `destination-out` and filled, so overlapping parts show no seams.
   - The cut-out erases whatever is beneath it, so the figure is always drawn first on the freshly cleared canvas.
   - The figure avoids a scratch canvas and wide strokes on purpose. Measured per frame on an Intel Iris Xe, which MediaPipe also runs on: compositing a scratch canvas cost about 14 ms, and stroking the glow cost about 2.5 ms.
2. **The player's body.** The same capsule style at half the figure's width, coloured by limb status. Lost scored limbs are drawn grey with a dashed edge, at the detector's best guess.
3. **The hint.** A label beside the limb, with an arrow to the part it names: the elbow for "arm" hints, the knee for "knee" hints. The label stays out of the HUD corners and off the figure.
4. **The low-visibility banner.** "Step back so your whole body is in frame", placed so it doesn't cover the scored limbs.

**Mirroring.** The stage shows a selfie view: CSS flips the video and the canvas together (`.stage__video, .stage__canvas` in `index.css`). Everything is laid out in camera-image pixels and flips with the video, so it stays on the body. Text is drawn through `drawText` in `src/ui/canvas.ts`, which flips it back so it reads normally. `prepareCanvas` detects the flip from the canvas's computed style, so this stays right if the CSS changes.

## Tests

`npm test` covers the pure parts:

| File | What it checks |
| --- | --- |
| `feedback.test.ts` | Frame building: phases, limb status, hint and visibility timing |
| `hints.test.ts` | Hint selection and wording |
| `silhouette.test.ts` | Figure geometry: scored angles, widths, winding, legibility, inflation |
| `placement.test.ts` | The overlap rule and the beside-the-player offset |
| `ease.test.ts` | Easing |
| `overlayLayout.test.ts` | Player capsules, hint callout and banner placement |
| `feedbackStore.test.ts` | The store and the hook |
