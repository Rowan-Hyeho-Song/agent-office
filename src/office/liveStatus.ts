// The real status source (#1): agent_status rows from Supabase, kept current over Realtime. It plugs into the
// same StatusSource interface as the debug fake (#17).
//
// The server only records the last signal. When the signals stop, the page decides what that means from the
// row's timestamps, so every visitor reaches the same answer without a server timer:
//   working, quiet for 3 min  → idle      (the session is waiting for its user, or a long command runs)
//   wrapping, quiet for 2 min → idle
//   anything, quiet for 2 h   → off       (gone home)

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AgentState, AgentStatus, OfficeMessage, StatusMap, StatusSource } from './status'

export interface StatusRow {
  seat: number
  state: AgentState
  activity: string | null
  since: string
  updated_at: string
}

export const WORKING_FOR = 3 * 60_000
export const WRAPPING_FOR = 2 * 60_000
export const OFF_AFTER = 2 * 3_600_000

/** what a row means at `now` (ms) */
export function effective(row: StatusRow, now: number): AgentStatus {
  const updated = Date.parse(row.updated_at)
  const since = Date.parse(row.since)
  const quiet = now - updated
  if (row.state === 'off') return { state: 'off', since }
  if (quiet > OFF_AFTER) return { state: 'off', since: updated + OFF_AFTER }
  if (row.state === 'working' && quiet > WORKING_FOR) return { state: 'idle', since: updated + WORKING_FOR }
  if (row.state === 'wrapping' && quiet > WRAPPING_FOR) return { state: 'idle', since: updated + WRAPPING_FOR }
  return row.activity ? { state: row.state, activity: row.activity, since } : { state: row.state, since }
}

const agentOf = (seat: number) => `agent_${seat}`

/** rows → status map; agents without a row yet are off */
export function toStatusMap(rows: StatusRow[], agents: string[], now: number): StatusMap {
  const out: StatusMap = Object.fromEntries(agents.map((a) => [a, { state: 'off', since: 0 } satisfies AgentStatus]))
  for (const r of rows) if (agentOf(r.seat) in out) out[agentOf(r.seat)] = effective(r, now)
  return out
}

const sameMap = (a: StatusMap, b: StatusMap) => JSON.stringify(a) === JSON.stringify(b)

export class LiveStatusSource implements StatusSource {
  private rows = new Map<number, StatusRow>()
  private snapshot: StatusMap
  private listeners = new Set<() => void>()
  private client: SupabaseClient
  private agents: string[]
  private now: () => number
  /** set when the first load or the subscription failed (shown in the list) */
  error: string | null = null

  constructor(url: string, key: string, agents: string[], now: () => number = Date.now) {
    this.client = createClient(url, key, { auth: { persistSession: false } })
    this.agents = agents
    this.now = now
    this.snapshot = toStatusMap([], agents, now())
    void this.start()
    // quiet rows turn idle / off by time alone, so look again now and then
    setInterval(() => this.recompute(), 10_000)
  }

  private async start() {
    this.client
      .channel('agent_status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_status' }, (p) => {
        const row = p.new as StatusRow
        if (typeof row?.seat === 'number') {
          this.rows.set(row.seat, row)
          this.recompute()
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.error = '실시간 연결이 끊겼어요'
        if (status === 'SUBSCRIBED') this.error = null
      })
    const { data, error } = await this.client.from('agent_status').select('seat,state,activity,since,updated_at')
    if (error) {
      this.error = '상태를 불러오지 못했어요'
      return
    }
    for (const r of data as StatusRow[]) if (!this.rows.has(r.seat)) this.rows.set(r.seat, r)
    this.recompute()
  }

  private recompute() {
    const next = toStatusMap([...this.rows.values()], this.agents, this.now())
    if (sameMap(next, this.snapshot)) return
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  // face-to-face messages come with a later hook (SendMessage between sessions); none yet
  onMessage = (_listener: (m: OfficeMessage) => void) => () => {}
}
