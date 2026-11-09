import { describe, expect, it } from 'vitest'
import { SPOTS } from './navSpots.fixture'
import {
  ARC,
  DEG,
  DWELL_MS,
  SCORE,
  SHOULDER,
  TOUR,
  TourPlan,
  arcAt,
  arcPositions,
  buildViews,
  cutOf,
  driftRange,
  driftYaw,
  dwellMs,
  establishingCut,
  forward,
  isClear,
  lag,
  leaveEarly,
  meetingPose,
  orbitYaw,
  pathClear,
  rightOf,
  shouldFly,
  standPose,
  tablePose,
  workCandidates,
  workPose,
  type AgentObs,
  type Clearance,
  type Frame,
  type Pose,
} from './tour'

const NOW = 1_000_000
const obs = (id: string, o: Partial<AgentObs> = {}): AgentObs => ({ id, visible: true, state: 'idle', ...o })
const NO_BOXES: Clearance = { boxes: [], margin: 0.3 }
const seatOf = (n: number): Frame => {
  const s = SPOTS.find((p) => p.id === `work_${n}`)!
  return { x: s.x, z: s.z, ry: s.ry }
}
const HOME: [number, number, number] = [8.5, 8, 9.5]
const dist2 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[2] - b[2])

describe('scores', () => {
  it('orders event 6 > meeting 5 > working 4 > wrapping 3 > play 2 > idle 1, and leaves off / dozing out', () => {
    const views = buildViews(
      [
        obs('a', { state: 'working' }),
        obs('b', { state: 'wrapping' }),
        obs('c', { pose: 'pingpong' }),
        obs('d'),
        obs('e', { state: 'off' }),
        obs('f', { pose: 'doze' }),
        obs('g', { visible: false, state: 'working' }),
        obs('h', { state: 'working', event: { at: NOW - 1000, until: NOW + 1000 } }),
      ],
      NOW,
    )
    expect(views.map((v) => [v.id, v.score])).toEqual([['a', 4], ['b', 3], ['c', 2], ['d', 1], ['h', 6]])
    expect(SCORE.meeting).toBe(5)
  })
  it('an event at an agent that is off or dozing still counts (a plane on a sleeper desk, a result at night, #223); an old one does not', () => {
    const views = buildViews(
      [
        obs('e', { state: 'off', event: { at: NOW - 1000, until: NOW + 5000 } }),
        obs('f', { pose: 'doze', event: { at: NOW - 2000, until: NOW + 4000 } }),
        obs('g', { visible: false, state: 'off', event: { at: NOW - 1000, until: NOW + 5000 } }),
        obs('o', { state: 'off', event: { at: NOW - 20_000, until: NOW - 15_000 } }),
      ],
      NOW,
    )
    expect(views.map((v) => [v.id, v.why])).toEqual([['e', 'event'], ['f', 'event']])
  })
  it('an event counts for 15 s only', () => {
    const old = buildViews([obs('a', { state: 'working', event: { at: NOW - 16_000, until: NOW - 13_000 } })], NOW)
    expect(old[0].why).toBe('working')
    const fresh = buildViews([obs('a', { state: 'working', event: { at: NOW - 14_000, until: NOW - 11_000 } })], NOW)
    expect(fresh[0].why).toBe('event')
  })
  it('a talk circle is one cut with its agents, and beats working', () => {
    const views = buildViews([obs('a', { state: 'working', pose: 'talk', meet: 'meet_floor' }), obs('b', { pose: 'talk', meet: 'meet_floor' }), obs('c', { state: 'working' })], NOW)
    expect(views.map((v) => [v.id, v.agents, v.score])).toEqual([['c', ['c'], 4], ['meet:meet_floor', ['a', 'b'], 5]])
  })
})

describe('order', () => {
  const four = () => buildViews(['a', 'b', 'c', 'd'].map((id) => obs(id, { state: 'working' })), NOW)

  it('the highest score first, the longest unseen on a tie', () => {
    const plan = new TourPlan()
    const views = buildViews([obs('a', { state: 'working' }), obs('b'), obs('c', { state: 'working' }), obs('d', { pose: 'water' })], NOW)
    expect(plan.next(NOW, views).id).toBe('a')
    expect(plan.next(NOW + 1, views).id).toBe('c') // a was just seen
    expect(plan.next(NOW + 2, views).id).toBe('a') // c was just seen: only the two working ones score 4, never the same twice
  })
  it('never the same agent twice in a row; with one scorer the establishing shot sits between', () => {
    const plan = new TourPlan()
    const views = buildViews([obs('a', { state: 'working' }), obs('b', { state: 'off' })], NOW)
    const ids = [0, 1, 2, 3, 4, 5].map((i) => plan.next(NOW + i, views).id)
    expect(ids).toEqual(['a', 'establishing', 'a', 'establishing', 'a', 'establishing'])
  })
  it('over a long run nobody repeats and the establishing shot comes every fourth cut', () => {
    const plan = new TourPlan()
    const views = four()
    const ids = Array.from({ length: 20 }, (_, i) => plan.next(NOW + i, views).id)
    ids.forEach((id, i) => i > 0 && expect(id === ids[i - 1] && id !== 'establishing').toBe(false))
    const est = ids.map((id, i) => (id === 'establishing' ? i : -1)).filter((i) => i >= 0)
    expect(est).toEqual([4, 9, 14, 19])
  })
  it('all off: only the establishing shot, again and again', () => {
    const plan = new TourPlan()
    const views = buildViews([obs('a', { state: 'off' }), obs('b', { pose: 'doze' })], NOW)
    expect([plan.next(NOW, views).id, plan.next(NOW, views).id]).toEqual(['establishing', 'establishing'])
  })
  it('the tour starts at the clicked agent when it scores, else the usual first cut', () => {
    const plan = new TourPlan()
    const views = buildViews([obs('a', { state: 'working' }), obs('b'), obs('c', { state: 'off' })], NOW)
    expect(plan.startAt(NOW, 'b', views).id).toBe('b')
    expect(new TourPlan().startAt(NOW, 'c', views).id).toBe('a')
    expect(new TourPlan().startAt(NOW, undefined, views).id).toBe('a')
  })
  it('an event cuts in only after the cut has run 4 s, and only a newer one', () => {
    const plan = new TourPlan()
    const calm = four()
    plan.next(NOW, calm)
    const ev = buildViews(['a', 'b', 'c', 'd'].map((id) => obs(id, { state: 'working', ...(id === 'c' ? { event: { at: NOW + 500, until: NOW + 3500 } } : {}) })), NOW + 1000)
    expect(plan.interrupt(NOW + 3000, ev, NOW)).toBeNull() // 3 s in
    const cut = plan.interrupt(NOW + 4000, ev, NOW)
    expect(cut?.id).toBe('c')
    expect(cut?.why).toBe('event')
    // an event that began before the cut started does not cut in again
    expect(plan.interrupt(NOW + 9000, ev, NOW + 5000)).toBeNull()
  })
  it('keeps the last 8 cuts; back and forward walk them, a new cut after going back drops what was ahead', () => {
    const plan = new TourPlan()
    const views = four()
    const cuts = Array.from({ length: 10 }, (_, i) => plan.next(NOW + i, views))
    expect(plan.history).toHaveLength(TOUR.historyMax)
    expect(plan.history[7]).toBe(cuts[9])
    expect(plan.prev()).toBe(cuts[8])
    expect(plan.prev()).toBe(cuts[7])
    expect(plan.next(NOW, views)).toBe(cuts[8])
    expect(plan.next(NOW, views)).toBe(cuts[9])
    const fresh = plan.next(NOW + 99, views)
    expect(fresh).not.toBe(cuts[9])
    // back to the oldest, then nothing further
    for (let i = 0; i < 20; i++) plan.prev()
    expect(plan.prev()).toBeNull()
    expect(plan.canGoBack).toBe(false)
  })
  it('from replay x16 only event cuts are used; with none, the establishing shot', () => {
    const plan = new TourPlan()
    const views = buildViews([obs('a', { state: 'working' }), obs('b', { state: 'working', event: { at: NOW, until: NOW + 100 } })], NOW)
    expect(plan.next(NOW, views, 16).id).toBe('b')
    expect(plan.next(NOW, views, 16).id).toBe('establishing') // b was just shown
    const none = buildViews([obs('a', { state: 'working' })], NOW)
    expect(new TourPlan().next(NOW, none, 16).id).toBe('establishing')
    expect(new TourPlan().next(NOW, none, 8).id).toBe('a')
  })
  it('a circle is not shown twice in a row, but another cut can follow and it returns', () => {
    const plan = new TourPlan()
    const views = buildViews([obs('a', { pose: 'talk', meet: 'm' }), obs('b', { pose: 'talk', meet: 'm' }), obs('c', { state: 'working' })], NOW)
    expect(plan.next(NOW, views).id).toBe('meet:m')
    expect(plan.next(NOW, views).id).toBe('c')
    expect(plan.next(NOW, views).id).toBe('meet:m')
  })
})

describe('dwell', () => {
  const cut = (why: Parameters<typeof cutOf>[0]['why'], extra = {}) => cutOf({ id: 'a', agents: ['a'], why, score: SCORE[why], ...extra })
  it('follows the table', () => {
    expect(dwellMs(cut('working'), NOW)).toBe(12_000)
    expect(dwellMs(cut('wrapping'), NOW)).toBe(12_000)
    expect(dwellMs(cut('play'), NOW)).toBe(10_000)
    expect(dwellMs(cut('idle'), NOW)).toBe(6000)
    expect(dwellMs(establishingCut(), NOW)).toBe(6000)
    expect(dwellMs(cut('meeting'), NOW)).toBe(30_000)
  })
  it('an event: until it ends + 2 s, at least 6 s, at most 15 s', () => {
    expect(dwellMs(cut('event', { event: { at: NOW, until: NOW + 1000 } }), NOW)).toBe(6000)
    expect(dwellMs(cut('event', { event: { at: NOW, until: NOW + 8000 } }), NOW)).toBe(10_000)
    expect(dwellMs(cut('event', { event: { at: NOW, until: NOW + 60_000 } }), NOW)).toBe(15_000)
  })
  it('in the timelapse: divided by the speed, 3 s at least', () => {
    expect(dwellMs(cut('working'), NOW, 1)).toBe(12_000)
    expect(dwellMs(cut('working'), NOW, 2)).toBe(6000)
    expect(dwellMs(cut('working'), NOW, 4)).toBe(3000)
    expect(dwellMs(cut('working'), NOW, 8)).toBe(3000)
    expect(dwellMs(cut('idle'), NOW, 16)).toBe(3000)
    expect(dwellMs(cut('meeting'), NOW, 4)).toBe(7500)
  })
  it('a cut whose subject has gone ends early, after 3 s', () => {
    const c = cut('working')
    expect(leaveEarly(c, [], 2000)).toBe(false)
    expect(leaveEarly(c, [], 3500)).toBe(true)
    expect(leaveEarly(c, buildViews([obs('a', { state: 'working' })], NOW), 9000)).toBe(false)
    expect(leaveEarly(establishingCut(), [], 9000)).toBe(false)
  })
  it('the dwell table is the spec (no entry slips)', () => {
    expect(DWELL_MS).toEqual({ event: 6000, meeting: 30_000, working: 12_000, wrapping: 12_000, play: 10_000, idle: 6000, establishing: 6000 })
  })
})

describe('framing relative to the seat', () => {
  it('forward / right match the rig: ry 0 faces -z (right = +x), ry 90 deg faces -x (right = -z)', () => {
    expect(forward(0).map((v) => Math.round(v))).toEqual([-0, -1].map((v) => Math.round(v)))
    const f = forward(Math.PI / 2)
    const r = rightOf(Math.PI / 2)
    expect([Math.round(f[0]), Math.round(f[1]), Math.round(r[0]), Math.round(r[1])]).toEqual([-1, -0, 0, -1].map((v) => Math.round(v)))
  })
  it('the over-the-shoulder camera is behind and to the right of every current seat, looking at the monitor side', () => {
    for (let n = 0; n < 4; n++) {
      const seat = seatOf(n)
      const p = workCandidates(seat)[0]
      const [fx, fz] = forward(seat.ry)
      const [rx, rz] = rightOf(seat.ry)
      const rel = [p.pos[0] - seat.x, p.pos[2] - seat.z]
      expect(rel[0] * fx + rel[1] * fz).toBeCloseTo(-SHOULDER.back, 5) // behind
      expect(rel[0] * rx + rel[1] * rz).toBeCloseTo(SHOULDER.side, 5) // to the right
      expect(p.pos[1]).toBe(SHOULDER.y)
      const t = [p.target[0] - seat.x, p.target[2] - seat.z]
      expect(t[0] * fx + t[1] * fz).toBeGreaterThan(0) // the look-at is ahead of the seat (monitor side)
    }
  })
  it('turning a seat 90 degrees turns its framing with it (pods rotated, #195 / #206)', () => {
    const seat: Frame = { x: -2.8, z: -2.57, ry: 0 }
    const rot: Frame = { ...seat, ry: Math.PI / 2 }
    const a = workCandidates(seat)
    const b = workCandidates(rot)
    a.forEach((pose, i) => {
      // the same offset from the seat, turned by 90 degrees about it
      for (const k of ['pos', 'target'] as const) {
        const dx = pose[k][0] - seat.x
        const dz = pose[k][2] - seat.z
        // a turn of ry by +90 deg: forward (0,-1) -> (-1,0), right (1,0) -> (0,-1)
        expect(b[i][k][0]).toBeCloseTo(seat.x + dz, 5)
        expect(b[i][k][2]).toBeCloseTo(seat.z - dx, 5)
        expect(b[i][k][1]).toBeCloseTo(pose[k][1], 9)
      }
    })
  })
  it('works for a fifth seat anywhere', () => {
    const seat: Frame = { x: 1.2, z: 0.5, ry: Math.PI }
    const p = workPose(seat, NO_BOXES)
    const [fx, fz] = forward(seat.ry)
    expect((p.pos[0] - seat.x) * fx + (p.pos[2] - seat.z) * fz).toBeCloseTo(-SHOULDER.back, 5)
  })
  it('over the shoulder when that spot is clear, else the next that is (no ids anywhere)', () => {
    const seat = seatOf(0)
    const c = workCandidates(seat)
    expect(workPose(seat, NO_BOXES)).toEqual(c[0])
    // something stands where the first camera would be
    const [x, y, z] = c[0].pos
    const block: Clearance = { boxes: [{ min: [x - 0.3, y - 0.5, z - 0.3], max: [x + 0.3, y + 0.5, z + 0.3] }], margin: 0.3 }
    const p = workPose(seat, block)
    expect(p).not.toEqual(c[0])
    expect(isClear(p.pos, block)).toBe(true)
    expect(c.slice(1)).toContainEqual(p)
  })
  it('a camera outside the room is not clear', () => {
    expect(isClear([9, 2, 0], NO_BOXES)).toBe(false)
    expect(isClear([0, 2, 0], NO_BOXES)).toBe(true)
  })
  it('a table: the long side, away from the table, at the spec distance when the room allows', () => {
    const a = SPOTS.find((s) => s.id === 'pingpong_a')!
    const b = SPOTS.find((s) => s.id === 'pingpong_b')!
    const p = tablePose(a, b, NO_BOXES, HOME, { dist: 3.8, y: 2.2, targetY: 0.76 })
    expect(p.target[0]).toBeCloseTo((a.x + b.x) / 2)
    expect(isClear(p.pos, NO_BOXES)).toBe(true)
    // across the table (more z than x away from the middle), on the side of the default camera (+z)
    expect(p.pos[2]).toBeGreaterThan(p.target[2])
    expect(Math.hypot(p.pos[0] - p.target[0], p.pos[1] - p.target[1], p.pos[2] - p.target[2])).toBeGreaterThan(3.5)
  })
  it('a stander: in front when clear, from the side when the front is a wall, always inside the room', () => {
    const open = standPose({ x: 0, z: 0, ry: 0 }, NO_BOXES)
    expect(open.pos[2]).toBeLessThan(0) // front = -z
    const atWall = standPose({ x: 3.56, z: -2, ry: -Math.PI / 2 }, NO_BOXES) // the coffee machine, facing the east wall
    expect(isClear(atWall.pos, NO_BOXES)).toBe(true)
    expect(atWall.target).toEqual([3.56, 1.0, -2])
  })
  it('a circle: towards the default camera, 4 m away, 2.6 m up, looking at its middle', () => {
    const p = meetingPose({ x: -1, z: -0.6 }, NO_BOXES, HOME)
    expect(dist2(p.pos, p.target)).toBeCloseTo(4, 5)
    expect(p.pos[1]).toBe(2.6)
    expect(p.target).toEqual([-1, 1, -0.6])
    expect(p.pos[0]).toBeGreaterThan(-1)
    expect(p.pos[2]).toBeGreaterThan(-0.6)
  })
})

describe('drift and follow', () => {
  it('4 degrees over the dwell (the establishing shot 24), none with reduced motion', () => {
    const c = cutOf({ id: 'a', agents: ['a'], why: 'working', score: 4 })
    const [lo, hi] = driftRange(c, false)
    expect((hi - lo) / DEG).toBeCloseTo(4)
    const e = driftRange(establishingCut(), false)
    expect((e[1] - e[0]) / DEG).toBeCloseTo(24)
    expect(driftRange(c, true)).toEqual([0, 0])
    expect(driftYaw([lo, hi], 0)).toBe(lo)
    expect(driftYaw([lo, hi], 1)).toBe(hi)
    expect(driftYaw([lo, hi], 7)).toBe(hi)
  })
  it('turning about the target keeps the distance and the height', () => {
    const t: [number, number, number] = [1, 1, 2]
    const p = orbitYaw([4, 3, 6], t, 0.2)
    expect(dist2(p, t)).toBeCloseTo(dist2([4, 3, 6], t), 9)
    expect(p[1]).toBe(3)
    expect(orbitYaw([4, 3, 6], t, 0)).toEqual([4, 3, 6])
  })
  it('the look-at follows with a 0.5 s lag (63 % after 0.5 s)', () => {
    let v = 0
    for (let i = 0; i < 50; i++) v = lag(v, 1, 0.01)
    expect(v).toBeCloseTo(1 - Math.exp(-1), 2)
  })
})

describe('the way there', () => {
  const A: Pose = { pos: [-3, 1.75, 1], target: [-4, 1, 0] }
  const B: Pose = { pos: [2, 1.9, -1], target: [1, 1, -2] }
  it('1.6 s, eased, up 0.6 m at the middle', () => {
    expect(ARC.ms).toBe(1600)
    expect(ARC.lift).toBe(0.6)
    expect(arcAt(A, B, 0)).toEqual(A)
    const end = arcAt(A, B, 1)
    expect(end.pos.map((v) => +v.toFixed(9))).toEqual(B.pos)
    const mid = arcAt(A, B, 0.5)
    expect(mid.pos[1] - (A.pos[1] + B.pos[1]) / 2).toBeCloseTo(0.6, 9)
    expect(mid.pos[0]).toBeCloseTo((A.pos[0] + B.pos[0]) / 2, 9)
    // ease-in-out: slow at both ends
    expect(arcAt(A, B, 0.1).pos[0] - A.pos[0]).toBeLessThan((B.pos[0] - A.pos[0]) * 0.1)
  })
  it('the sampled path is at most 5 cm between samples and has its apex 0.6 m up', () => {
    const s = arcPositions(A, B)
    for (let i = 1; i < s.length; i++) expect(Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1], s[i][2] - s[i - 1][2])).toBeLessThanOrEqual(0.0501)
    const apex = Math.max(...s.map((p, i) => p[1] - (A.pos[1] + (B.pos[1] - A.pos[1]) * (i / (s.length - 1)))))
    expect(apex).toBeCloseTo(0.6, 3)
  })
  it('a clear room: fly; a box on the way: a fade cut; reduced motion: always a cut', () => {
    expect(pathClear(A, B, NO_BOXES)).toBe(true)
    expect(shouldFly(A, B, NO_BOXES, false)).toBe(true)
    const mid = arcAt(A, B, 0.5).pos
    const wall: Clearance = { boxes: [{ min: [mid[0] - 0.1, 0, -5], max: [mid[0] + 0.1, 2.6, 5] }], margin: 0.3 }
    expect(pathClear(A, B, wall)).toBe(false)
    expect(shouldFly(A, B, wall, false)).toBe(false)
    expect(shouldFly(A, B, NO_BOXES, true)).toBe(false)
  })
  it('a box well above the path (the arc goes over the lower wall) does not block it', () => {
    const low: Clearance = { boxes: [{ min: [-0.1, 0, -5], max: [0.1, 0.15, 5] }], margin: 0.3 }
    expect(pathClear(A, B, low)).toBe(true)
  })
  it('a box beside the path closer than the margin blocks it, farther away does not', () => {
    const p = arcAt(A, B, 0.5).pos
    const near: Clearance = { boxes: [{ min: [p[0] - 0.1, p[1] - 0.1 + 0.2, p[2] - 0.1], max: [p[0] + 0.1, p[1] + 0.1 + 0.2, p[2] + 0.1] }], margin: 0.3 }
    expect(pathClear(A, B, near)).toBe(false)
    const far: Clearance = { boxes: [{ min: [p[0] - 0.1, p[1] + 1, p[2] - 0.1], max: [p[0] + 0.1, p[1] + 1.2, p[2] + 0.1] }], margin: 0.3 }
    expect(pathClear(A, B, far)).toBe(true)
  })
})
