import type { ProgramView } from '../care';

interface ProgramCardProps {
  program: ProgramView;
  /** Start a program session. */
  onStart: () => void;
}

/**
 * The patient's program on the title screen: who set it, what it plays,
 * their limits in words, this week's count, the doctor's note, and the
 * button that starts today's session.
 */
export function ProgramCard({ program, onStart }: ProgramCardProps) {
  const { week } = program;
  return (
    <section className="program slab slab-edge" data-testid="program-card" aria-labelledby="program-heading">
      <h2 id="program-heading" className="program__head label">
        Your program · {program.doctorName}
      </h2>
      <p className="program__moves display">{program.moveNames.join(' · ') || 'No moves'}</p>
      <p className="program__dose">
        {program.rounds} {program.rounds === 1 ? 'round' : 'rounds'}
      </p>
      {program.limits.length > 0 && (
        <ul className="program__limits" aria-label="Your limits">
          {program.limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      )}
      {week && (
        <p className="program__week">
          <span className="led" data-testid="program-week">
            {week.done}/{week.prescribed}
          </span>{' '}
          sessions this week
        </p>
      )}
      {program.note && <p className="program__note">“{program.note}”</p>}
      {program.finished && (
        <p className="program__status">This program has finished. Ask {program.doctorName} what is next.</p>
      )}
      {!program.finished && program.doneToday && <p className="program__status">Done for today.</p>}
      {program.playable ? (
        <button
          type="button"
          className="button button--primary program__start"
          onClick={onStart}
          data-testid="program-start"
          autoFocus
        >
          {program.doneToday ? 'Play it again' : "Start today's session"} <kbd>Enter</kbd>
        </button>
      ) : (
        <p className="program__status">
          Nothing in this program can be played with your limits. Ask {program.doctorName}.
        </p>
      )}
    </section>
  );
}
