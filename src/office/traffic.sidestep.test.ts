import { Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { buildGrid, decodeFootprint, footprintFromRects } from './grid'
import { buildGraph, type NavSpot } from './nav'
import { inSofaRow, readSofaRow, rowApproach, rowLocal, SOFA_ROW, type SofaRow } from './sofaRow'
import { CRUISE, CRUISE_TUNED, TRAFFIC, TrafficPlanner, type Request } from './traffic'
import { FOOTPRINT_DATA } from './footprint.data'
import { GRAPH } from './navSpots.fixture'
import { PLAYS } from './play'
import { STANDS } from './water'

// The sofa's knee row (#341) on a synthetic floor with the re-baked room's numbers (web m): the low table's south edge z 2.69, the
// sofa's front z 3.11, so the row between them is 0.42 m deep (x 2.16 .. 3.06, centre line z 2.9). The table is made a long block
// to the north here (the way round it is far), the chaise (x 3.81 ..) leaves the 0.75 m east gap that is normal floor, not the row.
// Seats sofa_0..2 at z 3.445 on the sofa; sofa_in_w / sofa_in_e just outside the row's west end / on the east gap.

const ZONE: SofaRow = { cx: 2.61, cz: 2.9, ry: 0, face: Math.PI, sizeX: 0.9, sizeZ: 0.42 }
const RECTS: [number, number, number, number][] = [
  [2.4, 3.11, 3.81, 4], // the sofa
  [3.81, 2.4, 4.5, 4], // the chaise
  [2.16, -1, 3.06, 2.69], // the table (long, so the row is the way through)
]
const spot = (id: string, x: number, z: number, kind: NavSpot['kind'] = 'stand', ry = 0): NavSpot => ({ id, x, z, ry, kind })
const SPOTS: NavSpot[] = [
  spot('sofa_0', 2.635, 3.445, 'sofa'),
  spot('sofa_1', 3.105, 3.445, 'sofa'),
  spot('sofa_2', 3.575, 3.445, 'sofa'),
  spot('sofa_in_w', 2.12, 2.9, 'sofa_in', -Math.PI / 2),
  spot('sofa_in_e', 3.435, 2.9, 'sofa_in', Math.PI),
  // the middle of the row in front of seat 0: its lane (nav edge) runs from here straight across the sofa's front
  spot('row_0', 2.635, 2.9),
  // the east end of the row, inside it: the way from the east entrance into the row
  spot('row_e', 3.0, 2.9),
  // on the east gap, joined to the row's east end: its dock is carved first (docks are carved in id order, and seat 2's lane would
  // otherwise open the cell of sofa_in_e before it carves its own)
  spot('a_east_mouth', 3.3, 2.9),
  spot('W1', 0.9, 2.3),
  spot('W2', 0.9, 3.3),
  spot('E1', 5.2, 2.3),
  spot('E2', 5.9, 2.3),
  spot('P', -2, 2.9),
  spot('P2', -2.2, 2.0),
]
const EDGES: [string, string][] = [
  ['W1', 'sofa_in_w'],
  ['sofa_in_w', 'row_0'],
  ['row_0', 'sofa_0'],
  ['sofa_0', 'sofa_1'],
  ['sofa_1', 'sofa_2'],
  ['sofa_in_e', 'sofa_2'],
  ['a_east_mouth', 'row_e'],
  ['a_east_mouth', 'sofa_in_e'],
]
const R2 = 2 * TRAFFIC.bodyR
const req = (s: string, extra: Partial<Request> = {}): Request => ({ spot: s, pace: 1, ...extra })

function floor(zone: SofaRow | null = ZONE, spots = SPOTS, rects = RECTS) {
  const g = buildGraph(spots, EDGES)
  return { g, p: new TrafficPlanner(buildGrid(footprintFromRects(7, 4, rects), g, {}, zone ?? undefined), g) }
}

type Pt = { x: number; z: number }
const seated = (p: Pt) => SPOTS.some((s) => s.kind === 'sofa' && Math.hypot(s.x - p.x, s.z - p.z) < SOFA_ROW.seatEps)
const standing = (p: Pt) => inSofaRow(ZONE, p.x, p.z) && !seated(p)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** run the clock in 50 ms steps, calling `each` after every update */
function run(p: TrafficPlanner, t0: number, t1: number, each: (t: number) => void) {
  for (let t = t0; t <= t1 + 1e-9; t += 0.05) {
    p.update(t)
    each(t)
  }
}

describe('the sofa row: grid', () => {
  it('relaxes the furniture clearance inside the row only', () => {
    const fp = footprintFromRects(7, 4, RECTS)
    // no docks: a spot that is blocked in one grid and not in the other would carve its own (the row's spots are open only in the relaxed one)
    const plain = buildGrid(fp)
    const row = buildGrid(fp, undefined, {}, ZONE)
    let opened = 0
    for (let c = 0; c < plain.blocked.length; c++) {
      const x = plain.minX + ((c % plain.w) + 0.5) * plain.cell
      const z = plain.minZ + (Math.floor(c / plain.w) + 0.5) * plain.cell
      if (inSofaRow(ZONE, x, z)) {
        // never closed, only opened
        expect(row.blocked[c]).toBeLessThanOrEqual(plain.blocked[c])
        if (plain.blocked[c] && !row.blocked[c]) opened++
      } else expect(row.blocked[c]).toBe(plain.blocked[c])
    }
    expect(opened).toBeGreaterThan(5)
  })

  it('without a row the grid has no zone', () => {
    expect(floor(null).p.grid.zone).toBeUndefined()
  })
})

describe('the sofa row: reader', () => {
  it('reads zone_sofa_row: position, rotation y, extras size_x / size_z', () => {
    const scene = new Object3D()
    const n = new Object3D()
    n.name = SOFA_ROW.node
    n.position.set(2.61, 0, 2.9)
    n.rotation.y = 0
    n.userData = { zone: 'sofa_row', ry: 0, size_x: 0.9, size_z: 0.42 }
    scene.add(n)
    const z = readSofaRow(scene)!
    expect(z.cx).toBeCloseTo(2.61)
    expect(z.cz).toBeCloseTo(2.9)
    expect(z.ry).toBeCloseTo(0)
    // the sofa is on the +z side: a body in the row faces +z
    expect(Math.abs(z.face)).toBeCloseTo(Math.PI)
    expect(z.sizeX).toBe(0.9)
    expect(z.sizeZ).toBe(0.42)
  })

  it('is null when the node is not baked or its size is missing', () => {
    const scene = new Object3D()
    expect(readSofaRow(scene)).toBeNull()
    const n = new Object3D()
    n.name = SOFA_ROW.node
    scene.add(n)
    expect(readSofaRow(scene)).toBeNull()
  })
})

describe('the sofa row: side-step rule', () => {
  it('seat 0 from the west and seat 2 from the east at the same time: both arrive, never two standing in the row, nobody waits over 60 s', () => {
    const { p } = floor()
    p.place('a', req('W1'), 0, 0)
    p.place('b', req('E1'), 0, 1)
    p.update(0)
    p.request('a', req('sofa_0'), 0)
    p.request('b', req('sofa_2'), 0)
    run(p, 0, 70, () => {})
    let both = 0
    let still = 0
    let worst = 0
    for (let t = 0; t <= 70; t += 0.05) {
      const sa = p.sample('a', t)
      const sb = p.sample('b', t)
      if (standing(sa) && standing(sb)) both++
      for (const s of [sa, sb]) {
        still = s.moving || s.arrived ? 0 : still + 0.05
        worst = Math.max(worst, still)
      }
    }
    expect(p.sample('a', 70).arrived).toBe('sofa_0')
    expect(p.sample('b', 70).arrived).toBe('sofa_2')
    expect(both).toBe(0)
    expect(worst).toBeLessThan(60)
  })

  it('two bodies that both need the row (one to seat 0, one crossing it) never stand in it together; both arrive within 60 s', () => {
    const { p } = floor()
    // b asked first (it has the row), a comes the other way
    p.place('b', req('E1'), 0, 0)
    p.place('a', req('W1'), 0, 1)
    p.update(0)
    p.request('b', req('P'), 0)
    p.request('a', req('sofa_0'), 0)
    run(p, 0, 70, () => {})
    let both = 0
    let used = 0
    for (let t = 0; t <= 70; t += 0.05) {
      const sa = p.sample('a', t)
      const sb = p.sample('b', t)
      if (standing(sa) && standing(sb)) both++
      if (standing(sb)) used++
    }
    expect(p.sample('a', 70).arrived).toBe('sofa_0')
    expect(p.sample('b', 70).arrived).toBe('P')
    expect(used).toBeGreaterThan(0)
    expect(both).toBe(0)
    expect(Math.max(p.settledAt('a'), p.settledAt('b'))).toBeLessThan(60)
  })

  it('two bodies walking the row the same way: the second stays out until the first has left it (no following in the row)', () => {
    const { p } = floor()
    p.place('a', req('E1'), 0, 0)
    p.place('b', req('E2'), 0, 1)
    p.update(0)
    p.request('a', req('P'), 0)
    p.request('b', req('P2'), 0)
    let both = 0
    let used = 0
    run(p, 0, 70, (t) => {
      const sa = p.sample('a', t)
      const sb = p.sample('b', t)
      if (standing(sa) && standing(sb)) both++
      if (standing(sa) && standing(sb) === false) used++
    })
    expect(p.sample('a', 70).arrived).toBe('P')
    expect(p.sample('b', 70).arrived).toBe('P2')
    expect(used).toBeGreaterThan(0)
    expect(both).toBe(0)
  })

  it('every seat is within 1.0 m of side-stepping from the row end of its entrance (the nearest one)', () => {
    const { g } = floor()
    for (const id of ['sofa_0', 'sofa_1', 'sofa_2']) {
      const s = g.spots[id]
      const near = ['sofa_in_w', 'sofa_in_e'].map((e) => g.spots[e]).sort((p, q) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(q.x - s.x, q.z - s.z))[0]
      // along the row from the row's end on the entrance's side to the seat
      const end = ZONE.cx + Math.sign(near.x - ZONE.cx) * (ZONE.sizeX / 2)
      expect(Math.abs(s.x - end)).toBeLessThanOrEqual(1.0)
    }
  })

  it('goes in by the entrance nearest its seat: nobody walks on past its seat deeper into the row (the far end stays shut)', () => {
    const through = (seat: string, from: string) => {
      const { p } = floor()
      p.place('a', req(from), 0, 0)
      p.update(0)
      p.request('a', req(seat), 0)
      run(p, 0, 90, () => {})
      const xs: number[] = []
      for (let t = 0; t <= 90; t += 0.05) {
        const s = p.sample('a', t)
        if (inSofaRow(ZONE, s.x, s.z)) xs.push(s.x)
      }
      expect(p.sample('a', 90).arrived).toBe(seat)
      return xs
    }
    // seat 0 (west entrance) from the east side: never in the row's east end (x > seat + overshoot)
    expect(through('sofa_0', 'E1').every((x) => x <= 2.635 + SOFA_ROW.overshootM)).toBe(true)
    // seat 1 (east entrance, 0.33 m away) from the west side: never in the row's west end
    expect(through('sofa_1', 'W1').every((x) => x >= 3.105 - SOFA_ROW.overshootM)).toBe(true)
    // and a seat's own entrance does use the row: seat 0 from the west walks it
    expect(through('sofa_0', 'W1').length).toBeGreaterThan(0)
  })

  it('in the row: at most 0.4 x cruise, and the body faces the sofa instead of its way', () => {
    const { p } = floor()
    p.place('a', req('W1'), 0, 0)
    p.update(0)
    p.request('a', req('sofa_0'), 0)
    let inside = 0
    let maxSpeed = 0
    let maxYaw = 0
    // a stand-in for the rig's heading (rig.ts: capped turn rate TURN_RATE = 4.5 x CRUISE / CRUISE_TUNED, 60 fps) so the turn at the edge is judged too
    const TURN = (4.5 * CRUISE) / CRUISE_TUNED / 60
    let yaw = NaN
    let sent = false
    for (let t = 0; t <= 60; t += 1 / 60) {
      // later a gets up and walks out the way it came
      if (!sent && t > 25) {
        p.request('a', req('P'), t)
        sent = true
      }
      p.update(t)
      const s = p.sample('a', t)
      if (Number.isNaN(yaw)) yaw = s.heading ?? 0
      if (s.heading !== null) {
        const diff = wrap(s.heading - yaw)
        const turn = Math.max(-TURN, Math.min(TURN, diff)) * Math.min(1, 12 / 60 + 0.4)
        yaw = wrap(yaw + turn)
      }
      if (inSofaRow(ZONE, s.x, s.z) && s.moving) {
        inside++
        maxSpeed = Math.max(maxSpeed, s.speed)
        maxYaw = Math.max(maxYaw, Math.abs(wrap(s.heading! - ZONE.face)), Math.abs(wrap(yaw - ZONE.face)))
      }
    }
    expect(inside).toBeGreaterThan(60)
    expect(maxSpeed).toBeLessThanOrEqual(0.4 * TRAFFIC.cruise + 0.03)
    expect(maxYaw).toBeLessThanOrEqual((10 * Math.PI) / 180)
  })

  it('a body getting up and walking out through the row: the one that wants in waits outside until it is out', () => {
    const { p } = floor()
    p.place('a', req('sofa_0'), 0, 0)
    p.place('b', req('W2'), 0, 1)
    p.update(0)
    p.request('a', req('P'), 0)
    p.request('b', req('E1'), 0)
    let aIn = false
    let aOutAt = -Infinity
    let bInAt = Infinity
    let bWaited = 0
    run(p, 0, 70, (t) => {
      const sa = p.sample('a', t)
      const sb = p.sample('b', t)
      if (standing(sa)) {
        aIn = true
        aOutAt = t
      }
      if (standing(sb)) bInAt = Math.min(bInAt, t)
      // waiting outside the mouth while the leaver is in the row
      if (standing(sa) && !standing(sb) && !sb.moving) bWaited += 0.05
    })
    expect(p.sample('a', 70).arrived).toBe('P')
    expect(p.sample('b', 70).arrived).toBe('E1')
    expect(aIn).toBe(true)
    expect(bInAt).toBeLessThan(Infinity)
    expect(bInAt).toBeGreaterThan(aOutAt)
    expect(bWaited).toBeGreaterThan(0.3)
  })

  it('a seated body does not block another from entering', () => {
    const { p } = floor()
    p.place('a', req('sofa_1'), 0, 0)
    p.place('b', req('W1'), 0, 1)
    p.update(0)
    p.request('b', req('sofa_0'), 0)
    let still = 0
    let worst = 0
    run(p, 0, 60, (t) => {
      const s = p.sample('b', t)
      still = s.moving || s.arrived ? 0 : still + 0.05
      worst = Math.max(worst, still)
    })
    expect(p.sample('a', 60).arrived).toBe('sofa_1')
    expect(p.sample('b', 60).arrived).toBe('sofa_0')
    // b came straight in: it never stood waiting
    expect(worst).toBeLessThan(1)
  })

  it('outside the row the furniture clearance is unchanged: the same walk past the table end is the same with and without the zone', () => {
    const walk = (zone: SofaRow | null) => {
      const spots = [...SPOTS, spot('N1', 0.9, -1.3), spot('N2', 5.2, -1.3)]
      const { p } = floor(zone, spots)
      p.place('a', req('N1'), 0, 0)
      p.update(0)
      p.request('a', req('N2'), 0)
      const out: Pt[] = []
      run(p, 0, 15, (t) => out.push(p.sample('a', t)))
      return { out, p }
    }
    const withRow = walk(ZONE)
    const without = walk(null)
    expect(withRow.p.sample('a', 15).arrived).toBe('N2')
    let minD = Infinity
    for (let i = 0; i < withRow.out.length; i++) {
      const s = withRow.out[i]
      // distance to the table rectangle
      const dx = Math.max(2.16 - s.x, 0, s.x - 3.06)
      const dz = Math.max(-1 - s.z, 0, s.z - 2.69)
      minD = Math.min(minD, Math.hypot(dx, dz))
      expect(s.x).toBeCloseTo(without.out[i].x, 9)
      expect(s.z).toBeCloseTo(without.out[i].z, 9)
    }
    // the body radius (the grid's own rounding is a few cm)
    expect(minD).toBeGreaterThanOrEqual(TRAFFIC.bodyR - 0.04)
  })

  it('no zone: a head-on swap on open floor behaves as it always did (both keep right, never closer than 2R, heading = way of travel)', () => {
    const { p } = floor(null, [spot('A', -5, -2), spot('B', 5, -2)], [])
    p.place('a', req('A'), 0, 0)
    p.place('b', req('B'), 0, 1)
    p.update(0)
    p.request('a', req('B'), 0)
    p.request('b', req('A'), 0)
    let min = Infinity
    let zA = -Infinity
    let off = 0
    run(p, 0, 25, (t) => {
      const sa = p.sample('a', t)
      const sb = p.sample('b', t)
      min = Math.min(min, Math.hypot(sa.x - sb.x, sa.z - sb.z))
      zA = Math.max(zA, sa.z)
      if (sa.heading !== null) {
        const q = p.position('a', t + 0.1)
        const o = p.position('a', t - 0.1)
        off = Math.max(off, Math.abs(wrap(sa.heading - Math.atan2(-(q.x - o.x), -(q.z - o.z)))))
      }
    })
    expect(min).toBeGreaterThanOrEqual(R2)
    expect(zA).toBeGreaterThan(-2 + 0.2)
    expect(off).toBeLessThan(0.5)
    expect(p.settledAt('a')).toBeLessThan(10 / TRAFFIC.cruise + 2)
    expect(p.settledAt('b')).toBeLessThan(10 / TRAFFIC.cruise + 2)
  })
})

// The re-baked room itself (generated footprint + nav): no stand a body is put at may be a pocket it cannot plan out of (#341: a body was seen
// standing at the sofa plant's stand, the 0.9 m west gap, after a boardgame goal).
describe('the re-baked lounge: every stand has a way out', () => {
  const stands: [string, { x: number; z: number }][] = [
    ...Object.entries(STANDS),
    ['book', PLAYS.find((p) => p.kind === 'books')!.stand!],
    ...Object.values(GRAPH.spots)
      .filter((s) => s.kind !== 'hall' && s.kind !== 'meet_center' && s.x > 0.8 && s.z > 1.4)
      .map((s): [string, { x: number; z: number }] => [s.id, s]),
  ]
  for (const [name, at] of stands) {
    for (const goal of ['hall_front', 'game_a']) {
      it(`${name} (${at.x}, ${at.z}) -> ${goal}`, () => {
        const p = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
        p.place('a', { spot: 'stand_here', pace: 1, slot: { x: at.x, z: at.z, ry: 0 } }, 0, 0)
        p.update(0)
        p.request('a', req(goal), 0)
        run(p, 0, 90, () => {})
        expect(p.sample('a', 90).arrived).toBe(goal)
      })
    }
  }
})

// Seated bodies are exempt in the row and at the entrances (#341), but a walker never comes nearer than the seat pitch (the closest two seats of the
// row, read off the nav graph; two heads are 0.42 m wide) to a body resting on a seat of the sofa (#280: 0.438 m was measured passing the sitter
// on seat 2 into seat 1). Seats, entrances and starts are picked from the generated nav by kind and order: the sofa is rebuilt in the next bake.
describe('the re-baked lounge: passing a seated body keeps the seat pitch', () => {
  const zone = FOOTPRINT_DATA.zone as SofaRow
  const all = Object.values(GRAPH.spots).sort((a, b) => (a.id < b.id ? -1 : 1))
  const entrances = all.filter((s) => s.kind === 'sofa_in')
  const rowSeats = (rowApproach(zone, entrances, all.filter((s) => s.kind === 'sofa')).seats as NavSpot[]).sort((a, b) => rowLocal(zone, a.x, a.z).u - rowLocal(zone, b.x, b.z).u)
  // a hall spot beside each entrance: where a walker comes from
  const starts = entrances.map((e) => all.filter((s) => s.kind === 'hall').sort((a, b) => Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z))[0].id)
  const cases: [string, string, string][] = []
  rowSeats.forEach((seat, k) => {
    for (const j of [k - 1, k + 1]) if (rowSeats[j]) for (const from of new Set(starts)) cases.push([seat.id, rowSeats[j].id, from])
  })
  it('the row has seats to pass between', () => {
    expect(rowSeats.length).toBeGreaterThanOrEqual(2)
    expect(cases.length).toBeGreaterThan(0)
  })
  for (const [seat, sitter, from] of cases) {
    it(`a sitter on ${sitter}, a walker from ${from} to ${seat} and back: never nearer than the pitch, there within 60 s`, () => {
      const p = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
      p.place('s', req(sitter), 0, 0)
      p.place('w', req(from), 0, 1)
      p.update(0)
      p.request('w', req(seat), 0)
      const pitch = p.seatPassM
      expect(pitch).toBeGreaterThan(0.42)
      let min = Infinity
      let sat = -1
      let out = -1
      let sent = false
      for (let t = 0; t <= 150; t += 0.05) {
        if (sat < 0 && p.sample('w', t).arrived === seat) sat = t
        if (sat >= 0 && !sent && t > sat + 5) {
          p.request('w', req(from), t)
          sent = true
        }
        p.update(t)
        const w = p.sample('w', t)
        const s = p.sample('s', t)
        min = Math.min(min, Math.hypot(w.x - s.x, w.z - s.z))
        if (sent && out < 0 && w.arrived === from) out = t
      }
      expect(sat, 'sat on the seat').toBeGreaterThanOrEqual(0)
      expect(sat).toBeLessThan(60)
      expect(out, 'left again').toBeGreaterThan(sat)
      expect(out - sat - 5).toBeLessThan(60)
      expect(min).toBeGreaterThanOrEqual(pitch - 0.005)
    })
  }
  // a seat between two sitters (five agents, three seats: the schedule can fill both sides first)
  rowSeats.forEach((seat, k) => {
    const [l, r] = [rowSeats[k - 1], rowSeats[k + 1]]
    if (!l || !r) return
    for (const from of new Set(starts))
      it(`sitters on ${l.id} and ${r.id}, a walker from ${from} to ${seat.id} and back: never nearer than the pitch to either`, () => {
        const p = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
        p.place('l', req(l.id), 0, 0)
        p.place('r', req(r.id), 0, 1)
        p.place('w', req(from), 0, 2)
        p.update(0)
        p.request('w', req(seat.id), 0)
        const pitch = p.seatPassM
        let min = Infinity
        let sat = -1
        let out = -1
        let sent = false
        for (let t = 0; t <= 150; t += 0.05) {
          if (sat < 0 && p.sample('w', t).arrived === seat.id) sat = t
          if (sat >= 0 && !sent && t > sat + 5) {
            p.request('w', req(from), t)
            sent = true
          }
          p.update(t)
          const w = p.sample('w', t)
          for (const id of ['l', 'r']) {
            const s = p.sample(id, t)
            min = Math.min(min, Math.hypot(w.x - s.x, w.z - s.z))
          }
          if (sent && out < 0 && w.arrived === from) out = t
        }
        expect(sat, 'sat on the seat').toBeGreaterThanOrEqual(0)
        expect(sat).toBeLessThan(60)
        expect(out, 'left again').toBeGreaterThan(sat)
        expect(out - sat - 5).toBeLessThan(60)
        expect(min).toBeGreaterThanOrEqual(pitch - 0.005)
      })
  })
})
