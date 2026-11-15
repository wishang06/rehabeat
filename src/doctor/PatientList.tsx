import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { consistency, type PatientFile } from '../care';

interface PatientListProps {
  files: readonly PatientFile[];
  selectedId: string | null;
  today: string;
  onSelect: (patientId: string) => void;
  onAdd: (input: { name: string; condition: string }) => Promise<void>;
}

/** How long the button says Copied before it offers to copy again. */
const COPIED_MS = 2000;

/**
 * Puts a patient's join code on the clipboard. The button is an icon, small enough to sit beside the
 * code in the narrow patient column; it turns to a tick for a moment once the code is copied.
 */
function CopyCode({ code, patientName }: { code: string; patientName: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = () => {
    // The clipboard is only there on https and localhost, and the browser may still refuse it.
    const written = navigator.clipboard?.writeText(code) ?? Promise.reject(new Error('No clipboard'));
    written.then(
      () => setState('copied'),
      (cause: unknown) => {
        console.error('Could not copy the join code', cause);
        setState('failed');
      },
    );
  };

  return (
    <button
      type="button"
      className="doc-copy"
      onClick={copy}
      data-state={state}
      title={state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy the code'}
      aria-label={state === 'idle' ? `Copy ${patientName}'s join code` : undefined}
      data-testid="copy-code"
    >
      {state === 'copied' ? <Check aria-hidden="true" /> : state === 'failed' ? <X aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span className="doc-sr" role="status">
        {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : ''}
      </span>
    </button>
  );
}

/** The doctor's patients, each with one status, and a form to add another. */
export function PatientList({ files, selectedId, today, onSelect, onAdd }: PatientListProps) {
  const [name, setName] = useState('');
  const [condition, setCondition] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('A patient needs a name.');
      return;
    }
    setBusy(true);
    setError(null);
    onAdd({ name, condition })
      .then(() => {
        setName('');
        setCondition('');
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'The patient could not be added.'))
      .finally(() => setBusy(false));
  };

  return (
    <nav className="doc-patients" aria-label="Patients">
      <h2 className="label">Patients</h2>
      <ul>
        {files.map(({ patient, prescriptions, sessions }) => {
          const record = consistency(prescriptions, sessions, today);
          const code = patient.joined ? null : patient.joinCode;
          return (
            <li key={patient.id}>
              <button
                type="button"
                className={code ? 'doc-patient doc-patient--coded' : 'doc-patient'}
                aria-current={patient.id === selectedId ? 'true' : undefined}
                data-testid={`patient-${patient.id}`}
                onClick={() => onSelect(patient.id)}
              >
                <span className="doc-patient__name">{patient.name}</span>
                <span className="doc-patient__about">
                  {[patient.condition, record.programWeek > 0 && `week ${record.programWeek} of ${record.programWeeks}`]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="doc-pill" data-warn={record.warn}>
                  {record.statusText}
                </span>
              </button>
              {/* Outside the patient's button, so the code has a button of its own. */}
              {code && (
                <p className="doc-patient__code">
                  <span>
                    Join code: <b className="doc-num">{code}</b>
                  </span>
                  <CopyCode code={code} patientName={patient.name} />
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <form className="doc-add" onSubmit={add} data-testid="add-patient">
        <h3 className="label">Add patient</h3>
        <label className="doc-field">
          <span>Name</span>
          <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} data-testid="add-name" />
        </label>
        <label className="doc-field">
          <span>Condition</span>
          <input
            value={condition}
            maxLength={80}
            placeholder="Right shoulder"
            onChange={(event) => setCondition(event.target.value)}
            data-testid="add-condition"
          />
        </label>
        {error && (
          <p className="doc-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="doc-btn" disabled={busy}>
          Add patient
        </button>
      </form>
    </nav>
  );
}
