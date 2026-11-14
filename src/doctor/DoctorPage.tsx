import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { dayKey } from '../care';
import { careStoreFor, usePatients } from '../care/useCare';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AccountButton } from '../ui/AccountButton';
import { PatientDetail } from './PatientDetail';
import { PatientList } from './PatientList';
import './doctor.css';

/**
 * The doctor's page: patients on the left, the picked patient on the right.
 * Signed out it runs on the demo clinic kept in this browser; signed in, on
 * the doctor's own patients. It is a desk tool, so it is set upright and at
 * reading size, in the game's colours.
 */
export function DoctorPage() {
  const auth = useAuth();
  const store = careStoreFor(auth);
  const { files, error, reload } = usePatients(store);
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<{ patientId: string; text: string } | null>(null);
  const today = dayKey(new Date());

  useEffect(() => {
    const before = document.title;
    document.title = 'Rehabeat · Doctor';
    return () => {
      document.title = before;
    };
  }, []);

  // The picked patient is in the query string: a static host serves /doctor for it, where it would 404 a path.
  const selected = files?.find((file) => file.patient.id === params.get('patient')) ?? files?.[0] ?? null;

  return (
    <div className="doc">
      <header className="doc-bar">
        <Link to="/" className="doc-wordmark">
          Rehabeat
        </Link>
        <span className="label">Doctor</span>
        <span className="doc-bar__space" />
        <Link to="/play" className="doc-link">
          Open the game
        </Link>
        {supabase && <AccountButton auth={auth} />}
      </header>

      {store?.kind === 'demo' && (
        <p className="doc-banner" data-testid="demo-banner">
          <span>
            <b>Demo clinic.</b> These are sample patients, saved in this browser only.
            {supabase && ' Sign in to treat real patients.'}
          </span>
          <button
            type="button"
            className="doc-link"
            data-testid="demo-reset"
            onClick={() => {
              store.reset?.();
              setNotice(null);
              reload();
            }}
          >
            Reset demo clinic
          </button>
        </p>
      )}

      {error === 'setup' && (
        <p className="doc-banner doc-banner--warn" role="alert">
          The clinic is not set up yet. The database change in supabase/migrations has to be applied first.
        </p>
      )}
      {error === 'failed' && (
        <p className="doc-banner doc-banner--warn" role="alert">
          The patients could not be loaded.{' '}
          <button type="button" className="doc-link" onClick={reload}>
            Try again
          </button>
        </p>
      )}

      {files && store && (
        <div className="doc-main">
          <PatientList
            files={files}
            selectedId={selected?.patient.id ?? null}
            today={today}
            onSelect={(patientId) => setParams({ patient: patientId })}
            onAdd={async (input) => {
              const patient = await store.addPatient(input);
              reload();
              setParams({ patient: patient.id });
            }}
          />
          {selected ? (
            <PatientDetail
              // A new version, or another patient, starts the editor again from what is saved.
              key={`${selected.patient.id}:${selected.prescriptions.at(-1)?.id ?? 'none'}`}
              file={selected}
              store={store}
              today={today}
              notice={notice?.patientId === selected.patient.id ? notice.text : null}
              onSaved={(name) => {
                setNotice({ patientId: selected.patient.id, text: `Sent to ${name}.` });
                reload();
              }}
            />
          ) : (
            <p className="doc-quiet doc-empty">No patients yet. Add one to write their program.</p>
          )}
        </div>
      )}
      {!files && !error && (
        <p className="doc-quiet doc-empty" role="status">
          Loading patients…
        </p>
      )}
    </div>
  );
}
