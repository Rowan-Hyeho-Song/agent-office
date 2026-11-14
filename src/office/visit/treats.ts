// #4 office-ui.md 12.2, the page's side of the snacks and cheers: send one (through /api/visit, never to the tables), keep
// this tab's per-robot minute, and hear the others' through a content-free signal on `office-visit` after which the last
// seconds of `visitor_events` are read (RLS: visitors may read it). Everything shown, the sender's own included, goes out
// through `onTreat` once per event id.

import type { SupabaseClient } from '@supabase/supabase-js'
import { assetUrl } from '../../room/base'
import { PER_ROBOT_MS, groupOf, type SharedEvent, type TreatKind } from '../../visit/treat'

export const VISIT_TOPIC = 'office-visit'
const VISIT_EVENT = 'changed'
/** a signal reads the events of the last this-many seconds (later than that is old news on a screen that just joined) */
export const FRESH_MS = 15_000

export interface Treat {
  /** `local:<n>` for the sender's own until the server answers (or for good when it is not shared) */
  id: string
  agent: string
  kind: TreatKind
  /** shown on this screen because this visitor gave it */
  mine: boolean
}

const listeners = new Set<(t: Treat) => void>()
export const onTreat = (cb: (t: Treat) => void) => (listeners.add(cb), () => void listeners.delete(cb))
const shown = new Set<string>()
const show = (t: Treat) => {
  if (shown.has(t.id)) return
  shown.add(t.id)
  listeners.forEach((l) => l(t))
}

// ---- this tab's minute per robot (the server checks it again) --------------------------------------------------------

const until = new Map<string, number>()
const cdKey = (agent: string, kind: TreatKind) => `${agent}|${groupOf(kind)}`
/** seconds left before this tab may give `agent` another of `kind`'s group; 0 = now */
export const waitLeft = (agent: string, kind: TreatKind, now = Date.now()) => Math.max(0, Math.ceil(((until.get(cdKey(agent, kind)) ?? 0) - now) / 1000))
const holdFor = (agent: string, kind: TreatKind, ms: number, now = Date.now()) => until.set(cdKey(agent, kind), now + ms)

let localN = 0
/**
 * Give `agent` a `kind`. It shows here at once (the server's answer is not waited for); the others see it when the server
 * shares it. Resolves to what the server said: shared, kept to this screen (the room's limit), or wait (seconds).
 */
export async function give(agent: string, kind: TreatKind, fetcher: typeof fetch = fetch): Promise<{ shared: boolean } | { wait: number } | { error: true }> {
  if (waitLeft(agent, kind)) return { wait: waitLeft(agent, kind) }
  holdFor(agent, kind, PER_ROBOT_MS)
  const local: Treat = { id: `local:${++localN}`, agent, kind, mine: true }
  show(local)
  try {
    const res = await fetcher(assetUrl('api/visit'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent, kind }) })
    const body = (await res.json().catch(() => ({}))) as { shared?: boolean; event?: SharedEvent; retryS?: number }
    if (res.status === 429 && body.retryS) {
      holdFor(agent, kind, body.retryS * 1000)
      return { wait: body.retryS }
    }
    if (!res.ok) return { error: true }
    // the signal will bring it back: it is this one, already shown
    if (body.event) shown.add(`visit:${body.event.id}`)
    return { shared: !!body.shared }
  } catch {
    return { error: true }
  }
}

/** a shared event as the others' screens get it */
export const fromRow = (r: SharedEvent): Treat => ({ id: `visit:${r.id}`, agent: r.agent, kind: r.kind, mine: false })

/** the newest events after a signal: only the fresh ones, oldest first, each once */
export function freshEvents(rows: readonly SharedEvent[], now: number, seen: ReadonlySet<string> = shown): Treat[] {
  return rows
    .filter((r) => now - Date.parse(r.created_at) <= FRESH_MS)
    .sort((a, b) => a.id - b.id)
    .map(fromRow)
    .filter((t) => !seen.has(t.id))
}

const noteSignals = new Set<() => void>()
/** #4 12.3: be told when a note was pinned somewhere (the notes list reads its table again) */
export const onNoteSignal = (cb: () => void) => (noteSignals.add(cb), () => void noteSignals.delete(cb))

/** hear the others: join `office-visit`; on a signal read the last seconds and show what is new. Returns leave */
export function listenTreats(supabase: SupabaseClient): () => void {
  let reading = false
  const read = async () => {
    if (reading) return
    reading = true
    try {
      const since = new Date(Date.now() - FRESH_MS).toISOString()
      const { data } = await supabase.from('visitor_events').select('id,agent,kind,created_at').gte('created_at', since).order('id', { ascending: true }).limit(20)
      for (const t of freshEvents((data ?? []) as SharedEvent[], Date.now())) show(t)
    } finally {
      reading = false
    }
  }
  // one channel for the visitors' things: the payload's table says which list to read again (#4: the notes ride the same topic)
  const ch = supabase.channel(VISIT_TOPIC).on('broadcast', { event: VISIT_EVENT }, (m: { payload?: { table?: unknown } }) => {
    if (m.payload?.table === 'visitor_notes') noteSignals.forEach((cb) => cb())
    else void read()
  })
  ch.subscribe()
  return () => void supabase.removeChannel(ch)
}

/** tests */
export const resetTreatsForTest = () => {
  shown.clear()
  until.clear()
  listeners.clear()
}
