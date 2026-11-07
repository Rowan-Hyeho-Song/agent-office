import { handle, type StatusRow, type Store } from '../src/signal/events.js'

// Vercel function for the Claude Code hooks (hooks/office-hook.mjs). Writes the agent tables with the server
// key; visitors only read them (RLS) and get changes over Supabase Realtime.
//
// Environment (Vercel → Project → Settings → Environment Variables):
//   SUPABASE_URL                  https://<project>.supabase.co (same project as the rowansong.dev guestbook)
//   SUPABASE_SECRET_KEY           new-style secret key (sb_secret_…), or
//   SUPABASE_SERVICE_ROLE_KEY     the legacy service_role key; server only, never sent to the page
//   OFFICE_HOOK_TOKEN             long random string; the hook sends it as "Authorization: Bearer …"
// Tables: supabase/office.sql

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const token = process.env.OFFICE_HOOK_TOKEN ?? ''

// legacy keys are JWTs and go in both headers; new sb_secret_ keys aren't JWTs and go in `apikey` only
const auth: Record<string, string> = key?.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key ?? '' }

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...auth, 'content-type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
  return (res.status === 204 || res.status === 201 ? null : await res.json()) as T
}

const supabase: Store = {
  async status(seat) {
    const rows = await rest<StatusRow[]>(`agent_status?select=seat,state,activity,since,updated_at&seat=eq.${seat}`)
    return rows[0] ?? null
  },
  async setStatus(row) {
    await rest('agent_status?on_conflict=seat', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    })
  },
  async addEvent(e) {
    await rest('agent_events', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify(e) })
  },
  async prune(before) {
    await rest(`agent_events?created_at=lt.${encodeURIComponent(before)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
  },
}

export async function POST(request: Request) {
  if (!url || !key || !token) return Response.json({ error: 'not configured' }, { status: 503 })
  try {
    return await handle(request, supabase, token)
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'store failed' }, { status: 502 })
  }
}
