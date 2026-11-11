import { handle, type TimelineStore } from '../src/timeline/ingest.js'

// Vercel function for the push Action (.github/workflows/timeline.yml, a draft until deployment) and the backfill.
// Writes the timeline table with the server key; visitors read through RLS (supabase/timeline.sql).
//
// Environment (same as /api/docs; see docs/deploy.md):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
//   OFFICE_DOCS_TOKEN       the Action sends it as "Authorization: Bearer …"
//   OFFICE_PUBLIC_REPOS     comma separated "owner/name" whose points are public (default: this repo and rowansong.dev, #424)
//   OFFICE_PRIVATE_REPOS    comma separated repos that are never collected
//   OFFICE_BANNED_WORDS     comma separated words to hide

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const cfg = {
  token: process.env.OFFICE_DOCS_TOKEN ?? '',
  publicRepos: list(process.env.OFFICE_PUBLIC_REPOS ?? 'Rowan-Hyeho-Song/agent-office,Rowan-Hyeho-Song/rowansong.dev'),
  privateRepos: list(process.env.OFFICE_PRIVATE_REPOS),
  banned: list(process.env.OFFICE_BANNED_WORDS),
}

// legacy keys are JWTs and go in both headers; new sb_secret_ keys aren't JWTs and go in `apikey` only
const auth: Record<string, string> = key?.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key ?? '' }

const supabase: TimelineStore = {
  async upsert(rows) {
    const res = await fetch(`${url}/rest/v1/timeline?on_conflict=key`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      // every row carries the same keys (a bulk upsert needs them): result is false off the approval results
      body: JSON.stringify(rows.map((r) => ({ ...r, result: r.result === true }))),
    })
    if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
  },
}

export async function POST(request: Request) {
  if (!url || !key || !cfg.token) return Response.json({ error: 'not configured' }, { status: 503 })
  try {
    return await handle(request, supabase, cfg)
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'store failed' }, { status: 502 })
  }
}
