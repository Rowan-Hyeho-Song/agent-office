-- #4 (office-ui.md 12.3): the visitors' notes on the cork board. Safe to run again. Run supabase/visit.sql first (the
-- cooldown rows of /api/note live in its visit_cooldown).
--
-- visitor_notes   one note: the robot it is for, the words (80), the name the visitor chose (20, '' = anonymous), the time.
--                 Nothing about who wrote it. Visitors read the notes that are not hidden; only the server writes (api/note.ts),
--                 after the word filter, the contact-details check, the 30 s cooldown and the repeat check.
--
-- To take a note off the board (the owner, in the SQL editor):
--   update public.visitor_notes set hidden = true where id = 123;

create table if not exists public.visitor_notes (
  id bigint generated always as identity primary key,
  agent text not null check (agent in ('agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4')),
  text text not null check (char_length(text) between 1 and 80),
  name text not null default '' check (char_length(name) <= 20),
  created_at timestamptz not null default now(),
  hidden boolean not null default false
);
create index if not exists visitor_notes_board on public.visitor_notes (hidden, id desc);

alter table public.visitor_notes enable row level security;
drop policy if exists "visitors read visitor_notes" on public.visitor_notes;
create policy "visitors read visitor_notes" on public.visitor_notes for select to anon, authenticated using (hidden = false);
revoke insert, update, delete, truncate on public.visitor_notes from anon, authenticated;
grant select on public.visitor_notes to anon, authenticated;
