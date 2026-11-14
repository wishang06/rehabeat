import type { CSSProperties, ReactNode, Ref } from 'react';
import { cn } from 'cn';

/** The poses the DOM figure can strike. They mirror the routine's moves. */
export type FigurePose = 'rest' | 'overhead' | 'side' | 'knee';

/** Joint angles in degrees, as the custom properties the .fig rules in theme.css read. */
const POSE: Record<FigurePose, Record<string, number>> = {
  rest: {},
  overhead: { '--arm-l': 168, '--arm-r': 168 },
  side: { '--arm-l': 90, '--arm-r': 90 },
  knee: { '--leg-l': 62, '--shin-l': -62 },
};

/** Arm angles for a pose, for animations that move between rest and the pose. */
export const ARM_REST = 8;
export function armAngle(pose: FigurePose): number {
  return POSE[pose]['--arm-l'] ?? ARM_REST;
}

/** The pose for one of the routine's moves, by its id in moves.json. */
export function poseForMove(moveId: string | null | undefined): FigurePose {
  if (!moveId) return 'rest';
  if (moveId.includes('overhead')) return 'overhead';
  if (moveId.includes('side')) return 'side';
  if (moveId.includes('knee')) return 'knee';
  return 'rest';
}

/** A tapered capsule hanging from (0,0) to (0,len): radius `ra` at the joint, `rb` at the tip. */
const capsule = (len: number, ra: number, rb: number) =>
  `M${-ra} 0A${ra} ${ra} 0 0 1 ${ra} 0L${rb} ${len}A${rb} ${rb} 0 0 1 ${-rb} ${len}Z`;

const NECK = capsule(24, 11, 12);
const UPPER_ARM = capsule(66, 13, 10);
const FOREARM = capsule(62, 10, 7.5);
const THIGH = capsule(86, 16, 12.5);
const SHIN = capsule(84, 13, 9);
const TORSO = 'M86 88H154Q166 88 164 100L150 206Q148 218 136 218H104Q92 218 90 206L76 100Q74 88 86 88Z';

/** Room for arms held out to the side; otherwise the box hugs the body. */
const WIDE_BOX = '-70 -42 380 444';
const NARROW_BOX = '0 -42 240 444';

const arm = (side: 'l' | 'r') => (
  <g data-part={`arm-${side}`}>
    <path d={UPPER_ARM} />
    <g transform="translate(0 66)">
      <g data-part="fore">
        <path d={FOREARM} />
      </g>
    </g>
  </g>
);

const leg = (side: 'l' | 'r') => (
  <g data-part={`leg-${side}`}>
    <path d={THIGH} />
    <g transform="translate(0 86)">
      <g data-part={`shin-${side}`}>
        <path d={SHIN} />
      </g>
    </g>
  </g>
);

/** One copy of the whole body. */
function body(layer: string): ReactNode {
  return (
    <g data-layer={layer}>
      <circle cx="120" cy="40" r="27" />
      <path d={NECK} transform="translate(120 60)" />
      <path d={TORSO} />
      <g transform="translate(80 102)">{arm('l')}</g>
      {/* The right side is the left side mirrored, so one positive angle lifts either arm outward. */}
      <g transform="translate(160 102) scale(-1 1)">{arm('r')}</g>
      <g transform="translate(101 212)">{leg('l')}</g>
      <g transform="translate(139 212) scale(-1 1)">{leg('r')}</g>
    </g>
  );
}

interface FigureProps {
  pose?: FigurePose;
  /** A tube of light (outline, dark inside) instead of a solid shape. The default. */
  solid?: boolean;
  /** Add the glow. Leave it off for small or dimmed figures. */
  glow?: boolean;
  /** Use the wide box even for a narrow pose, for a figure that will move into a side raise. */
  wide?: boolean;
  /** Read out for screen readers. Without it the figure is decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<SVGSVGElement>;
}

/**
 * The target figure as DOM: a head, a torso and tapered capsules for the
 * limbs, the same construction the canvas overlay uses for the figure it
 * draws over the camera. This one is an SVG for the landing page, cards and
 * the HUD; it never touches the canvas.
 *
 * Colour comes from --fig, and the inside of the tube from --fig-bg (set it
 * to the colour of whatever the figure stands on).
 */
export function Figure({
  pose = 'rest',
  solid = false,
  glow = true,
  wide = false,
  label,
  className,
  style,
  ref,
}: FigureProps) {
  return (
    <svg
      ref={ref}
      className={cn('fig', !solid && 'fig--tube', glow && 'fig--glow', className)}
      viewBox={wide || pose === 'side' ? WIDE_BOX : NARROW_BOX}
      style={{ ...(POSE[pose] as CSSProperties), ...style }}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {solid ? (
        body('solid')
      ) : (
        <>
          {body('stroke')}
          {body('fill')}
          {body('tint')}
        </>
      )}
    </svg>
  );
}
