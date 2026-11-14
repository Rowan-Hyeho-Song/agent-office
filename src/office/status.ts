// Where the agents' state comes from. The office only sees this interface: today a fake source driven by the
// ?debug=1 panel, after #1 a Supabase Realtime source (agent_status rows + message events) with the same shape.

export type AgentState = 'working' | 'wrapping' | 'idle' | 'off'

export interface AgentStatus {
  state: AgentState
  /** what it's doing while working ("파일 편집 중"), from the tool name the hook sends */
  activity?: string
  /** ms since the epoch when this state began (a new wrap-up is a new `since`) */
  since: number
  /** why an agent is off: no session yet, quiet for 2 h, or the session ended (real rows; absent on the fake) */
  offReason?: 'none' | 'quiet' | 'ended'
  /** set by duty.ts on an off agent at night: dozing at its desk, or the one awake on night duty */
  night?: 'sleep' | 'duty'
  /** the last test / build outcome the hook reported (#44: the coder's signal light, the 3D ring light) */
  lastResult?: { activity: 'test' | 'build'; ok: boolean; at: number }
  /** #182: the issue it is on (only while working / wrapping). A private repo carries no repo, number or title. */
  task?: AgentTask
}

export type AgentTask = { private: true; repo: null; issue: null; title: null } | { private: false; repo: string; issue: number; title: string | null }

/** the office's own repository: its issues show as "#170"; another repository's with its name ("rowansong.dev#12") */
export const OWN_REPO = 'agent-office'
export const taskNumber = (t: Extract<AgentTask, { private: false }>) => (t.repo === OWN_REPO ? `#${t.issue}` : `${t.repo}#${t.issue}`)
export const PRIVATE_TASK_LABEL = '책상 방 작업(비공개)'
/** the task as one plain sentence part (screen readers, title attributes): "#170 제목" / the private label */
export const taskText = (t: AgentTask) => (t.private ? PRIVATE_TASK_LABEL : t.title ? `${taskNumber(t)} ${t.title}` : taskNumber(t))
/** the task shows only while the agent is at work or wrapping up */
export const taskOf = (s: AgentStatus | undefined) => (s && (s.state === 'working' || s.state === 'wrapping') ? s.task : undefined)
/** cut to n characters with an ellipsis */
export const clip = (text: string, n: number) => (Array.from(text).length > n ? `${Array.from(text).slice(0, n - 1).join('')}…` : text)

/**
 * One agent reaching another (plan.md 4.1, #28 decision): a talk is a face-to-face meeting; a handoff (a message
 * between sessions, an issue assigned) is a paper plane thrown to the other desk (#51).
 */
export interface OfficeMessage {
  id: string
  kind: 'talk' | 'handoff'
  from: string
  to: string
  at: number
}

export type StatusMap = Record<string, AgentStatus>

export interface StatusSource {
  /** the current status of every agent; a new object whenever anything changed */
  getSnapshot(): StatusMap
  subscribe(listener: () => void): () => void
  onMessage(listener: (m: OfficeMessage) => void): () => void
}

/** in-memory source for development: everyone idle until the debug panel says otherwise */
export class FakeStatusSource implements StatusSource {
  private snapshot: StatusMap
  private listeners = new Set<() => void>()
  private messageListeners = new Set<(m: OfficeMessage) => void>()
  private seq = 0

  constructor(agents: string[], now = Date.now()) {
    this.snapshot = Object.fromEntries(agents.map((a) => [a, { state: 'idle', since: now } satisfies AgentStatus]))
  }

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  onMessage = (listener: (m: OfficeMessage) => void) => {
    this.messageListeners.add(listener)
    return () => void this.messageListeners.delete(listener)
  }

  set(agent: string, state: AgentState, activity?: string) {
    const { lastResult, task } = this.snapshot[agent] ?? {}
    this.snapshot = { ...this.snapshot, [agent]: { state, activity, since: Date.now(), ...(state === 'off' ? { offReason: 'ended' as const } : {}), ...(lastResult ? { lastResult } : {}), ...(task ? { task } : {}) } }
    for (const l of this.listeners) l()
  }

  /** the issue an agent is on (the debug panel, #182); undefined clears it */
  setTask(agent: string, task?: AgentTask) {
    const { task: _old, ...rest } = this.snapshot[agent] ?? { state: 'idle' as const, since: Date.now() }
    this.snapshot = { ...this.snapshot, [agent]: { ...rest, ...(task ? { task } : {}) } }
    for (const l of this.listeners) l()
  }

  /** a test / build finished (the debug panel's pass / fail buttons) */
  setResult(agent: string, activity: 'test' | 'build', ok: boolean) {
    const s = this.snapshot[agent]
    this.snapshot = { ...this.snapshot, [agent]: { ...s, lastResult: { activity, ok, at: Date.now() } } }
    for (const l of this.listeners) l()
  }

  send(from: string, to: string, kind: OfficeMessage['kind'] = 'talk') {
    const m: OfficeMessage = { id: `m${++this.seq}`, kind, from, to, at: Date.now() }
    for (const l of this.messageListeners) l(m)
  }
}

/**
 * Activity kinds the hook sends (hooks/classify.mjs) and their words on screen. Same keys and labels as the
 * design's ACTIVITIES table (docs/design/office-ui.html).
 */
export const ACTIVITY_LABELS: Record<string, string> = {
  edit: '파일 편집 중',
  read: '코드 읽는 중',
  test: '테스트 실행 중',
  build: '빌드 중',
  install: '설치 중',
  git: '버전 기록 중',
  run: '앱 실행 중',
  other: '명령 실행 중',
  delegate: '일 나누는 중',
  think: '생각 중',
  // a session outside the office's projects, with "outside": "private" in hook.json (#34)
  private: '비공개 작업 중',
}

export const activityLabel = (activity?: string) => (activity && ACTIVITY_LABELS[activity]) || '작업 중'

export const STATE_LABELS = { working: '', wrapping: '정리 중', idle: '휴식 중', off: '퇴근' } as const

/** the one line of what an agent is doing, as the agent list (and the badge, #4) shows it; `detail` is the director's (#186) */
export function statusLine(s: AgentStatus | undefined, detail?: string): string {
  if (!s) return '…'
  if (s.state === 'wrapping' && detail) return `정리 중 · ${detail}`
  return detail ?? (s.state === 'working' ? activityLabel(s.activity) : s.night === 'sleep' ? '조는 중' : s.night === 'duty' ? '야간 당번' : STATE_LABELS[s.state])
}
