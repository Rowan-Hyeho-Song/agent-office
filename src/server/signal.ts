// #240 the server's "something changed" signal. After a write the Vercel functions broadcast ONE content-free message on
// the public channel `office-signal`: which table (approvals | docs) and when. Nothing else rides on it, so a public
// channel leaks nothing; the page answers by re-reading what it is allowed to read (cover views for visitors).
// Supabase Realtime's HTTP endpoint: POST {SUPABASE_URL}/realtime/v1/api/broadcast. Never imported by the page.

export type SignalTable = 'approvals' | 'docs' | 'visitor_events' | 'visitor_notes'

/** the channel and event the page listens to (src/office/signal.ts uses the same names) */
export const SIGNAL_TOPIC = 'office-signal'
/** #4 the visitors' snacks and cheers have their own topic (src/office/visit/feed.ts): shown at once, not coalesced with the lists */
export const VISIT_TOPIC = 'office-visit'
export const SIGNAL_EVENT = 'changed'

/** the whole payload: the table and the time, nothing else */
export const signalPayload = (table: SignalTable, at: Date = new Date()) => ({ table, at: at.toISOString() })

/** a short wait so a slow Realtime never holds a write's answer */
export const SIGNAL_TIMEOUT_MS = 1500

/**
 * Send one signal. Resolves true when Supabase took it; false on any failure (network, timeout, a refusal). It never
 * throws: a failed signal must not fail the write that already happened (the page's poll catches up), only logs.
 */
export async function broadcastSignal(
  url: string,
  key: string,
  table: SignalTable,
  opts: { fetch?: typeof fetch; now?: Date; timeoutMs?: number; topic?: string } = {},
): Promise<boolean> {
  try {
    // legacy keys are JWTs and go in both headers; new sb_secret_ keys aren't JWTs and go in `apikey` only
    const auth: Record<string, string> = key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key }
    const res = await (opts.fetch ?? fetch)(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: opts.topic ?? SIGNAL_TOPIC, event: SIGNAL_EVENT, payload: signalPayload(table, opts.now) }] }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? SIGNAL_TIMEOUT_MS),
    })
    if (!res.ok) console.error(`signal ${table}: ${res.status}`)
    return res.ok
  } catch (e) {
    console.error(`signal ${table} failed:`, e instanceof Error ? e.message : 'error')
    return false
  }
}

/**
 * Collects which tables a request wrote, then signals each once when the request is done (several rows or several
 * writes in one request = one signal per table). `note` after a write that succeeded, `flush` before answering.
 */
export function signals(url: string, key: string, opts: Parameters<typeof broadcastSignal>[3] = {}) {
  const touched = new Set<SignalTable>()
  return {
    note: (table: SignalTable) => void touched.add(table),
    /** wrap a store write: noted only when it resolved */
    after<A extends unknown[], R>(table: SignalTable, write: (...args: A) => Promise<R>) {
      return async (...args: A): Promise<R> => {
        const out = await write(...args)
        touched.add(table)
        return out
      }
    },
    async flush() {
      const tables = [...touched]
      touched.clear()
      await Promise.all(tables.map((t) => broadcastSignal(url, key, t, opts)))
    },
  }
}
