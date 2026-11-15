-- Player avatars, and demo players marked on the leaderboard.
--
-- profiles.avatar_id: the avatar picked in the profile menu, one of the ids
--                     in src/ui/avatars/avatars.ts. Null until the game deals
--                     a new account a random one on its first sign-in.
-- leaderboard:        now also carries avatar_id and is_sample, so the board
--                     can draw each player's avatar and tag demo players.
--
-- Players already update their own profile row (see the policy in
-- 20261114090000), which is how a rename or a new avatar is saved. From here
-- on those are the only two columns they can change: is_sample in particular
-- is for the seed alone.

alter table public.profiles
  add column avatar_id text check (avatar_id ~ '^[a-z0-9-]{1,32}$');

revoke update on table public.profiles from anon, authenticated;
grant update (display_name, avatar_id) on table public.profiles to authenticated;

-- New columns go at the end: create or replace keeps the existing ones in place.
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  p.id as user_id,
  p.display_name,
  p.avatar_url,
  max(s.points) as best_points,
  sum(s.points)::bigint as total_points,
  count(*)::integer as runs,
  max(s.best_combo) as best_combo,
  max(s.accuracy) as best_accuracy,
  (rank() over (order by max(s.points) desc))::integer as rank,
  p.avatar_id,
  p.is_sample
from public.scores s
join public.profiles p on p.id = s.user_id
group by p.id, p.display_name, p.avatar_url, p.avatar_id, p.is_sample;

grant select on public.leaderboard to anon, authenticated;

-- The demo players get avatars from the new set (the seed sets the same).
update public.profiles as p
set avatar_id = v.avatar_id
from (
  values
    ('00000000-0000-4000-a000-000000000001'::uuid, 'crown'),
    ('00000000-0000-4000-a000-000000000002'::uuid, 'bolt'),
    ('00000000-0000-4000-a000-000000000003'::uuid, 'star'),
    ('00000000-0000-4000-a000-000000000004'::uuid, 'eq'),
    ('00000000-0000-4000-a000-000000000005'::uuid, 'flame'),
    ('00000000-0000-4000-a000-000000000006'::uuid, 'note'),
    ('00000000-0000-4000-a000-000000000007'::uuid, 'chevrons'),
    ('00000000-0000-4000-a000-000000000008'::uuid, 'dial')
) as v (id, avatar_id)
where p.id = v.id and p.is_sample;
