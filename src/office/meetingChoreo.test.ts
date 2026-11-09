import { describe, expect, it } from 'vitest'
import { conversations, type DocMeta } from '../docs/library'
import type { Goal } from './director'
import { formation } from './formation'
import { buildScript, type MeetingScript } from './meeting'
import { CHOREO, MeetingRunner, reaction, seatLabel, type Place } from './meetingRun'
import { GRAPH } from './navSpots.fixture'
import type { StatusMap } from './status'

const meta: DocMeta = { id: 9, kind: 'minutes', repo: 'o/r', folder: 28, title: 'T', agents: [], grade: 'public', approved: true, readable: true, created_at: '', updated_at: '' }
const row = (order: number, from: number, to: number[], text: string) => ({ order, from: { seat: from }, to: to.map((seat) => ({ seat })), text })
const rows = [row(1, 0, [1], '하나.'), row(2, 1, [2], '둘.'), row(3, 2, [3], '셋.'), row(4, 3, [0], '넷.'), row(5, 1, [0], '다섯.'), row(6, 2, [1], '여섯.')]
const make = (decision: string | null, followUp: string | null, reduced = false): MeetingScript =>
  buildScript(meta, conversations({ minutes: [{ date: null, rows, decision, followUp }] }), { reduced })
const status: StatusMap = Object.fromEntries([0, 1, 2, 3].map((i) => [`agent_${i}`, { state: 'idle' as const, since: 0 }]))
const SEATS = [0, 1, 2, 3]

const start: Record<string, { x: number; z: number }> = {
  agent_0: { x: -2.8, z: -2.57 },
  agent_1: { x: -1, z: -2.57 },
  agent_2: { x: -3.64, z: -1.12 },
  agent_3: { x: -3.64, z: 0.68 },
}
let where = { ...start }
const place: Place = { at: (a) => where[a] ?? null, spot: (s) => GRAPH.spots[s] ?? null }
const directors = (pose: Record<string, Goal['pose']> = {}): Record<string, Goal> =>
  Object.fromEntries(SEATS.map((i) => [`agent_${i}`, { spot: `work_${i}`, pose: pose[`agent_${i}`] ?? 'idle', label: 'x' }]))

/** every agent is where its goal says, at once (unless told not to arrive) */
function stepper(r: MeetingRunner, pose: Record<string, Goal['pose']> = {}) {
  const at: Record<string, string | null> = {}
  return (now: number, arrive = true) => {
    const goals = directors(pose)
    r.apply(now, (a) => at[a] ?? null, goals, { x: -3.95, z: 2.6 }, place)
    if (arrive) for (const [a, g] of Object.entries(goals)) at[a] = g.spot
    return goals
  }
}

describe('gathering (#141)', () => {
  it('departures are staggered 0.3-0.8 s, the farthest first; a player leaves 0.6 s later; none under reduced motion', () => {
    where = { ...start }
    const r = new MeetingRunner()
    r.start(make('정했다.', null), 1000, status)
    const g = stepper(r, { agent_2: 'pingpong' })(1000, false)
    const dep = SEATS.map((i) => ({ i, d: g[`agent_${i}`].depart! - 1000 - (i === 2 ? CHOREO.playDelayMs : 0) }))
    const seats = formation(GRAPH.spots.meet_center_board, 4, true)
    const far = (i: number) => Math.hypot(where[`agent_${i}`].x - seats[i].x, where[`agent_${i}`].z - seats[i].z)
    expect([...dep].sort((a, b) => a.d - b.d).map((d) => d.i)).toEqual([...SEATS].sort((a, b) => far(b) - far(a)))
    const ds = dep.map((d) => d.d).sort((a, b) => a - b)
    expect(ds[0]).toBe(0)
    for (let k = 1; k < ds.length; k++) {
      expect(ds[k] - ds[k - 1]).toBeGreaterThanOrEqual(300)
      expect(ds[k] - ds[k - 1]).toBeLessThan(800)
    }
    expect(g.agent_2.depart).toBeGreaterThanOrEqual(1000 + CHOREO.playDelayMs)

    const q = new MeetingRunner()
    q.start(make('정했다.', null, true), 1000, status)
    const h = stepper(q)(1000, false)
    expect(SEATS.map((i) => h[`agent_${i}`].depart)).toEqual([1000, 1000, 1000, 1000])
  })
  it('every seat is a slot of the one formation: open to the board with a decision, closed without', () => {
    where = { ...start }
    const r = new MeetingRunner()
    r.start(make('정했다.', null), 0, status)
    const g = stepper(r)(0, false)
    const want = formation(GRAPH.spots.meet_center_board, 4, true)
    SEATS.forEach((i) => {
      expect(g[`agent_${i}`].spot).toBe(seatLabel(i))
      expect(g[`agent_${i}`].slot).toEqual(want[i])
    })
    const q = new MeetingRunner()
    q.start(make(null, null), 0, status)
    expect(stepper(q)(0, false).agent_1.slot).toEqual(formation(GRAPH.spots.meet_center_floor, 4, false)[1])
  })
  it('an early arriver looks at someone still coming; when the last is within 1 m they all face the centre', () => {
    where = { ...start }
    const r = new MeetingRunner()
    r.start(make('정했다.', null), 0, status)
    const at: Record<string, string | null> = { agent_1: seatLabel(1) }
    const goals = directors()
    r.apply(2000, (a) => at[a] ?? null, goals, undefined, place)
    expect(goals.agent_1.lookAt).toMatch(/^agent_/)
    // only agent_3 is left, and it stands next to its seat
    const slot = formation(GRAPH.spots.meet_center_board, 4, true)[3]
    for (const i of [0, 1, 2]) at[`agent_${i}`] = seatLabel(i)
    where.agent_3 = { x: slot.x + 0.5, z: slot.z }
    const g2 = directors()
    r.apply(2100, (a) => at[a] ?? null, g2, undefined, place)
    expect(g2.agent_1.lookAt).toBeUndefined()
  })
})

describe('listening (#141)', () => {
  const s = make('정했다.', null)
  it('the same line key makes the same decision, the addressee always nods and lifts a hand', () => {
    for (const l of s.lines)
      for (const seat of SEATS) {
        const a = reaction(s.id, l, seat)
        expect(reaction(s.id, l, seat)).toEqual(a)
        if (l.from === seat) expect(a).toBeNull()
        else if (l.to.includes(seat)) expect(a).toEqual({ key: `${s.id}:${l.key}`, hand: true })
      }
  })
  it('the other listeners nod about half of the time', () => {
    let n = 0
    let all = 0
    for (let id = 0; id < 60; id++)
      for (const l of s.lines)
        for (const seat of SEATS)
          if (l.from !== seat && !l.to.includes(seat)) {
            all++
            if (reaction(`doc${id}`, l, seat)) n++
          }
    expect(n / all).toBeGreaterThan(0.4)
    expect(n / all).toBeLessThan(0.6)
  })
  it('the body keeps its seat, the speaker gazes at the addressee and listeners at the speaker; no nod under reduced motion', () => {
    where = { ...start }
    const r = new MeetingRunner()
    r.start(make('정했다.', null), 0, status)
    const step = stepper(r)
    step(0)
    step(100) // all there: the lines begin
    const l = r.script!.lines[0]
    const g = step(100 + l.startMs + 50)
    const speaker = l.from as number
    expect(g[`agent_${speaker}`].gaze).toBe(`agent_${l.to[0]}`)
    const listener = SEATS.find((i) => i !== speaker && i !== l.to[0])!
    expect(g[`agent_${listener}`].gaze).toBe(`agent_${speaker}`)
    expect(g[`agent_${speaker}`].lookAt).toBeUndefined()
    // just before the line ends the addressee gets its nod
    const end = 100 + l.startMs + l.typeMs + l.holdMs - 100
    expect(step(end)[`agent_${l.to[0]}`].gesture).toEqual({ key: `${r.script!.id}:${l.key}`, hand: true })
    const q = new MeetingRunner()
    q.start(make('정했다.', null, true), 0, status)
    const stepQ = stepper(q)
    stepQ(0)
    stepQ(100)
    const lq = q.script!.lines[0]
    expect(Object.values(stepQ(100 + lq.startMs + lq.typeMs + lq.holdMs - 100)).some((x) => x.gesture)).toBe(false)
  })
})

describe('deciding and dispersing (#141)', () => {
  /** step until the phase is reached; returns the time */
  function until(r: MeetingRunner, step: (now: number) => Record<string, Goal>, phase: string, from = 0) {
    for (let now = from; now < 200_000; now += 50) {
      step(now)
      if (r.phase === phase) return now
    }
    throw new Error('never reached ' + phase)
  }
  it('the planner posts at the whiteboard, the others keep their seats (turned 15° toward the board), all nod when it is pinned', () => {
    where = { ...start }
    const r = new MeetingRunner()
    r.start(make('정했다.', '루프가 한다.'), 0, status)
    const step = stepper(r)
    let now = until(r, step, 'decide')
    const g = step(now + 50)
    expect(g.agent_0).toMatchObject({ spot: 'whiteboard', pose: 'post' })
    const seats = formation(GRAPH.spots.meet_center_board, 4, true)
    for (const i of [1, 2, 3]) {
      const x = g[`agent_${i}`]
      expect(x.spot).toBe(seatLabel(i))
      expect(x.slot).toMatchObject({ x: seats[i].x, z: seats[i].z })
      const turn = Math.abs(Math.atan2(Math.sin(x.slot!.ry - seats[i].ry), Math.cos(x.slot!.ry - seats[i].ry))) * (180 / Math.PI)
      expect(turn).toBeLessThanOrEqual(15.01)
      expect(x.gaze).toBe('agent_0')
      expect(x.gesture).toBeUndefined()
    }
    let pinned = 0
    r.onDecisionPinned(() => pinned++)
    for (now += 100; r.phase === 'decide' && now < 100_000; now += 50) {
      const gg = step(now)
      if (pinned) {
        expect([1, 2, 3].every((i) => gg[`agent_${i}`].gesture?.key.endsWith(':pin'))).toBe(true)
        break
      }
    }
    expect(pinned).toBe(1)
  })
  it('the follow-up owners leave first 0.3 s apart, then the rest 0.5-1.0 s apart; each steps back 0.3 m before leaving', () => {
    where = { ...start }
    const s = make(null, '메시가 맡고 루프가 한다.')
    expect(s.followUps.length).toBeGreaterThan(1)
    const r = new MeetingRunner()
    r.start(s, 0, status)
    const step = stepper(r)
    const t0 = until(r, step, 'follow')
    const left: Record<number, number> = {}
    const stepped: Record<number, Goal> = {}
    for (let now = t0; r.phase === 'follow' && now < t0 + 20_000; now += 20) {
      const g = step(now)
      for (const i of SEATS) {
        const x = g[`agent_${i}`]
        if (x.spot.startsWith('meet_step_') && !stepped[i]) {
          stepped[i] = x
          left[i] = now
        }
      }
    }
    const owners = s.followUps
    const order = [...SEATS].sort((a, b) => left[a] - left[b])
    expect(order.slice(0, owners.length).sort()).toEqual([...owners].sort())
    const times = order.map((i) => left[i])
    for (let k = 1; k < owners.length; k++) expect(times[k] - times[k - 1]).toBeGreaterThanOrEqual(CHOREO.followGapMs - 20)
    for (let k = owners.length; k < times.length; k++) {
      const d = times[k] - times[k - 1]
      expect(d).toBeGreaterThanOrEqual(CHOREO.restGapMs[0] - 20)
      expect(d).toBeLessThanOrEqual(CHOREO.restGapMs[1] + 20)
    }
    const centre = GRAPH.spots.meet_center_floor
    for (const i of SEATS) expect(Math.hypot(stepped[i].slot!.x - centre.x, stepped[i].slot!.z - centre.z)).toBeCloseTo(0.75 + CHOREO.stepBackM)
  })
  it('under reduced motion everybody leaves at once', () => {
    where = { ...start }
    const r = new MeetingRunner()
    r.start(make(null, '메시가 맡고 루프가 한다.', true), 0, status)
    const step = stepper(r)
    const t0 = until(r, step, 'follow')
    const g = step(t0 + 10)
    expect(SEATS.every((i) => g[`agent_${i}`].spot.startsWith('meet_step_'))).toBe(true)
  })
  it('is repeatable: the same script gives the same schedule', () => {
    where = { ...start }
    const run = () => {
      const r = new MeetingRunner()
      r.start(make('정했다.', '루프가 한다.'), 500, status)
      const step = stepper(r)
      const first = step(500, false)
      const out: unknown[] = [SEATS.map((i) => first[`agent_${i}`].depart)]
      const t = until(r, step, 'follow', 500)
      out.push(SEATS.map((i) => step(t + 1500)[`agent_${i}`].spot))
      return JSON.stringify(out)
    }
    expect(run()).toBe(run())
  })
})
