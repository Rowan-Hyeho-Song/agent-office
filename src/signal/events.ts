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
 * after a test / build command: result (did it pass: one boolean, nothing of the command or its output, #44),
 * and a message to another agent: handoff (only the receiver's seat, never the message, #51)
 */
export const KINDS = ['start', 'activity', 'stop', 'end', 'result', 'handoff'] as const
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
  /**
   * #182: the issue the agent is on. Each signal carries the current task or none; none clears it. A private
   * repo stores only task_private = true (no repo, no number); a public one its short repo name, number and
   * the title the server found in the public docs (null when there is none). All null = no task.
   */
  task_repo?: string | null
  task_issue?: number | null
  task_title?: string | null
  task_private?: boolean | null
}

/** the task a signal names, as the hook sends it: a repo (short name or owner/name) and an issue number */
export interface TaskRef {
  repo: string
  issue: number
}

export type Signal = (
  | { seat: number; kind: 'start' | 'stop' | 'end' }
  | { seat: number; kind: 'activity'; activity: Activity }
  | { seat: number; kind: 'result'; activity: ResultActivity; ok: boolean }
  | { seat: number; kind: 'handoff'; to: number }
) & { task?: TaskRef }

/** a task as stored on the status row */
export type StoredTask = Pick<StatusRow, 'task_repo' | 'task_issue' | 'task_title' | 'task_private'>
const NO_TASK: StoredTask = { task_repo: null, task_issue: null, task_title: null, task_private: null }

/** server-side lists (#182): which repos a task may name, and which of them are public */
export interface TaskConfig {
  /** "owner/name"; the hook may also send just "name" */
  repos: string[]
  /** "owner/name" whose documents are public (the same rule as OFFICE_PUBLIC_REPOS of /api/docs) */
  publicRepos: string[]
}
export const DEFAULT_TASK_CONFIG: TaskConfig = {
  repos: ['Rowan-Hyeho-Song/agent-office', 'Rowan-Hyeho-Song/rowansong.dev'],
  publicRepos: ['Rowan-Hyeho-Song/agent-office'],
}
export const MAX_ISSUE = 1_000_000

const shortName = (repo: string) => repo.slice(repo.lastIndexOf('/') + 1).toLowerCase()

/** the full "owner/name" a task repo means, or null when it is not in the list */
export function matchRepo(repo: unknown, repos: string[]): string | null {
  if (typeof repo !== 'string' || repo.length > 100 || !/^[\w.-]+(\/[\w.-]+)?$/.test(repo)) return null
  const wanted = repo.toLowerCase()
  return repos.find((r) => r.toLowerCase() === wanted) ?? repos.find((r) => !wanted.includes('/') && shortName(r) === wanted) ?? null
}

export interface Store {
  status(seat: number): Promise<StatusRow | null>
  setStatus(row: StatusRow): Promise<void>
  addEvent(e: { seat: number; kind: Kind; activity: Activity | null; ok: boolean | null; to_seat: number | null; created_at: string }): Promise<void>
  /** the title of a public issue's plan document (#182), or null when there is none */
  issueTitle?(repo: string, issue: number): Promise<string | null>
  /** drop events older than this (keeps the table small) */
  prune(before: string): Promise<void>
}

const KEEP_DAYS = 14

export function parseSignal(body: unknown, repos: string[] = DEFAULT_TASK_CONFIG.repos): Signal | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { seat, kind, activity, ok, to, repo, issue, ...rest } = body as Record<string, unknown>
  if (Object.keys(rest).length) return null // nothing else may ride along
  const signal = parseKind({ seat, kind, activity, ok, to })
  if (!signal) return null
  // #182: the task is optional; a bad repo or number is ignored, it doesn't fail the event
  if (typeof repo === 'string' && typeof issue === 'number' && Number.isInteger(issue) && issue >= 1 && issue <= MAX_ISSUE && matchRepo(repo, repos) !== null) {
    return { ...signal, task: { repo, issue } }
  }
  return signal
}

function parseKind(body: Record<string, unknown>): Signal | null {
  const { seat, kind, activity, ok, to } = body
  if (typeof seat !== 'number' || !(SEATS as readonly number[]).includes(seat)) return null
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return null
  if (kind === 'result') {
    if (to !== undefined) return null
    if (typeof activity !== 'string' || !(RESULT_ACTIVITIES as readonly string[]).includes(activity)) return null
    if (typeof ok !== 'boolean') return null
    return { seat, kind, activity: activity as ResultActivity, ok }
  }
  if (ok !== undefined) return null
  if (kind === 'handoff') {
    if (activity !== undefined) return null
    if (typeof to !== 'number' || !(SEATS as readonly number[]).includes(to) || to === seat) return null
    return { seat, kind, to }
  }
  if (to !== undefined) return null
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
export function nextStatus(prev: StatusRow | null, s: Signal, now: string, task: StoredTask = NO_TASK): { row: StatusRow; changed: boolean } {
  const kept = prev
    ? { last_result_activity: prev.last_result_activity ?? null, last_result_ok: prev.last_result_ok ?? null, last_result_at: prev.last_result_at ?? null }
    : NO_RESULT
  if (s.kind === 'result') {
    // an outcome doesn't change what the agent is doing; it is still at work on whatever came next
    const base = prev ?? { seat: s.seat, state: 'working' as State, activity: s.activity, since: now, updated_at: now }
    return {
      row: { ...base, seat: s.seat, updated_at: now, last_result_activity: s.activity, last_result_ok: s.ok, last_result_at: now, ...task },
      changed: true,
    }
  }
  if (s.kind === 'handoff') {
    // handing work over is a moment, not a state: the agent goes on working; the event row carries the plane
    const base = prev ?? { seat: s.seat, state: 'working' as State, activity: 'delegate' as Activity, since: now, updated_at: now, ...kept }
    return { row: { ...base, seat: s.seat, updated_at: now, ...task }, changed: true }
  }
  const state: State = s.kind === 'activity' ? 'working' : s.kind === 'stop' ? 'wrapping' : s.kind === 'end' ? 'off' : 'idle'
  const activity = s.kind === 'activity' ? s.activity : null
  const sameState = prev?.state === state
  // a repeated signal only refreshes updated_at (the page keeps the agent "working" while signals keep coming)
  const changed = !sameState || (state === 'working' && prev?.activity !== activity)
  return {
    row: { seat: s.seat, state, activity, since: sameState && prev ? prev.since : now, updated_at: now, ...kept, ...(s.kind === 'end' ? NO_TASK : task) },
    changed,
  }
}

/**
 * The task a signal names, as stored (#182). Only repos in the server's list count; a private one keeps no
 * repo or number; a public one looks its title up from the public plan document (reusing the title already on
 * the row while it is the same issue, so a busy session doesn't query on every tool call).
 */
export async function resolveTask(task: TaskRef | undefined, prev: StatusRow | null, store: Store, cfg: TaskConfig): Promise<StoredTask> {
  if (!task) return NO_TASK
  const repo = matchRepo(task.repo, cfg.repos)
  if (!repo) return NO_TASK
  if (!cfg.publicRepos.some((r) => r.toLowerCase() === repo.toLowerCase())) return { ...NO_TASK, task_private: true }
  const name = repo.slice(repo.lastIndexOf('/') + 1)
  const same = prev?.task_repo === name && prev.task_issue === task.issue
  let title = same ? (prev?.task_title ?? null) : null
  if (title === null && store.issueTitle) {
    try {
      title = await store.issueTitle(repo, task.issue)
    } catch {
      title = null // the title is a nicety; never fail the signal for it
    }
  }
  return { task_repo: name, task_issue: task.issue, task_title: title, task_private: false }
}

export async function handle(request: Request, store: Store, token: string, now = new Date(), cfg: TaskConfig = DEFAULT_TASK_CONFIG): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  const auth = request.headers.get('authorization') ?? ''
  if (!sameToken(auth.replace(/^Bearer\s+/i, ''), token)) return Response.json({ error: 'unauthorized' }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 })
  }
  const signal = parseSignal(body, cfg.repos)
  if (!signal) return Response.json({ error: 'bad signal' }, { status: 400 })

  const at = now.toISOString()
  const prev = await store.status(signal.seat)
  const task = await resolveTask(signal.task, prev, store, cfg)
  const { row, changed } = nextStatus(prev, signal, at, task)
  await store.setStatus(row)
  if (changed) {
    const ok = signal.kind === 'result' ? signal.ok : null
    const activity = signal.kind === 'result' ? signal.activity : signal.kind === 'handoff' ? null : row.activity
    const to_seat = signal.kind === 'handoff' ? signal.to : null
    await store.addEvent({ seat: row.seat, kind: signal.kind, activity, ok, to_seat, created_at: at })
  }
  if (signal.kind === 'start') await store.prune(new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString())
  return Response.json({ ok: true, state: row.state, changed })
}
