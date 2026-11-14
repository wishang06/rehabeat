-- Sample players for the demo leaderboard. Safe to run more than once.
--
-- They are real auth users (so the profile trigger and foreign keys apply)
-- but have no password or identity, so nobody can sign in as them.
-- Remove them all with:
--   delete from auth.users where id in (select id from public.profiles where is_sample);

with players (id, name) as (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'Maya R.'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'Leo Park'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'Priya S.'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'Jonas'),
    ('00000000-0000-4000-a000-000000000005'::uuid, 'Aiko T.'),
    ('00000000-0000-4000-a000-000000000006'::uuid, 'Sam Rivera'),
    ('00000000-0000-4000-a000-000000000007'::uuid, 'Noah K.'),
    ('00000000-0000-4000-a000-000000000008'::uuid, 'Zoe')
),
new_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
    'sample-' || right(id::text, 2) || '@rehabeat.invalid', '', now(),
    '{"provider":"sample","providers":["sample"]}', jsonb_build_object('full_name', name),
    now(), now(), '', '', '', ''
  from players
  on conflict (id) do nothing
  returning id
)
select count(*) from new_users;

update public.profiles
set is_sample = true
where id::text like '00000000-0000-4000-a000-%';

insert into public.scores (user_id, points, moves, perfect, good, miss, best_combo, accuracy, duration_sec, created_at)
select
  p.id,
  (r ->> 0)::int, (r ->> 1)::int, (r ->> 2)::int, (r ->> 3)::int, (r ->> 4)::int,
  (r ->> 5)::int, (r ->> 6)::real, (r ->> 7)::int,
  now() - (ord * interval '37 minutes')
from (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, '[[4380,24,17,5,2,14,88.5,312],[3910,22,14,6,2,11,84.0,290]]'::jsonb),
    ('00000000-0000-4000-a000-000000000002'::uuid, '[[4120,23,15,6,2,13,86.2,301]]'::jsonb),
    ('00000000-0000-4000-a000-000000000003'::uuid, '[[3760,21,13,6,2,10,83.1,276],[2950,18,10,6,2,8,79.4,240]]'::jsonb),
    ('00000000-0000-4000-a000-000000000004'::uuid, '[[3240,20,11,6,3,9,78.8,265]]'::jsonb),
    ('00000000-0000-4000-a000-000000000005'::uuid, '[[2870,18,9,7,2,8,77.0,238],[2410,16,8,5,3,6,74.6,212]]'::jsonb),
    ('00000000-0000-4000-a000-000000000006'::uuid, '[[2260,16,7,6,3,6,73.9,215]]'::jsonb),
    ('00000000-0000-4000-a000-000000000007'::uuid, '[[1730,14,5,6,3,5,69.2,186]]'::jsonb),
    ('00000000-0000-4000-a000-000000000008'::uuid, '[[1180,11,3,5,3,4,64.5,150]]'::jsonb)
) as p (id, runs)
cross join lateral jsonb_array_elements(p.runs) with ordinality as e (r, ord)
where not exists (select 1 from public.scores s where s.user_id = p.id);
