import { describe, expect, it } from 'vitest'
import { BLINK_MS, STAMP_MS, deskProps, type PropsInput } from './props'
import type { AgentStatus, StatusMap } from './status'

const NOW = new Date(2026, 10, 8, 9, 0).getTime()
const idle = (): StatusMap => Object.fromEntries([0, 1, 2, 3].map((i) => [`agent_${i}`, { state: 'idle', since: 0 } satisfies AgentStatus]))
const input = (over: Partial<PropsInput> = {}, status: Record<string, AgentStatus> = {}): PropsInput => ({
  status: { ...idle(), ...status },
  pending: 0,
  waitingSeats: [],
  decidedAt: null,
  handoffsToday: 0,
  now: NOW,
  ...over,
})
const working = (activity: string, extra: Partial<AgentStatus> = {}): AgentStatus => ({ state: 'working', activity, since: 0, ...extra })

describe('deskProps', () => {
  it('no data defaults', () => {
    expect(deskProps(input())).toMatchObject({
      inbox: 0,
      outbox: 0,
      inboxMore: false,
      outboxMore: false,
      hourglass: false,
      stamp: false,
      turntable: false,
      ringlight: 'off',
      tablet: false,
      lamp: true,
      signal: 'off',
      duckLook: false,
    })
  })

  it('inbox / outbox clamp to 0..5', () => {
    for (const [n, want] of [[-3, 0], [0, 0], [2.7, 2], [5, 5], [9, 5], [NaN, 0]] as const) {
      expect(deskProps(input({ pending: n })).inbox).toBe(want)
      expect(deskProps(input({ handoffsToday: n })).outbox).toBe(want)
    }
  })

  it('more than 5 sheets shows the + tab (#59)', () => {
    for (const [n, want] of [[0, false], [5, false], [6, true], [40, true], [NaN, false]] as const) {
      expect(deskProps(input({ pending: n })).inboxMore).toBe(want)
      expect(deskProps(input({ handoffsToday: n })).outboxMore).toBe(want)
    }
  })

  it('calendar comes from now', () => {
    expect(deskProps(input()).calendar).toEqual({ year: 2026, month: 11, day: 8, weekday: '일' })
  })

  it('hourglass iff waiting seats include 0', () => {
    expect(deskProps(input({ waitingSeats: [0] })).hourglass).toBe(true)
    expect(deskProps(input({ waitingSeats: [1, 0] })).hourglass).toBe(true)
    expect(deskProps(input({ waitingSeats: [1, 2] })).hourglass).toBe(false)
    expect(deskProps(input({ waitingSeats: [] })).hourglass).toBe(false)
  })

  it('stamp within STAMP_MS after decidedAt only', () => {
    expect(deskProps(input({ decidedAt: NOW })).stamp).toBe(true)
    expect(deskProps(input({ decidedAt: NOW - STAMP_MS + 1 })).stamp).toBe(true)
    expect(deskProps(input({ decidedAt: NOW - STAMP_MS })).stamp).toBe(false)
    expect(deskProps(input({ decidedAt: NOW + 1 })).stamp).toBe(false)
    expect(deskProps(input({ decidedAt: null })).stamp).toBe(false)
  })

  it('turntable iff agent_1 is working on a build', () => {
    expect(deskProps(input({}, { agent_1: working('build') })).turntable).toBe(true)
    expect(deskProps(input({}, { agent_1: working('edit') })).turntable).toBe(false)
    expect(deskProps(input({}, { agent_1: { state: 'idle', activity: 'build', since: 0 } })).turntable).toBe(false)
    expect(deskProps(input({}, { agent_2: working('build') })).turntable).toBe(false)
  })

  it('ringlight: on while baking, blink after a build, then off', () => {
    expect(deskProps(input({}, { agent_1: working('build') })).ringlight).toBe('on')
    const done = (ago: number, activity: 'build' | 'test' = 'build'): AgentStatus => ({ state: 'idle', since: 0, lastResult: { activity, ok: true, at: NOW - ago } })
    expect(deskProps(input({}, { agent_1: done(0) })).ringlight).toBe('blink')
    expect(deskProps(input({}, { agent_1: done(BLINK_MS - 1) })).ringlight).toBe('blink')
    expect(deskProps(input({}, { agent_1: done(BLINK_MS) })).ringlight).toBe('off')
    expect(deskProps(input({}, { agent_1: done(1000, 'test') })).ringlight).toBe('off')
    // baking beats blinking
    expect(deskProps(input({}, { agent_1: working('build', { lastResult: { activity: 'build', ok: true, at: NOW } }) })).ringlight).toBe('on')
  })

  it('tablet iff agent_2 is working on an edit', () => {
    expect(deskProps(input({}, { agent_2: working('edit') })).tablet).toBe(true)
    expect(deskProps(input({}, { agent_2: working('read') })).tablet).toBe(false)
    expect(deskProps(input({}, { agent_2: { state: 'wrapping', since: 0 } })).tablet).toBe(false)
    expect(deskProps(input({}, { agent_1: working('edit') })).tablet).toBe(false)
  })

  it('lamp false only when agent_2 is off or missing', () => {
    for (const state of ['working', 'wrapping', 'idle'] as const) expect(deskProps(input({}, { agent_2: { state, since: 0 } })).lamp).toBe(true)
    expect(deskProps(input({}, { agent_2: { state: 'off', since: 0 } })).lamp).toBe(false)
    const missing = input()
    delete missing.status.agent_2
    expect(deskProps(missing).lamp).toBe(false)
  })

  describe('signal', () => {
    const last = (ok: boolean, activity: 'test' | 'build' = 'test') => ({ activity, ok, at: NOW - 60_000 })
    it('running test / build is yellow even with an old failing result', () => {
      expect(deskProps(input({}, { agent_3: working('test', { lastResult: last(false) }) })).signal).toBe('yellow')
      expect(deskProps(input({}, { agent_3: working('build', { lastResult: last(false) }) })).signal).toBe('yellow')
      expect(deskProps(input({}, { agent_3: working('test') })).signal).toBe('yellow')
    })
    it('the last result decides otherwise', () => {
      expect(deskProps(input({}, { agent_3: { state: 'idle', since: 0, lastResult: last(true) } })).signal).toBe('green')
      expect(deskProps(input({}, { agent_3: { state: 'idle', since: 0, lastResult: last(false) } })).signal).toBe('red')
      expect(deskProps(input({}, { agent_3: working('edit', { lastResult: last(true, 'build') }) })).signal).toBe('green')
    })
    it('no result and not running is off', () => {
      expect(deskProps(input({}, { agent_3: working('edit') })).signal).toBe('off')
      expect(deskProps(input()).signal).toBe('off')
    })
    it('duckLook iff red', () => {
      expect(deskProps(input({}, { agent_3: { state: 'idle', since: 0, lastResult: last(false) } })).duckLook).toBe(true)
      expect(deskProps(input({}, { agent_3: { state: 'idle', since: 0, lastResult: last(true) } })).duckLook).toBe(false)
      expect(deskProps(input({}, { agent_3: working('test', { lastResult: last(false) }) })).duckLook).toBe(false)
    })
  })
})
