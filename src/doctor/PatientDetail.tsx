import { useMemo, useState } from 'react';
import {
  RX_BOUNDS,
  consistency,
  findings,
  localDay,
  quality,
  validatePrescription,
  type CareStore,
  type PatientFile,
} from '../care';
import { MOVES } from '../moves';
import { draftFor, isDirty } from './editor';
import { LimitsEditor } from './LimitsEditor';
import { ProblemSpots } from './ProblemSpots';
import { ProgramEditor } from './ProgramEditor';
import { WeekGrid } from './WeekGrid';

interface PatientDetailProps {
  file: PatientFile;
  store: CareStore;
  today: string;
  /** Shown after a save: "Sent to Maya Chen." */
  notice: string | null;
  /** Called once a new version of the program is saved. */
  onSaved: (patientName: string) => void;
}

/** "up 6", "down 3", or nothing when the change rounds to zero or there is nothing to compare. */
function changeText(change: number | null): { text: string; down: boolean } | null {
  if (change === null || Math.round(change) === 0) return null;
  const size = Math.abs(Math.round(change));
  return change > 0 ? { text: `up ${size}`, down: false } : { text: `down ${size}`, down: true };
}

/**
 * One patient: how consistently and how well they are doing their program,
 * where they go wrong, and the program itself, to change and send back.
 */
export function PatientDetail({ file, store, today, notice, onSaved }: PatientDetailProps) {
  const { patient, prescriptions, sessions } = file;
  const [draft, setDraft] = useState(() => draftFor(file, today));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const record = useMemo(() => consistency(prescriptions, sessions, today), [prescriptions, sessions, today]);
  const scores = useMemo(() => quality(sessions, today), [sessions, today]);
  const spots = useMemo(() => findings(sessions, MOVES), [sessions]);
  const breaches = spots.filter((spot) => spot.kind === 'breach').reduce((sum, spot) => sum + spot.value, 0);
  const change = changeText(scores.change);

  const dirty = isDirty(draft, file, today);
  const problem = validatePrescription(draft, MOVES);
  const lastSession = sessions.at(-1);

  const save = () => {
    if (problem) return;
    setSaving(true);
    setSaveError(null);
    store
      .savePrescription(patient.id, draft)
      .then(() => onSaved(patient.name))
      .catch((cause: unknown) => {
        setSaveError(cause instanceof Error ? cause.message : 'The program could not be saved.');
        setSaving(false);
      });
  };

  return (
    <article className="doc-detail" data-testid="patient-detail">
      <header className="doc-head">
        <h1>{patient.name}</h1>
        <p>
          {[
            patient.condition,
            record.programWeek > 0 && `week ${record.programWeek} of ${record.programWeeks}`,
            lastSession ? `last session ${lastSession.day}` : 'no sessions yet',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <div className="doc-tiles">
        <section className="doc-panel doc-tile">
          <h2 className="label">This week</h2>
          <p>
            <span className="doc-num doc-big" data-testid="tile-week">
              {record.thisWeek ? `${record.thisWeek.done}/${record.thisWeek.prescribed}` : '–'}
            </span>{' '}
            sessions
          </p>
        </section>
        <section className="doc-panel doc-tile">
          <h2 className="label">Average score</h2>
          <p>
            <span className="doc-num doc-big">{scores.average === null ? '–' : Math.round(scores.average)}</span>{' '}
            {change && <span data-down={change.down}>{change.text}</span>}
          </p>
        </section>
        <section className="doc-panel doc-tile">
          <h2 className="label">Past a limit</h2>
          <p>
            <span className="doc-num doc-big" data-warn={breaches > 0}>
              {breaches}
            </span>{' '}
            {breaches === 1 ? 'hold' : 'holds'}, last sessions
          </p>
        </section>
      </div>

      <div className="doc-two">
        <section className="doc-panel">
          <h2 className="label">Consistency</h2>
          <WeekGrid record={record} />
        </section>
        <section className="doc-panel">
          <h2 className="label">Problem spots</h2>
          <ProblemSpots findings={spots} hasSessions={sessions.length > 0} />
        </section>
      </div>

      <div className="doc-two">
        <section className="doc-panel">
          <h2 className="label">Program</h2>
          <ProgramEditor
            draft={draft}
            onChange={setDraft}
            name={patient.name}
            hasProgram={prescriptions.length > 0}
            today={today}
          />
        </section>
        <section className="doc-panel">
          <h2 className="label">Limits</h2>
          <LimitsEditor draft={draft} onChange={setDraft} />
        </section>
      </div>

      <section className="doc-panel doc-send">
        <label className="label" htmlFor="rx-note">
          Note to {patient.name}
        </label>
        <textarea
          id="rx-note"
          data-testid="rx-note"
          value={draft.note}
          rows={3}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
        <p className="doc-quiet doc-num" data-over={draft.note.length > RX_BOUNDS.note}>
          {draft.note.length}/{RX_BOUNDS.note}
        </p>
        <div className="doc-send__row">
          <button
            type="button"
            className="doc-btn doc-btn--primary"
            data-testid="rx-save"
            disabled={!dirty || saving || problem !== null}
            onClick={save}
          >
            Save and send
          </button>
          <p role="status" data-testid="rx-status">
            {saveError ? (
              <span className="doc-error">{saveError}</span>
            ) : dirty ? (
              (problem ?? 'Not saved yet.')
            ) : (
              (notice ?? '')
            )}
          </p>
        </div>
      </section>

      {prescriptions.length > 0 && (
        <section className="doc-panel">
          <h2 className="label">Program history</h2>
          <ol className="doc-versions" reversed>
            {[...prescriptions].reverse().map((version) => (
              <li key={version.id}>
                <span className="doc-num">{localDay(version.createdAt) ?? ''}</span>
                <span>{version.note || 'No note.'}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
