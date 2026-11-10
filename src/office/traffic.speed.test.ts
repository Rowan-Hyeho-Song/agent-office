import { describe, expect, it } from 'vitest'
import { buildGrid, footprintFromRects } from './grid'
import { buildGraph, type NavSpot } from './nav'
import { CRUISE, TrafficPlanner, type Request } from './traffic'

// #339: nobody walks faster than 1.1 x the cruise. The speed spikes (up to 1.5 x) had two causes, both in how a replan joins the new plan to
// where the body is: the first step from a place that is not its cell's centre was timed as a whole cell, and the join pulled the smoothed start
// back to the body in 0.5 s (a push of 1.5 x offset / 0.5 s on top of the walk).
const CAP = 1.1 * CRUISE
const spot = (id: string, x: number, z: number): NavSpot => ({ id, x, z, ry: 0, kind: 'stand' })
const req = (s: string, extra: Partial<Request> = {}): Request => ({ spot: s, pace: 1, ...extra })

function fastest(p: TrafficPlanner, ids: string[], t0: number, t1: number, hook?: (t: number) => void) {
  let max = 0
  for (let t = t0; t <= t1; t += 0.05) {
    hook?.(t)
    p.update(t)
    for (const id of ids) max = Math.max(max, p.sample(id, t).speed)
  }
  return max
}

describe('walking speed stays within 1.1 x the cruise (#339)', () => {
  it('setting off from places that are not a cell centre, in every direction', () => {
    let worst = 0
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI
      const ox = 0.09 * Math.cos(a)
      const oz = 0.09 * Math.sin(a)
      const spots = [spot('A', ox, oz), spot('B', 5 + ox, 1 + oz)]
      const g = buildGraph(spots, [])
      const p = new TrafficPlanner(buildGrid(footprintFromRects(7, 3.5, []), g), g)
      p.place('a', req('A'), 0, 0)
      p.update(0)
      p.request('a', req('B'), 0)
      worst = Math.max(worst, fastest(p, ['a'], 0, 12))
    }
    expect(worst).toBeLessThanOrEqual(CAP)
  })

  it('several walking together, replanned as new requests come in', () => {
    const spots = [spot('A', -5.04, 0.07), spot('B', 5.03, 0.01), spot('C', -4.9, 2.1), spot('D', 4.95, -2.07), spot('E', 0.03, 2.4), spot('F', 0.02, -2.4)]
    const g = buildGraph(spots, [])
    const p = new TrafficPlanner(buildGrid(footprintFromRects(7, 3.5, []), g), g)
    const ids = ['a', 'b', 'c', 'd']
    ;['A', 'B', 'C', 'D'].forEach((s, i) => p.place(ids[i], req(s), 0, i))
    p.update(0)
    const goals: Record<string, [string, string, string]> = { a: ['B', 'E', 'D'], b: ['A', 'F', 'C'], c: ['D', 'A', 'F'], d: ['C', 'B', 'E'] }
    const max = fastest(p, ids, 0, 60, (t) => {
      // a new goal every 7 s, one agent after the other, so every replan finds the others on the move
      const k = Math.floor(t / 7)
      ids.forEach((id, i) => {
        if (t >= k * 7 + i * 0.6) p.request(id, req(goals[id][k % 3]), t)
      })
    })
    expect(max).toBeLessThanOrEqual(CAP)
  })
})
