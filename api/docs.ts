import { handle, type DocStore } from '../src/docs/ingest.js'
import { signals } from '../src/server/signal.js'

// Vercel function for the GitHub Action (.github/workflows/docs.yml) and the backfill script
// (scripts/docs/backfill.mjs). Writes the docs tables with the server key; visitors read through RLS.
//
// Environment (Vercel → Project → Settings → Environment Variables; see docs/deploy.md):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)   same as /api/events
//   OFFICE_DOCS_TOKEN      long random string; the Action sends it as "Authorization: Bearer …"
//   OFFICE_PUBLIC_REPOS    comma separated "owner/name" whose documents are public (default: this repo)
//   OFFICE_BANNED_WORDS    comma separated words to hide (company names …); kept out of the repo
// Tables: supabase/docs.sql

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const cfg = {
  token: process.env.OFFICE_DOCS_TOKEN ?? '',
  publicRepos: list(process.env.OFFICE_PUBLIC_REPOS ?? 'Rowan-Hyeho-Song/agent-office'),
  banned: list(process.env.OFFICE_BANNED_WORDS),
}

// legacy keys are JWTs and go in both headers; new sb_secret_ keys aren't JWTs and go in `apikey` only
const auth: Record<string, string> = key?.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key ?? '' }

async function rest(path: string, init: RequestInit) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...init.headers } })
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
}

const MERGE = { prefer: 'resolution=merge-duplicates,return=minimal' }

// #240 after a write that went through, one content-free signal per table (table + time, nothing else) tells open pages
// to re-read; a failed signal never fails the write (src/server/signal.ts)
const storeFor = (sig: ReturnType<typeof signals>): DocStore => ({
  upsert: sig.after('docs', (rows) => rest('docs?on_conflict=source_url', { method: 'POST', headers: MERGE, body: JSON.stringify(rows) })),
  setOpenIssues: (repo, open, at) =>
    rest('projects?on_conflict=repo', { method: 'POST', headers: MERGE, body: JSON.stringify({ repo, open_issues: open, updated_at: at }) }),
  addHandoffs: (events) =>
    rest('agent_events', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(events.map((e) => ({ ...e, kind: 'handoff' }))),
    }),
  // a re-sent (edited) request updates its text; status and the decision columns are not in the row, so stay
  upsertApprovals: sig.after('approvals', (rows) => rest('approvals?on_conflict=source_url', { method: 'POST', headers: MERGE, body: JSON.stringify(rows) })),
  decide: sig.after('approvals', (requestUrl, d) =>
    rest(`approvals?source_url=eq.${encodeURIComponent(requestUrl)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'decided', ...d, updated_at: d.decided_at }),
    }),
  ),
})

export async function POST(request: Request) {
  if (!url || !key || !cfg.token) return Response.json({ error: 'not configured' }, { status: 503 })
  const sig = signals(url, key)
  try {
    return await handle(request, storeFor(sig), cfg)
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'store failed' }, { status: 502 })
  } finally {
    await sig.flush()
  }
}
