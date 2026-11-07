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
