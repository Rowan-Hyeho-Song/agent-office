import { broadcastSignal, VISIT_TOPIC } from '../src/server/signal.js'
import { handleNote, NOTE_BOARD, type Note, type NoteStore } from '../src/visit/note.js'

// Vercel function for the visitors' notes (#4, office-ui.md 12.3). The page never writes the table: it calls this, and this
// checks the note again (src/visit/note.ts: the guestbook's word filter, no links, no email address or phone number, 80
// characters, a 30 s cooldown per visitor, no repeats). Tables and policies: supabase/notes.sql (visitors read the notes that
// are not hidden) and supabase/visit.sql (the cooldown rows nobody may read). After a note one content-free signal goes out
// on `office-visit`.
//
// Environment (nothing new): SUPABASE_URL, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)

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

const store: NoteStore = {
  async lastCooldown(hash) {
    const rows = await rest<{ at: string }[]>(`visit_cooldown?select=at&hash=eq.${hash}&order=at.desc&limit=1`)
    return rows[0] ? Date.parse(rows[0].at) : null
  },
  async putCooldown(hash, agent, at, before) {
    await rest(`visit_cooldown?at=lt.${encodeURIComponent(before.toISOString())}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    await rest('visit_cooldown', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ hash, agent, at: at.toISOString() }) })
  },
  async recentTexts() {
    const rows = await rest<{ text: string }[]>(`visitor_notes?select=text&hidden=eq.false&order=id.desc&limit=${NOTE_BOARD}`)
    return rows.map((r) => r.text)
  },
  async add({ agent, text, name, at }) {
    const rows = await rest<Note[]>('visitor_notes?select=id,agent,text,name,created_at', { method: 'POST', headers: { prefer: 'return=representation' }, body: JSON.stringify({ agent, text, name, created_at: at.toISOString() }) })
    return rows[0]
  },
}

export async function POST(request: Request) {
  if (!url || !key) return Response.json({ error: 'not configured' }, { status: 503 })
  try {
    return await handleNote(request, store, { secret: key, signal: () => broadcastSignal(url, key, 'visitor_notes', { topic: VISIT_TOPIC }) })
  } catch (e) {
    console.error(e)
    return Response.json({ error: 'store failed' }, { status: 502 })
  }
}
