import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint, footprintFromRects } from './grid'
import { buildGraph, type NavSpot } from './nav'
import { GRAPH } from './navSpots.fixture'
import { TRAFFIC, TrafficPlanner, type Request } from './traffic'

const R2 = 2 * TRAFFIC.bodyR
const spot = (id: string, x: number, z: number): NavSpot => ({ id, x, z, ry: 0, kind: 'stand' })
const req = (s: string, extra: Partial<Request> = {}): Request => ({ spot: s, pace: 1, ...extra })

/** step the clock; the smallest centre distance over all pairs (every 50 ms) */
function run(p: TrafficPlanner, ids: string[], t0: number, t1: number, hook?: (t: number) => void) {
  let min = Infinity
  for (let t = t0; t <= t1; t += 0.05) {
    hook?.(t)
    p.update(t)
    const s = ids.map((i) => p.sample(i, t))
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) min = Math.min(min, Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z))
  }
  return min
}

/** an empty 14 x 7 m room with the given spots and furniture rectangles */
function room(spots: NavSpot[], rects: [number, number, number, number][] = []) {
  const g = buildGraph(spots, [])
  return new TrafficPlanner(buildGrid(footprintFromRects(7, 3.5, rects), g), g)
}

const office = () => new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)

// a wall with a one-metre gap, 4 m thick: a corridor two bodies cannot pass side by side
const CORRIDOR: [number, number, number, number][] = [
  [-2, -3.5, 2, -0.5],
  [-2, 0.5, 2, 3.5],
]

describe('traffic planner on the grid', () => {
  it('narrow corridor, head on: one waits aside, then passes; never closer than 2R', () => {
    const p = room([spot('A', -5, 0), spot('B', 5, 0)], CORRIDOR)
    p.place('a', req('A'), 0, 0)
    p.place('b', req('B'), 0, 1)
    p.update(0)
    p.request('a', req('B'), 0)
    p.request('b', req('A'), 0)
    const min = run(p, ['a', 'b'], 0, 60)
    expect(min).toBeGreaterThanOrEqual(R2)
    expect(p.sample('a', 60).arrived).toBe('B')
    expect(p.sample('b', 60).arrived).toBe('A')
    // the lower priority (b) stood still for a while (beside the corridor mouth) while a crossed
    let waited = false
    for (let t = 3; t < 14; t += 0.1) if (!p.sample('b', t).moving) waited = true
    expect(waited).toBe(true)
  })

  it('open floor, head on: both keep right, nobody waits, never closer than 2R', () => {
    const p = room([spot('A', -5, 0), spot('B', 5, 0)])
    p.place('a', req('A'), 0, 0)
    p.place('b', req('B'), 0, 1)
    p.update(0)
    p.request('a', req('B'), 0)
    p.request('b', req('A'), 0)
    let zA = 0
    let zB = 0
    const min = run(p, ['a', 'b'], 0, 25, (t) => {
      zA = Math.max(zA, p.sample('a', t).z)
      zB = Math.min(zB, p.sample('b', t).z)
    })
    expect(min).toBeGreaterThanOrEqual(R2)
    // a walks +x: its right is +z; b walks -x: its right is -z
    expect(zA).toBeGreaterThan(0.2)
    expect(zB).toBeLessThan(-0.2)
    expect(p.settledAt('a')).toBeLessThan(10 / 0.75 + 2)
    expect(p.settledAt('b')).toBeLessThan(10 / 0.75 + 2)
  })

  it('three agents crossing stay apart and all arrive', () => {
    const p = room([spot('N', 0, -2.5), spot('E', 5, 0), spot('S', 0, 2.5), spot('W', -5, 0)])
    p.place('a0', req('N'), 0, 0)
    p.place('a1', req('E'), 0, 1)
    p.place('a2', req('S'), 0, 2)
    p.update(0)
    p.request('a0', req('S'), 0)
    p.request('a1', req('W'), 0)
    p.request('a2', req('N'), 0)
    const min = run(p, ['a0', 'a1', 'a2'], 0, 40)
    expect(min).toBeGreaterThanOrEqual(R2)
    expect(p.sample('a0', 40).arrived).toBe('S')
    expect(p.sample('a1', 40).arrived).toBe('W')
    expect(p.sample('a2', 40).arrived).toBe('N')
  })

  it('destination occupied: waits beside it (> 2R) until it is free, then takes it', () => {
    const p = room([spot('A', -5, 0), spot('B', 5, 0), spot('C', 0, 2)])
    p.place('a', req('B'), 0, 0)
    p.place('b', req('A'), 0, 1)
    p.update(0)
    p.request('b', req('B'), 0)
    const min = run(p, ['a', 'b'], 0, 25)
    expect(min).toBeGreaterThanOrEqual(R2)
    const w = p.sample('b', 25)
    expect(w.arrived).toBeNull()
    expect(w.moving).toBe(false)
    const d = Math.hypot(w.x - 5, w.z)
    expect(d).toBeGreaterThan(0.6)
    expect(d).toBeLessThan(1)
    expect(w.cue?.kind).toBe('dest')
    p.request('a', req('C'), 25)
    const min2 = run(p, ['a', 'b'], 25, 70)
    expect(min2).toBeGreaterThanOrEqual(R2)
    expect(p.sample('b', 70).arrived).toBe('B')
    expect(p.sample('a', 70).arrived).toBe('C')
  })

  it('blocked for more than 3 s: waits it out as a beat (head tilt), then plans on', () => {
    // two corridors, the far one a detour; an oncoming walker holds the near one, so waiting is the quicker way at first
    const rects: [number, number, number, number][] = [
      [-2, -3.5, 2, -0.5],
      [-2, 0.5, 2, 2.5],
      [-2, 3.5, 2, 3.5],
    ]
    const p = room([spot('P', -3, 0), spot('Q', 5, 0), spot('S0', 2.6, 0), spot('W', -6, 0)], rects)
    p.place('walker', req('S0'), 0, 0)
    p.place('fast', req('P'), 0, 1)
    p.update(0)
    p.request('walker', req('W'), 0)
    p.request('fast', req('Q'), 0.2)
    let tilt = false
    const min = run(p, ['walker', 'fast'], 0, 40, (t) => {
      if (!p.has('fast')) return
      const s = p.sample('fast', t)
      if (s.cue?.kind === 'tilt') tilt = true
    })
    expect(min).toBeGreaterThanOrEqual(R2)
    expect(p.sample('fast', 40).arrived).toBe('Q')
    expect(tilt).toBe(true)
  })

  it('same inputs give the same plans, whatever the frame step', () => {
    const go = (step: number) => {
      const p = office()
      p.place('a', req('work_0'), 0, 0)
      p.place('b', req('work_3'), 0, 1)
      p.place('c', req('sofa_0'), 0, 2)
      p.update(0)
      p.request('a', req('game_b'), 5)
      p.request('b', req('game_a'), 5)
      p.request('c', req('whiteboard'), 5)
      for (let t = 0; t <= 45; t += step) p.update(t)
      const out: number[] = []
      for (let t = 5; t <= 45; t += 0.5) for (const i of ['a', 'b', 'c']) out.push(p.position(i, t).x, p.position(i, t).z)
      return out
    }
    const a = go(1 / 60)
    expect(go(1 / 60)).toEqual(a)
    const b = go(1 / 24)
    expect(b.length).toBe(a.length)
    a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(0.02))
  })

  it('a request injected mid-walk does not jump or teleport', () => {
    const p = office()
    p.place('a', req('work_0'), 0, 0)
    p.update(0)
    p.request('a', req('game_b'), 1)
    run(p, ['a'], 1, 3)
    const before = p.position('a', 3.1)
    expect(p.sample('a', 3.1).speed).toBeGreaterThan(0.3)
    p.request('a', req('sofa_2'), 3.1)
    p.update(3.1)
    const after = p.position('a', 3.1)
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(1e-6)
    let prev = after
    for (let t = 3.15; t < 12; t += 0.05) {
      const q = p.position('a', t)
      expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(0.75 * 0.05 * 1.8)
      prev = q
    }
    // velocity carries over (no stop-and-go at the injection)
    expect(p.sample('a', 3.15).speed).toBeGreaterThan(0.2)
    expect(p.sample('a', 90).arrived).toBe('sofa_2')
  })

  it('a slot destination (any pose) works, and a taken slot is waited beside', () => {
    const p = office()
    p.place('a', req('work_0'), 0, 0)
    p.place('b', req('work_1'), 0, 1)
    p.update(0)
    const slot = { x: -0.6, z: 0.9, ry: 1 }
    p.request('a', req('ring_0', { slot }), 0)
    p.request('b', req('ring_1', { slot: { x: -0.3, z: 0.9, ry: -1 } }), 0)
    const min = run(p, ['a', 'b'], 0, 60)
    expect(min).toBeGreaterThanOrEqual(R2)
    const a = p.sample('a', 60)
    expect(a.arrived).toBe('ring_0')
    expect(Math.hypot(a.x - slot.x, a.z - slot.z)).toBeLessThan(0.01)
    expect(p.sample('b', 60).arrived).toBeNull() // 0.3 m from a: waits beside its slot
  })

  it('notBefore staggers a departure', () => {
    const p = office()
    p.place('a', req('work_0'), 0, 0)
    p.update(0)
    p.request('a', req('whiteboard', { notBefore: 4 }), 0)
    p.update(0)
    expect(p.sample('a', 3.5).moving).toBe(false)
    expect(p.sample('a', 6).moving).toBe(true)
  })

  it('lists the designed neighbour spots, closer than the resting clearance 2R + planGap (sofa seats, coffee / shelf)', () => {
    const pairs = office().exemptPairs
    for (const p of [['sofa_0', 'sofa_1'], ['sofa_1', 'sofa_2'], ['coffee', 'shelf']]) expect(pairs).toContainEqual(p)
    for (const [a, b] of pairs) expect(Math.hypot(GRAPH.spots[a].x - GRAPH.spots[b].x, GRAPH.spots[a].z - GRAPH.spots[b].z)).toBeLessThan(2 * TRAFFIC.bodyR + TRAFFIC.planGap)
  })

  it('someone standing at the coffee machine does not keep the shelf unreachable, nor the other way round', () => {
    // 0.63 m apart: more than two bodies, less than the resting clearance; the planner used to send the second agent
    // to wait beside its goal for good (seen in the day sim and in the browser, #184 review)
    for (const [first, second] of [['coffee', 'shelf'], ['shelf', 'coffee']]) {
      const p = office()
      p.place('a', req(first), 0, 0)
      p.place('b', req('hall_back'), 0, 1)
      p.update(0)
      p.request('b', req(second), 0)
      run(p, ['a', 'b'], 0, 40)
      expect(p.sample('b', 40).arrived).toBe(second)
      expect(p.sample('a', 40).arrived).toBe(first)
    }
  })
  // desks.md 2.1 (#251): the window strip behind 메모's seat is not a lane for others, but it is 메모's own way out when someone stands
  // at chat_0 (the head desk's north-east corner to a body on chat_0 is 0.39 m). The grid only treats seated bodies as obstacles, so the
  // strip opens as soon as 메모 gets up; this checks it with a talk going on at both chat spots and the whole pod seated
  for (const to of ['meet_center', 'board_tray'])
    it(`메모 leaves its seat while two talk at chat_0 / chat_1 and reaches ${to} within 60 s; never closer than 2R`, () => {
      const p = office()
      const seated = ['work_1', 'work_2', 'work_3', 'work_4']
      p.place('memo', req('work_0'), 0, 0)
      p.place('c0', req('chat_0'), 0, 1)
      p.place('c1', req('chat_1'), 0, 2)
      seated.forEach((s, i) => p.place(s, req(s), 0, 3 + i))
      p.update(0)
      p.request('memo', req(to), 0)
      const ids = ['memo', 'c0', 'c1', ...seated]
      const min = run(p, ids, 0, 60)
      expect(min).toBeGreaterThanOrEqual(R2 - 1e-6)
      expect(p.sample('memo', 60).arrived).toBe(to)
      // the talkers and the seated ones never moved
      for (const [id, spot] of [['c0', 'chat_0'], ['c1', 'chat_1'], ...seated.map((s) => [s, s])]) expect(p.sample(id, 60).arrived).toBe(spot)
    })
})
