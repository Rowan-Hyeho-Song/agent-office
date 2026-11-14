-- #4 (office-ui.md 12.2): the visitors' snacks and cheers. Safe to run again.
--
-- visitor_events   what every screen shows: the robot, the kind, the time. Nothing about who gave it.
--                  Visitors read it (the page re-reads the last seconds after a signal); only the server writes (api/visit.ts).
-- visit_cooldown   one row per given snack / cheer for the per-robot minute: a keyed hash of the visitor's IP (the key is
--                  derived from the server key and changes every day), the robot and the time. The server deletes rows
--                  older than two minutes on every write. Nobody but the server key may read or write it.

create table if not exists public.visitor_events (
  id bigint generated always as identity primary key,
  agent text not null check (agent in ('agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4')),
  kind text not null check (kind in ('coffee', 'cookie', 'apple', 'cheer')),
  created_at timestamptz not null default now()
);
create index if not exists visitor_events_created_at on public.visitor_events (created_at);

alter table public.visitor_events enable row level security;
drop policy if exists "visitors read visitor_events" on public.visitor_events;
create policy "visitors read visitor_events" on public.visitor_events for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.visitor_events from anon, authenticated;
grant select on public.visitor_events to anon, authenticated;

create table if not exists public.visit_cooldown (
  hash text not null,
  agent text not null check (agent in ('agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4')),
  at timestamptz not null default now()
);
create index if not exists visit_cooldown_lookup on public.visit_cooldown (hash, agent, at);
create index if not exists visit_cooldown_at on public.visit_cooldown (at);

-- RLS on and no policy: anon and authenticated get nothing; the server key bypasses RLS
alter table public.visit_cooldown enable row level security;
revoke all on public.visit_cooldown from anon, authenticated;
