-- Approvals and the owner (#25, plan.md 5.2 · 6.5 · 6.6). Run after docs.sql, in the same Supabase project.
--
-- Who can do what:
--   visitors            the number of pending approvals only (approvals_pending view)
--   the owner           every approval and every document (review = SECRET ones too), through is_owner()
--   /api/docs           files 🖊 requests and ✅ results from GitHub (secret key)
--   /api/approve        records the owner's decision after posting the ✅ comment (secret key)
--
-- The owner is whoever signed in with the GitHub account in office_owner. The check reads auth.identities,
-- which only Supabase Auth writes (user_metadata can be edited by the user, so it is never trusted).

-- one row: the owner's GitHub numeric user id (`gh api user --jq .id`), inserted at deploy time (docs/deploy.md)
create table if not exists public.office_owner (
  github_id text primary key
);
alter table public.office_owner enable row level security; -- no policies: nobody reads it through the API

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.identities i
    join public.office_owner o on o.github_id = i.provider_id
    where i.user_id = auth.uid() and i.provider = 'github'
  );
$$;
revoke all on function public.is_owner() from public;
grant execute on function public.is_owner() to anon, authenticated;

create table if not exists public.approvals (
  id bigint generated always as identity primary key,
  repo text not null,
  folder int not null,
  title text not null default '', -- the issue's title, for the owner's card
  -- the 🖊 request comment (one row per request; editing it updates the row)
  source_url text not null unique,
  kind text not null, -- 결정 요청 | 문서 공개 | 산출물 확인, as written
  requester text not null default '',
  requester_seat smallint check (requester_seat between 0 and 3),
  content text not null default '',
  options jsonb not null default '[]',
  recommended int,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'decided')),
  -- the ✅ result: 승인 | 반려 | 선택지 N, the chosen option, the opinion, and the comment that recorded it
  result text,
  option int,
  opinion text,
  result_url text,
  decided_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists approvals_pending on public.approvals (status, created_at);
create index if not exists approvals_seat on public.approvals (requester_seat, decided_at);

alter table public.approvals enable row level security;
drop policy if exists "owner reads approvals" on public.approvals;
create policy "owner reads approvals" on public.approvals for select to authenticated using (public.is_owner());

-- visitors see how many are waiting, and each waiting one only as a SECRET cover: what kind, which agent
-- asked, when (no content, options, issue or title), like the documents' covers (docs_cover)
create or replace view public.approvals_pending with (security_invoker = false) as
  select count(*)::int as pending from public.approvals where status = 'pending';
grant select on public.approvals_pending to anon, authenticated;

create or replace view public.approvals_cover with (security_invoker = false) as
  select id, kind, requester_seat, created_at from public.approvals where status = 'pending';
grant select on public.approvals_cover to anon, authenticated;

-- the owner reads every document, SECRET (review) ones included (plan.md 6.6)
drop policy if exists "owner reads all docs" on public.docs;
create policy "owner reads all docs" on public.docs for select to authenticated using (public.is_owner());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'approvals') then
    alter publication supabase_realtime add table public.approvals;
  end if;
end $$;
