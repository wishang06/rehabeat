-- Marks demo players so they can be told apart from real ones and removed
-- in one go (see supabase/seed_sample_players.sql).
alter table public.profiles add column is_sample boolean not null default false;
