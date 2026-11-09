-- Office documents for /api/docs (#24, plan.md 5.2 · 6). Run after office.sql, in the same Supabase project.
--
-- Who can do what:
--   visitors (anon / publishable key)  public + approved documents in full (table, Realtime);
--                                      every document's cover only (docs_cover view): SECRET documents
--   /api/docs (secret key)             writes; RLS has no insert/update/delete policies
--   the owner (#25)                    reads review documents and approves them (policy added in #25)
--
-- The original is on GitHub; these rows are copies, keyed by the source URL so an edited comment updates
-- its row instead of adding one.

create table if not exists public.docs (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('plan', 'minutes', 'decision', 'report', 'worklog')),
  -- project folder ("owner/name") and file (issue number)
  repo text not null,
  folder int not null,
  title text not null,
  summary text not null default '',
  body text not null default '',
  -- seats of the agents in it (0 기획 · 1 3D · 2 디자인 · 3 코더)
  agents smallint[] not null default '{}',
  source_kind text not null check (source_kind in ('issue', 'comment', 'pr')),
  source_url text not null unique,
  grade text not null check (grade in ('public', 'review', 'private')),
  approved boolean not null default false,
  -- parsed structure: minutes rows / decision / follow-up, approval result, issue state, …
  data jsonb not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists docs_folder on public.docs (repo, folder, created_at);
create index if not exists docs_recent on public.docs (created_at desc);

-- open issue count per project (the planner's sticky notes, #28), refreshed by every issue event
create table if not exists public.projects (
  repo text primary key,
  open_issues int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.docs enable row level security;
alter table public.projects enable row level security;

drop policy if exists "visitors read public docs" on public.docs;
create policy "visitors read public docs" on public.docs for select to anon, authenticated
  using (grade = 'public' and approved);
drop policy if exists "visitors read projects" on public.projects;
create policy "visitors read projects" on public.projects for select to anon, authenticated using (true);

-- Covers of every document, for the library: what kind, when, who. A SECRET document shows no title; a
-- private one not even its project or file. The view runs as its owner, so it can see rows the visitor
-- can't, and hands out only these columns.
create or replace view public.docs_cover with (security_invoker = false) as
  select
    id,
    kind,
    case when grade = 'private' then null else repo end as repo,
    case when grade = 'private' then null else folder end as folder,
    case when grade = 'public' and approved then title end as title,
    agents,
    grade,
    approved,
    (grade = 'public' and approved) as readable,
    created_at,
    updated_at,
    -- the issue's GitHub labels are topic info like the title (#236): shown only where the title is
    case when grade = 'public' and approved then coalesce(data->'labels', '[]'::jsonb) else '[]'::jsonb end as labels
  from public.docs;

grant select on public.docs_cover to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
