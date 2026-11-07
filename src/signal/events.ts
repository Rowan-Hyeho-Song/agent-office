// /api/events, minus the database: check the hook's token and payload, then turn one signal into a status
// update and (when something changed) an event row. Pure apart from the Store, so it's unit tested.
//
// The hook on the PC has already mapped its session to a seat and classified the tool into an activity kind;
// nothing else arrives here (plan.md 5.1). Anything outside the lists below is rejected, so a buggy or
// hostile client can't smuggle text into the public tables.

export const SEATS = [0, 1, 2, 3] as const
export const ACTIVITIES = ['edit', 'read', 'test', 'build', 'install', 'git', 'run', 'other', 'delegate', 'think'] as const
export type Activity = (typeof ACTIVITIES)[number]

/** SessionStart → start, UserPromptSubmit / Pre- / PostToolUse → activity, Stop → stop, SessionEnd → end */
export const KINDS = ['start', 'activity', 'stop', 'end'] as const
export type Kind = (typeof KINDS)[number]

export type State = 'working' | 'wrapping' | 'idle' | 'off'

export interface StatusRow {
  seat: number
  state: State
  activity: Activity | null
  since: string
  updated_at: string
}

export interface Signal {
  seat: number
  kind: Kind
  activity?: Activity
}

export interface Store {
  status(seat: number): Promise<StatusRow | null>
  setStatus(row: StatusRow): Promise<void>
  addEvent(e: { seat: number; kind: Kind; activity: Activity | null; created_at: string }): Promise<void>
  /** drop events older than this (keeps the table small) */
  prune(before: string): Promise<void>
}

const KEEP_DAYS = 14

export function parseSignal(body: unknown): Signal | null {
  if (!body || typeof body !== 'object') return null
  const { seat, kind, activity } = body as Record<string, unknown>
  if (typeof seat !== 'number' || !(SEATS as readonly number[]).includes(seat)) return null
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return null
  if (kind === 'activity') {
    if (typeof activity !== 'string' || !(ACTIVITIES as readonly string[]).includes(activity)) return null
    return { seat, kind, activity: activity as Activity }
  }
  if (activity !== undefined) return null
  return { seat, kind: kind as Kind }
}

/** constant-time string compare (the token is the only thing between the internet and the tables) */
export function sameToken(a: string, b: string) {
  if (!a || !b) return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** the next status for a signal, and whether it's a change worth an event row */
export function nextStatus(prev: StatusRow | null, s: Signal, now: string): { row: StatusRow; changed: boolean } {
  const state: State = s.kind === 'activity' ? 'working' : s.kind === 'stop' ? 'wrapping' : s.kind === 'end' ? 'off' : 'idle'
  const activity = s.kind === 'activity' ? s.activity! : null
  const sameState = prev?.state === state
  // a repeated signal only refreshes updated_at (the page keeps the agent "working" while signals keep coming)
  const changed = !sameState || (state === 'working' && prev?.activity !== activity)
  return {
    row: { seat: s.seat, state, activity, since: sameState && prev ? prev.since : now, updated_at: now },
    changed,
  }
}

export async function handle(request: Request, store: Store, token: string, now = new Date()): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const auth = request.headers.get('authorization') ?? ''
  if (!sameToken(auth.replace(/^Bearer\s+/i, ''), token)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }
  const signal = parseSignal(body)
  if (!signal) return Response.json({ error: 'bad signal' }, { status: 400 })

  const at = now.toISOString()
  const { row, changed } = nextStatus(await store.status(signal.seat), signal, at)
  await store.setStatus(row)
  if (changed) await store.addEvent({ seat: row.seat, kind: signal.kind, activity: row.activity, created_at: at })
  if (signal.kind === 'start') await store.prune(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString())
  return Response.json({ ok: true, state: row.state, changed })
}
