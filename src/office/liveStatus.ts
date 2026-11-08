// The real status source (#1): agent_status rows from Supabase, kept current over Realtime. It plugs into the
// same StatusSource interface as the debug fake (#17).
//
// The server only records the last signal. When the signals stop, the page decides what that means from the
// row's timestamps, so every visitor reaches the same answer without a server timer:
//   working, quiet for 3 min  → idle      (the session is waiting for its user, or a long command runs)
//   wrapping, quiet for 2 min → idle
//   anything, quiet for 2 h   → off       (offReason 'quiet'; no row at all = 'none')
// "off" only means no work signal. Whether that is rest by day or sleep at night is duty.ts's call (#110).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentState, AgentStatus, AgentTask, OfficeMessage, StatusMap, StatusSource } from './status'

export interface StatusRow {
  seat: number
  state: AgentState
  activity: string | null
  since: string
  updated_at: string
  /** #44: the last test / build outcome (absent on rows from before it) */
  last_result_activity?: 'test' | 'build' | null
  last_result_ok?: boolean | null
  last_result_at?: string | null
  /** #182: the issue it is on; task_private = a private repo (no repo / number / title) */
  task_repo?: string | null
  task_issue?: number | null
  task_title?: string | null
  task_private?: boolean | null
}

export const COLUMNS = 'seat,state,activity,since,updated_at,last_result_activity,last_result_ok,last_result_at,task_repo,task_issue,task_title,task_private'

export const WORKING_FOR = 3 * 60_000
export const WRAPPING_FOR = 2 * 60_000
export const OFF_AFTER = 2 * 3_600_000

/** what a row means at `now` (ms) */
export function effective(row: StatusRow, now: number): AgentStatus {
  const updated = Date.parse(row.updated_at)
  const since = Date.parse(row.since)
  const quiet = now - updated
  const result =
    row.last_result_activity && typeof row.last_result_ok === 'boolean' && row.last_result_at
      ? { lastResult: { activity: row.last_result_activity, ok: row.last_result_ok, at: Date.parse(row.last_result_at) } }
      : {}
  const task: { task?: AgentTask } = row.task_private
    ? { task: { private: true, repo: null, issue: null, title: null } }
    : row.task_repo && typeof row.task_issue === 'number'
      ? { task: { private: false, repo: row.task_repo, issue: row.task_issue, title: row.task_title ?? null } }
      : {}
  let s: AgentStatus
  if (row.state === 'off') s = { state: 'off', since, offReason: 'ended' }
  else if (quiet > OFF_AFTER) s = { state: 'off', since: updated + OFF_AFTER, offReason: 'quiet' }
  else if (row.state === 'working' && quiet > WORKING_FOR) s = { state: 'idle', since: updated + WORKING_FOR }
  else if (row.state === 'wrapping' && quiet > WRAPPING_FOR) s = { state: 'idle', since: updated + WRAPPING_FOR }
  else s = row.activity ? { state: row.state, activity: row.activity, since } : { state: row.state, since }
  return { ...s, ...result, ...(s.state === 'working' || s.state === 'wrapping' ? task : {}) }
}

const agentOf = (seat: number) => `agent_${seat}`

/** rows → status map; agents without a row yet are off */
export function toStatusMap(rows: StatusRow[], agents: string[], now: number): StatusMap {
  const out: StatusMap = Object.fromEntries(agents.map((a) => [a, { state: 'off', since: 0, offReason: 'none' } satisfies AgentStatus]))
  for (const r of rows) if (agentOf(r.seat) in out) out[agentOf(r.seat)] = effective(r, now)
  return out
}

const sameMap = (a: StatusMap, b: StatusMap) => JSON.stringify(a) === JSON.stringify(b)

const shared = new WeakMap<SupabaseClient, LiveStatusSource>()

/**
 * The one source of a client. The page builds its world twice in development (React StrictMode runs the
 * useState initializer twice), and a second source would add listeners to the realtime channel the first one
 * already subscribed (client.channel() hands back the same topic), which throws.
 */
export function liveStatusFor(client: SupabaseClient, agents: string[]): LiveStatusSource {
  let s = shared.get(client)
  if (!s) {
    s = new LiveStatusSource(client, agents)
    shared.set(client, s)
  }
  return s
}

export class LiveStatusSource implements StatusSource {
  private rows = new Map<number, StatusRow>()
  private snapshot: StatusMap
  private listeners = new Set<() => void>()
  private client: SupabaseClient
  private agents: string[]
  private now: () => number
  /** set when the first load or the subscription failed (shown in the list) */
  error: string | null = null

  constructor(client: SupabaseClient, agents: string[], now: () => number = Date.now) {
    this.client = client
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
      // a new handoff row = a paper plane (#51)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_events', filter: 'kind=eq.handoff' }, (p) => {
        const m = toHandoff(p.new as EventRow, this.agents)
        if (m) for (const l of this.messageListeners) l(m)
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.error = '실시간 연결이 끊겼어요'
        if (status === 'SUBSCRIBED') this.error = null
      })
    const { data, error } = await this.client.from('agent_status').select(COLUMNS)
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

  private messageListeners = new Set<(m: OfficeMessage) => void>()

  // handoffs only for now; face-to-face talks come with the meeting replays (minutes, #24 docs)
  onMessage = (listener: (m: OfficeMessage) => void) => {
    this.messageListeners.add(listener)
    return () => void this.messageListeners.delete(listener)
  }
}

export interface EventRow {
  id: number
  seat: number
  kind: string
  to_seat: number | null
  created_at: string
}

/** an agent_events handoff row → a paper plane message (null for anything else or an unknown seat) */
export function toHandoff(row: EventRow | null | undefined, agents: string[]): OfficeMessage | null {
  if (!row || row.kind !== 'handoff' || typeof row.to_seat !== 'number') return null
  const from = agentOf(row.seat)
  const to = agentOf(row.to_seat)
  if (!agents.includes(from) || !agents.includes(to) || from === to) return null
  return { id: `e${row.id}`, kind: 'handoff', from, to, at: Date.parse(row.created_at) }
}
