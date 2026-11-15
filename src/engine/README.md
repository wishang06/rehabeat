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

The figure is a stick figure in one colour: black by default, or the colour the player picks with the **Figure** button. It turns green while `onTarget`. Three files build it, none of which touches a canvas.

### Where it stands (`anchor.ts`)

`FigureAnchor.update(landmarks, world, size, nowMs)` returns the body to draw the figure on, once per display frame.

- **Upright, on the hips.** The figure stands on the player's hip midpoint, with its shoulders one torso length above. The hips move least through a move. When the hips are out of view it hangs from the shoulders instead.
- **It stays put.** The figure does not move until the player is more than a quarter of a shoulder width away from it for 200 ms. Then it glides over and stops again. A shaking detector, a sway, or a one-frame glitch moves nothing.
- **It never tilts.** A side bend moves the player's shoulders, not the figure.
- **Size.** Shoulder width and torso length are only measured while the player is upright and facing the camera, and followed the same way (12% out before it resizes). Turning side-on or folding forward does not shrink the figure.
- **Limb lengths.** Each is the mean of the last 120 measurements of the player's own limbs against their torso, kept within 0.75 to 1.3 of standard proportions, and the same on both sides.
- **Lost pose.** With no landmarks the figure stays where it was.

### Its shape (`stick.ts`, `moveViews.ts`)

A pose is a `FigureView`: the direction of each bone in the picture, in degrees from straight down, turning toward the player's left. `stickPoints(view, body)` gives every joint, and `stickFigure(points, scale, order)` the lines to draw.

```ts
import { stickFigure, stickPoints, standardBody, viewForMove, bodyScale } from '../engine';

const body = standardBody({ center: { x: 60, y: 50 }, shoulderWidth: 36 }); // mirrored like the stage by default
const view = viewForMove(move.id, move.joints);
const figure = stickFigure(stickPoints(view, body), bodyScale(body), view.order);
// figure.trunk: Point[][]   spine and neck, shoulder line, hip line
// figure.head:  { center, radius }
// figure.limbs: { chain, points }[]   each from the body outward, furthest from the viewer first
```

- **Moves with joint angles only** (the arm raises, the knee raise) get a front view from `viewForPose`. Arms swing in the picture, so they read exactly as the targets. A thigh lifting toward the camera is drawn short and canted outward.
- **Poses the angles can't picture** have a view written by hand in `MOVE_VIEWS`, keyed by move id: the eight yoga poses. A hip at 60° is a raised knee, a leg out to the side, or a torso folded over a straight leg; only the view says which. Triangle and half moon lean the torso, dancer and downward dog are drawn side-on (`width`), bound angle shortens the thighs that point at the camera.
- **A new move with an unusual shape needs a view.** `moveViews.test.ts` fails if any scored joint, as drawn, is further from its target than the move's tolerance.
- **Depth.** `order` lists the limbs from furthest to nearest. The overlay draws a nearer limb over the ones behind it.
- **Rest.** Joints a move doesn't score take `REST_POSE`, with the arms 16° off the sides.

### Motion

`StickEaser` moves the joints from one pose to the next over 150 ms (`POSE_EASE_MS`). The figure shows:

| Phase | Pose |
| --- | --- |
| Count-in | The first move's target |
| Reach, hold | The target |
| Release | The rest pose, which is where the player is going back to |

## The canvas overlay (`src/ui/overlay.ts`)

`PlayOverlay.draw(surface, frame, landmarks, world, nowMs)` draws, in order:

1. **The target figure.** Solid lines about a tenth of a shoulder width thick, each with a thin contrasting edge (light round a dark colour, dark round a light one) so the figure shows on any background.
   - The trunk and head are drawn first, as one shape.
   - Each limb is then drawn over what is there, its edge first. Where a limb crosses the body or another limb, the edge cuts a gap, so the nearer limb reads as in front.
   - A limb's edge starts a little way out from the joint it hangs from, so it doesn't notch the shoulder or hip.
2. **A dot on each scored joint.** On the far end of each limb the move scores (elbow, wrist, knee, ankle), in a reach or hold. White until that limb is within tolerance, then green. A limb the camera has lost gets a dashed grey ring at the detector's best guess. The dots sit on landmarks steadied by `LandmarkSmoother` (a One Euro filter run every display frame), so they neither shake nor step at the camera's frame rate.
3. **The hint.** A label beside the limb, with an arrow to the part it names: the elbow for "arm" hints, the knee for "knee" hints. The label stays out of the HUD corners and off the figure.

"Step back" is not drawn on the canvas: when a scored joint is out of view its limb is greyed here, and the HUD's message strip under the picture says why.

The canvas uses three colours, each with one meaning: the figure's colour (the pose to copy), white (you), green (in place).

**Mirroring.** The stage shows a selfie view: CSS flips the video and the canvas together (`.stage__video, .stage__canvas` in `index.css`). Everything is laid out in camera-image pixels and flips with the video, so it stays on the body. Text is drawn through `drawText` in `src/ui/canvas.ts`, which flips it back so it reads normally. `prepareCanvas` detects the flip from the canvas's computed style, so this stays right if the CSS changes.

## Tests

`npm test` covers the pure parts:

| File | What it checks |
| --- | --- |
| `feedback.test.ts` | Frame building: phases, limb status, hint and visibility timing |
| `hints.test.ts` | Hint selection and wording |
| `anchor.test.ts` | The figure holds still through noise, sway, a lean, a turn and a glitch; glides after a real step; limb lengths |
| `stick.test.ts` | Joint positions from a view, the lines, and easing between poses |
| `moveViews.test.ts` | Every move's picture shows the angles the move scores |
| `landmarkSmoother.test.ts` | Shake removed from a still joint; a moving one followed |
| `silhouette.test.ts` | The body: standard proportions, the live body from landmarks, body scale |
| `ease.test.ts` | The easing curve |
| `overlayLayout.test.ts` | Player limb layout, hint callout and banner placement |
| `feedbackStore.test.ts` | The store and the hook |
