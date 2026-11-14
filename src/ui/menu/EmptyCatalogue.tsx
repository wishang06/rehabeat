import type { CSSProperties, Ref } from 'react';
import type { CatalogueGroup } from '../../songs/library';
import { definitionFor, emptyReason } from './menuModel';

interface EmptyCatalogueProps {
  group: CatalogueGroup;
  /** A catalogue that does have songs, to offer instead. */
  alternative: CatalogueGroup | null;
  onBrowse(): void;
  ref?: Ref<HTMLDivElement>;
}

/** Shown in place of the cards when a catalogue has no songs: its empty tempo band, and why it is empty. */
export function EmptyCatalogue({ group, alternative, onBrowse, ref }: EmptyCatalogueProps) {
  const band = definitionFor(group.catalogue.id);
  return (
    <div ref={ref} className="menu-empty" data-testid="menu-empty" data-menu-zone="content" tabIndex={-1}>
      {band && (
        <div
          className="menu-empty__band"
          aria-hidden="true"
          style={{ '--steps': (band.maxBpm - band.minBpm) / 5 } as CSSProperties}
        >
          <span>{band.minBpm}</span>
          <span className="menu-empty__ruler" />
          <span>{band.maxBpm} BPM</span>
        </div>
      )}
      <p className="menu-empty__title">More songs coming</p>
      <p className="menu-empty__text">{emptyReason(group)}</p>
      {alternative && (
        <button type="button" className="button button--quiet" onClick={onBrowse}>
          Browse {alternative.catalogue.name}
        </button>
      )}
    </div>
  );
}
