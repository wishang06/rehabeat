import { useState, type FormEvent } from 'react';
import { consistency, type PatientFile } from '../care';

interface PatientListProps {
  files: readonly PatientFile[];
  selectedId: string | null;
  today: string;
  onSelect: (patientId: string) => void;
  onAdd: (input: { name: string; condition: string }) => Promise<void>;
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
          return (
            <li key={patient.id}>
              <button
                type="button"
                className="doc-patient"
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
                {!patient.joined && patient.joinCode && (
                  <span className="doc-patient__code">
                    Join code: <b className="doc-num">{patient.joinCode}</b>
                  </span>
                )}
              </button>
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
