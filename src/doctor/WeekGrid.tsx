import type { Consistency } from '../care';

/** The most weeks shown: the latest ones. */
const WEEKS_SHOWN = 8;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** The weekday letter of a YYYY-MM-DD key, without going through local time. */
function weekday(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
}

const STATE_WORD = { done: 'session done', partial: 'ended early', empty: 'no session' } as const;

/** A lamp per day of the program, a row per week, and each week's count against what was prescribed. */
export function WeekGrid({ record }: { record: Consistency }) {
  const weeks = record.weeks.slice(-WEEKS_SHOWN);
  if (weeks.length === 0) return <p className="doc-quiet">No program yet.</p>;

  return (
    <div data-testid="week-grid">
      <div className="doc-weeks" role="table" aria-label="Sessions by week">
        <div className="doc-weeks__row" role="row" aria-hidden="true">
          <span />
          {weeks[0].days.map((cell) => (
            <span key={cell.day} className="doc-weeks__day">
              {weekday(cell.day)}
            </span>
          ))}
          <span />
        </div>
        {weeks.map((week) => {
          // A week that has ended short of its number is the thing to notice.
          const over = week.days.every((cell) => !cell.future && !cell.today);
          return (
            <div key={week.index} className="doc-weeks__row" role="row">
              <span className="doc-weeks__name" role="rowheader">
                Wk {week.index}
              </span>
              {week.days.map((cell) => (
                <span key={cell.day} role="cell" className="doc-weeks__cell">
                  <i
                    className="doc-lamp"
                    data-state={cell.state}
                    data-today={cell.today}
                    data-future={cell.future}
                    title={`${cell.day}: ${cell.future ? 'to come' : STATE_WORD[cell.state]}`}
                  />
                </span>
              ))}
              <span
                className="doc-weeks__count doc-num"
                role="cell"
                data-short={over && week.done < week.prescribed}
                data-testid={`week-count-${week.index}`}
              >
                {week.done}/{week.prescribed}
              </span>
            </div>
          );
        })}
      </div>
      <p className="doc-key">
        <span>
          <i className="doc-lamp" data-state="done" /> Done
        </span>
        <span>
          <i className="doc-lamp" data-state="partial" /> Ended early
        </span>
        <span>
          <i className="doc-lamp" data-state="empty" /> No session
        </span>
        <span>
          <i className="doc-lamp" data-state="empty" data-today="true" /> Today
        </span>
      </p>
    </div>
  );
}
