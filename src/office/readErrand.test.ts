/// <reference types="node" />
// Reading as an errand (#280, lounge-props.md 3): pick the book up from the low table, sit and read, put it back. Three levels:
//  - readRun.ts, the stages and their times on their own (which seat, called away, a stand that stays taken);
//  - the Director: seat 0, else seat 1, else this reading is skipped; the goal of every stage (where, what the label says);
//  - the stage on the baked model, with the planner walking the body: the sequence and its timing, where the body stands for the pick, the book back exactly where it rests,
//    nothing loose or jumping or out of reach (Guard), and the hands on the open book while seated: no finger inside it, pads within 1 mm (the thumb 2.5 mm).
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { Director } from './director'
import { BLOCK_MINUTES, playAt } from './play'
import { Guard, IDS, REACH, expectClean, runRead, world } from './errandWorld.fixture'
import { GRAPH } from './navSpots.fixture'
import { bookBoxes, bookDimsOf, distToBook, halfAngle, OPEN_ANGLE } from './bookGeom'
import { BOOK_AT, READ_LABEL, READ_S, READ_STANDS, callAway, chooseSeat, holding, pickSpot, placeOf, seatSpot, startRead, stepRead, type ReadRun } from './readRun'
import type { StatusMap } from './status'

stubCanvas()

/** step a run with the agent standing where `at()` says, a frame every 100 ms */
function drive(run: ReadRun, at: (t: number) => string | null, seconds: number, t0 = 0) {
  const seen: string[] = []
  let r = run
  let done = -1
  for (let t = 0; t <= seconds; t += 0.1) {
    const res = stepRead(r, { now: t0 + t * 1000, at: (spot) => at(t) === spot })
    r = res.run
    if (seen[seen.length - 1] !== r.stage) seen.push(r.stage)
    if (res.done) {
      done = t
      break
    }
  }
  return { seen, done, run: r }
}

describe('stepRead: the errand in stages', () => {
  it('fetch, pick, carry, read, return, put: each only once the agent is where the stage sends it', () => {
    const run = startRead(0, 0, 0)
    // at the stand at 5 s, on the seat at 9 s, back at the stand at 80 s
    const at = (t: number) => (t < 5 ? null : t < 6.5 ? pickSpot(0) : t < 9 ? null : t < 78 ? seatSpot(0) : t < 80 ? null : pickSpot(0))
    const r = drive(run, at, 120)
    expect(r.seen).toEqual(['fetch', 'pick', 'carry', 'read', 'return', 'put'])
    expect(r.done).toBeGreaterThan(80 + READ_S.put - 0.2)
  })

  it('the book is read for READ_S seconds, counted from sitting down', () => {
    const at = (t: number) => (t < 1 ? pickSpot(1) : t < 3 ? null : t < 3 + READ_S.read + 1 ? seatSpot(1) : pickSpot(1))
    const r = drive(startRead(1, 0, 0), at, READ_S.read + 30)
    expect(r.seen).toEqual(['pick', 'carry', 'read', 'return', 'put'])
  })

  it('the pick is under 1.5 s at the table (seat 1 stops in the east entrance only that long) and the hand has the time to reach, close and lift', () => {
    expect(READ_S.pick).toBeLessThan(1.5)
    expect(READ_S.pick).toBeGreaterThanOrEqual(0.3 + 0.12 + 0.35)
    expect(READ_S.put).toBeGreaterThanOrEqual(READ_S.lower + 0.06 + 0.3)
    // it closes (READ_S.close) inside the lowering: the book is shut before the hand lets go
    expect(READ_S.close).toBeLessThanOrEqual(READ_S.lower)
  })

  it('nothing is in the hand before the pick; called away it forgets the book, or with it in hand brings it back', () => {
    const run = startRead(0, 0, 0)
    expect(holding(run)).toBe(false)
    for (const stage of ['pick', 'carry', 'read', 'return', 'put'] as const) expect(holding({ ...run, stage }), stage).toBe(true)
    for (const stage of ['pick', 'carry', 'read'] as const) expect(callAway({ ...run, stage }, 5000).stage, stage).toBe('return')
    expect(callAway({ ...run, stage: 'put' }, 5000).stage).toBe('put')
    expect(callAway(run, 5000).stage).toBe('fetch')
  })

  it('a stand that stays taken: the walk to the table is given up after fetchMax; a seat never reached: the book is brought back unread', () => {
    const fetch = drive(startRead(0, 0, 0), () => null, READ_S.fetchMax + 5)
    expect(fetch.seen).toEqual(['fetch'])
    expect(fetch.done, 'gives up').toBeGreaterThan(READ_S.fetchMax)
    const at = (t: number) => (t < 2 ? pickSpot(0) : t > 2 + READ_S.pick + READ_S.carryMax + 4 ? pickSpot(0) : null)
    const carry = drive(startRead(0, 0, 0), at, 120)
    expect(carry.seen).toEqual(['pick', 'carry', 'return', 'put'])
  })

  it("the place of each stage: the knee row in front of seat 0 or the table's east end for seat 1, facing the book; the seat itself (no slot) while seated", () => {
    expect(READ_STANDS[0]).toEqual({ x: 2.81, z: 2.88 })
    expect(READ_STANDS[1]).toEqual({ x: 3.12, z: 2.72 })
    for (const seat of [0, 1] as const) {
      for (const stage of ['fetch', 'pick', 'return', 'put'] as const) {
        const p = placeOf({ ...startRead(seat, 0, 0), stage })
        expect(p.spot).toBe(pickSpot(seat))
        expect(p.stand).toEqual(READ_STANDS[seat])
        expect(p.face).toEqual(BOOK_AT)
      }
      for (const stage of ['carry', 'read'] as const) expect(placeOf({ ...startRead(seat, 0, 0), stage })).toEqual({ spot: seatSpot(seat) })
    }
  })

  it('seat 0 first, then 1, else none (the corner and the east seat are not used)', () => {
    expect(chooseSeat(() => false)).toBe(0)
    expect(chooseSeat((s) => s === 'sofa_0')).toBe(1)
    expect(chooseSeat((s) => s === 'sofa_1')).toBe(0)
    expect(chooseSeat((s) => s === 'sofa_0' || s === 'sofa_1')).toBeNull()
    expect(chooseSeat((s) => s !== 'sofa_2' && s !== 'sofa_3')).toBeNull()
  })
})

describe('the Director sends a reader (#280)', () => {
  const FIVE = IDS
  // a block of the real schedule in which somebody is handed the book
  const minute = (() => {
    for (let b = 100; b < 3000; b++) if (Object.values(playAt(b * BLOCK_MINUTES, FIVE)).some((o) => o.kind === 'books')) return b * BLOCK_MINUTES
    throw new Error('no reading in the schedule')
  })()
  const reader = Object.entries(playAt(minute, FIVE)).find(([, o]) => o.kind === 'books')![0]
  const idle = (): StatusMap => Object.fromEntries(FIVE.map((a) => [a, { state: 'idle' as const, since: 0 }]))
  const others = FIVE.filter((a) => a !== reader)
  const goalsWith = (taken: string[]) => {
    const d = new Director(FIVE)
    const at = new Map<string, string>(taken.map((s, i) => [others[i], s]))
    const g = d.goals(minute * 60000, minute, idle(), (a) => at.get(a) ?? null)
    return { d, g }
  }

  it('seat 0 when it is free: stands in the knee row facing the book, with the stage and the seat in the goal', () => {
    const { g } = goalsWith([])
    const r = g[reader]
    expect(r.pose).toBe('books')
    expect(r.spot).toBe(pickSpot(0))
    expect(r.read).toMatchObject({ stage: 'fetch', seat: 0 })
    expect(r.slot).toMatchObject({ x: 2.81, z: 2.88 })
    expect(r.label).toContain(READ_LABEL.fetch)
  })

  it("seat 1 when somebody sits on seat 0 (or is going to): the stand at the table's east end", () => {
    const { g } = goalsWith(['sofa_0'])
    expect(g[reader].read).toMatchObject({ stage: 'fetch', seat: 1 })
    expect(g[reader].spot).toBe(pickSpot(1))
    expect(g[reader].slot).toMatchObject({ x: 3.12, z: 2.72 })
  })

  it('both seats taken: this reading is skipped, nobody goes to the table, and the agent rests at its desk for the block', () => {
    const { d, g } = goalsWith(['sofa_0', 'sofa_1'])
    expect(g[reader].read).toBeUndefined()
    expect(g[reader]).toMatchObject({ spot: `work_${reader.split('_')[1]}`, pose: 'idle', label: '자리에서 쉬는 중' })
    // and it does not try again later in the block, even when a seat is free by then
    const later = d.goals(minute * 60000 + 30_000, minute, idle(), () => null)
    expect(later[reader].read).toBeUndefined()
  })

  it('the goal follows the stage: the stand until the book is in the hand, the seat while it is read (no slot), the stand again to put it back', () => {
    const d = new Director(FIVE)
    const at = new Map<string, string>()
    let now = minute * 60000
    const step = (s: number) => {
      now += s * 1000
      return d.goals(now, minute, idle(), (a) => at.get(a) ?? null)
    }
    expect(step(0)[reader].read?.stage).toBe('fetch')
    at.set(reader, pickSpot(0))
    expect(step(0.1)[reader].read?.stage).toBe('pick')
    expect(step(READ_S.pick + 0.1)[reader].read?.stage).toBe('carry')
    expect(step(0.1)[reader]).toMatchObject({ spot: 'sofa_0', pose: 'books' })
    expect(step(0.1)[reader].slot).toBeUndefined()
    at.set(reader, 'sofa_0')
    const read = step(0.1)[reader]
    expect(read.read?.stage).toBe('read')
    expect(read.label).toContain(READ_LABEL.read)
    expect(step(READ_S.read - 5)[reader].spot).toBe('sofa_0')
    expect(step(6)[reader]).toMatchObject({ spot: pickSpot(0), read: { stage: 'return' } })
    at.set(reader, pickSpot(0))
    expect(step(0.1)[reader].read?.stage).toBe('put')
    expect(step(READ_S.put + 0.1)[reader].read).toBeUndefined()
  })

  it('called to work with the book in the hand: it first brings it back and says so; before it has the book it just goes', () => {
    const d = new Director(FIVE)
    const at = new Map<string, string>()
    const st = idle()
    const go = (now: number) => d.goals(now, minute, st, (a) => at.get(a) ?? null)
    let now = minute * 60000
    go(now)
    st[reader] = { state: 'working', activity: 'test', since: 0 }
    expect(go(now + 100)[reader].read, 'not yet at the table: nothing to bring back').toBeUndefined()
    st[reader] = { state: 'idle', since: 0 }
    d.forceRead(reader, now, 0)
    at.set(reader, pickSpot(0))
    go((now += 200))
    go((now += (READ_S.pick + 0.2) * 1000))
    at.set(reader, 'sofa_0')
    go((now += 500))
    st[reader] = { state: 'working', activity: 'test', since: 0 }
    const g = go((now += 500))[reader]
    expect(g.read?.stage).toBe('return')
    expect(d.shown[reader]).toMatchObject({ kind: 'work', detail: READ_LABEL.return })
  })
})

describe('on the stage: the baked book, the planner walking the body', () => {
  it('seat 0: the body stands in the knee row facing the book, takes it, sits on sofa_0, reads, stands, and puts it back exactly where it rested', async () => {
    const w = await world()
    const book = w.nodes.prop_book
    const home = { p: book.position.clone(), q: book.quaternion.clone() }
    const guard = new Guard(w)
    const lap: number[] = []
    const turns = { n: 0, vis: false }
    const pad: Record<string, number> = {}
    const boxes = bookBoxes(bookDimsOf(w.nodes.prop_book_l, w.nodes.prop_book_r))
    const open: { l: number; r: number }[] = []
    const r = runRead(w, 'agent_0', 0, guard, {
      onStep: (walk, st) => {
        const g = walk.goals.agent_0
        if (st !== 'read') return
        const rig = w.rigs.agent_0
        lap.push(book.getWorldPosition(new Vector3()).y)
        const vis = w.nodes.prop_book_page.visible
        if (vis && !turns.vis) turns.n++
        turns.vis = vis
        // the open book: both halves at their open angle
        if (g.read!.u > 1.5) open.push({ l: w.nodes.prop_book_l.rotation.z, r: w.nodes.prop_book_r.rotation.z })
        // the hands on it, mid-reading and between two turns: every pad on its surface (fingers 1 mm, thumb 2.5 mm), none inside the book
        if (g.read!.u > 3 && g.read!.u < 3.1 && !vis) {
          const inv = book.matrixWorld.clone().invert()
          for (const side of ['l', 'r'] as const) {
            const h = rig.parts.hands[side]
            const tips = [...h.fingers.map((f, i) => ({ n: 'index middle ring little'.split(' ')[i], tip: h.tips[i]!, j: f[2]!.node })), { n: 'thumb', tip: h.thumbTip!, j: h.thumb[2]!.node }]
            for (const x of tips) {
              x.j.updateWorldMatrix(true, false)
              const d = distToBook(x.tip.clone().applyMatrix4(x.j.matrixWorld).applyMatrix4(inv), boxes).d
              pad[`${side} ${x.n}`] = Math.max(pad[`${side} ${x.n}`] ?? -Infinity, d)
              pad[`${side} ${x.n} min`] = Math.min(pad[`${side} ${x.n} min`] ?? Infinity, d)
            }
          }
        }
      },
    })
    expect(r.stages).toEqual(['fetch', 'pick', 'carry', 'read', 'return', 'put'])
    // the pick: in the knee row in front of seat 0, the book within REACH
    expect(Math.hypot(r.at.pick.x - 2.81, r.at.pick.z - 2.88)).toBeLessThan(0.1)
    expect(Math.hypot(r.at.pick.x - BOOK_AT.x, r.at.pick.z - BOOK_AT.z)).toBeLessThan(REACH)
    // seated on sofa_0 for the reading
    const seat0 = GRAPH.spots.sofa_0
    expect(Math.hypot(r.at.read.x - seat0.x, r.at.read.z - seat0.z)).toBeLessThan(0.05)
    // the times: the pick, the reading, the put
    expect(r.at.carry.t - r.at.pick.t).toBeCloseTo(READ_S.pick, 1)
    expect(r.at.return.t - r.at.read.t).toBeGreaterThanOrEqual(READ_S.read)
    expect(r.at.return.t - r.at.read.t).toBeLessThan(READ_S.read + 0.5)
    expect(r.ended - r.at.put.t).toBeGreaterThanOrEqual(READ_S.put - 0.1)
    // the book is read open at 150° (lower half lifted LIFT, upper at pi - LIFT), in the lap: above the table (0.40), under the face
    for (const o of open) {
      expect(o.l).toBeCloseTo(halfAngle('l'), 3)
      expect(o.r).toBeCloseTo(halfAngle('r'), 3)
      expect(o.l - o.r).toBeCloseTo(OPEN_ANGLE, 3)
    }
    expect(Math.min(...lap)).toBeGreaterThan(0.55)
    expect(Math.max(...lap)).toBeLessThan(1.1)
    // a leaf turns every 6 s: about ten in a minute
    expect(turns.n).toBeGreaterThanOrEqual(8)
    expect(turns.n).toBeLessThanOrEqual(11)
    // no finger inside the book (0.1 mm of float), pads within 1 mm of the surface, the thumb 2.5 mm: the same bounds as the standing grip
    expect(Object.keys(pad).length).toBe(20)
    for (const [k, d] of Object.entries(pad)) {
      if (k.endsWith('min')) expect(d, `${k} not inside`).toBeGreaterThanOrEqual(-1e-4)
      else expect(d, `${k} pad on the surface`).toBeLessThanOrEqual(k.endsWith('thumb') ? 0.0025 : 0.001)
    }
    // the round trip: taken within reach, put down within reach, nothing jumped, nothing was ever loose, and it is back exactly where it rested, closed
    expectClean('seated reading', guard.stats, 'book')
    expect(guard.stats.byProp.prop_book).toBe(1)
    expect(book.position.distanceTo(home.p)).toBeLessThan(0.001)
    expect(book.quaternion.angleTo(home.q)).toBeLessThan(0.001)
    expect(w.nodes.prop_book_l.rotation.z).toBeCloseTo(0, 6)
    expect(w.nodes.prop_book_r.rotation.z).toBeCloseTo(0, 6)
    expect(w.nodes.prop_book_page.visible).toBe(false)
  }, 180000)

  it("seat 1: picked at the table's east end within 1.5 s, read on sofa_1, put back from the same stand", async () => {
    const w = await world()
    const book = w.nodes.prop_book
    const home = book.position.clone()
    const guard = new Guard(w)
    const r = runRead(w, 'agent_2', 1, guard)
    expect(r.stages).toEqual(['fetch', 'pick', 'carry', 'read', 'return', 'put'])
    expect(Math.hypot(r.at.pick.x - 3.12, r.at.pick.z - 2.72)).toBeLessThan(0.1)
    expect(r.at.carry.t - r.at.pick.t, 'the stop at the east end').toBeLessThan(1.5)
    const seat1 = GRAPH.spots.sofa_1
    expect(Math.hypot(r.at.read.x - seat1.x, r.at.read.z - seat1.z)).toBeLessThan(0.05)
    expect(Math.hypot(r.at.put.x - r.at.pick.x, r.at.put.z - r.at.pick.z), 'put back from the same stand').toBeLessThan(0.1)
    expectClean('seat 1 reading', guard.stats, 'book')
    expect(book.position.distanceTo(home)).toBeLessThan(0.001)
  }, 180000)

  it('reduced motion: the same sequence, no leaf turns, the book back where it rested', async () => {
    const w = await world()
    const book = w.nodes.prop_book
    const home = book.position.clone()
    const guard = new Guard(w)
    let leaf = 0
    const r = runRead(w, 'agent_1', 0, guard, { reduced: true, onStep: () => void (w.nodes.prop_book_page.visible && leaf++) })
    expect(r.stages).toEqual(['fetch', 'pick', 'carry', 'read', 'return', 'put'])
    expect(leaf).toBe(0)
    expectClean('reduced reading', guard.stats, 'book')
    expect(book.position.distanceTo(home)).toBeLessThan(0.001)
  }, 180000)

  it('called to work while reading: the book is brought back and put down first, within reach, back home', async () => {
    const w = await world()
    const book = w.nodes.prop_book
    const home = book.position.clone()
    const guard = new Guard(w)
    let called = false
    const r = runRead(w, 'agent_3', 0, guard, {
      onStep: (walk, st) => {
        if (st === 'read' && walk.goals.agent_3.read!.u > 8 && !called) {
          called = true
          walk.status.agent_3 = { state: 'working', activity: 'test', since: 0 }
        }
      },
    })
    expect(called).toBe(true)
    expect(r.stages).toEqual(['fetch', 'pick', 'carry', 'read', 'return', 'put'])
    expect(r.at.return.t - r.at.read.t, 'cut short').toBeLessThan(15)
    expectClean('called away', guard.stats, 'book')
    expect(book.position.distanceTo(home)).toBeLessThan(0.001)
  }, 180000)
})
