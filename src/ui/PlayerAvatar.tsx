import { critterFor, type Species } from './avatar';

interface PlayerAvatarProps {
  /** A stable id; the same id always draws the same critter. */
  seed: string;
  className?: string;
}

const INK = '#23164d';

/** A player's critter on a rounded tile. Decorative: the name sits next to it. */
export function PlayerAvatar({ seed, className }: PlayerAvatarProps) {
  const { species, color } = critterFor(seed);
  return (
    <svg
      className={className ? `critter ${className}` : 'critter'}
      viewBox="0 0 64 64"
      aria-hidden="true"
      data-species={species}
    >
      <rect width="64" height="64" rx="16" fill={color.tile} />
      <Ears species={species} body={color.body} shade={color.shade} />
      <ellipse cx="32" cy="40" rx="21" ry="19" fill={color.body} />
      {/* Belly patch */}
      <ellipse cx="32" cy="49" rx="11" ry="7.5" fill="#fff" opacity="0.45" />
      <Face species={species} shade={color.shade} />
    </svg>
  );
}

function Ears({ species, body, shade }: { species: Species; body: string; shade: string }) {
  switch (species) {
    case 'bear':
      return (
        <g>
          <circle cx="16" cy="24" r="8" fill={body} />
          <circle cx="48" cy="24" r="8" fill={body} />
          <circle cx="16" cy="24" r="4" fill={shade} />
          <circle cx="48" cy="24" r="4" fill={shade} />
        </g>
      );
    case 'cat':
      return (
        <g>
          <path d="M13 31 L16 12 L28 23 Z" fill={body} strokeLinejoin="round" />
          <path d="M51 31 L48 12 L36 23 Z" fill={body} strokeLinejoin="round" />
          <path d="M17 26 L18 17 L24 23 Z" fill={shade} />
          <path d="M47 26 L46 17 L40 23 Z" fill={shade} />
        </g>
      );
    case 'bunny':
      return (
        <g>
          <ellipse cx="23" cy="15" rx="5.5" ry="13" fill={body} transform="rotate(-10 23 15)" />
          <ellipse cx="41" cy="15" rx="5.5" ry="13" fill={body} transform="rotate(10 41 15)" />
          <ellipse cx="23" cy="16" rx="2.5" ry="8.5" fill={shade} transform="rotate(-10 23 16)" />
          <ellipse cx="41" cy="16" rx="2.5" ry="8.5" fill={shade} transform="rotate(10 41 16)" />
        </g>
      );
    case 'frog':
      // Eye bumps; the eyes themselves are drawn by Face, higher up than usual.
      return (
        <g>
          <circle cx="22" cy="25" r="9" fill={body} />
          <circle cx="42" cy="25" r="9" fill={body} />
        </g>
      );
    case 'chick':
      return <path d="M30 22 C27 14 31 11 32 18 C33 10 38 12 34 22 Z" fill={shade} />;
    case 'monster':
      return (
        <g>
          <path d="M22 26 L19 11 L28 22 Z" fill={shade} />
          <path d="M42 26 L45 11 L36 22 Z" fill={shade} />
        </g>
      );
  }
}

function Face({ species, shade }: { species: Species; shade: string }) {
  const eyeY = species === 'frog' ? 25 : 37;
  const eyeDx = species === 'frog' ? 10 : 8;
  const eyeR = species === 'monster' ? 0 : 4.6;
  return (
    <g>
      {species === 'monster' ? (
        // One big eye.
        <g>
          <circle cx="32" cy="36" r="8" fill="#fff" />
          <circle cx="33" cy="37" r="4.5" fill={INK} />
          <circle cx="34.6" cy="35.2" r="1.6" fill="#fff" />
        </g>
      ) : (
        [-1, 1].map((side) => (
          <g key={side}>
            <circle cx={32 + side * eyeDx} cy={eyeY} r={eyeR} fill="#fff" />
            <circle cx={32 + side * eyeDx + 0.8} cy={eyeY + 0.8} r={2.7} fill={INK} />
            <circle cx={32 + side * eyeDx + 1.9} cy={eyeY - 0.6} r={1} fill="#fff" />
          </g>
        ))
      )}

      {/* Cheeks */}
      <circle cx="19" cy="45" r="3.4" fill="#ff6f91" opacity="0.45" />
      <circle cx="45" cy="45" r="3.4" fill="#ff6f91" opacity="0.45" />

      {species === 'chick' ? (
        <path d="M27.5 44 L36.5 44 L32 49.5 Z" fill="#ff9d2e" stroke={shade} strokeWidth="0.8" strokeLinejoin="round" />
      ) : species === 'cat' || species === 'bunny' ? (
        <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round">
          <path d="M28.5 45 Q30.5 47.5 32 45 Q33.5 47.5 35.5 45" />
          <circle cx="32" cy="43" r="1.4" fill={INK} stroke="none" />
        </g>
      ) : (
        <path
          d={species === 'frog' ? 'M24 41 Q32 48 40 41' : 'M27.5 44 Q32 49 36.5 44'}
          fill="none"
          stroke={INK}
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}
