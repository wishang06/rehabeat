/**
 * The avatar glyphs, on a 64 x 64 grid. Each is a piece of the cabinet: the
 * gold figure, a star from the results, the beat dial, LED segments, the
 * tempo rod. Panels and bars lean like the UI (SLANT), corners are square,
 * and the light is the theme's: gold, cyan and white, with pink only as an
 * accent. Avatar.tsx puts each on the void and adds the glow.
 */
import type { ReactElement } from 'react';
import type { AvatarId } from './avatars';

/** The theme's tokens (src/styles/theme.css). SVG presentation attributes can't read CSS variables. */
export const INK = {
  void: '#05060c',
  deck2: '#151c36',
  deck3: '#242d50',
  gold: '#ffd23f',
  cyan: '#27e0f0',
  pink: '#ff2e88',
  white: '#eef2ff',
} as const;

/** Every panel leans this way (--slant). */
const SLANT = 'skewX(-10)';

/** Leans a glyph about its own centre, so it stays where it was drawn. */
const lean = (cx: number, cy: number) => `translate(${cx} ${cy}) ${SLANT} translate(${-cx} ${-cy})`;

function starPoints(outer: number, inner: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

/** A point on a circle, with 0 at the top and going clockwise, as a fraction of a turn. */
function onCircle(cx: number, cy: number, r: number, turn: number): [number, number] {
  const a = -Math.PI / 2 + turn * 2 * Math.PI;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const HEART = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];

const GLYPHS: Record<AvatarId, () => ReactElement> = {
  // The target figure, arms overhead.
  figure: () => (
    <g stroke={INK.gold} strokeWidth="6.5" strokeLinecap="round" fill="none">
      <path d="M29 25 L21 10 M35 25 L43 10" />
      <path d="M32 24 L32 39" strokeWidth="8.5" />
      <path d="M30 39 L25 55 M34 39 L39 55" />
      <circle cx="32" cy="15" r="5" fill={INK.gold} stroke="none" />
    </g>
  ),

  star: () => <polygon points={starPoints(22, 9.2)} transform={`translate(32 34) ${SLANT}`} fill={INK.gold} />,

  bolt: () => <polygon points="38,6 15,36 29,36 24,58 49,25 35,25 42,6" fill={INK.cyan} />,

  // Two beamed eighth notes.
  note: () => (
    <g fill={INK.cyan}>
      <ellipse cx="21" cy="47" rx="6.5" ry="4.8" transform="rotate(-22 21 47)" />
      <ellipse cx="43" cy="41" rx="6.5" ry="4.8" transform="rotate(-22 43 41)" />
      <rect x="25.5" y="15" width="3.6" height="32" />
      <rect x="47.5" y="9" width="3.6" height="32" />
      <polygon points="25.5,15 51.1,9 51.1,17 25.5,23" fill={INK.white} />
    </g>
  ),

  // The match ring: cyan past Good, with the Good and Perfect marks.
  ring: () => {
    const marks = [0.6, 0.85].map((turn) => [onCircle(32, 32, 14, turn), onCircle(32, 32, 26, turn)] as const);
    return (
      <g fill="none">
        <circle cx="32" cy="32" r="20" stroke={INK.deck3} strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r="20"
          stroke={INK.cyan}
          strokeWidth="7"
          pathLength={100}
          strokeDasharray="72 100"
          transform="rotate(-90 32 32)"
        />
        {marks.map(([[x1, y1], [x2, y2]], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i === 1 ? INK.gold : INK.white} strokeWidth="3" />
        ))}
        <rect x="27" y="27" width="10" height="10" fill={INK.gold} transform={lean(32, 32)} />
      </g>
    );
  },

  crown: () => (
    <g fill={INK.gold} transform={lean(32, 34)}>
      <polygon points="11,44 9,17 22,30 32,11 42,30 55,17 53,44" />
      <rect x="11" y="47" width="42" height="7" />
      <rect x="29" y="35" width="6" height="6" fill={INK.void} />
    </g>
  ),

  // LED dots in a pixel heart.
  heart: () => (
    <g fill={INK.pink}>
      {HEART.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === 'X' ? <rect key={`${x}-${y}`} x={11 + x * 6} y={15 + y * 6} width="5" height="5" /> : null,
        ),
      )}
    </g>
  ),

  // Equaliser columns of slanted LED segments, the tallest topped in gold.
  eq: () => {
    const heights = [3, 5, 4, 6, 2];
    const tallest = Math.max(...heights);
    return (
      <g transform={lean(32, 32)}>
        {heights.flatMap((count, column) =>
          Array.from({ length: count }, (_, segment) => (
            <rect
              key={`${column}-${segment}`}
              x={10 + column * 9.5}
              y={52 - segment * 7.5 - 5.5}
              width="7"
              height="5.5"
              fill={count === tallest && segment === count - 1 ? INK.gold : INK.cyan}
            />
          )),
        )}
      </g>
    );
  },

  // The tempo rod with its cyan notches and the gold diamond on the selected tempo.
  diamond: () => (
    <g>
      <rect x="30" y="6" width="4" height="52" fill={INK.deck3} />
      <rect x="25" y="13" width="14" height="4" fill={INK.cyan} />
      <rect x="25" y="47" width="14" height="4" fill={INK.cyan} />
      <rect x="22" y="22" width="20" height="20" fill={INK.gold} transform="rotate(45 32 32)" />
    </g>
  ),

  // The title screen's three lanes, with notes riding them.
  lanes: () => (
    <g transform={lean(32, 32)}>
      <rect x="12" y="6" width="11" height="52" fill={INK.deck2} />
      <rect x="26.5" y="6" width="11" height="52" fill={INK.deck3} />
      <rect x="41" y="6" width="11" height="52" fill={INK.deck2} />
      <rect x="12" y="16" width="11" height="6" fill={INK.cyan} />
      <rect x="26.5" y="33" width="11" height="6" fill={INK.gold} />
      <rect x="41" y="44" width="11" height="6" fill={INK.white} />
    </g>
  ),

  chevrons: () => (
    <g fill="none" strokeWidth="6.5" strokeLinejoin="miter" strokeLinecap="square">
      <polyline points="12,18 24,32 12,46" stroke={INK.cyan} opacity="0.55" />
      <polyline points="25,18 37,32 25,46" stroke={INK.cyan} />
      <polyline points="38,18 50,32 38,46" stroke={INK.gold} />
    </g>
  ),

  // The streak's flame: gold, with a pink core.
  flame: () => (
    <g>
      <path
        d="M33 5 C41 17 50 24 48 40 C47 52 40 58 32 58 C24 58 16 52 16 41 C16 31 22 26 25 17 C29 23 30 27 31 31 C34 22 35 14 33 5 Z"
        fill={INK.gold}
      />
      <path d="M32 31 C37 38 41 42 40 48 C39 54 36 56 32 56 C28 56 24 53 24 48 C24 43 28 40 32 31 Z" fill={INK.pink} />
    </g>
  ),

  // Beat pips: two beats gone, the beat now lit, one to come.
  pips: () => (
    <g transform={lean(32, 32)}>
      {[INK.cyan, INK.cyan, INK.gold, INK.deck3].map((fill, i) => (
        <rect key={i} x={9 + i * 12} y="22" width="9" height="20" fill={fill} />
      ))}
      <rect x="9" y="46" width="45" height="4" fill={INK.white} opacity="0.5" />
    </g>
  ),

  // The hint arrow.
  arrow: () => <polygon points="32,6 54,30 41,30 41,57 23,57 23,30 10,30" fill={INK.cyan} transform={lean(32, 32)} />,

  // The top grade, in the display face.
  ace: () => (
    <text
      x="33"
      y="54"
      textAnchor="middle"
      fill={INK.gold}
      fontFamily="'Barlow Condensed', 'Arial Narrow', sans-serif"
      fontStyle="italic"
      fontWeight="800"
      fontSize="58"
    >
      S
    </text>
  ),

  // The beat dial: eight ticks, three lit, and the phase filling in gold.
  dial: () => {
    const ticks = Array.from({ length: 8 }, (_, i) => [onCircle(32, 32, 23, i / 8), onCircle(32, 32, 28, i / 8)] as const);
    return (
      <g fill="none">
        <circle cx="32" cy="32" r="15" stroke={INK.deck3} strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r="15"
          stroke={INK.gold}
          strokeWidth="6"
          pathLength={100}
          strokeDasharray="40 100"
          transform="rotate(-90 32 32)"
        />
        {ticks.map(([[x1, y1], [x2, y2]], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={i < 3 ? INK.cyan : INK.white} strokeOpacity={i < 3 ? 1 : 0.3} strokeWidth="3.5" />
        ))}
      </g>
    );
  },
};

export function AvatarGlyph({ id }: { id: AvatarId }) {
  const Glyph = GLYPHS[id];
  return <Glyph />;
}
