import { useId, type Ref } from 'react';
import type { CatalogueGroup } from '../../songs/library';
import { creditParts } from '../../songs/model';

interface CreditsViewProps {
  groups: readonly CatalogueGroup[];
  ref?: Ref<HTMLDivElement>;
}

/** Every song's credit line, catalogue by catalogue. Links open in a new tab so the menu stays put. */
export function CreditsView({ groups, ref }: CreditsViewProps) {
  const baseId = useId();
  const stocked = groups.filter((group) => group.songs.length > 0);
  return (
    <div ref={ref} className="menu-credits" data-testid="credits-view" data-menu-zone="content" tabIndex={-1}>
      {stocked.length === 0 && <p className="menu-credits__none">No songs have loaded, so there is nothing to credit yet.</p>}
      {stocked.map((group) => (
        <section
          key={group.catalogue.id}
          className="menu-credits__group"
          aria-labelledby={`${baseId}-${group.catalogue.id}`}
        >
          <h3 className="menu-credits__catalogue" id={`${baseId}-${group.catalogue.id}`}>
            {group.catalogue.name}
          </h3>
          <ul className="menu-credits__songs">
            {group.songs.map((song) => (
              <li key={song.id} className="menu-credits__song">
                <p className="menu-credits__title">{song.title}</p>
                <p className="menu-credits__line">
                  {creditParts(song).map((part, index) =>
                    part.href ? (
                      <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
                        {part.text}
                      </a>
                    ) : (
                      <span key={index}>{part.text}</span>
                    ),
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
