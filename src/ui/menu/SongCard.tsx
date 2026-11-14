import { useId, type CSSProperties, type PointerEvent } from 'react';
import { DIFFICULTIES, formatDuration, type SongMeta } from '../../songs/model';
import { DIFFICULTY_LABEL, DIFFICULTY_LEVEL, beatPeriod } from './menuModel';

interface SongCardProps {
  song: SongMeta;
  /** Position in the shown catalogue, read back by the menu's key handling. */
  index: number;
  selected: boolean;
  /** Its preview is playing. */
  previewing: boolean;
  /** The card that takes Tab focus in this catalogue (roving tabindex). */
  tabbable: boolean;
  buttonRef(element: HTMLButtonElement | null): void;
  onFocus(): void;
  onPointerMove(event: PointerEvent<HTMLButtonElement>): void;
  onPointerLeave(): void;
  onPointerDown(event: PointerEvent<HTMLButtonElement>): void;
  onClick(): void;
}

const PIPS = DIFFICULTIES.length;

/**
 * One song: its tempo (with a lamp blinking on the beat), length, title,
 * artist and difficulty. The whole card is the button: clicking it, or Enter
 * while it has focus, plays the song.
 */
export function SongCard({
  song,
  index,
  selected,
  previewing,
  tabbable,
  buttonRef,
  onFocus,
  onPointerMove,
  onPointerLeave,
  onPointerDown,
  onClick,
}: SongCardProps) {
  const id = useId();
  const level = DIFFICULTY_LEVEL[song.difficulty];

  return (
    <li className="menu-card__slot">
      <button
        ref={buttonRef}
        type="button"
        className="menu-card"
        data-testid={`song-card-${song.id}`}
        data-card-index={index}
        data-selected={selected}
        data-previewing={previewing}
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected ? 'true' : undefined}
        aria-labelledby={`${id}-title ${id}-artist`}
        aria-describedby={`${id}-tempo ${id}-time ${id}-level`}
        style={{ '--beat': beatPeriod(song.bpm) } as CSSProperties}
        onFocus={onFocus}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        <span className="menu-card__top">
          <span className="menu-card__tempo" id={`${id}-tempo`}>
            <span className="menu-card__lamp" aria-hidden="true" />
            <span className="menu-card__bpm">{Math.round(song.bpm)}</span> BPM
          </span>
          <span className="menu-card__time" id={`${id}-time`}>
            {formatDuration(song.durationSec)}
          </span>
        </span>

        <span className="menu-card__title" id={`${id}-title`}>
          {song.title}
        </span>
        <span className="menu-card__artist" id={`${id}-artist`}>
          {song.artist}
        </span>

        <span className="menu-card__foot">
          <span className="menu-card__level" data-level={song.difficulty} id={`${id}-level`}>
            <span className="menu-card__pips" aria-hidden="true">
              {Array.from({ length: PIPS }, (_, pip) => (
                <span key={pip} className="menu-card__pip" data-on={pip < level} />
              ))}
            </span>
            {DIFFICULTY_LABEL[song.difficulty]}
          </span>
          <span className="menu-card__play button button--primary button--quiet" aria-hidden="true">
            <svg viewBox="0 0 10 12" className="menu-card__play-icon">
              <path d="M1 1.2v9.6a.7.7 0 0 0 1.06.6l7.6-4.8a.7.7 0 0 0 0-1.2l-7.6-4.8A.7.7 0 0 0 1 1.2Z" />
            </svg>
            Play
          </span>
        </span>
      </button>
    </li>
  );
}
