import type { CSSProperties } from 'react';
import type { CatalogueGroup } from '../../songs/library';
import { bpmRangeLabel, definitionFor, rodMarks, rodPosition, songCountLabel } from './menuModel';

interface CatalogueRailProps {
  groups: readonly CatalogueGroup[];
  /** The rail item shown: a catalogue index, or groups.length for Credits. */
  shown: number;
  selectedId: string;
  /** Where the metronome weight sits on the rod (see rodPosition), or null to hide it. */
  weight: number | null;
  tabId(index: number): string;
  panelId: string;
  tabRef(index: number, element: HTMLButtonElement | null): void;
  onChoose(index: number): void;
}

const at = (position: number) => ({ '--at': position }) as CSSProperties;

/**
 * The catalogues as a metronome's tempo rod: slow at the top, as on a real
 * metronome, with a notch for every song at its tempo and a brass weight on
 * the selected song. Credits sits below the rod. On a narrow screen the rail
 * becomes a tab strip and the rod is hidden.
 */
export function CatalogueRail({ groups, shown, selectedId, weight, tabId, panelId, tabRef, onChoose }: CatalogueRailProps) {
  const credits = groups.length;
  const marks = rodMarks(groups);

  const tab = (index: number, testId: string, name: string, range: string | null, detail: string) => (
    <button
      key={testId}
      ref={(element) => {
        tabRef(index, element);
      }}
      type="button"
      role="tab"
      id={tabId(index)}
      className={index === credits ? 'menu-rail__tab menu-rail__tab--credits' : 'menu-rail__tab'}
      data-testid={testId}
      data-rail-index={index}
      aria-selected={index === shown}
      aria-controls={panelId}
      tabIndex={index === shown ? 0 : -1}
      onClick={() => onChoose(index)}
    >
      <span className="menu-rail__name">{name}</span>
      <span className="menu-rail__meta">
        {range && <span className="menu-rail__range">{range}</span>}
        <span className="menu-rail__detail">{detail}</span>
      </span>
    </button>
  );

  return (
    <div className="menu-rail" data-menu-zone="rail">
      <div
        className="menu-rail__tabs"
        role="tablist"
        aria-label="Song catalogues"
        aria-orientation="vertical"
        style={{ '--rod-items': groups.length } as CSSProperties}
      >
        <div className="menu-rail__rod" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.position} className="menu-rail__mark" style={at(mark.position)}>
              <span className="menu-rail__mark-bpm">{mark.bpm}</span>
            </span>
          ))}
          {groups.flatMap((group, index) => {
            const band = definitionFor(group.catalogue.id);
            return group.songs.map((song) => (
              <span
                key={song.id}
                className="menu-rail__notch"
                data-selected={song.id === selectedId}
                style={at(rodPosition(song.bpm, index, band))}
              />
            ));
          })}
          {weight !== null && <span className="menu-rail__weight" style={at(weight)} />}
        </div>

        {groups.map((group, index) =>
          tab(
            index,
            `catalogue-tab-${group.catalogue.id}`,
            group.catalogue.name,
            bpmRangeLabel(definitionFor(group.catalogue.id)),
            songCountLabel(group.songs.length),
          ),
        )}
        {tab(credits, 'catalogue-tab-credits', 'Credits', null, 'Music, data, licences')}
      </div>
    </div>
  );
}
