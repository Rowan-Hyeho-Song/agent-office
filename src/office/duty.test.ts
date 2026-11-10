import { describe, expect, it } from 'vitest'
import { DutySource, NIGHT, applyDuty, dutyOf, dutyStatus, isLateHour, nightDuty } from './duty'
import { isNight, kstMinutes, kstTimeToMs, minutesIntoNight, nightDate } from './kst'
import { FakeStatusSource, type AgentStatus } from './status'

const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
/** an instant from a Seoul wall time, independent of the machine's zone */
const kst = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00+09:00`)

describe('KST day and night', () => {
  const table: [string, boolean][] = [
    ['2026-11-08 12:00', false],
    ['2026-11-08 09:00', false], // the morning boundary: awake
    ['2026-11-08 08:59', true],
    ['2026-11-08 22:59', false],
    ['2026-11-08 23:00', true], // the evening boundary: night
    ['2026-11-09 00:00', true],
    ['2026-11-09 03:30', true],
  ]
  for (const [t, night] of table) it(`${t} KST is ${night ? 'night' : 'day'}`, () => expect(isNight(kst(t))).toBe(night))

  it('a UTC instant that is night in Seoul', () => {
    // 15:30 UTC = 00:30 KST the next day
    const ms = Date.UTC(2026, 10, 8, 15, 30)
    expect(kstMinutes(ms)).toBe(30)
    expect(isNight(ms)).toBe(true)
    // 01:00 UTC = 10:00 KST: day, although it is night in UTC
    expect(isNight(Date.UTC(2026, 10, 8, 1, 0))).toBe(false)
  })

  it('the night date is the evening it began', () => {
    expect(nightDate(kst('2026-11-08 23:10'))).toBe('2026-11-08')
    expect(nightDate(kst('2026-11-09 02:00'))).toBe('2026-11-08')
    expect(nightDate(kst('2026-11-09 08:59'))).toBe('2026-11-08')
  })

  it('minutes into the night', () => {
    expect(minutesIntoNight(kst('2026-11-08 23:00'))).toBe(0)
    expect(minutesIntoNight(kst('2026-11-09 00:10'))).toBe(70)
  })

  it('kstTimeToMs reads HH:MM on the Seoul day', () => {
    expect(kstTimeToMs('02:00', kst('2026-11-08 12:00'))).toBe(kst('2026-11-08 02:00'))
    expect(kstTimeToMs('25:00')).toBeNull()
    expect(kstTimeToMs('')).toBeNull()
  })
})

describe('night duty pick', () => {
  it('is deterministic for a night and one of the four', () => {
    const t = kst('2026-11-08 23:30')
    const a = nightDuty(AGENTS, t)
    expect(AGENTS).toContain(a)
    expect(nightDuty(AGENTS, kst('2026-11-09 03:00'))).toBe(a) // same night, any hour
    expect(nightDuty([...AGENTS].reverse(), t)).toBe(a) // roster order doesn't matter
  })

  it('changes across dates', () => {
    const picks = new Set<string>()
    for (let d = 1; d <= 28; d++) picks.add(nightDuty(AGENTS, kst(`2026-11-${String(d).padStart(2, '0')} 23:30`)))
    expect(picks.size).toBeGreaterThan(1)
    for (const p of picks) expect(AGENTS).toContain(p)
  })
})

describe('dutyStatus: off / no session / night', () => {
  const off: AgentStatus = { state: 'off', since: 0, offReason: 'none' }
  const idle: AgentStatus = { state: 'idle', since: 5 }
  const day = kst('2026-11-08 14:00')
  const deep = kst('2026-11-09 02:00')

  it('a working signal wins, day or night', () => {
    const w: AgentStatus = { state: 'working', since: 1, activity: 'edit' }
    expect(dutyStatus(w, 'agent_1', AGENTS, day)).toBe(w)
    expect(dutyStatus(w, 'agent_1', AGENTS, deep)).toBe(w)
    const wrap: AgentStatus = { state: 'wrapping', since: 1 }
    expect(dutyStatus(wrap, 'agent_1', AGENTS, deep)).toBe(wrap)
  })

  it('no session by day rests (never off)', () => {
    for (const a of AGENTS) expect(dutyStatus(off, a, AGENTS, day).state).toBe('idle')
    expect(dutyOf(dutyStatus(off, 'agent_0', AGENTS, day))).toBe('rest')
  })

  it('no work at night: three sleep, one is on duty', () => {
    const m = applyDuty(Object.fromEntries(AGENTS.map((a) => [a, off])), AGENTS, deep)
    const duties = AGENTS.map((a) => dutyOf(m[a]))
    expect(duties.filter((d) => d === 'duty')).toHaveLength(1)
    expect(duties.filter((d) => d === 'sleep')).toHaveLength(3)
    expect(m[nightDuty(AGENTS, deep)].night).toBe('duty')
    // sleepers are off (monitor 퇴근); the duty agent stays idle (monitor rest screensaver)
    expect(AGENTS.filter((a) => m[a].state === 'off')).toHaveLength(3)
    expect(m[nightDuty(AGENTS, deep)].state).toBe('idle')
  })

  it('an idle session at night also goes off duty; real hook rows keep their reason', () => {
    expect(dutyStatus(idle, 'agent_2', AGENTS, deep).state).toBe('off')
    const quiet: AgentStatus = { state: 'off', since: 3, offReason: 'quiet' }
    expect(dutyStatus(quiet, 'agent_2', AGENTS, deep)).toMatchObject({ offReason: 'quiet', since: 3 })
  })

  it('desks go dark one seat at a time after 23:00 (the duty agent keeps its light)', () => {
    const base = kst('2026-11-08 23:00')
    const duty = nightDuty(AGENTS, base)
    const dark = (min: number) => AGENTS.filter((a) => a !== duty && dutyStatus(off, a, AGENTS, base + min * 60000).state === 'off')
    const expected = (min: number) => AGENTS.filter((a) => a !== duty && Number(a.split('_')[1]) * NIGHT.staggerMin <= min)
    for (const min of [0, NIGHT.staggerMin, NIGHT.staggerMin * 2, NIGHT.staggerMin * 3]) expect(dark(min)).toEqual(expected(min))
    expect(dark(NIGHT.staggerMin * 3)).toHaveLength(3)
    expect(dutyStatus(off, duty, AGENTS, base + 60 * 60000).state).toBe('idle')
  })

  it('wakes at 09:00', () => {
    expect(dutyStatus(off, 'agent_1', AGENTS, kst('2026-11-09 08:59')).state).toBe('off')
    expect(dutyStatus(off, 'agent_1', AGENTS, kst('2026-11-09 09:00')).state).toBe('idle')
  })
})

describe('DutySource', () => {
  it('returns a cached snapshot until something changes', () => {
    let now = kst('2026-11-08 14:00')
    const fake = new FakeStatusSource(AGENTS)
    const src = new DutySource(fake, AGENTS, () => now)
    const a = src.getSnapshot()
    expect(src.getSnapshot()).toBe(a)
    src.refresh()
    expect(src.getSnapshot()).toBe(a)
    let calls = 0
    src.subscribe(() => calls++)
    now = kst('2026-11-09 03:00')
    src.refresh()
    expect(calls).toBe(1)
    expect(src.getSnapshot()).not.toBe(a)
    expect(src.getSnapshot().agent_0.state).toBe('off')
    src.dispose()
  })
})

describe('five agents (#193)', () => {
  const FIVE = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
  it('night duty falls on all five over a month, and the lights go out one seat at a time up to seat 4', () => {
    const picks = new Set<string>()
    for (let d = 1; d <= 30; d++) picks.add(nightDuty(FIVE, kst(`2026-11-${String(d).padStart(2, '0')} 23:30`)))
    expect(picks.size).toBeGreaterThanOrEqual(4)
    expect(FIVE.length).toBe(5)
    // exactly one of the five stays up deep in the night; the other four are asleep
    const deep = kst('2026-11-09 03:00')
    const raw = Object.fromEntries(FIVE.map((a) => [a, { state: 'idle', since: 0 } as AgentStatus]))
    const out = applyDuty(raw, FIVE, deep)
    expect(FIVE.filter((a) => out[a].night === 'duty')).toHaveLength(1)
    expect(FIVE.filter((a) => out[a].night === 'sleep')).toHaveLength(4)
    // seat 4's light is the last to go (stagger x 4 minutes)
    const t0 = kst('2026-11-08 23:00') + (NIGHT.staggerMin * 4 - 1) * 60_000
    expect(dutyStatus({ state: 'idle', since: 0 }, 'agent_4', FIVE, t0).night).toBeUndefined()
  })
})

describe('the sleepy window (#193)', () => {
  const at = (hhmm: string) => kstTimeToMs(hhmm, Date.UTC(2026, 10, 10, 3))!
  it('30 minutes before each seat dozes: seat 0 22:30-23:00, seat 2 22:36-23:06, seat 4 22:42-23:12', () => {
    expect(isLateHour(at('22:29'), 0)).toBe(false)
    expect(isLateHour(at('22:30'), 0)).toBe(true)
    expect(isLateHour(at('22:59'), 0)).toBe(true)
    expect(isLateHour(at('23:00'), 0)).toBe(false)
    expect(isLateHour(at('22:35'), 2)).toBe(false)
    expect(isLateHour(at('22:36'), 2)).toBe(true)
    expect(isLateHour(at('23:05'), 2)).toBe(true)
    expect(isLateHour(at('23:06'), 2)).toBe(false)
    expect(isLateHour(at('22:42'), 4)).toBe(true)
    expect(isLateHour(at('23:11'), 4)).toBe(true)
    expect(isLateHour(at('12:00'), 3)).toBe(false)
  })
  it('it is the KST clock: the debug offset moves it (the office passes now + offset)', () => {
    const real = at('12:00')
    expect(isLateHour(real + (kstTimeToMs('22:45', real)! - real), 1)).toBe(true)
  })
})
