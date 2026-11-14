-- Accounts, scores and the leaderboard.
--
-- profiles: one row per signed-in player, created automatically on sign-up
--           from the Google profile (name, picture).
-- scores:   one row per finished run. Players can only add their own rows and
--           can't edit or delete them.
-- leaderboard: each player's best run, total points and rank.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are visible to everyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "Players can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        nullif(split_part(new.email, '@', 1), ''),
        'Player'
      ),
      40
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.scores (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  points integer not null check (points >= 0),
  moves integer not null check (moves between 1 and 1000),
  perfect integer not null check (perfect >= 0),
  good integer not null check (good >= 0),
  miss integer not null check (miss >= 0),
  best_combo integer not null check (best_combo >= 0),
  accuracy real not null check (accuracy between 0 and 100),
  duration_sec integer not null check (duration_sec between 0 and 86400),
  created_at timestamptz not null default now(),
  constraint scores_counts_add_up check (perfect + good + miss = moves),
  constraint scores_combo_fits check (best_combo <= moves),
  -- A move is worth at most 200 points (see src/scoring/points.ts).
  constraint scores_points_possible check (points <= moves * 200)
);

create index scores_user_created_idx on public.scores (user_id, created_at desc);
create index scores_points_idx on public.scores (points desc);

alter table public.scores enable row level security;

create policy "Scores are visible to everyone"
  on public.scores for select
  to anon, authenticated
  using (true);

create policy "Players can add their own scores"
  on public.scores for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create view public.leaderboard
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
  (rank() over (order by max(s.points) desc))::integer as rank
from public.scores s
join public.profiles p on p.id = s.user_id
group by p.id, p.display_name, p.avatar_url;

grant select on public.leaderboard to anon, authenticated;
