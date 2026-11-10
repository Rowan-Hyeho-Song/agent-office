import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint } from './grid'
import { GRAPH } from './navSpots.fixture'
import { PLAYS } from './play'
import { TRAFFIC, TrafficPlanner, type Request } from './traffic'

// #272: a head-on meeting in a narrow passage is solved by the planner, with no help from the play schedule's assignment rule (play.ts used to keep
// a reader from going to the books the block after somebody napped on the sofa, because they would meet head on in the aisle one body wide that
// leads to the sofa). Here the two swap places on purpose: the sleeper gets up and walks to the book shelf's stand while the reader walks to the
// seat, whoever asked first, on the real room's floor.

const BOOKS = PLAYS.find((p) => p.kind === 'books')!
const booksReq = (): Request => ({ spot: 'shelf', slot: { ...BOOKS.stand!, ry: 0 }, pace: 1 })
const seatReq = (s: string): Request => ({ spot: s, pace: 1 })

function swap(seat: string, sleeperFirst: boolean) {
  const p = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
  const ids = sleeperFirst ? ['sleeper', 'reader'] : ['reader', 'sleeper']
  p.place(ids[0], ids[0] === 'sleeper' ? seatReq(seat) : booksReq(), 0, 0)
  p.place(ids[1], ids[1] === 'sleeper' ? seatReq(seat) : booksReq(), 0, 1)
  p.update(0)
  let min = Infinity
  let minSeat = Infinity
  let aloneStill = 0
  const stillFor = { sleeper: 0, reader: 0 }
  for (let t = 0; t <= 60; t += 0.05) {
    if (t >= 1) {
      p.request('sleeper', booksReq(), t)
      p.request('reader', seatReq(seat), t)
    }
    p.update(t)
    const a = p.sample('sleeper', t)
    const b = p.sample('reader', t)
    for (const [k, s] of [['sleeper', a], ['reader', b]] as const) if (t > 1 && t < 25 && !s.moving && s.arrived === null) stillFor[k] += 0.05
    const d = Math.hypot(a.x - b.x, a.z - b.z)
    // a body resting on a seat of the sofa row is kept at the seat pitch, any other pair at 2R (the day sim's rule)
    if (p.restsOnRowSeat(a.x, a.z) || p.restsOnRowSeat(b.x, b.z) || p.isSeatedPair(a.x, a.z, b.x, b.z)) minSeat = Math.min(minSeat, d)
    else min = Math.min(min, d)
    aloneStill = Math.max(aloneStill, stillFor.sleeper, stillFor.reader)
  }
  return { min, minSeat, arrived: [p.sample('sleeper', 60).arrived, p.sample('reader', 60).arrived], aloneStill, seatPass: p.seatPassM }
}

describe('head-on at the sofa and the book shelf, no assignment rule (#272)', () => {
  for (const seat of ['sofa_0', 'sofa_1', 'sofa_2', 'sofa_3']) {
    for (const first of [true, false]) {
      it(`${seat}, ${first ? 'the sleeper' : 'the reader'} asked first: 2R kept, both arrive, nobody waits long`, () => {
        const r = swap(seat, first)
        expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
        expect(r.minSeat).toBeGreaterThanOrEqual(r.seatPass - 0.005)
        expect(r.arrived).toEqual(['shelf', seat])
        // far under the 60 s the day sim allows for a wait: one lets the other by
        expect(r.aloneStill).toBeLessThan(20)
      })
    }
  }
})
