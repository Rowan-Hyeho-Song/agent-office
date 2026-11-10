import { describe, expect, it } from 'vitest'
import { buildGrid, FIELD_STATS, footprintFromRects } from './grid'
import { buildGraph, type NavSpot } from './nav'
import { TrafficPlanner, type Request } from './traffic'

// #218: what a replan costs, counted in work and not in milliseconds (those depend on the machine; traffic.day.test.ts reports them).
const spot = (id: string, x: number, z: number): NavSpot => ({ id, x, z, ry: 0, kind: 'stand' })
const req = (s: string): Request => ({ spot: s, pace: 1 })

function room() {
  const spots = [spot('A', -5, 0), spot('B', 5, 1), spot('C', 0, -2)]
  const g = buildGraph(spots, [])
  return new TrafficPlanner(buildGrid(footprintFromRects(7, 3.5, []), g), g)
}

describe('replan cost (#218)', () => {
  it('a plan builds one distance field per goal: the lane route reuses the search\'s', () => {
    const p = room()
    p.place('a', req('A'), 0, 0)
    p.update(0)
    const before = FIELD_STATS.builds
    p.request('a', req('B'), 1)
    p.update(1)
    // the free-flow pass and the plan itself ask for the same field: built once (a second Dijkstra over the whole floor for the lane route used to double it twice over)
    expect(FIELD_STATS.builds - before).toBe(1)
    // the same goal again, from somewhere else (another agent): the cached field serves
    p.place('b', req('C'), 1, 1)
    p.request('b', req('B'), 2)
    p.update(2)
    expect(FIELD_STATS.builds - before).toBe(1)
  })

  it('planning round a body that stands still for a long time (its cells are marked once and extended) keeps 2R', () => {
    // a walks to B, where b rests for the whole minute
    const p = room()
    p.place('a', req('A'), 0, 0)
    p.place('b', req('B'), 0, 1)
    p.update(0)
    p.request('a', req('B'), 1)
    p.update(1)
    let min = Infinity
    for (let t = 1; t < 60; t += 0.05) {
      p.update(t)
      const s = [p.sample('a', t), p.sample('b', t)]
      min = Math.min(min, Math.hypot(s[0].x - s[1].x, s[0].z - s[1].z))
    }
    // a walks to B's place and b, resting there, is walked round: never closer than 2R
    expect(min).toBeGreaterThanOrEqual(0.6)
  })
})
