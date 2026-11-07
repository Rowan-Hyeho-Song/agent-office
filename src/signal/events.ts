// /api/events, minus the database: check the hook's token and payload, then turn one signal into a status
// update and (when something changed) an event row. Pure apart from the Store, so it's unit tested.
//
// The hook on the PC has already mapped its session to a seat and classified the tool into an activity kind;
// nothing else arrives here (plan.md 5.1). Anything outside the lists below is rejected, so a buggy or
// hostile client can't smuggle text into the public tables.

export const SEATS = [0, 1, 2, 3] as const
export const ACTIVITIES = ['edit', 'read', 'test', 'build', 'install', 'git', 'run', 'other', 'delegate', 'think', 'private'] as const
export type Activity = (typeof ACTIVITIES)[number]
/** the activities whose outcome is reported (the coder's signal light, the 3D turntable, #44) */
export const RESULT_ACTIVITIES = ['test', 'build'] as const
export type ResultActivity = (typeof RESULT_ACTIVITIES)[number]

/**
 * SessionStart → start, UserPromptSubmit / PreToolUse → activity, Stop → stop, SessionEnd → end,
 * and after a test / build command: result (did it pass: one boolean, nothing of the command or its output, #44)
 */
export const KINDS = ['start', 'activity', 'stop', 'end', 'result'] as const
export type Kind = (typeof KINDS)[number]

export type State = 'working' | 'wrapping' | 'idle' | 'off'

export interface StatusRow {
  seat: number
  state: State
  activity: Activity | null
  since: string
  updated_at: string
  /** the last test / build outcome: kept across other signals until the next one */
  last_result_activity: ResultActivity | null
  last_result_ok: boolean | null
  last_result_at: string | null
}

export type Signal =
  | { seat: number; kind: 'start' | 'stop' | 'end' }
  | { seat: number; kind: 'activity'; activity: Activity }
  | { seat: number; kind: 'result'; activity: ResultActivity; ok: boolean }

export interface Store {
  status(seat: number): Promise<StatusRow | null>
  setStatus(row: StatusRow): Promise<void>
  addEvent(e: { seat: number; kind: Kind; activity: Activity | null; ok: boolean | null; created_at: string }): Promise<void>
  /** drop events older than this (keeps the table small) */
  prune(before: string): Promise<void>
}

const KEEP_DAYS = 14

export function parseSignal(body: unknown): Signal | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { seat, kind, activity, ok, ...rest } = body as Record<string, unknown>
  if (Object.keys(rest).length) return null // nothing else may ride along
  if (typeof seat !== 'number' || !(SEATS as readonly number[]).includes(seat)) return null
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return null
  if (kind === 'result') {
    if (typeof activity !== 'string' || !(RESULT_ACTIVITIES as readonly string[]).includes(activity)) return null
    if (typeof ok !== 'boolean') return null
    return { seat, kind, activity: activity as ResultActivity, ok }
  }
  if (ok !== undefined) return null
  if (kind === 'activity') {
    if (typeof activity !== 'string' || !(ACTIVITIES as readonly string[]).includes(activity)) return null
    return { seat, kind, activity: activity as Activity }
  }
  if (activity !== undefined) return null
  return { seat, kind: kind as 'start' | 'stop' | 'end' }
}

/** constant-time string compare (the token is the only thing between the internet and the tables) */
export function sameToken(a: string, b: string) {
  if (!a || !b) return false
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

const NO_RESULT = { last_result_activity: null, last_result_ok: null, last_result_at: null }

/** the next status for a signal, and whether it's a change worth an event row */
export function nextStatus(prev: StatusRow | null, s: Signal, now: string): { row: StatusRow; changed: boolean } {
  const kept = prev
    ? { last_result_activity: prev.last_result_activity ?? null, last_result_ok: prev.last_result_ok ?? null, last_result_at: prev.last_result_at ?? null }
    : NO_RESULT
  if (s.kind === 'result') {
    // an outcome doesn't change what the agent is doing; it is still at work on whatever came next
    const base = prev ?? { seat: s.seat, state: 'working' as State, activity: s.activity, since: now, updated_at: now }
    return {
      row: { ...base, seat: s.seat, updated_at: now, last_result_activity: s.activity, last_result_ok: s.ok, last_result_at: now },
      changed: true,
    }
  }
  const state: State = s.kind === 'activity' ? 'working' : s.kind === 'stop' ? 'wrapping' : s.kind === 'end' ? 'off' : 'idle'
  const activity = s.kind === 'activity' ? s.activity : null
  const sameState = prev?.state === state
  // a repeated signal only refreshes updated_at (the page keeps the agent "working" while signals keep coming)
  const changed = !sameState || (state === 'working' && prev?.activity !== activity)
  return {
    row: { seat: s.seat, state, activity, since: sameState && prev ? prev.since : now, updated_at: now, ...kept },
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
  if (changed) {
    const ok = signal.kind === 'result' ? signal.ok : null
    const activity = signal.kind === 'result' ? signal.activity : row.activity
    await store.addEvent({ seat: row.seat, kind: signal.kind, activity, ok, created_at: at })
  }
  if (signal.kind === 'start') await store.prune(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString())
  return Response.json({ ok: true, state: row.state, changed })
}
