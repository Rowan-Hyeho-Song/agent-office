-- Timelapse points for /api/timeline (#81, #413, plan.md 6.7). Run once in the office's Supabase project (after docs.sql);
-- safe to run again. Written by /api/timeline (the Action and the backfill, .github/workflows/timeline.yml); read by the
-- timelapse (src/replay/livePoints.ts) with the page's publishable key.
--
-- Who can do what:
--   visitors (anon / publishable key)  public points in full; review points (SECRET: no title)
--   /api/timeline (secret key)         writes; RLS has no insert/update/delete policies
--   private repos                      never stored (the server drops them)
--
-- One row per point, keyed by its source address (commit URL, comment URL, ...), so a point sent twice stays one.
-- Never any code, diff or file path: only counts. A review point has no title, address or numbers, enforced here too.

create table if not exists public.timeline (
  id bigint generated always as identity primary key,
  key text not null unique,
  project text not null,
  at timestamptz not null,
  kind text not null check (kind in ('plan', 'work', 'minutes', 'approval', 'decision', 'deploy')),
  -- seat of the agent (0 기획 · 1 3D · 2 디자인 · 3 코더 · 4 사운드); null = before roles were split
  agent smallint check (agent between 0 and 4),
  title text not null default '',
  secret boolean not null default false,
  additions int check (additions >= 0),
  deletions int check (deletions >= 0),
  files int check (files >= 0),
  issue int,
  pr int,
  -- approval points: true = the owner's result (✅), false = a request (🖊)
  result boolean not null default false,
  tier text not null check (tier in ('public', 'review')),
  -- a review point is opaque: no title, no source address (key is review:<project>:<hash>), no numbers
  constraint review_is_opaque check (tier = 'public' or (secret and title = '' and key like 'review:%' and issue is null and pr is null))
);

create index if not exists timeline_project_at on public.timeline (project, at);
create index if not exists timeline_at on public.timeline (at);

alter table public.timeline enable row level security;

drop policy if exists "visitors read timeline" on public.timeline;
create policy "visitors read timeline" on public.timeline for select to anon, authenticated
  using (tier = 'public' or (tier = 'review' and title = ''));
-- the page reads the table itself (#413), not a view: the policy above decides the rows
grant select on public.timeline to anon, authenticated;

-- #193: a fifth seat (에코, sound). Widens the check on a database made for four seats; safe to run again
alter table public.timeline drop constraint if exists timeline_agent_check;
alter table public.timeline add constraint timeline_agent_check check (agent between 0 and 4);
