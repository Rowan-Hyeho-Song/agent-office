// Day, night and the night shift (#110, plan 4 / 8.1). The raw status says what the signals mean; this layer says
// what the office does with "nobody is working": by day they rest and play, at night they doze at their desks
// (lights going off one seat at a time) and one agent, picked from the night's date, stays up on night duty.
// Pure functions plus a StatusSource wrapper that applies them.

import { isNight, minutesIntoNight, nightDate } from './kst'
import type { AgentStatus, OfficeMessage, StatusMap, StatusSource } from './status'

export const NIGHT = {
  /** the desks go dark one by one: seat N dims this many minutes × N after 23:00 */
  staggerMin: 3,
}

function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** the agent on night duty: one of the roster, from the night's date alone (the same for every visitor) */
export function nightDuty(agents: string[], ms: number): string {
  const roster = [...agents].sort()
  return roster[hash(nightDate(ms)) % roster.length]
}

export type Duty = 'work' | 'rest' | 'sleep' | 'duty'

/**
 * What one agent's status becomes at `ms`:
 *   working / wrapping  → unchanged (a signal always wins)
 *   no signal, by day   → idle (rests and plays; never leaves)
 *   no signal, at night → off + night 'sleep' (dozes at its desk, monitor 퇴근), or idle + night 'duty' (the one awake)
 */
export function dutyStatus(s: AgentStatus, agent: string, agents: string[], ms: number): AgentStatus {
  if (s.state === 'working' || s.state === 'wrapping') return s
  const rest: AgentStatus = s.state === 'idle' ? s : { ...s, state: 'idle' }
  if (!isNight(ms)) return rest
  const seat = Number(agent.split('_')[1]) || 0
  if (minutesIntoNight(ms) < seat * NIGHT.staggerMin) return rest // its light is still on
  // the night-duty agent stays "idle": its monitor shows the rest screensaver and its desk light stays on
  return nightDuty(agents, ms) === agent ? { ...s, state: 'idle', night: 'duty' } : { ...s, state: 'off', night: 'sleep' }
}

export function dutyOf(s: AgentStatus | undefined): Duty {
  if (!s) return 'rest'
  if (s.state === 'working' || s.state === 'wrapping') return 'work'
  return s.night ?? 'rest'
}

export function applyDuty(raw: StatusMap, agents: string[], ms: number): StatusMap {
  return Object.fromEntries(Object.entries(raw).map(([a, s]) => [a, dutyStatus(s, a, agents, ms)]))
}

/**
 * The status source the office reads: the real or fake one with day / night applied at `now()`. The snapshot is
 * cached (useSyncExternalStore) and only replaced when something changed; time passing is noticed by a slow poll.
 */
export class DutySource implements StatusSource {
  private snapshot: StatusMap
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(
    private inner: StatusSource,
    private agents: string[],
    private now: () => number = Date.now,
  ) {
    this.snapshot = applyDuty(inner.getSnapshot(), agents, now())
    inner.subscribe(() => this.refresh())
    if (typeof setInterval === 'function') this.timer = setInterval(() => this.refresh(), 5_000)
  }

  /** look again (the inner source changed, time passed, or the debug clock moved) */
  refresh() {
    const next = applyDuty(this.inner.getSnapshot(), this.agents, this.now())
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return
    this.snapshot = next
    for (const l of this.listeners) l()
  }

  dispose() {
    if (this.timer) clearInterval(this.timer)
  }

  getSnapshot = () => this.snapshot
  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => void this.listeners.delete(l)
  }
  onMessage = (l: (m: OfficeMessage) => void) => this.inner.onMessage(l)
}
