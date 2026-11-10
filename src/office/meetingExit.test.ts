import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from './footprint.data'
import { formation } from './formation'
import { buildGrid, decodeFootprint } from './grid'
import { dist } from './nav'
import { GRAPH } from './navSpots.fixture'
import { MEET_INNER_R, TrafficPlanner } from './traffic'

// #355: leaving a seat of the meeting circle goes out by the near side, never across the middle; coming in is from outside.
// "Across the middle" = a planned step within half the circle's ring (MEET_INNER_R) of meet_center. Every leave / arrival below is a real
// plan of the traffic planner over the scene's footprint, the other seats of the circle held by their bodies.
const C = GRAPH.spots.meet_center
const planner = () => new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
/** the aisles, desks and spots round the room: every direction a body may set off to or come from */
const AROUND = ['work_0', 'work_1', 'work_3', 'work_4', 'desk_side_3', 'whiteboard', 'board_tray', 'hall_mid', 'hall_back', 'hall_north', 'hall_east', 'sofa_0', 'pingpong_a', 'chat_0', 'coffee', 'bulletin', 'shelf', 'game_a', 'door']

/** the closest the walker comes to the centre in 25 s */
function closest(p: TrafficPlanner, id: string) {
  let min = Infinity
  for (let t = 0; t <= 25; t += 0.05) min = Math.min(min, dist(p.sample(id, t), C))
  return min
}

describe('the circle keeps its middle free (#355)', () => {
  it('the planner keeps out of the inner half of the circle from every talk seat, leaving and arriving', () => {
    const seats = Object.keys(GRAPH.spots).filter((s) => s.startsWith('meet_talk_'))
    expect(seats.length).toBeGreaterThanOrEqual(2)
    for (const s of seats) {
      for (const d of AROUND) {
        // the other seats are taken (it must not squeeze between them either)
        const out = planner()
        out.place('a', { spot: s, pace: 1 }, 0, 0)
        seats.filter((o) => o !== s).forEach((o, k) => out.place(`o${k}`, { spot: o, pace: 1 }, 0, k + 1))
        out.request('a', { spot: d, pace: 1 }, 0, 0)
        out.update(0)
        expect(closest(out, 'a'), `${s} -> ${d}`).toBeGreaterThanOrEqual(MEET_INNER_R)
        expect(out.sample('a', 25).arrived, `${s} -> ${d} gets out and arrives`).toBe(d)
        const into = planner()
        into.place('a', { spot: d, pace: 1 }, 0, 0)
        into.request('a', { spot: s, pace: 1 }, 0, 0)
        into.update(0)
        expect(closest(into, 'a'), `${d} -> ${s}`).toBeGreaterThanOrEqual(MEET_INNER_R)
        expect(into.sample('a', 25).arrived, `${d} -> ${s} arrives`).toBe(s)
      }
    }
  }, 120_000) // every seat / formation through the planner: heavy, slow under a loaded machine (the 30 s default was missed at 33 s)

  it('the planner keeps out of it from every formation spot (open and closed, 2-5 seats), the others staying where they stand', () => {
    for (const open of [true, false]) {
      for (let n = 2; n <= 5; n++) {
        const ring = formation(C, n, open)
        for (let i = 0; i < n; i++) {
          for (const d of AROUND) {
            const out = planner()
            ring.forEach((sl, k) => out.place(`a${k}`, { spot: `meet_seat_${k}`, slot: sl, pace: 1 }, 0, k))
            out.request(`a${i}`, { spot: d, pace: 1 }, 0, i)
            out.update(0)
            expect(closest(out, `a${i}`), `${open ? 'open' : 'closed'} ${n}, seat ${i} -> ${d}`).toBeGreaterThanOrEqual(MEET_INNER_R)
            // (a destination one of the other bodies stands beside, the whiteboard behind a closed ring's board-side seat, is theirs to give up)
            if (!ring.some((sl, k) => k !== i && dist(sl, GRAPH.spots[d]) < 0.8)) expect(out.sample(`a${i}`, 25).arrived, `${open ? 'open' : 'closed'} ${n}, seat ${i} -> ${d} arrives`).toBe(d)
            // the others do not move for it, and nobody is squeezed: 2R stays
            for (let k = 0; k < n; k++) {
              if (k === i) continue
              for (let t = 0; t <= 25; t += 0.5) expect(dist(out.sample(`a${i}`, t), out.sample(`a${k}`, t))).toBeGreaterThanOrEqual(0.6)
            }
          }
        }
      }
    }
  }, 120_000) // every seat / formation through the planner: heavy, slow under a loaded machine (the 30 s default was missed at 33 s)

  it('arriving at a formation spot is from outside the inner half too (the other seats taken)', () => {
    for (const open of [true, false]) {
      for (let n = 2; n <= 5; n++) {
        const ring = formation(C, n, open)
        for (let i = 0; i < n; i++) {
          for (const d of ['work_0', 'work_3', 'whiteboard', 'hall_mid', 'hall_back', 'sofa_0', 'door']) {
            const into = planner()
            ring.forEach((sl, k) => k !== i && into.place(`a${k}`, { spot: `meet_seat_${k}`, slot: sl, pace: 1 }, 0, k))
            into.place(`a${i}`, { spot: d, pace: 1 }, 0, i)
            into.request(`a${i}`, { spot: `meet_seat_${i}`, slot: ring[i], pace: 1 }, 0, i)
            into.update(0)
            expect(closest(into, `a${i}`), `${open ? 'open' : 'closed'} ${n}, ${d} -> seat ${i}`).toBeGreaterThanOrEqual(MEET_INNER_R)
          }
        }
      }
    }
  }, 120_000) // every seat / formation through the planner: heavy, slow under a loaded machine (the 30 s default was missed at 33 s)

  it('a body bound for the centre itself still goes in', () => {
    const p = planner()
    p.place('a', { spot: 'hall_back', pace: 1 }, 0, 0)
    p.request('a', { spot: 'meet_center', pace: 1 }, 0, 0)
    p.update(0)
    expect(closest(p, 'a')).toBeLessThan(0.05)
  })
})
