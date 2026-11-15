/**
 * The Play screen's canvas overlay, drawn once per display frame from a
 * FeedbackFrame: the target figure (a stick figure in one colour), a dot on
 * each joint the move scores, a hint callout, and the low-visibility warning.
 *
 * Geometry is laid out in camera-image pixels; the stage mirrors the canvas
 * with the video (selfie view), and text is flipped back by drawText.
 */
import {
  DEFAULT_ORDER,
  FigureAnchor,
  LIMBS,
  LandmarkSmoother,
  REST_VIEW,
  StickEaser,
  bodyScale,
  hintAnchor,
  layoutBanner,
  layoutHint,
  layoutPlayerBody,
  stickFigure,
  stickPoints,
  viewForMove,
  type Bounds,
  type PlayerBodyLayout,
  type Point,
  type StickFigure,
} from '../engine';
import type { JointName, Landmark } from '../types';
import type { FeedbackFrame } from '../types/ui';
import { CANVAS_COLORS, drawText, type CanvasSurface } from './canvas';
import { figureColorStore, isLight, type FigureColorStore } from './figureColor';

export const LOW_VISIBILITY_MESSAGE = 'Step back so your whole body is in frame';

/** HUD panels sit in the top and bottom corners; canvas text stays in the band between. */
const SAFE_TOP = 0.2;
const SAFE_BOTTOM = 0.27;

/** The figure's line width as a fraction of the body scale (about shoulder width), and its limits in CSS pixels. */
const LINE = { ofScale: 0.085, minPx: 5, maxPx: 16 };
/** The contrasting edge on each side of a line, as a fraction of the line's width, and its floor in CSS pixels. */
const EDGE = { ofLine: 0.22, minPx: 1.5 };
/** A limb's edge starts this many line widths out from the body, so it doesn't cut into the joint it hangs from. */
const EDGE_STARTS_AT = 0.75;

function targetJoints(feedback: FeedbackFrame): Partial<Record<JointName, number>> {
  const joints: Partial<Record<JointName, number>> = {};
  for (const { limb, joint } of LIMBS) {
    const target = feedback.limbs[limb].targetDeg;
    if (target !== null) joints[joint] = target;
  }
  return joints;
}

function polyline(path: Path2D, points: readonly Point[]): void {
  points.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
}

/** `points` without its first `distance`, measured along the line. */
function trimStart(points: readonly Point[], distance: number): Point[] {
  const [a, b] = points;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  // Never more than half the first bone: a foreshortened one can be shorter than the trim.
  const t = length > 0 ? Math.min(0.5, distance / length) : 0;
  return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...points.slice(1)];
}

export class PlayOverlay {
  private readonly anchor = new FigureAnchor();
  private readonly easer = new StickEaser();
  private readonly smoother = new LandmarkSmoother();
  private lowVisibilitySince: number | null = null;

  constructor(private readonly colors: Pick<FigureColorStore, 'get'> = figureColorStore) {}

  /**
   * Draws everything for one frame. `landmarks` and `world` are the latest
   * fresh pose sample's, or null when there is none.
   */
  draw(
    surface: CanvasSurface,
    feedback: FeedbackFrame,
    landmarks: Landmark[] | null,
    world: Landmark[] | null,
    nowMs: number,
  ): void {
    // The figure goes first, under everything else. It stands on its own steadied anchor, so it
    // takes the raw landmarks; the dots and the hint sit on the player, so they take smoothed ones.
    const figure = this.drawFigure(surface, feedback, landmarks, world, nowMs);
    const smooth = this.smoother.update(landmarks, nowMs);

    // The banner keeps off the limbs being scored, which are the ones it is warning about.
    const scoredLimbs: Bounds[] = [];
    if (smooth) {
      // Lost scored limbs are laid out at the detector's best guess, so the player sees which.
      const keep = new Set(LIMBS.filter(({ limb }) => feedback.limbs[limb].status === 'grey').map(({ limb }) => limb));
      const player = layoutPlayerBody(smooth, surface, { keep });
      drawPlayer(surface, player, feedback);
      if (feedback.hint) drawHint(surface, feedback.hint, smooth, player, figure);
      for (const c of player.capsules) {
        if (!feedback.limbs[c.part].scored) continue;
        const r = Math.max(c.ra, c.rb);
        scoredLimbs.push({
          left: Math.min(c.a.x, c.b.x) - r,
          top: Math.min(c.a.y, c.b.y) - r,
          right: Math.max(c.a.x, c.b.x) + r,
          bottom: Math.max(c.a.y, c.b.y) + r,
        });
      }
    }

    if (feedback.lowVisibility) {
      this.lowVisibilitySince ??= nowMs;
      drawLowVisibility(surface, Math.min(1, (nowMs - this.lowVisibilitySince) / 200), scoredLimbs);
    } else {
      this.lowVisibilitySince = null;
    }
  }

  /** Draws the target figure and returns the box it covers, so the hint label can keep off it. */
  private drawFigure(
    surface: CanvasSurface,
    feedback: FeedbackFrame,
    landmarks: Landmark[] | null,
    world: Landmark[] | null,
    nowMs: number,
  ): Bounds | null {
    // The figure stays where it is when the pose drops out: that is when the player needs it most.
    const body = this.anchor.update(landmarks, world, surface, nowMs);
    if (!body) return null;

    // In the release the figure shows where to go back to: rest. In the count-in, the first move.
    const resting = feedback.phase === 'release';
    const id = feedback.move?.id ?? feedback.nextMove.id;
    const view = resting ? REST_VIEW : viewForMove(id, targetJoints(feedback));
    const points = this.easer.update(resting ? 'rest' : id, stickPoints(view, body), body, nowMs);
    const figure = stickFigure(points, bodyScale(body), view.order ?? DEFAULT_ORDER);

    const color = feedback.onTarget ? CANVAS_COLORS.onTarget : this.colors.get().value;
    return drawStick(surface, figure, color);
  }
}

/**
 * Draws the figure as solid lines in `color`, each with a thin contrasting
 * edge so it shows against any background. The trunk and head go down first
 * as one shape. Each limb then goes over what is already there, edge first:
 * where a limb crosses the body or another limb, its edge cuts a clean gap,
 * so the nearer one reads as in front instead of the two merging.
 */
function drawStick(surface: CanvasSurface, figure: StickFigure, color: string): Bounds {
  const { ctx, ratio } = surface;
  const width = Math.min(LINE.maxPx * ratio, Math.max(LINE.minPx * ratio, LINE.ofScale * figure.scale));
  const edge = Math.max(EDGE.minPx * ratio, EDGE.ofLine * width);
  const edgeColor = isLight(color) ? CANVAS_COLORS.ink : CANVAS_COLORS.chalk;

  const bounds: Bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const include = (p: Point, r: number) => {
    bounds.left = Math.min(bounds.left, p.x - r);
    bounds.top = Math.min(bounds.top, p.y - r);
    bounds.right = Math.max(bounds.right, p.x + r);
    bounds.bottom = Math.max(bounds.bottom, p.y + r);
  };

  ctx.save();
  ctx.lineJoin = 'round';

  const trunk = new Path2D();
  for (const line of figure.trunk) {
    polyline(trunk, line);
    for (const p of line) include(p, width);
  }
  const { center, radius } = figure.head;
  trunk.moveTo(center.x + radius, center.y);
  trunk.arc(center.x, center.y, radius, 0, 2 * Math.PI);
  include(center, radius + width);
  ctx.lineCap = 'round';
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = width + 2 * edge;
  ctx.stroke(trunk);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(trunk);

  for (const limb of figure.limbs) {
    for (const p of limb.points) include(p, width);
    const end = limb.points[limb.points.length - 1];

    const outline = new Path2D();
    polyline(outline, trimStart(limb.points, EDGE_STARTS_AT * width));
    ctx.lineCap = 'butt';
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = width + 2 * edge;
    ctx.stroke(outline);
    // The butt cap leaves the far end square; round it off like the line it edges.
    ctx.fillStyle = edgeColor;
    ctx.beginPath();
    ctx.arc(end.x, end.y, width / 2 + edge, 0, 2 * Math.PI);
    ctx.fill();

    const line = new Path2D();
    polyline(line, limb.points);
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke(line);
  }
  ctx.restore();
  return bounds;
}

/**
 * A dot on the far end of each limb the move scores (elbow, wrist, knee,
 * ankle), while the player is meant to be in the pose. White until that limb
 * is in place, then green. A limb the camera has lost gets a dashed grey ring
 * at the detector's best guess. Nothing is drawn along the limbs: the player
 * can see their own body.
 */
function drawPlayer(surface: CanvasSurface, layout: PlayerBodyLayout, feedback: FeedbackFrame): void {
  const { ctx, ratio } = surface;
  const radius = Math.max(5 * ratio, 0.065 * layout.scale);
  ctx.save();
  for (const c of layout.capsules) {
    const { scored, status } = feedback.limbs[c.part];
    if (!scored || status === 'idle') continue;
    ctx.beginPath();
    ctx.arc(c.b.x, c.b.y, radius, 0, 2 * Math.PI);
    if (status === 'grey') {
      ctx.strokeStyle = CANVAS_COLORS.limb.grey;
      ctx.lineWidth = 2.5 * ratio;
      ctx.setLineDash([4 * ratio, 4 * ratio]);
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = status === 'green' ? CANVAS_COLORS.onTarget : CANVAS_COLORS.chalk;
    ctx.fill();
    ctx.strokeStyle = CANVAS_COLORS.ink;
    ctx.lineWidth = 2 * ratio;
    ctx.stroke();
  }
  ctx.restore();
}

const fontSize = (surface: CanvasSurface, fraction: number, minPx: number, maxPx: number) =>
  Math.round(Math.min(maxPx * surface.ratio, Math.max(minPx * surface.ratio, surface.width * fraction)));

const FONT = '"Archivo Variable", system-ui, sans-serif';

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
}

/** A label beside the limb, with an arrow to the part it names and a ring round that part. */
function drawHint(
  surface: CanvasSurface,
  hint: NonNullable<FeedbackFrame['hint']>,
  landmarks: Landmark[],
  player: PlayerBodyLayout,
  figure: Bounds | null,
): void {
  const anchor = hintAnchor(hint.joint, landmarks, surface);
  if (!anchor || !player.bounds) return;
  const { ctx, width, height, ratio } = surface;
  const color = CANVAS_COLORS.chalk;
  const text = hint.text.charAt(0).toUpperCase() + hint.text.slice(1);

  const size = fontSize(surface, 0.026, 15, 30);
  ctx.save();
  ctx.font = `650 ${size}px ${FONT}`;
  const labelHeight = Math.round(size * 2);
  const labelWidth = Math.ceil(ctx.measureText(text).width) + labelHeight;
  const { label, tail, tip } = layoutHint({
    anchor,
    bodyCenterX: (player.bounds.left + player.bounds.right) / 2,
    scale: player.scale,
    width,
    height,
    labelWidth,
    labelHeight,
    safeTop: height * SAFE_TOP,
    safeBottom: height * SAFE_BOTTOM,
    avoid: figure,
  });

  // Ring round the part to move.
  const ring = Math.max(10 * ratio, 0.2 * player.scale);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * ratio;
  ctx.beginPath();
  ctx.arc(anchor.x, anchor.y, ring, 0, 2 * Math.PI);
  ctx.stroke();

  // Arrow from the label to the ring.
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const end = { x: anchor.x - Math.cos(angle) * ring, y: anchor.y - Math.sin(angle) * ring };
  const head = Math.max(9 * ratio, 0.09 * player.scale);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tail.x, tail.y);
  ctx.lineTo(end.x - Math.cos(angle) * head * 0.6, end.y - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - Math.cos(angle - 0.45) * head, end.y - Math.sin(angle - 0.45) * head);
  ctx.lineTo(end.x - Math.cos(angle + 0.45) * head, end.y - Math.sin(angle + 0.45) * head);
  ctx.closePath();
  ctx.fill();

  // The label.
  ctx.fillStyle = CANVAS_COLORS.scrim;
  pill(ctx, label.x, label.y, label.width, label.height);
  ctx.fill();
  ctx.lineWidth = 2 * ratio;
  ctx.stroke();
  ctx.fillStyle = CANVAS_COLORS.chalk;
  drawText(surface, text, label.x + label.width / 2, label.y + label.height / 2 + size * 0.04);
  ctx.restore();
}

/** The warning shown instead of scoring silently when a scored joint is out of view. */
function drawLowVisibility(surface: CanvasSurface, appear: number, avoid: readonly Bounds[]): void {
  const { ctx, width, height, ratio } = surface;
  const size = fontSize(surface, 0.03, 16, 34);
  ctx.save();
  ctx.font = `650 ${size}px ${FONT}`;
  const textWidth = ctx.measureText(LOW_VISIBILITY_MESSAGE).width;
  const h = Math.round(size * 2.3);
  const dot = size * 0.32;
  const w = Math.min(width - 32 * ratio, Math.ceil(textWidth + h + dot * 3));
  const banner = layoutBanner({
    width,
    height,
    bannerWidth: w,
    bannerHeight: h,
    safeTop: height * SAFE_TOP,
    safeBottom: height * SAFE_BOTTOM,
    avoid,
  });
  const x = banner.x;
  const y = banner.y + (1 - appear) * 8 * ratio;

  ctx.globalAlpha = appear;
  ctx.fillStyle = CANVAS_COLORS.scrim;
  pill(ctx, x, y, w, h);
  ctx.fill();
  ctx.strokeStyle = CANVAS_COLORS.limb.grey;
  ctx.lineWidth = 2 * ratio;
  ctx.stroke();

  // A grey dot ties the message to the greyed limbs. It sits at the line's
  // start on screen, which is the far end in a mirrored canvas.
  const dotX = surface.mirrored ? x + w - h / 2 : x + h / 2;
  ctx.fillStyle = CANVAS_COLORS.limb.grey;
  ctx.beginPath();
  ctx.arc(dotX, y + h / 2, dot, 0, 2 * Math.PI);
  ctx.fill();

  ctx.fillStyle = CANVAS_COLORS.chalk;
  const textCenter = x + w / 2 + (surface.mirrored ? -1 : 1) * (dot * 1.5);
  drawText(surface, LOW_VISIBILITY_MESSAGE, textCenter, y + h / 2 + size * 0.04);
  ctx.restore();
}
