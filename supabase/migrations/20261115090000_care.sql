-- The doctor loop: a doctor's patients, the programs the doctor prescribes
-- and the sessions the patient plays.
--
-- care_patients:      one row per patient of a doctor. The patient joins it
--                     with the row's join code, which sets patient_id.
-- care_prescriptions: versions of a patient's program. Never edited: a
--                     change is the next version, and the newest is in force.
-- care_sessions:      one row per program session, written by the patient.
--                     Scores and joint angles only: no picture, no landmarks.
--
-- Unlike profiles and scores, nothing here is public. A doctor reads and
-- writes only their own patients; a patient reads their own row and its
-- programs, and adds their own sessions. Nobody can edit or delete a
-- program or a session from the app.

-- Six characters, without the letters and digits that are easy to misread.
create function public.new_care_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  from generate_series(1, 6);
$$;

create table public.care_patients (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- The patient's account, once they have joined. An account is a patient of at most one doctor.
  patient_id uuid unique references public.profiles (id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  condition text not null default '' check (char_length(condition) <= 80),
  join_code text not null unique default public.new_care_code(),
  created_at timestamptz not null default now()
);

create index care_patients_doctor_idx on public.care_patients (doctor_id, created_at);

create table public.care_prescriptions (
  id uuid primary key default gen_random_uuid(),
  care_patient_id uuid not null references public.care_patients (id) on delete cascade,
  version integer not null check (version >= 1),
  -- The program's fields (see PrescriptionBody in src/care/types.ts).
  body jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) < 20000),
  created_at timestamptz not null default now(),
  unique (care_patient_id, version),
  -- Lets a session's foreign key say which patient its prescription belongs to.
  unique (id, care_patient_id)
);

create table public.care_sessions (
  -- Made by the patient's browser, so sending the same session twice cannot make two rows.
  id uuid primary key,
  care_patient_id uuid not null references public.care_patients (id) on delete cascade,
  prescription_id uuid not null,
  day date not null,
  completed boolean not null,
  -- The whole session record (see SessionRecord in src/care/types.ts).
  body jsonb not null check (jsonb_typeof(body) = 'object' and pg_column_size(body) < 200000),
  created_at timestamptz not null default now(),
  -- A session can only name a prescription of the same patient.
  foreign key (prescription_id, care_patient_id)
    references public.care_prescriptions (id, care_patient_id) on delete cascade
);

create index care_sessions_patient_day_idx on public.care_sessions (care_patient_id, day);

-- Who the signed-in user is to a patient row. Policies on the other two
-- tables call these instead of selecting from care_patients themselves, so
-- no policy depends on another table's policies.
create function public.is_care_doctor(care_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.care_patients
    where id = care_patient and doctor_id = (select auth.uid())
  );
$$;

create function public.is_care_patient(care_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.care_patients
    where id = care_patient and patient_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_care_doctor(uuid) from public, anon;
revoke execute on function public.is_care_patient(uuid) from public, anon;
grant execute on function public.is_care_doctor(uuid) to authenticated;
grant execute on function public.is_care_patient(uuid) to authenticated;

alter table public.care_patients enable row level security;
alter table public.care_prescriptions enable row level security;
alter table public.care_sessions enable row level security;

-- Signed-in users only, and only the columns and actions the app uses. A
-- doctor names a patient and their condition; doctor_id, the join code and
-- patient_id are never set from the app. patient_id is set by
-- claim_care_code alone, so a doctor cannot attach a program to an account
-- that did not ask for it.
revoke all on table public.care_patients from anon, authenticated;
revoke all on table public.care_prescriptions from anon, authenticated;
revoke all on table public.care_sessions from anon, authenticated;

grant select on table public.care_patients to authenticated;
grant insert (display_name, condition) on table public.care_patients to authenticated;
grant update (display_name, condition) on table public.care_patients to authenticated;
grant select, insert on table public.care_prescriptions to authenticated;
grant select, insert on table public.care_sessions to authenticated;

create policy "A doctor and their patient can read the patient row"
  on public.care_patients for select
  to authenticated
  using ((select auth.uid()) = doctor_id or (select auth.uid()) = patient_id);

create policy "A doctor can add their own patients"
  on public.care_patients for insert
  to authenticated
  with check ((select auth.uid()) = doctor_id and patient_id is null);

create policy "A doctor can rename their own patients"
  on public.care_patients for update
  to authenticated
  using ((select auth.uid()) = doctor_id)
  with check ((select auth.uid()) = doctor_id);

create policy "A doctor and their patient can read the programs"
  on public.care_prescriptions for select
  to authenticated
  using (public.is_care_doctor(care_patient_id) or public.is_care_patient(care_patient_id));

create policy "A doctor can save a program for their own patient"
  on public.care_prescriptions for insert
  to authenticated
  with check (public.is_care_doctor(care_patient_id));

create policy "A doctor and their patient can read the sessions"
  on public.care_sessions for select
  to authenticated
  using (public.is_care_doctor(care_patient_id) or public.is_care_patient(care_patient_id));

create policy "A patient can add their own sessions"
  on public.care_sessions for insert
  to authenticated
  with check (public.is_care_patient(care_patient_id));

-- A patient joins their doctor with the code the doctor gave them.
create function public.claim_care_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  claimed uuid;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if exists (select 1 from public.care_patients where patient_id = me) then
    raise exception 'You already have a doctor';
  end if;

  update public.care_patients
  set patient_id = me
  where join_code = upper(btrim(code)) and patient_id is null
  returning id into claimed;

  if claimed is null then
    raise exception 'No program found for that code';
  end if;
  return claimed;
end;
$$;

revoke execute on function public.claim_care_code(text) from public, anon;
grant execute on function public.claim_care_code(text) to authenticated;
