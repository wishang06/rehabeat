// Checks the doctor loop's privacy rules by applying the migration to a
// throwaway Postgres (PGlite, in memory) and trying each thing a doctor, a
// patient, another doctor, a stranger and a signed-out visitor might do.
//
//   npm install --no-save @electric-sql/pglite
//   node supabase/tests/care_rls.mjs
//
// PGlite is not a dependency of the app, so it is installed for the run
// only. The script stands in for what a Supabase project already has
// (the anon and authenticated roles, auth.uid(), profiles); it never
// touches the real project.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const D1 = '00000000-0000-0000-0000-0000000000d1', D2 = '00000000-0000-0000-0000-0000000000d2';
const P1 = '00000000-0000-0000-0000-0000000000a1', X = '00000000-0000-0000-0000-0000000000ff';
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

// What a Supabase project has before this migration.
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table auth.users (id uuid primary key);
  grant usage on schema public, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  create table public.profiles (id uuid primary key references auth.users (id) on delete cascade, display_name text not null);
  alter table public.profiles enable row level security;
  create policy "everyone" on public.profiles for select to anon, authenticated using (true);
  insert into auth.users values ('${D1}'), ('${D2}'), ('${P1}'), ('${X}');
  insert into public.profiles values ('${D1}', 'Dr One'), ('${D2}', 'Dr Two'), ('${P1}', 'Pat'), ('${X}', 'Stranger');
`);
await db.exec(readFileSync(new URL('../migrations/20261115090000_care.sql', import.meta.url), 'utf8'));
check('the migration applies', true);

/** Runs sql as a signed-in user (or as anon when user is null). Returns rows, or { error } with the message and code. */
async function as(user, sql, params = []) {
  await db.exec('begin');
  try {
    await db.exec(user ? `set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true)` : 'set local role anon');
    const result = await db.query(sql, params);
    await db.exec('commit');
    return result.rows;
  } catch (error) {
    await db.exec('rollback');
    return { error: error.message, code: error.code };
  }
}
const denied = (r) => r.error !== undefined;

const added = await as(D1, `insert into care_patients (display_name, condition) values ('Maya', 'Right shoulder') returning id, doctor_id, patient_id, join_code`);
check('a doctor adds a patient; the row is theirs and has a code', added[0]?.doctor_id === D1 && added[0].patient_id === null && /^[A-HJKMNP-Z2-9]{6}$/.test(added[0].join_code), JSON.stringify(added.error ?? added[0]?.join_code));
const patient = added[0].id, code = added[0].join_code;

check('a doctor cannot attach an account to a patient on insert', denied(await as(D1, `insert into care_patients (display_name, patient_id) values ('X', '${X}')`)));
check('a doctor cannot attach an account to a patient by update', denied(await as(D1, `update care_patients set patient_id = '${X}' where id = '${patient}'`)));
check('a doctor cannot pose as another doctor', denied(await as(D1, `insert into care_patients (display_name, doctor_id) values ('X', '${D2}')`)));
check('a doctor can rename their patient', (await as(D1, `update care_patients set display_name = 'Maya C' where id = '${patient}' returning id`)).length === 1);
check('another doctor cannot rename them', (await as(D2, `update care_patients set display_name = 'Hacked' where id = '${patient}' returning id`)).length === 0);
check('another doctor sees no patients', (await as(D2, 'select * from care_patients')).length === 0);
check('signed-out visitors cannot read patients', denied(await as(null, 'select * from care_patients')));
check('signed-out visitors cannot read sessions', denied(await as(null, 'select * from care_sessions')));

const rx = await as(D1, `insert into care_prescriptions (care_patient_id, version, body) values ('${patient}', 1, '{"rounds":3}') returning id`);
check('the doctor saves a program', rx.length === 1, rx.error);
check('another doctor cannot save a program for that patient', denied(await as(D2, `insert into care_prescriptions (care_patient_id, version, body) values ('${patient}', 2, '{}')`)));
check('a program cannot be edited', denied(await as(D1, `update care_prescriptions set body = '{}' where id = '${rx[0].id}'`)));
check('a program cannot be deleted', denied(await as(D1, `delete from care_prescriptions where id = '${rx[0].id}'`)));
check('the same version cannot be saved twice', (await as(D1, `insert into care_prescriptions (care_patient_id, version, body) values ('${patient}', 1, '{}')`)).code === '23505');

check('before joining, the patient sees no program', (await as(P1, 'select * from care_prescriptions')).length === 0);
const wrong = await as(P1, `select claim_care_code('ZZZZZZ')`);
check('a wrong code is refused', wrong.error === 'No program found for that code', wrong.error);
check('signed-out visitors cannot claim a code', denied(await as(null, `select claim_care_code('${code}')`)));
const claimed = await as(P1, `select claim_care_code($1) as id`, [` ${code.toLowerCase()} `]);
check('the patient joins with the code, in any case and with spaces', claimed[0]?.id === patient, claimed.error);
check('the patient sees their row and program', (await as(P1, 'select * from care_patients')).length === 1 && (await as(P1, 'select * from care_prescriptions')).length === 1);
check('a patient cannot join a second doctor', (await as(P1, `select claim_care_code('${code}')`)).error === 'You already have a doctor');
check('a used code does not work again', (await as(X, `select claim_care_code('${code}')`)).error === 'No program found for that code');
check('a stranger still sees nothing', (await as(X, 'select * from care_patients')).length === 0 && (await as(X, 'select * from care_prescriptions')).length === 0);

const sid = '00000000-0000-0000-0000-00000000005e';
const insertSession = (who, id, p = patient, r = rx[0].id) => as(who, `insert into care_sessions (id, care_patient_id, prescription_id, day, completed, body) values ('${id}', '${p}', '${r}', '2026-11-14', true, '{"holds":[]}') returning id`);
check('the patient saves a session', (await insertSession(P1, sid)).length === 1);
check('saving the same session again is a duplicate, not a second row', (await insertSession(P1, sid)).code === '23505');
check('a stranger cannot save a session for the patient', denied(await insertSession(X, '00000000-0000-0000-0000-00000000005f')));
check('the doctor cannot write a session for the patient', denied(await insertSession(D1, '00000000-0000-0000-0000-000000000060')));
check('a session cannot be edited or deleted', denied(await as(P1, `update care_sessions set completed = false where id = '${sid}'`)) && denied(await as(P1, `delete from care_sessions where id = '${sid}'`)));

const other = await as(D2, `insert into care_patients (display_name) values ('Other') returning id, join_code`);
const otherRx = await as(D2, `insert into care_prescriptions (care_patient_id, version, body) values ('${other[0].id}', 1, '{}') returning id`);
check("a session cannot name another patient's program", denied(await insertSession(P1, '00000000-0000-0000-0000-000000000061', patient, otherRx[0].id)));
check('the doctor reads the session; another doctor and a stranger do not', (await as(D1, 'select * from care_sessions')).length === 1 && (await as(D2, 'select * from care_sessions')).length === 0 && (await as(X, 'select * from care_sessions')).length === 0);
check('the patient reads their own session', (await as(P1, 'select * from care_sessions')).length === 1);

const self = await as(D1, `insert into care_patients (display_name) values ('Me') returning join_code`);
check('one person can be doctor and patient (the two-sided demo)', (await as(D1, `select claim_care_code('${self[0].join_code}') as id`)).length === 1);
check('the patient reads the doctor name from profiles', (await as(P1, `select display_name from profiles where id = '${D1}'`))[0]?.display_name === 'Dr One');

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
