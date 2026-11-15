import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { groupByCatalogue, type Library } from '../../songs/library';
import type { SongMeta } from '../../songs/model';
import { CatalogueRail } from './CatalogueRail';
import { CreditsView } from './CreditsView';
import { EmptyCatalogue } from './EmptyCatalogue';
import { SongCard } from './SongCard';
import {
  catalogueIndexOf,
  definitionFor,
  initialRail,
  missingNote,
  nearestStocked,
  rodPosition,
  rovingCard,
} from './menuModel';
import { columnsFromTops, moveSelection, type MenuFocus, type MenuLayout, type MenuZone } from './navigation';
import { usePreview } from './usePreview';
import './menu.css';

export interface SongMenuProps {
  library: Library;
  /** The song that is selected (focused or hovered last). */
  selectedId: string;
  /** Selection moved (focus, hover, arrows). */
  onSelect(id: string): void;
  /** Enter or click: play this song. */
  onPick(id: string): void;
  /** Esc at the top level. */
  onBack?(): void;
  /** Returns the shared AudioContext, creating it if needed. Only called after the user has interacted with the page. */
  getAudioContext(): AudioContext;
  /** Optional slot rendered above the catalogues. */
  header?: ReactNode;
  /** Focus the selected card when the menu mounts, so Enter plays it straight away. Default true. */
  autoFocus?: boolean;
}

/** A press on a card, remembered from pointerdown to click. */
interface Press {
  id: string;
  pointerType: string;
  wasSelected: boolean;
}

function railPlacement(element: Element | null): MenuLayout['railPlacement'] {
  if (!element) return 'side';
  return getComputedStyle(element).getPropertyValue('--menu-rail').trim() === 'top' ? 'top' : 'side';
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="menu__hint-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path className="menu__hint-cone" d="M2.5 6h2.2L8 3.3v9.4L4.7 10H2.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5Z" />
      {muted ? (
        <path className="menu__hint-wave" d="m10.5 6 3 4m0-4-3 4" />
      ) : (
        <path className="menu__hint-wave" d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.8a6 6 0 0 1 0 8.4" />
      )}
    </svg>
  );
}

/**
 * The song select menu: catalogues on a rail, the chosen catalogue's songs as
 * cards, and the credits. Hovering or focusing a card selects it and plays a
 * short preview; clicking it or pressing Enter picks it.
 */
export function SongMenu({
  library,
  selectedId,
  onSelect,
  onPick,
  onBack,
  getAudioContext,
  header,
  autoFocus = true,
}: SongMenuProps) {
  const groups = useMemo(() => groupByCatalogue(library), [library]);
  const creditsIndex = groups.length;
  const [active, setActive] = useState(() => initialRail(groups, selectedId));
  const shown = Math.min(active, creditsIndex);
  const group = shown < creditsIndex ? groups[shown] : null;
  const songs = group?.songs ?? [];
  const roving = rovingCard(songs, selectedId);
  const preview = usePreview(getAudioContext);

  // A selection made outside the menu (App restoring the last song, say) brings its catalogue into view.
  const [seenSelectedId, setSeenSelectedId] = useState(selectedId);
  if (seenSelectedId !== selectedId) {
    setSeenSelectedId(selectedId);
    const holding = catalogueIndexOf(groups, selectedId);
    if (holding !== -1 && holding !== shown) setActive(holding);
  }

  const baseId = useId();
  const tabId = (index: number) => `${baseId}-tab-${index}`;
  const panelId = `${baseId}-panel`;

  const frameRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const viewRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const hoveredId = useRef<string | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const pendingFocus = useRef<MenuFocus | null>(null);

  const focusTarget = (focus: MenuFocus) => {
    if (focus.zone === 'rail') tabRefs.current[focus.rail]?.focus();
    else if (songs.length > 0) cardRefs.current[focus.card]?.focus();
    else viewRef.current?.focus();
  };

  // Focus that has to wait for a render, such as a card in a catalogue just switched to.
  useEffect(() => {
    const focus = pendingFocus.current;
    if (!focus) return;
    pendingFocus.current = null;
    focusTarget(focus);
  });

  useEffect(() => {
    if (!autoFocus) return;
    const target = songs.length > 0 ? cardRefs.current[roving] : tabRefs.current[shown];
    target?.focus({ preventScroll: true });
    // Only on mount: after that, focus goes where the player puts it.
  }, []);

  const showRail = (index: number) => {
    if (index === shown) return;
    setActive(index);
    const next = index < creditsIndex ? groups[index].songs : [];
    // The preview belongs to the cards on screen.
    if (!next.some((song) => song.id === selectedId)) preview.request(null);
  };

  const select = (song: SongMeta) => {
    if (song.id !== selectedId) onSelect(song.id);
    preview.request(song);
  };

  const pick = (song: SongMeta) => {
    preview.stop();
    onPick(song.id);
  };

  const hover = (song: SongMeta, index: number, event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== 'mouse') return;
    // Content scrolling under a still pointer is not a hover.
    const last = lastPointer.current;
    if (last && last.x === event.clientX && last.y === event.clientY) return;
    lastPointer.current = { x: event.clientX, y: event.clientY };
    if (hoveredId.current === song.id) return;
    hoveredId.current = song.id;

    // While the keyboard is in the grid, focus follows the pointer, so Enter plays the marked card.
    const focused = document.activeElement;
    const card = cardRefs.current[index];
    const inGrid = focused instanceof HTMLElement && focused.dataset.cardIndex !== undefined;
    if (inGrid && card && card !== focused && frameRef.current?.contains(focused)) card.focus({ preventScroll: true });
    else select(song);
  };

  const click = (song: SongMeta) => {
    const pressed = press.current;
    press.current = null;
    // A tap on a card that was not selected selects it and plays its preview; a second tap plays the song.
    if (pressed && pressed.id === song.id && pressed.pointerType !== 'mouse' && !pressed.wasSelected) {
      select(song);
      return;
    }
    pick(song);
  };

  const layout = (): MenuLayout => ({
    railCount: creditsIndex + 1,
    cardCount: songs.length,
    columns: columnsFromTops(
      cardRefs.current.slice(0, songs.length).map((card) => card?.getBoundingClientRect().top ?? 0),
    ),
    railPlacement: railPlacement(frameRef.current),
    contentFocusable: true,
    canGoBack: onBack !== undefined,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    press.current = null;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    // Keys in the header slot are the header's business.
    const zone = target.closest<HTMLElement>('[data-menu-zone]')?.dataset.menuZone as MenuZone | undefined;
    if (!zone) return;

    const { railIndex, cardIndex } = target.dataset;
    const focus: MenuFocus = {
      zone,
      rail: railIndex !== undefined ? Number(railIndex) : shown,
      card: cardIndex !== undefined ? Number(cardIndex) : roving,
    };
    const move = moveSelection(focus, event.key, layout());
    if (!move.handled) return;
    event.preventDefault();

    if (move.effect === 'pick') {
      const song = songs[move.focus.card];
      if (song) pick(song);
    } else if (move.effect === 'back') {
      onBack?.();
    } else if (move.effect === 'focus') {
      if (move.focus.zone === 'rail') showRail(move.focus.rail);
      focusTarget(move.focus);
    }
  };

  // The metronome is set for the selected song: its weight sits on that song's tempo,
  // whichever catalogue is on show.
  const selectedSong: SongMeta | undefined = library.songs[selectedId];
  const selectedIndex = catalogueIndexOf(groups, selectedId);
  const weight =
    selectedSong && selectedIndex !== -1
      ? rodPosition(selectedSong.bpm, selectedIndex, definitionFor(groups[selectedIndex].catalogue.id))
      : null;

  const alternative = group && songs.length === 0 ? nearestStocked(groups, shown) : -1;
  const playingSong = preview.playingId ? library.songs[preview.playingId] : undefined;
  const missing = group && songs.length > 0 ? missingNote(group) : null;

  return (
    <div className="menu" data-testid="song-menu">
      <div className="menu__frame" ref={frameRef} onKeyDown={onKeyDown}>
        {header !== undefined && <div className="menu__header">{header}</div>}

        <CatalogueRail
          groups={groups}
          shown={shown}
          selectedId={selectedId}
          weight={weight}
          tabId={tabId}
          panelId={panelId}
          tabRef={(index, element) => {
            tabRefs.current[index] = element;
          }}
          onChoose={(index) => {
            showRail(index);
            // Safari does not focus a clicked button; the keyboard carries on from the tab either way.
            tabRefs.current[index]?.focus();
          }}
        />

        <section className="menu__panel" id={panelId} role="tabpanel" aria-labelledby={tabId(shown)}>
          <header className="menu__lede">
            <h2 className="menu__title">{group ? group.catalogue.name : 'Credits'}</h2>
            <p className="menu__about">
              {group
                ? group.catalogue.description
                : 'The music and data in Rehabeat and the licences that let us use them. Links open in a new tab.'}
            </p>
          </header>

          {group && (
            <div className="menu__status">
              <p className="menu__hint" data-state={!preview.activated ? 'waiting' : playingSong ? 'playing' : 'ready'}>
                <SpeakerIcon muted={!preview.activated} />
                {!preview.activated ? (
                  <>
                    <span className="menu__on-pointer">Click anywhere or press a key to hear previews</span>
                    <span className="menu__on-touch">Tap anywhere to hear previews</span>
                  </>
                ) : playingSong ? (
                  <span>
                    Previewing <span className="menu__hint-song">{playingSong.title}</span>
                  </span>
                ) : (
                  <>
                    <span className="menu__on-pointer">Hover or focus a song to hear a preview</span>
                    <span className="menu__on-touch">Tap a song to hear it, tap again to play</span>
                  </>
                )}
              </p>
              <p className="menu__keys menu__on-pointer" aria-hidden="true">
                <span>
                  <kbd>←</kbd>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd>
                  <kbd>→</kbd> choose
                </span>
                <span>
                  <kbd>Enter</kbd> play
                </span>
                <span>
                  <kbd>Esc</kbd> back
                </span>
              </p>
            </div>
          )}

          {group && songs.length > 0 && (
            <ul className="menu__cards" data-menu-zone="content" aria-label={`${group.catalogue.name} songs`}>
              {songs.map((song, index) => (
                <SongCard
                  key={song.id}
                  song={song}
                  index={index}
                  selected={song.id === selectedId}
                  previewing={song.id === preview.playingId}
                  tabbable={index === roving}
                  buttonRef={(element) => {
                    cardRefs.current[index] = element;
                  }}
                  onFocus={() => select(song)}
                  onPointerMove={(event) => hover(song, index, event)}
                  onPointerLeave={() => {
                    if (hoveredId.current === song.id) hoveredId.current = null;
                  }}
                  onPointerDown={(event) => {
                    press.current = { id: song.id, pointerType: event.pointerType, wasSelected: song.id === selectedId };
                  }}
                  onClick={() => click(song)}
                />
              ))}
            </ul>
          )}
          {missing && <p className="menu__note">{missing}</p>}

          {group && songs.length === 0 && (
            <EmptyCatalogue
              ref={viewRef}
              group={group}
              alternative={alternative === -1 ? null : groups[alternative]}
              onBrowse={() => {
                if (alternative === -1) return;
                showRail(alternative);
                pendingFocus.current = {
                  zone: 'content',
                  rail: alternative,
                  card: rovingCard(groups[alternative].songs, selectedId),
                };
              }}
            />
          )}

          {!group && <CreditsView ref={viewRef} groups={groups} />}
        </section>
      </div>
    </div>
  );
}
