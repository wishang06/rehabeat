/**
 * The Play screen's canvas overlay, drawn once per display frame from a
 * FeedbackFrame: the gold target figure, the player's own body coloured limb
 * by limb, a hint callout, and the low-visibility warning.
 *
 * Geometry is laid out in camera-image pixels; the stage mirrors the canvas
 * with the video (selfie view), and text is flipped back by drawText.
 */
import {
  FigureEaser,
  LIMBS,
  REST_POSE,
  bodyFromLandmarks,
  buildSilhouette,
  capsuleOutline,
  figureOffset,
  inflateSilhouette,
  hintAnchor,
  layoutBanner,
  layoutHint,
  layoutPlayerBody,
  needsOffset,
  poseForMove,
  silhouetteBounds,
  steadyBody,
  translateSilhouette,
  type Bounds,
  type Capsule,
  type PlayerBodyLayout,
  type Side,
  type Silhouette,
  type SilhouettePose,
} from '../engine';
import type { JointName, Landmark } from '../types';
import type { FeedbackFrame, LimbStatus } from '../types/ui';
import { CANVAS_COLORS, drawText, type CanvasSurface } from './canvas';

export const LOW_VISIBILITY_MESSAGE = 'Step back so your whole body is in frame';

/** Figure opacity through each phase: a preview in the count-in, solid in the hold, fading as you release. */
function figureAlpha(feedback: FeedbackFrame): number {
  switch (feedback.phase) {
    case 'ready':
      return 0.4;
    case 'reach':
      return 0.6 + 0.4 * feedback.phaseProgress;
    case 'hold':
      return 1;
    case 'release':
      return 1 - 0.55 * feedback.phaseProgress;
  }
}

/** HUD panels sit in the top and bottom corners; canvas text stays in the band between. */
const SAFE_TOP = 0.2;
const SAFE_BOTTOM = 0.27;

/** Glow bands round the figure, as [reach in body scales, opacity]: wide and faint, then tighter. */
const GLOW: readonly (readonly [number, number])[] = [
  [0.15, 0.1],
  [0.08, 0.16],
];
/** The figure's brighter edge, in CSS pixels. */
const EDGE_PX = 3;
/** When a shoulder or hip is too unsure to anchor the figure, try again down to this. */
const FALLBACK_ANCHOR_VISIBILITY = 0.1;

function traceCapsule(path: Path2D, c: Capsule): void {
  const outline = capsuleOutline(c);
  if (outline.kind === 'circle') {
    path.moveTo(outline.center.x + outline.radius, outline.center.y);
    path.arc(outline.center.x, outline.center.y, outline.radius, 0, 2 * Math.PI);
    return;
  }
  const { a, b, ra, rb } = outline;
  path.moveTo(a.x + ra * Math.cos(outline.aStart), a.y + ra * Math.sin(outline.aStart));
  path.arc(a.x, a.y, ra, outline.aStart, outline.aEnd);
  path.arc(b.x, b.y, rb, outline.bStart, outline.bEnd);
  path.closePath();
}

/** Every shape of the figure in one path. All are wound clockwise, so one fill paints their union once. */
function silhouettePath(s: Silhouette): Path2D {
  const path = new Path2D();
  for (const c of s.capsules) traceCapsule(path, c);
  path.moveTo(s.torso[0].x, s.torso[0].y);
  for (const p of s.torso.slice(1)) path.lineTo(p.x, p.y);
  path.closePath();
  const { center, radius } = s.head;
  path.moveTo(center.x + radius, center.y);
  path.arc(center.x, center.y, radius, 0, 2 * Math.PI);
  return path;
}

function targetJoints(feedback: FeedbackFrame): Partial<Record<JointName, number>> {
  const joints: Partial<Record<JointName, number>> = {};
  for (const { limb, joint } of LIMBS) {
    const target = feedback.limbs[limb].targetDeg;
    if (target !== null) joints[joint] = target;
  }
  return joints;
}

function poseKey(pose: SilhouettePose): string {
  return Object.values(pose).join(',');
}

export class PlayOverlay {
  private readonly easer = new FigureEaser();
  private side: Side | null = null;
  private offsetCache = { key: '', value: false };
  private lowVisibilitySince: number | null = null;
  /** Where the figure was drawn this frame, so the hint label can keep off it. */
  private figureBounds: Bounds | null = null;

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
    // The banner keeps off the limbs being scored, which are the ones it is warning about.
    const scoredLimbs: Bounds[] = [];
    if (landmarks) {
      // Lost scored limbs are drawn at the detector's best guess, greyed, so the player sees which.
      const keep = new Set(LIMBS.filter(({ limb }) => feedback.limbs[limb].status === 'grey').map(({ limb }) => limb));
      const player = layoutPlayerBody(landmarks, surface, { keep });
      this.drawFigure(surface, feedback, landmarks, world, player, nowMs);
      drawPlayer(surface, player, feedback);
      if (feedback.hint) drawHint(surface, feedback.hint, landmarks, player, this.figureBounds);
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

  private needsOffset(pose: SilhouettePose): boolean {
    const key = poseKey(pose);
    if (key !== this.offsetCache.key) this.offsetCache = { key, value: needsOffset(pose) };
    return this.offsetCache.value;
  }

  private drawFigure(
    surface: CanvasSurface,
    feedback: FeedbackFrame,
    landmarks: Landmark[],
    world: Landmark[] | null,
    player: PlayerBodyLayout,
    nowMs: number,
  ): void {
    const target = poseForMove({ joints: targetJoints(feedback) });
    // Where the figure sits follows the move's target pose, so it stays put through the release.
    const offset = this.needsOffset(target) ? 1 : 0;
    // In the release the figure shows where to go back to: rest.
    const shown = feedback.phase === 'release' ? REST_POSE : target;
    const eased = this.easer.update({ pose: shown, offset }, nowMs);

    this.figureBounds = null;
    // Keep showing the target when part of the player is out of view: that's when they need it
    // most. Guessed anchors can collapse the body, so that fallback is steadied first.
    const unsure = bodyFromLandmarks(landmarks, surface, world, FALLBACK_ANCHOR_VISIBILITY);
    const body = bodyFromLandmarks(landmarks, surface, world) ?? (unsure && steadyBody(unsure));
    if (!body) return;
    let silhouette = buildSilhouette(eased.pose, body);
    if (eased.offset > 0 && player.bounds) {
      const { dx, side } = figureOffset({
        figure: silhouetteBounds(silhouette),
        player: player.bounds,
        canvasWidth: surface.width,
        gap: 0.2 * player.scale,
        previousSide: this.side,
      });
      this.side = side;
      silhouette = translateSilhouette(silhouette, dx * eased.offset, 0);
    } else if (eased.offset === 0) {
      this.side = null;
    }

    const colors = feedback.onTarget ? CANVAS_COLORS.figureMatched : CANVAS_COLORS.figure;
    this.figureBounds = silhouetteBounds(silhouette);
    this.drawSilhouette(surface, silhouette, colors, figureAlpha(feedback), player.scale);
  }

  /**
   * Draws the figure as one solid shape: the glow and edge are stroked, the
   * inside is cut out so no seam between overlapping parts shows, and the
   * translucent fill goes in. The cut-out erases whatever is under the
   * figure, so it must be the first thing drawn on a freshly cleared canvas.
   *
   * Building the figure on a scratch canvas and compositing it in would look
   * the same, but copying that canvas every frame measured ~15 ms of GPU time
   * on an integrated GPU, which the pose model shares.
   */
  private drawSilhouette(
    surface: CanvasSurface,
    s: Silhouette,
    colors: (typeof CANVAS_COLORS)['figure'],
    alpha: number,
    scale: number,
  ): void {
    if (alpha <= 0) return;
    const { ctx, ratio } = surface;
    const path = silhouettePath(s);
    ctx.save();
    // Glow and edge are fills of grown copies of the figure; the cut-out below
    // leaves only the bands outside it. Wide strokes of this many arcs cost
    // several times more to raster.
    ctx.fillStyle = colors.glow;
    for (const [reach, opacity] of GLOW) {
      ctx.globalAlpha = opacity * alpha;
      ctx.fill(silhouettePath(inflateSilhouette(s, reach * scale)));
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors.edge;
    ctx.fill(silhouettePath(inflateSilhouette(s, EDGE_PX * ratio)));
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(path);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colors.fill;
    ctx.fill(path);
    ctx.restore();
  }
}

/** The player's own limbs in the figure's capsule style, coloured by status, over a faint torso outline. */
function drawPlayer(surface: CanvasSurface, layout: PlayerBodyLayout, feedback: FeedbackFrame): void {
  const { ctx, ratio } = surface;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (layout.torso) {
    ctx.strokeStyle = CANVAS_COLORS.chalk;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2 * ratio;
    ctx.beginPath();
    layout.torso.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
  }

  // One path per colour keeps this to a few draw calls; the pose model shares the GPU.
  const groups = new Map<LimbStatus, { path: Path2D; glow: Path2D }>();
  for (const c of layout.capsules) {
    const status = feedback.limbs[c.part].status;
    let group = groups.get(status);
    if (!group) groups.set(status, (group = { path: new Path2D(), glow: new Path2D() }));
    traceCapsule(group.path, c);
    const reach = 0.06 * layout.scale;
    traceCapsule(group.glow, { ...c, ra: c.ra + reach, rb: c.rb + reach });
  }

  for (const status of STATUS_ORDER) {
    const group = groups.get(status);
    if (!group) continue;
    const color = CANVAS_COLORS.limb[status];
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    // Soft glow on limbs that need attention.
    if (status === 'amber' || status === 'red') {
      ctx.globalAlpha = 0.22;
      ctx.fill(group.glow);
    }
    ctx.globalAlpha = status === 'idle' ? 0.35 : status === 'grey' ? 0.45 : 0.6;
    ctx.fill(group.path);
    ctx.globalAlpha = status === 'idle' ? 0.7 : 0.95;
    ctx.lineWidth = 2.5 * ratio;
    // A dashed edge marks a limb the camera can't see well enough to score.
    ctx.setLineDash(status === 'grey' ? [6 * ratio, 5 * ratio] : []);
    ctx.stroke(group.path);
  }
  ctx.restore();
}

/** Calmest first, so the limbs that need fixing are drawn on top. */
const STATUS_ORDER: readonly LimbStatus[] = ['idle', 'grey', 'green', 'amber', 'red'];

const fontSize = (surface: CanvasSurface, fraction: number, minPx: number, maxPx: number) =>
  Math.round(Math.min(maxPx * surface.ratio, Math.max(minPx * surface.ratio, surface.width * fraction)));

const FONT = '"Archivo Variable", system-ui, sans-serif';

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
}

/** A label beside the limb with an arrow to the part it names, ringed in the limb's status colour. */
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
  const color = CANVAS_COLORS.limb[hint.status];
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
