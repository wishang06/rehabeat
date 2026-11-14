/**
 * The demo clinic: a CareStore kept in this browser. It opens with sample
 * patients and a patient called You, who is whoever plays here, so one
 * person can prescribe, play and see the session arrive on one laptop with
 * no sign-in. Nothing in it leaves the browser.
 */
import { dayKey } from './days';
import { DEMO_DOCTOR, YOU_ID, samplePatients } from './sampleClinic';
import { parsePatient, parsePrescriptionBody, parseSession } from './shapes';
import type { CareStore, Patient, PatientFile, Prescription, PrescriptionBody, SessionRecord } from './types';

export const CARE_KEY = 'rehabeat.care.v1';

type DemoStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only what was changed here is stored. Sample history is rebuilt from today's date on every read. */
interface Stored {
  /** Patients the doctor added. */
  patients: Patient[];
  /** Versions saved here, by patient id. For a sample patient they follow the sample's own versions. */
  prescriptions: Record<string, Prescription[]>;
  /** You's sessions. */
  sessions: SessionRecord[];
}

const EMPTY: Stored = { patients: [], prescriptions: {}, sessions: [] };

const YOU: Patient = { id: YOU_ID, name: 'You', condition: 'This browser', joinCode: null, joined: true, sample: false };

function parsePrescription(value: unknown): Prescription | null {
  const body = parsePrescriptionBody(value);
  if (!body) return null;
  const { id, version, createdAt } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof version !== 'number' || typeof createdAt !== 'string') return null;
  return { ...body, id, version, createdAt };
}

const kept = <T>(values: unknown, parse: (value: unknown) => T | null): T[] =>
  Array.isArray(values) ? values.map(parse).filter((value): value is T => value !== null) : [];

/** Whatever was stored, keeping only what can be read. Anything else is treated as not there. */
function parseStored(raw: string | null): Stored {
  if (!raw) return EMPTY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return EMPTY;
  const record = value as Record<string, unknown>;

  const prescriptions: Stored['prescriptions'] = {};
  if (typeof record.prescriptions === 'object' && record.prescriptions !== null && !Array.isArray(record.prescriptions)) {
    for (const [patientId, versions] of Object.entries(record.prescriptions)) {
      const read = kept(versions, parsePrescription);
      if (read.length > 0) prescriptions[patientId] = read;
    }
  }
  return {
    patients: kept(record.patients, parsePatient).map((patient) => ({ ...patient, joinCode: null, joined: true, sample: false })),
    prescriptions,
    sessions: kept(record.sessions, parseSession),
  };
}

/**
 * A demo clinic on `storage` (the browser's localStorage). With no storage
 * it still works for the visit, in memory. `now` is the clock; tests pass their own.
 */
export function createDemoClinic(storage: DemoStorage | undefined, now: () => Date = () => new Date()): CareStore {
  let memory: Stored = EMPTY;

  const read = (): Stored => {
    if (!storage) return memory;
    try {
      return parseStored(storage.getItem(CARE_KEY));
    } catch {
      return EMPTY;
    }
  };

  const write = (next: Stored): void => {
    if (!storage) {
      memory = next;
      return;
    }
    try {
      storage.setItem(CARE_KEY, JSON.stringify(next));
    } catch {
      throw new Error('This browser would not save the change.');
    }
  };

  const files = (stored: Stored): PatientFile[] => [
    { patient: YOU, prescriptions: stored.prescriptions[YOU_ID] ?? [], sessions: stored.sessions },
    ...samplePatients(dayKey(now())).map((file) => ({
      ...file,
      prescriptions: [...file.prescriptions, ...(stored.prescriptions[file.patient.id] ?? [])],
    })),
    ...stored.patients.map((patient) => ({
      patient,
      prescriptions: stored.prescriptions[patient.id] ?? [],
      sessions: [],
    })),
  ];

  return {
    kind: 'demo',

    async listPatients() {
      return files(read());
    },

    async addPatient({ name, condition }) {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) throw new Error('A patient needs a name.');
      const stored = read();
      const patient: Patient = {
        id: `p-${crypto.randomUUID()}`,
        name: trimmed,
        condition: condition.trim().slice(0, 80),
        joinCode: null,
        joined: true,
        sample: false,
      };
      write({ ...stored, patients: [...stored.patients, patient] });
      return patient;
    },

    async savePrescription(patientId, body) {
      const stored = read();
      const file = files(stored).find((candidate) => candidate.patient.id === patientId);
      if (!file) throw new Error('That patient is no longer in the clinic.');
      const fields: PrescriptionBody | null = parsePrescriptionBody(body);
      if (!fields) throw new Error('That program could not be read.');

      const prescription: Prescription = {
        ...fields,
        id: crypto.randomUUID(),
        version: (file.prescriptions.at(-1)?.version ?? 0) + 1,
        createdAt: now().toISOString(),
      };
      write({
        ...stored,
        prescriptions: {
          ...stored.prescriptions,
          [patientId]: [...(stored.prescriptions[patientId] ?? []), prescription],
        },
      });
      return prescription;
    },

    async myProgram() {
      const stored = read();
      const prescription = stored.prescriptions[YOU_ID]?.at(-1);
      return prescription ? { doctorName: DEMO_DOCTOR, prescription, sessions: stored.sessions } : null;
    },

    async saveSession(session) {
      const stored = read();
      if (stored.sessions.some((saved) => saved.id === session.id)) return;
      write({ ...stored, sessions: [...stored.sessions, session] });
    },

    async joinWithCode() {
      throw new Error('Codes work once you are signed in.');
    },

    reset() {
      memory = EMPTY;
      try {
        storage?.removeItem(CARE_KEY);
      } catch {
        // Storage blocked: there was nothing stored to remove.
      }
    },
  };
}
