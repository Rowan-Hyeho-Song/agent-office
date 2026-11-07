// What the LIVE desk props need besides the agents' statuses (#44): the approval box's waiting count and who is
// waiting (visitor-safe covers only, #25), when the owner last decided, and how much work the planner handed
// out today. Same pattern as the status sources: a live one (Supabase, polled) and a fake one for ?debug=1.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PropsInput } from './props'

export type PropsExtra = Omit<PropsInput, 'status' | 'now'>

export interface PropsFeed {
  getSnapshot(): PropsExtra
  subscribe(listener: () => void): () => void
}

const EMPTY: PropsExtra = { pending: 0, waitingSeats: [], decidedAt: null, handoffsToday: 0 }

class Base implements PropsFeed {
  protected snapshot: PropsExtra = EMPTY
  private listeners = new Set<() => void>()
  getSnapshot = () => this.snapshot
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
  protected emit(next: PropsExtra) {
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return
    this.snapshot = next
    for (const l of this.listeners) l()
  }
}

/** the debug panel's hands on every input */
export class FakePropsFeed extends Base {
  set(patch: Partial<PropsExtra>) {
    this.emit({ ...this.snapshot, ...patch })
  }
}

/** local midnight, as an ISO string: "today" is the visitor's day, like the desk calendar */
const todayStart = (now: number) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

const POLL_MS = 30_000

export class LivePropsFeed extends Base {
  private client: SupabaseClient
  private now: () => number

  constructor(client: SupabaseClient, now: () => number = Date.now) {
    super()
    this.client = client
    this.now = now
    void this.poll()
    setInterval(() => void this.poll(), POLL_MS)
  }

  private async poll() {
    const [covers, handoffs] = await Promise.all([
      this.client.from('approvals_cover').select('requester_seat'),
      this.client
        .from('agent_events')
        .select('id', { count: 'exact', head: true })
        .eq('seat', 0)
        .eq('kind', 'activity')
        .eq('activity', 'delegate')
        .gte('created_at', todayStart(this.now())),
    ])
    if (covers.error || handoffs.error) return // keep what we had (tables not there yet, or offline)
    const rows = (covers.data ?? []) as { requester_seat: number | null }[]
    const pending = rows.length
    const prev = this.snapshot
    // the count went down: the owner just decided something (the planner stamps)
    const decidedAt = pending < prev.pending ? this.now() : prev.decidedAt
    const waitingSeats = [...new Set(rows.flatMap((r) => (r.requester_seat === null ? [] : [r.requester_seat])))].sort()
    this.emit({ pending, waitingSeats, decidedAt, handoffsToday: handoffs.count ?? 0 })
  }
}
