import { ArrowDown, ArrowUp } from 'lucide-react';
import { RX_BOUNDS, applyPrescription, type PrescriptionBody } from '../care';
import { MOVES } from '../moves';
import { moveDown, moveUp, startNewProgram, toggleMove } from './editor';

interface ProgramEditorProps {
  draft: PrescriptionBody;
  onChange: (next: PrescriptionBody) => void;
  /** The patient's name, for the preview's heading. */
  name: string;
  /** The patient already has a program, so a new one can be started. */
  hasProgram: boolean;
  today: string;
}

const HOLD_CHOICES = Array.from(
  { length: RX_BOUNDS.holdBeats[1] - RX_BOUNDS.holdBeats[0] + 1 },
  (_, index) => RX_BOUNDS.holdBeats[0] + index,
);

/** The moves in play order, the dose and the schedule, with a live preview of what the limits make of them. */
export function ProgramEditor({ draft, onChange, name, hasProgram, today }: ProgramEditorProps) {
  const picked = draft.moveIds.flatMap((id) => MOVES.filter((move) => move.id === id));
  const others = MOVES.filter((move) => !draft.moveIds.includes(move.id));
  const applied = applyPrescription(MOVES, draft);
  // Both shoulders limited alike produce the same sentence twice.
  const changes = [...new Set(applied.changes.map((change) => change.text))];

  const number = (
    label: string,
    key: 'rounds' | 'sessionsPerWeek' | 'weeks',
    testId: string,
  ) => (
    <label className="doc-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={RX_BOUNDS[key][0]}
        max={RX_BOUNDS[key][1]}
        value={draft[key]}
        data-testid={testId}
        onChange={(event) => onChange({ ...draft, [key]: Math.trunc(Number(event.target.value)) || 0 })}
      />
    </label>
  );

  return (
    <div className="doc-editor" data-testid="program-editor">
      <ul className="doc-moves">
        {picked.map((move, index) => (
          <li key={move.id} data-on="true">
            <label>
              <input
                type="checkbox"
                checked
                data-testid={`move-${move.id}`}
                onChange={() => onChange(toggleMove(draft, move.id))}
              />
              <span className="doc-num">{index + 1}.</span> {move.name}
            </label>
            <span className="doc-moves__order">
              <button
                type="button"
                className="doc-icon"
                aria-label={`Move ${move.name} earlier`}
                disabled={index === 0}
                onClick={() => onChange(moveUp(draft, move.id))}
              >
                <ArrowUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="doc-icon"
                aria-label={`Move ${move.name} later`}
                disabled={index === picked.length - 1}
                onClick={() => onChange(moveDown(draft, move.id))}
              >
                <ArrowDown aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
        {others.map((move) => (
          <li key={move.id}>
            <label>
              <input
                type="checkbox"
                checked={false}
                data-testid={`move-${move.id}`}
                onChange={() => onChange(toggleMove(draft, move.id))}
              />
              {move.name}
            </label>
          </li>
        ))}
      </ul>

      <div className="doc-fields">
        {number('Rounds', 'rounds', 'rx-rounds')}
        {number('Sessions a week', 'sessionsPerWeek', 'rx-sessions')}
        {number('Weeks', 'weeks', 'rx-weeks')}
        <label className="doc-field doc-field--wide">
          <span>Hold</span>
          <select
            value={draft.holdBeats ?? ''}
            data-testid="rx-hold"
            onChange={(event) =>
              onChange({ ...draft, holdBeats: event.target.value === '' ? null : Number(event.target.value) })
            }
          >
            <option value="">Each move's own</option>
            {HOLD_CHOICES.map((beats) => (
              <option key={beats} value={beats}>
                {beats} {beats === 1 ? 'beat' : 'beats'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasProgram && (
        <p className="doc-quiet">
          {draft.startDate === today ? (
            'This program starts today.'
          ) : (
            <>
              Started {draft.startDate}.{' '}
              <button
                type="button"
                className="doc-link"
                data-testid="rx-restart"
                onClick={() => onChange(startNewProgram(draft, today))}
              >
                Start a new program
              </button>
            </>
          )}
        </p>
      )}

      <div className="doc-preview" data-testid="rx-preview">
        <h4 className="label">What {name} will play</h4>
        {applied.moves.length === 0 ? (
          <p className="doc-quiet">Nothing yet.</p>
        ) : (
          <ol>
            {applied.moves.map((move) => (
              <li key={move.id}>{move.name}</li>
            ))}
          </ol>
        )}
        {changes.map((text) => (
          <p key={text} className="doc-change">
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}
