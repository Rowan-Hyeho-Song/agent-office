import { describe, expect, it } from 'vitest'
import { liveStatusFor, OFF_AFTER, WORKING_FOR, WRAPPING_FOR, effective, toHandoff, toStatusMap, type EventRow, type StatusRow } from './liveStatus'

const MIN = 60_000
const NOW = Date.parse('2026-03-15T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const row = (over: Partial<StatusRow> & { quietMs?: number } = {}): StatusRow => {
  const { quietMs = 0, ...rest } = over
  return {
    seat: 0,
    state: 'working',
    activity: 'edit',
    since: iso(NOW - quietMs - 10 * MIN),
    updated_at: iso(NOW - quietMs),
    ...rest,
  }
}

describe('constants', () => {
  it('match the documented thresholds', () => {
    expect(WORKING_FOR).toBe(3 * MIN)
    expect(WRAPPING_FOR).toBe(2 * MIN)
    expect(OFF_AFTER).toBe(2 * 60 * MIN)
  })
})

describe('effective', () => {
  it('working and fresh stays working with its activity', () => {
    const r = row({ quietMs: MIN })
    expect(effective(r, NOW)).toEqual({ state: 'working', activity: 'edit', since: Date.parse(r.since) })
  })

  it('working exactly at the limit is still working', () => {
    expect(effective(row({ quietMs: WORKING_FOR }), NOW).state).toBe('working')
  })

  it('working quiet > 3 min becomes idle, since = updated + WORKING_FOR', () => {
    const r = row({ quietMs: WORKING_FOR + 1 })
    const e = effective(r, NOW)
    expect(e).toEqual({ state: 'idle', since: Date.parse(r.updated_at) + WORKING_FOR })
    expect(e).not.toHaveProperty('activity')
  })

  it('wrapping fresh stays, > 2 min becomes idle', () => {
    expect(effective(row({ state: 'wrapping', activity: null, quietMs: MIN }), NOW).state).toBe('wrapping')
    const r = row({ state: 'wrapping', activity: null, quietMs: WRAPPING_FOR + 1 })
    expect(effective(r, NOW)).toEqual({ state: 'idle', since: Date.parse(r.updated_at) + WRAPPING_FOR })
  })

  it('idle stays idle for a while', () => {
    expect(effective(row({ state: 'idle', activity: null, quietMs: 60 * MIN }), NOW).state).toBe('idle')
  })

  it('any state quiet > 2 h is off, since = updated + OFF_AFTER', () => {
    for (const state of ['working', 'wrapping', 'idle'] as const) {
      const r = row({ state, quietMs: OFF_AFTER + 1 })
      expect(effective(r, NOW)).toEqual({ state: 'off', since: Date.parse(r.updated_at) + OFF_AFTER, offReason: 'quiet' })
    }
  })

  it('exactly 2 h is not yet off', () => {
    expect(effective(row({ state: 'idle', activity: null, quietMs: OFF_AFTER }), NOW).state).toBe('idle')
  })

  it('off stays off with its own since', () => {
    const r = row({ state: 'off', activity: null, quietMs: MIN })
    expect(effective(r, NOW)).toEqual({ state: 'off', since: Date.parse(r.since), offReason: 'ended' })
  })

  it('an idle row without activity has no activity key', () => {
    const e = effective(row({ state: 'idle', activity: null, quietMs: MIN }), NOW)
    expect(e).not.toHaveProperty('activity')
    expect(e.state).toBe('idle')
  })
})

describe('toStatusMap', () => {
  const agents = ['agent_0', 'agent_1', 'agent_2', 'agent_3']

  it('agents without rows are off', () => {
    expect(toStatusMap([], agents, NOW)).toEqual(Object.fromEntries(agents.map((a) => [a, { state: 'off', since: 0, offReason: 'none' }])))
  })

  it('maps rows to agent_<seat>', () => {
    const m = toStatusMap([row({ seat: 2, quietMs: MIN })], agents, NOW)
    expect(m.agent_2.state).toBe('working')
    expect(m.agent_0).toEqual({ state: 'off', since: 0, offReason: 'none' })
  })

  it('ignores rows for unknown seats', () => {
    const m = toStatusMap([row({ seat: 7 }), row({ seat: -1 })], agents, NOW)
    expect(Object.keys(m)).toEqual(agents)
    expect(m.agent_7).toBeUndefined()
  })

  it('only includes the given agents', () => {
    const m = toStatusMap([row({ seat: 1 }), row({ seat: 3 })], ['agent_1'], NOW)
    expect(Object.keys(m)).toEqual(['agent_1'])
  })
})

describe('effective lastResult (#44)', () => {
  const T = iso(NOW - 5 * MIN)
  const withResult = { last_result_activity: 'test', last_result_ok: false, last_result_at: T } as const

  it('is included when the row has all three fields', () => {
    const e = effective(row({ quietMs: MIN, ...withResult }), NOW)
    expect(e.lastResult).toEqual({ activity: 'test', ok: false, at: Date.parse(T) })
    expect(e.state).toBe('working')
  })

  it('is omitted when absent or partial', () => {
    expect(effective(row({ quietMs: MIN }), NOW)).not.toHaveProperty('lastResult')
    expect(effective(row({ quietMs: MIN, last_result_activity: null, last_result_ok: null, last_result_at: null }), NOW)).not.toHaveProperty('lastResult')
    expect(effective(row({ quietMs: MIN, last_result_activity: 'build', last_result_ok: true, last_result_at: null }), NOW)).not.toHaveProperty('lastResult')
    expect(effective(row({ quietMs: MIN, last_result_activity: 'build', last_result_ok: null, last_result_at: T }), NOW)).not.toHaveProperty('lastResult')
  })

  it('ok: false still counts as present', () => {
    expect(effective(row({ quietMs: MIN, ...withResult }), NOW).lastResult?.ok).toBe(false)
  })

  it('stays when the state decays to idle or off', () => {
    const idle = effective(row({ quietMs: WORKING_FOR + 1, ...withResult }), NOW)
    expect(idle.state).toBe('idle')
    expect(idle.lastResult).toEqual({ activity: 'test', ok: false, at: Date.parse(T) })
    const off = effective(row({ quietMs: OFF_AFTER + 1, ...withResult }), NOW)
    expect(off.state).toBe('off')
    expect(off.lastResult?.ok).toBe(false)
    expect(effective(row({ state: 'off', activity: null, ...withResult }), NOW).lastResult).toBeDefined()
  })
})

describe('effective task (#182)', () => {
  it('maps a public task, with or without a title', () => {
    expect(effective(row({ state: 'working', activity: 'edit', task_repo: 'agent-office', task_issue: 170, task_title: '제목', task_private: false }), NOW).task).toEqual({
      private: false, repo: 'agent-office', issue: 170, title: '제목',
    })
    expect(effective(row({ state: 'wrapping', task_repo: 'agent-office', task_issue: 170, task_title: null, task_private: false }), NOW).task).toEqual({
      private: false, repo: 'agent-office', issue: 170, title: null,
    })
  })
  it('maps a private task to no repo, number or title', () => {
    expect(effective(row({ state: 'working', activity: 'edit', task_private: true }), NOW).task).toEqual({ private: true, repo: null, issue: null, title: null })
  })
  it('no task columns (or all null): no task; idle / off carry none', () => {
    expect(effective(row({ state: 'working', activity: 'edit' }), NOW)).not.toHaveProperty('task')
    expect(effective(row({ state: 'idle', task_repo: 'agent-office', task_issue: 1, task_private: false }), NOW)).not.toHaveProperty('task')
    expect(effective(row({ state: 'off', task_private: true }), NOW)).not.toHaveProperty('task')
  })
})

describe('toHandoff (#51)', () => {
  const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
  const ev = (over: Partial<EventRow> = {}): EventRow => ({ id: 7, seat: 0, kind: 'handoff', to_seat: 3, created_at: iso(NOW), ...over })

  it('a handoff row → a paper plane message', () => {
    expect(toHandoff(ev(), AGENTS)).toEqual({ id: 'e7', kind: 'handoff', from: 'agent_0', to: 'agent_3', at: NOW })
  })

  it('null for other kinds, a missing target, unknown seats or a plane to itself', () => {
    expect(toHandoff(null, AGENTS)).toBeNull()
    expect(toHandoff(undefined, AGENTS)).toBeNull()
    expect(toHandoff(ev({ kind: 'activity' }), AGENTS)).toBeNull()
    expect(toHandoff(ev({ to_seat: null }), AGENTS)).toBeNull()
    expect(toHandoff(ev({ to_seat: 7 }), AGENTS)).toBeNull()
    expect(toHandoff(ev({ seat: 9 }), AGENTS)).toBeNull()
    expect(toHandoff(ev({ seat: 2, to_seat: 2 }), AGENTS)).toBeNull()
  })
})

describe('liveStatusFor', () => {
  // a client whose channel() hands back the same topic, and refuses listeners after subscribe(), like realtime-js
  const fakeClient = () => {
    const topics = new Map<string, { subscribed: boolean }>()
    let channels = 0
    const client = {
      channel(topic: string) {
        if (!topics.has(topic)) {
          topics.set(topic, { subscribed: false })
          channels++
        }
        const t = topics.get(topic)!
        const ch = {
          on() {
            if (t.subscribed) throw new Error(`cannot add callbacks for ${topic} after subscribe()`)
            return ch
          },
          subscribe() {
            t.subscribed = true
            return ch
          },
        }
        return ch
      },
      from: () => ({ select: () => new Promise(() => {}) }),
    }
    return { client: client as unknown as Parameters<typeof liveStatusFor>[0], channels: () => channels }
  }

  it('builds the world twice (StrictMode) with one source and one channel', () => {
    const { client, channels } = fakeClient()
    const a = liveStatusFor(client, ['agent_0'])
    const b = liveStatusFor(client, ['agent_0'])
    expect(b).toBe(a)
    expect(channels()).toBe(1)
  })
})
