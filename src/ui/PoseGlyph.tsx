import { computeGhost } from '../moves';
import { LM } from '../pose';
import type { Landmark, Move } from '../types';

const WIDTH = 100;
const HEIGHT = 128;

// A figure facing the viewer, as the camera sees it: the player's left is on the right.
const SHOULDER_Y = 36;
const HIP_Y = 68;
const FOOT_Y = 122;
const JOINTS = {
  leftShoulder: { x: 63, y: SHOULDER_Y },
  rightShoulder: { x: 37, y: SHOULDER_Y },
  leftHip: { x: 57, y: HIP_Y },
  rightHip: { x: 43, y: HIP_Y },
};

function standingLandmarks(): Landmark[] {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const place = (index: number, point: { x: number; y: number }) => {
    landmarks[index] = { x: point.x / WIDTH, y: point.y / HEIGHT, z: 0, visibility: 1 };
  };
  place(LM.leftShoulder, JOINTS.leftShoulder);
  place(LM.rightShoulder, JOINTS.rightShoulder);
  place(LM.leftHip, JOINTS.leftHip);
  place(LM.rightHip, JOINTS.rightHip);
  return landmarks;
}

const points = (line: { x: number; y: number }[]) => line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

/**
 * A small figure showing a move's target pose. The targeted limbs come from the
 * same geometry as the in-game ghost, so the picture always matches moves.json.
 */
export function PoseGlyph({ move }: { move: Move }) {
  const target = computeGhost(move, standingLandmarks(), { width: WIDTH, height: HEIGHT });

  // Limbs the move leaves alone hang at rest.
  const { leftShoulder, rightShoulder, leftHip, rightHip } = JOINTS;
  const rest: { x: number; y: number }[][] = [];
  if (move.joints.leftShoulder === undefined) rest.push([leftShoulder, { x: leftShoulder.x + 5, y: HIP_Y - 2 }]);
  if (move.joints.rightShoulder === undefined) rest.push([rightShoulder, { x: rightShoulder.x - 5, y: HIP_Y - 2 }]);
  if (move.joints.leftHip === undefined) rest.push([leftHip, { x: leftHip.x, y: FOOT_Y }]);
  if (move.joints.rightHip === undefined) rest.push([rightHip, { x: rightHip.x, y: FOOT_Y }]);

  return (
    <svg className="glyph" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${move.name} target pose`}>
      <g className="glyph__body">
        <circle cx={WIDTH / 2} cy={20} r={8.5} />
        <polygon points={points([leftShoulder, rightShoulder, rightHip, leftHip])} />
        {rest.map((line, index) => (
          <polyline key={index} points={points(line)} />
        ))}
      </g>
      <g className="glyph__target">
        {target.map((limb, index) => (
          <polyline key={`glow-${index}`} className="glyph__glow" points={points(limb)} />
        ))}
        {target.map((limb, index) => (
          <polyline key={index} points={points(limb)} />
        ))}
        {target.flatMap((limb, index) =>
          limb.slice(1).map((joint, jointIndex) => (
            <circle
              key={`${index}-${jointIndex}`}
              className="glyph__joint"
              cx={joint.x}
              cy={joint.y}
              r={jointIndex === limb.length - 2 ? 4 : 3}
            />
          )),
        )}
      </g>
    </svg>
  );
}
