import { useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  CHART_DAYS,
  DEFAULT_WEIGHT_KG,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
  lastDays,
  readWeight,
  setWeight,
  showWeight,
  useHistory,
  type DayTotal,
  type WeightUnit,
} from '../progress';
import './stats.css';

type ChartMode = 'runs' | 'kcal';

const MODES: { id: ChartMode; label: string }[] = [
  { id: 'runs', label: 'Runs' },
  { id: 'kcal', label: 'Kcal' },
];
const UNITS: WeightUnit[] = ['kg', 'lb'];

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Calories as shown: whole numbers, and "<1" for a run too short to round up. */
const kcalText = (kcal: number) => (kcal > 0 && kcal < 0.5 ? '<1' : Math.round(kcal).toLocaleString());

/** Segments in a bar; `.stats__bar` in stats.css is this many tall. */
const BAR_SEGMENTS = 12;

/** How many of a bar's segments are lit. A day with anything on it lights at least one. */
const litSegments = (amount: number, peak: number) =>
  amount > 0 && peak > 0 ? Math.max(1, Math.round((amount / peak) * BAR_SEGMENTS)) : 0;

/** What a day's bar says to someone who cannot see it. */
function describeDay(day: DayTotal): string {
  const date = day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return `${date}: ${plural(day.runs, 'run')}, ${kcalText(day.kcal)} kcal`;
}

/**
 * The player's history: lifetime totals, a bar per day for the last two
 * weeks, and the optional body weight the calorie estimate uses. It is
 * mounted each time the Stats dialog opens, so "today" is read then.
 */
export function StatsPanel() {
  const history = useHistory();
  const today = useMemo(() => new Date(), []);
  const days = useMemo(() => lastDays(history, today), [history, today]);
  const [mode, setMode] = useState<ChartMode>('runs');

  const value = (day: DayTotal) => (mode === 'runs' ? day.runs : day.kcal);
  const peak = Math.max(...days.map(value));

  return (
    <div className="stats" data-testid="stats-panel">
      <dl className="stats__totals">
        <div>
          <dt className="label">Runs</dt>
          <dd className="led" data-testid="stats-runs">
            {history.totals.runs.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="label">Minutes</dt>
          <dd className="led" data-testid="stats-minutes">
            {Math.round(history.totals.seconds / 60).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="label">Est. kcal</dt>
          <dd className="led" data-testid="stats-kcal">
            {kcalText(history.totals.kcal)}
          </dd>
        </div>
      </dl>

      <section className="stats__chart" aria-label={`Last ${CHART_DAYS} days`}>
        <header className="stats__chart-head">
          <div className="stats__switch" role="group" aria-label="Chart shows">
            {MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="button button--quiet"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                data-testid={`stats-mode-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="label stats__range">Last {CHART_DAYS} days</span>
        </header>

        {peak > 0 ? (
          <ol className="stats__bars" data-testid="stats-chart" data-mode={mode}>
            {days.map((day, index) => {
              const amount = value(day);
              return (
                <li key={day.day} data-today={index === days.length - 1}>
                  <span className="sr-only">{describeDay(day)}</span>
                  <span className="stats__value led" aria-hidden="true">
                    {amount > 0 ? (mode === 'runs' ? amount : kcalText(amount)) : ''}
                  </span>
                  <span className="stats__bar" aria-hidden="true">
                    <i style={{ '--lit': litSegments(amount, peak) } as CSSProperties} />
                  </span>
                  <span className="stats__day led" aria-hidden="true">
                    {day.date.getDate()}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="stats__empty" data-testid="stats-empty">
            {history.totals.runs > 0 ? `No runs in the last ${CHART_DAYS} days.` : 'Finish a run to start your chart.'}
          </p>
        )}
      </section>

      <WeightField weightKg={history.weightKg} unit={history.unit} />
    </div>
  );
}

/** The whole-number range the field accepts, in the unit it shows. */
function weightRange(unit: WeightUnit): [number, number] {
  return [Math.ceil(Number(showWeight(MIN_WEIGHT_KG, unit))), Math.floor(Number(showWeight(MAX_WEIGHT_KG, unit)))];
}

/**
 * The optional body weight. It saves when the field is left or Enter is
 * pressed; a value that is not a weight is refused and the saved one kept.
 */
function WeightField({ weightKg, unit }: { weightKg: number | null; unit: WeightUnit }) {
  const [draft, setDraft] = useState(weightKg === null ? '' : showWeight(weightKg, unit));
  const [refused, setRefused] = useState(false);
  const [low, high] = weightRange(unit);

  const save = () => {
    const reading = readWeight(draft, unit);
    setRefused(!reading.ok);
    if (!reading.ok) return;
    setWeight(reading.kg, unit);
    setDraft(reading.kg === null ? '' : showWeight(reading.kg, unit));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  /** Shows the saved weight in the other unit. What was typed and refused is dropped. */
  const switchUnit = (next: WeightUnit) => {
    if (next === unit) return;
    setWeight(weightKg, next);
    setDraft(weightKg === null ? '' : showWeight(weightKg, next));
    setRefused(false);
  };

  return (
    <form className="stats__weight" onSubmit={onSubmit} noValidate>
      <label className="label" htmlFor="stats-weight">
        Body weight
      </label>
      <div className="stats__weight-row">
        <input
          id="stats-weight"
          className="stats__input led"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={6}
          placeholder={showWeight(DEFAULT_WEIGHT_KG, unit)}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          aria-invalid={refused}
          aria-describedby="stats-weight-note"
          data-testid="stats-weight"
        />
        <div className="stats__switch" role="group" aria-label="Weight unit">
          {UNITS.map((option) => (
            <button
              key={option}
              type="button"
              className="button button--quiet"
              aria-pressed={unit === option}
              onClick={() => switchUnit(option)}
              data-testid={`stats-unit-${option}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      {refused && (
        <p className="stats__error" role="alert" data-testid="stats-weight-error">
          Enter a weight between {low} and {high} {unit}.
        </p>
      )}
      <p className="stats__note" id="stats-weight-note">
        Optional. Calories are an estimate from time played and body weight, using {showWeight(DEFAULT_WEIGHT_KG, unit)}{' '}
        {unit} until you enter yours. Your weight stays in this browser.
      </p>
    </form>
  );
}
