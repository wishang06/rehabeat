/**
 * The real clinic: a CareStore on private Supabase tables (see
 * supabase/migrations/20261115090000_care.sql). Row Level Security decides
 * what each signed-in user can read and write; this file only asks.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../lib/database.types';
import { parsePrescriptionBody, parseSession } from './shapes';
import {
  CareSetupError,
  type CareStore,
  type Patient,
  type PatientFile,
  type Prescription,
  type SessionRecord,
} from './types';

type DbError = { code?: string; message?: string } | null;

/** The table is not there: the migration has not been applied to this project. */
export function isMissingTable(error: DbError): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

/** A row with this primary key already exists: an earlier attempt to save it went through. */
export function isDuplicate(error: DbError): boolean {
  return error?.code === '23505';
}

/** A stored program version. Its id, number and date come from the row's own columns, never from the JSON. */
export function prescriptionFromRow(row: {
  id: string;
  version: number;
  created_at: string;
  body: unknown;
}): Prescription | null {
  const body = parsePrescriptionBody(row.body);
  return body ? { ...body, id: row.id, version: row.version, createdAt: row.created_at } : null;
}

/** A stored session, or null if its JSON cannot be read. */
export function sessionFromRow(row: { id: string; body: unknown }): SessionRecord | null {
  const session = parseSession(row.body);
  return session ? { ...session, id: row.id } : null;
}

function fail(error: NonNullable<DbError>): never {
  if (isMissingTable(error)) throw new CareSetupError('The clinic tables have not been set up.');
  throw new Error(error.message ?? 'The clinic could not be reached.');
}

const kept = <Row, T>(rows: Row[] | null, read: (row: Row) => T | null): T[] =>
  (rows ?? []).map(read).filter((value): value is T => value !== null);

/** The clinic of the signed-in user `userId`, who may be a doctor, a patient, or both. */
export function createSupabaseClinic(client: SupabaseClient<Database>, userId: string): CareStore {
  /** The signed-in user's own patient row, if they have joined a doctor. */
  const myPatientRow = async (): Promise<{ id: string; doctor_id: string } | null> => {
    const { data, error } = await client
      .from('care_patients')
      .select('id, doctor_id')
      .eq('patient_id', userId)
      .maybeSingle();
    if (error) fail(error);
    return data;
  };

  const prescriptionsOf = async (patientIds: string[]) => {
    const { data, error } = await client
      .from('care_prescriptions')
      .select('id, care_patient_id, version, created_at, body')
      .in('care_patient_id', patientIds)
      .order('version', { ascending: true });
    if (error) fail(error);
    return data ?? [];
  };

  const sessionsOf = async (patientIds: string[]) => {
    const { data, error } = await client
      .from('care_sessions')
      .select('id, care_patient_id, body')
      .in('care_patient_id', patientIds)
      .order('created_at', { ascending: true });
    if (error) fail(error);
    return data ?? [];
  };

  const patientOf = (row: {
    id: string;
    display_name: string;
    condition: string;
    join_code: string;
    patient_id: string | null;
  }): Patient => ({
    id: row.id,
    name: row.display_name,
    condition: row.condition,
    joinCode: row.patient_id === null ? row.join_code : null,
    joined: row.patient_id !== null,
    sample: false,
  });

  return {
    kind: 'clinic',

    async listPatients(): Promise<PatientFile[]> {
      const { data: rows, error } = await client
        .from('care_patients')
        .select('id, patient_id, display_name, condition, join_code')
        .eq('doctor_id', userId)
        .order('created_at', { ascending: true });
      if (error) fail(error);
      if (!rows || rows.length === 0) return [];

      const ids = rows.map((row) => row.id);
      const [prescriptions, sessions] = await Promise.all([prescriptionsOf(ids), sessionsOf(ids)]);
      return rows.map((row) => ({
        patient: patientOf(row),
        prescriptions: kept(
          prescriptions.filter((version) => version.care_patient_id === row.id),
          prescriptionFromRow,
        ),
        sessions: kept(
          sessions.filter((session) => session.care_patient_id === row.id),
          sessionFromRow,
        ),
      }));
    },

    async addPatient({ name, condition }) {
      const trimmed = name.trim().slice(0, 60);
      if (!trimmed) throw new Error('A patient needs a name.');
      const { data, error } = await client
        .from('care_patients')
        .insert({ display_name: trimmed, condition: condition.trim().slice(0, 80) })
        .select('id, patient_id, display_name, condition, join_code')
        .single();
      if (error) fail(error);
      return patientOf(data);
    },

    async savePrescription(patientId, body) {
      const fields = parsePrescriptionBody(body);
      if (!fields) throw new Error('That program could not be read.');

      const { data: newest, error: readError } = await client
        .from('care_prescriptions')
        .select('version')
        .eq('care_patient_id', patientId)
        .order('version', { ascending: false })
        .limit(1);
      if (readError) fail(readError);

      const { data, error } = await client
        .from('care_prescriptions')
        .insert({
          care_patient_id: patientId,
          version: (newest?.[0]?.version ?? 0) + 1,
          body: fields as unknown as Json,
        })
        .select('id, version, created_at, body')
        .single();
      if (error) fail(error);
      const saved = prescriptionFromRow(data);
      if (!saved) throw new Error('The saved program could not be read back.');
      return saved;
    },

    async myProgram() {
      const row = await myPatientRow();
      if (!row) return null;
      const [versions, sessions, doctor] = await Promise.all([
        prescriptionsOf([row.id]),
        sessionsOf([row.id]),
        client.from('profiles').select('display_name').eq('id', row.doctor_id).maybeSingle(),
      ]);
      const prescription = kept(versions, prescriptionFromRow).at(-1);
      if (!prescription) return null;
      return {
        doctorName: doctor.data?.display_name ?? 'Your doctor',
        prescription,
        sessions: kept(sessions, sessionFromRow),
      };
    },

    async saveSession(session) {
      const row = await myPatientRow();
      if (!row) throw new Error('You are not a patient of a doctor here.');
      const { error } = await client.from('care_sessions').insert({
        id: session.id,
        care_patient_id: row.id,
        prescription_id: session.prescriptionId,
        day: session.day,
        completed: session.completed,
        body: session as unknown as Json,
      });
      // The session keeps its id, so a second try after an unclear failure lands on the first one's row.
      if (error && !isDuplicate(error)) fail(error);
    },

    async joinWithCode(code) {
      const { error } = await client.rpc('claim_care_code', { code });
      if (error) fail(error);
    },
  };
}
