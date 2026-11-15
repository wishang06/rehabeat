import { useId } from 'react';
import { AvatarGlyph, INK } from './art';
import { resolveAvatar } from './avatars';

interface AvatarProps {
  /** The avatar the player chose, if any. */
  id: string | null | undefined;
  /** A stable id (the player's): picks the avatar when none was chosen. */
  seed: string;
  className?: string;
}

/** A player's avatar: a neon glyph on the void. Decorative: the name sits next to it. */
export function Avatar({ id, seed, className }: AvatarProps) {
  const avatar = resolveAvatar(id, seed);
  // useId's characters are not all safe inside url(#...).
  const glow = `avatar-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg
      className={className ? `avatar ${className}` : 'avatar'}
      viewBox="0 0 64 64"
      aria-hidden="true"
      data-avatar={avatar}
    >
      <defs>
        <filter id={glow} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="64" height="64" fill={INK.void} />
      <g filter={`url(#${glow})`}>
        <AvatarGlyph id={avatar} />
      </g>
    </svg>
  );
}
