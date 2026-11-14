import { broadcastSignal, VISIT_TOPIC } from '../src/server/signal.js'
import { handleVisit, type SharedEvent, type VisitStore } from '../src/visit/treat.js'

// Vercel function for the visitors' snacks and cheers (#4, office-ui.md 12.2). The page never writes the tables: it calls
// this, and this checks the kind, the robot, the visitor's minute per robot and the room's 10 s limit again
// (src/visit/treat.ts). Tables and policies: supabase/visit.sql (visitors may read the shared events, nobody may read the
// cooldown rows). After a shared event one content-free signal goes out on `office-visit`.
//
// Environment (the same as /api/docs; nothing new):
//   SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY): also the source of the daily cooldown hash key

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

// legacy keys are JWTs and go in both headers; new sb_secret_ keys aren't JWTs and go in `apikey` only
const auth: Record<string, string> = key?.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key ?? '' }

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  if (!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`)
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

const store: VisitStore = {
  async lastCooldown(hash, agent) {
    const rows = await rest<{ at: string }[]>(`visit_cooldown?select=at&hash=eq.${hash}&agent=eq.${agent}&order=at.desc&limit=1`)
    return rows[0] ? Date.parse(rows[0].at) : null
  },
  async putCooldown(hash, agent, at, before) {
    await rest(`visit_cooldown?at=lt.${encodeURIComponent(before.toISOString())}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    await rest('visit_cooldown', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ hash, agent, at: at.toISOString() }) })
  },
  async sharedSince(since) {
    const rows = await rest<{ id: number }[]>(`visitor_events?select=id&created_at=gte.${encodeURIComponent(since.toISOString())}`)
    return rows.length
  },
  async share(agent, kind, at) {
    // a day of events is plenty (the page reads the last seconds); older ones go on every write
    await rest(`visitor_events?created_at=lt.${encodeURIComponent(new Date(at.getTime() - 86_400_000).toISOString())}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    const rows = await rest<SharedEvent[]>('visitor_events?select=id,agent,kind,created_at', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ agent, kind, created_at: at.toISOString() }) })
    return rows[0]
  },
}

export async function POST(request: Request) {
  if (!url || !key) return Response.json({ error: 'not configured' }, { status: 503 })
  try {
    return await handleVisit(request, store, { secret: key, signal: () => broadcastSignal(url, key, 'visitor_events', { topic: VISIT_TOPIC }) })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'store failed' }, { status: 502 })
  }
}
