-- Timelapse points for /api/timeline (#81, plan.md 6.7). DRAFT: run at deployment, after docs.sql, in the same
-- Supabase project. Nothing runs it before that.
--
-- Who can do what:
--   visitors (anon / publishable key)  public points in full; review points (SECRET: no title)
--   /api/timeline (secret key)         writes; RLS has no insert/update/delete policies
--   private repos                      never stored (the server drops them)
--
-- One row per point, keyed by its source address (commit URL, comment URL, ...), so a point sent twice stays one.
-- Never any code, diff or file path: only counts. A review point's title is empty, enforced here too.

create table if not exists public.timeline (
  id bigint generated always as identity primary key,
  key text not null unique,
  project text not null,
  at timestamptz not null,
  kind text not null check (kind in ('plan', 'work', 'minutes', 'approval', 'decision', 'deploy')),
  -- seat of the agent (0 기획 · 1 3D · 2 디자인 · 3 코더); null = before roles were split
  agent smallint check (agent between 0 and 3),
  title text not null default '',
  secret boolean not null default false,
  additions int check (additions >= 0),
  deletions int check (deletions >= 0),
  files int check (files >= 0),
  issue int,
  pr int,
  tier text not null check (tier in ('public', 'review')),
  constraint review_has_no_title check (tier = 'public' or (secret and title = ''))
);

create index if not exists timeline_project_at on public.timeline (project, at);
create index if not exists timeline_at on public.timeline (at);

alter table public.timeline enable row level security;

drop policy if exists "visitors read timeline" on public.timeline;
create policy "visitors read timeline" on public.timeline for select to anon, authenticated
  using (tier = 'public' or (tier = 'review' and title = ''));
