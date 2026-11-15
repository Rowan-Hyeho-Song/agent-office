// #451 (lounge-props.md 7): at 09:00 KST one agent opens the office, at 23:00 one locks up: it walks to the stand on the mat, the lever goes down and
// up (held 1.2 s in the morning, 1 s at night), at night a nod after; then back to what it does. One person each time, the same for every visitor.
import { describe, expect, it } from 'vitest'
import { Director } from './director'
import { DOOR_LABEL, DOOR_ROUND, atDoorS, doorAgent, doorDue, doorStartAt, stepDoor } from './doorRound'
import { applyDuty, nightDuty } from './duty'
import type { StatusMap } from './status'

const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
/** 2026-11-16 00:00 KST */
const MIDNIGHT = Date.parse('2026-11-16T00:00:00+09:00')
const at = (hhmm: string, s = 0) => MIDNIGHT + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) * 60_000 + s * 1000

describe('the rounds (doorRound.ts)', () => {
  it('09:00 and 23:00 KST plus 0–90 s, the same whenever in the day it is asked', () => {
    for (const kind of ['morning', 'night'] as const) {
      const base = kind === 'morning' ? at('09:00') : at('23:00')
      const t = doorStartAt(kind, MIDNIGHT + 1234)
      expect(t).toBeGreaterThanOrEqual(base)
      expect(t).toBeLessThanOrEqual(base + DOOR_ROUND.seedS * 1000)
      for (const probe of [at('00:00', 59), at('08:59', 31), at('12:34', 7), at('23:59', 59)]) expect(doorStartAt(kind, probe)).toBe(t)
    }
    // another day, another seed
    expect(doorStartAt('morning', MIDNIGHT + 86_400_000) - 86_400_000).not.toBe(doorStartAt('morning', MIDNIGHT))
  })
  it('due from its start for windowS, not before or after', () => {
    const m = doorStartAt('morning', MIDNIGHT)
    expect(doorDue(m - 1)).toBeNull()
    expect(doorDue(m)).toEqual({ kind: 'morning', at: m })
    expect(doorDue(m + DOOR_ROUND.windowS * 1000 - 1)?.kind).toBe('morning')
    expect(doorDue(m + DOOR_ROUND.windowS * 1000)).toBeNull()
    const n = doorStartAt('night', MIDNIGHT)
    expect(doorDue(n + 1000)).toEqual({ kind: 'night', at: n })
  })
  it('who goes: 메모 in the morning, else the first not working, nobody if all work; the night-duty agent at night, else 메모', () => {
    const none = () => false
    expect(doorAgent('morning', IDS, none, 'agent_3')).toBe('agent_0')
    expect(doorAgent('morning', IDS, (a) => a === 'agent_0', null)).toBe('agent_1')
    expect(doorAgent('morning', IDS, (a) => a === 'agent_0' || a === 'agent_1', null)).toBe('agent_2')
    expect(doorAgent('morning', IDS, () => true, null)).toBeNull()
    expect(doorAgent('night', IDS, none, 'agent_3')).toBe('agent_3')
    expect(doorAgent('night', IDS, (a) => a === 'agent_3', 'agent_3')).toBe('agent_0')
    expect(doorAgent('night', IDS, () => true, 'agent_3')).toBeNull()
  })
  it('the act at the door: the press, 1.2 s / 1 s held, the release; at night the nod', () => {
    let r = stepDoor({ agent: 'agent_0', kind: 'morning', at: 0, arrived: null }, { now: 10_000, arrived: false })
    expect(r.run.arrived).toBeNull()
    r = stepDoor(r.run, { now: 20_000, arrived: true })
    expect(r.run.arrived).toBe(20_000)
    expect(stepDoor(r.run, { now: 20_000 + atDoorS('morning') * 1000 - 1, arrived: true }).done).toBe(false)
    expect(stepDoor(r.run, { now: 20_000 + atDoorS('morning') * 1000, arrived: true }).done).toBe(true)
    expect(atDoorS('morning')).toBeCloseTo(0.42 + 0.3 + 1.2 + 0.3 + 0.2, 9)
    expect(atDoorS('night')).toBeCloseTo(0.42 + 0.3 + 1.0 + 0.3 + DOOR_ROUND.nodS, 9)
    expect(stepDoor({ agent: 'agent_0', kind: 'night', at: 0, arrived: null }, { now: DOOR_ROUND.giveUpS * 1000 + 1, arrived: false }).giveUp).toBe(true)
  })
})

describe('the rounds in the Director (a day around 09:00 and 23:00)', () => {
  /** frames of 0.2 s; an agent is where it was sent once its spot has stayed the same `walkS` */
  function drive(from: number, to: number, status: (now: number) => StatusMap, walkS = 8) {
    const d = new Director(IDS)
    const sent: Record<string, { spot: string; at: number }> = {}
    const atDoor: Record<string, number> = {}
    const labels = new Set<string>()
    for (let now = from; now <= to; now += 200) {
      const g = d.goals(now, Math.floor(now / 60000), status(now), (a) => (sent[a] && now - sent[a].at >= walkS * 1000 ? sent[a].spot : null))
      for (const a of IDS) {
        if (sent[a]?.spot !== g[a].spot) sent[a] = { spot: g[a].spot, at: now }
        if (g[a].spot === DOOR_ROUND.spot) {
          atDoor[a] = (atDoor[a] ?? 0) + 0.2
          labels.add(g[a].label)
          expect(g[a].door).toBeDefined()
        }
      }
    }
    return { atDoor, labels }
  }
  const idle = (): StatusMap => Object.fromEntries(IDS.map((id) => [id, { state: 'idle' as const, since: 0 }]))

  it('the morning: 메모 alone goes to the door, presses the lever, comes back', () => {
    const { atDoor, labels } = drive(at('08:58'), at('09:05'), idle)
    expect(Object.keys(atDoor)).toEqual(['agent_0'])
    // the walk (8 s here) and the act at the door
    expect(atDoor.agent_0).toBeGreaterThan(8 + atDoorS('morning') - 0.5)
    expect(atDoor.agent_0).toBeLessThan(8 + atDoorS('morning') + 1)
    expect([...labels]).toEqual([DOOR_LABEL.morning])
  })
  it('the morning with 메모 at work: the next one resting goes; all at work: nobody', () => {
    const memoWorks = (): StatusMap => ({ ...idle(), agent_0: { state: 'working', activity: 'edit', since: 0 } })
    expect(Object.keys(drive(at('08:58'), at('09:05'), memoWorks).atDoor)).toEqual(['agent_1'])
    const allWork = (): StatusMap => Object.fromEntries(IDS.map((id) => [id, { state: 'working' as const, activity: 'edit', since: 0 }]))
    expect(drive(at('08:58'), at('09:05'), allWork).atDoor).toEqual({})
  })
  it('the night: the night-duty agent alone locks up (the others doze), then the day goes on as before', () => {
    const night = (now: number) => applyDuty(idle(), IDS, now)
    const { atDoor, labels } = drive(at('22:58'), at('23:05'), night)
    const duty = nightDuty(IDS, at('23:01'))
    expect(Object.keys(atDoor)).toEqual([duty])
    expect([...labels]).toEqual([DOOR_LABEL.night])
  })
  it('nobody goes to the door at other times', () => {
    expect(drive(at('12:00'), at('12:10'), idle).atDoor).toEqual({})
  })
})
