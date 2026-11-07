// Where the agents' state comes from. The office only sees this interface: today a fake source driven by the
// ?debug=1 panel, after #1 a Supabase Realtime source (agent_status rows + message events) with the same shape.

export type AgentState = 'working' | 'wrapping' | 'idle' | 'off'

export interface AgentStatus {
  state: AgentState
  /** what it's doing while working ("파일 편집 중"), from the tool name the hook sends */
  activity?: string
  /** ms since the epoch when this state began (a new wrap-up is a new `since`) */
  since: number
}

/** one agent asking or handing work to another: they meet face to face */
export interface OfficeMessage {
  id: string
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
    this.snapshot = { ...this.snapshot, [agent]: { state, activity, since: Date.now() } }
    for (const l of this.listeners) l()
  }

  send(from: string, to: string) {
    const m: OfficeMessage = { id: `m${++this.seq}`, from, to, at: Date.now() }
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
  think: '생각하는 중',
  // a session outside the office's projects, with "outside": "private" in hook.json (#34)
  private: '비공개 작업 중',
}

export const activityLabel = (activity?: string) => (activity && ACTIVITY_LABELS[activity]) || '작업 중'
