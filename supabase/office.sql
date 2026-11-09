-- Agent office signal tables for /api/events (#1). Run once in Supabase → SQL Editor, in the same project as
-- the rowansong.dev guestbook (that table is not touched here).
--
-- Who can do what:
--   visitors (anon / publishable key)  read agents, agent_status, agent_events; Realtime on status + events
--   /api/events (secret key)           writes; RLS has no insert/update/delete policies, so nobody else can
--
-- Nothing private is stored: an agent number, a state, an activity kind (edit, test, …). Session ids, paths,
-- commands and tool input/output never leave the PC (the hook classifies them locally, plan.md 5.1).

-- the agents (#5, #26; #193 the fifth): seat = desk / nav work_<seat>
create table if not exists public.agents (
  seat smallint primary key check (seat between 0 and 4),
  key text not null unique,
  name text not null,
  role text not null,
  color text not null
);

insert into public.agents (seat, key, name, role, color) values
  (0, 'memo', '메모 MEMO', '기획', '#ffb347'),
  (1, 'mesh', '메시 MESH', '3D', '#8f9bff'),
  (2, 'hue',  '휴 HUE',    '디자인', '#ff3ea5'),
  (3, 'loop', '루프 LOOP', '코더', '#4df3ff')
on conflict (seat) do update set key = excluded.key, name = excluded.name, role = excluded.role, color = excluded.color;

-- #193: the fifth agent, 에코 ECHO (sound). On a database made for four seats the check is widened first; both
-- statements are safe to run again
alter table public.agents drop constraint if exists agents_seat_check;
alter table public.agents add constraint agents_seat_check check (seat between 0 and 4);
insert into public.agents (seat, key, name, role, color) values (4, 'echo', '에코 ECHO', '사운드', '#f2ffc4')
on conflict (seat) do update set key = excluded.key, name = excluded.name, role = excluded.role, color = excluded.color;

-- what each agent is doing now. One row per agent; the page derives "idle" / "off" from updated_at when the
-- signals stop (a server function can't run timers).
create table if not exists public.agent_status (
  seat smallint primary key references public.agents (seat),
  state text not null default 'off' check (state in ('working', 'wrapping', 'idle', 'off')),
  activity text check (activity in ('edit', 'read', 'test', 'build', 'install', 'git', 'run', 'other', 'delegate', 'think', 'private')),
  -- when the current state began (a new wrap-up = a new since) and when the last signal came
  since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the last test / build outcome (#44: the coder's signal light). One boolean, nothing of the command
  last_result_activity text check (last_result_activity in ('test', 'build')),
  last_result_ok boolean,
  last_result_at timestamptz
);
-- (for a table created before #44)
alter table public.agent_status add column if not exists last_result_activity text check (last_result_activity in ('test', 'build'));
alter table public.agent_status add column if not exists last_result_ok boolean;
alter table public.agent_status add column if not exists last_result_at timestamptz;
-- #182: the issue the agent is on. The hook sends only the repo name and the number; the server looks the title
-- up from the public plan documents (docs table). A private repo stores only task_private = true: no repo, no
-- number, no title. All null = no task. Existing rows stay null, so this is safe to run before deploying.
alter table public.agent_status add column if not exists task_repo text check (char_length(task_repo) <= 100);
alter table public.agent_status add column if not exists task_issue integer check (task_issue between 1 and 1000000);
alter table public.agent_status add column if not exists task_title text check (char_length(task_title) <= 300);
alter table public.agent_status add column if not exists task_private boolean;

insert into public.agent_status (seat) select seat from public.agents on conflict do nothing;

-- recent changes, for the office's "today" view and later the meeting replays. Only changes are written
-- (a new activity, start, stop), not every tool call. Kept for 14 days (pruned by /api/events).
create table if not exists public.agent_events (
  id bigint generated always as identity primary key,
  seat smallint not null references public.agents (seat),
  kind text not null check (kind in ('start', 'activity', 'stop', 'end', 'result', 'handoff')),
  activity text check (activity in ('edit', 'read', 'test', 'build', 'install', 'git', 'run', 'other', 'delegate', 'think', 'private')),
  -- a result: did the test / build pass (#44). null for every other kind
  ok boolean,
  -- a handoff: the seat the work went to (#51 paper plane). null for every other kind
  to_seat smallint references public.agents (seat),
  created_at timestamptz not null default now()
);
-- (for a table created before #44)
alter table public.agent_events add column if not exists ok boolean;
alter table public.agent_events add column if not exists to_seat smallint references public.agents (seat);
alter table public.agent_events drop constraint if exists agent_events_kind_check;
alter table public.agent_events add constraint agent_events_kind_check check (kind in ('start', 'activity', 'stop', 'end', 'result', 'handoff'));

create index if not exists agent_events_created_at on public.agent_events (created_at desc);

alter table public.agents enable row level security;
alter table public.agent_status enable row level security;
alter table public.agent_events enable row level security;

drop policy if exists "visitors read agents" on public.agents;
create policy "visitors read agents" on public.agents for select to anon, authenticated using (true);
drop policy if exists "visitors read status" on public.agent_status;
create policy "visitors read status" on public.agent_status for select to anon, authenticated using (true);
drop policy if exists "visitors read events" on public.agent_events;
create policy "visitors read events" on public.agent_events for select to anon, authenticated using (true);

-- Realtime: the page subscribes to these two
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'agent_status') then
    alter publication supabase_realtime add table public.agent_status;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'agent_events') then
    alter publication supabase_realtime add table public.agent_events;
  end if;
end $$;
