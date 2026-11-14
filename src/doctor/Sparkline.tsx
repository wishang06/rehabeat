import { sparkPoints } from './editor';

const WIDTH = 96;
const HEIGHT = 34;
const PAD = 5;

interface SparklineProps {
  /** A finding's value in each of the last few sessions, oldest first. */
  series: readonly number[];
  tone: 'cyan' | 'pink' | 'dim';
}

/** A small trend line with its last point marked. Decoration for the sentence beside it, so hidden from screen readers. */
export function Sparkline({ series, tone }: SparklineProps) {
  const points = sparkPoints(series, WIDTH, HEIGHT, PAD);
  const last = points.at(-1);
  return (
    <svg className={`doc-spark doc-spark--${tone}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true">
      <line className="doc-spark__base" x1={PAD} y1={HEIGHT - PAD} x2={WIDTH - PAD} y2={HEIGHT - PAD} />
      {points.length > 1 && <polyline points={points.map((point) => point.join(',')).join(' ')} />}
      {last && <circle cx={last[0]} cy={last[1]} r={3.5} />}
    </svg>
  );
}
