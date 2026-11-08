import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, cellAt, centre, decodeFootprint, distanceField, findPath, lineClear } from './grid'
import { dist } from './nav'
import { GRAPH } from './navSpots.fixture'

const fp = decodeFootprint(FOOTPRINT_DATA)
const grid = buildGrid(fp, GRAPH)

describe('walkable grid', () => {
  it('has a blocked share that looks like a furnished room', () => {
    const n = grid.blocked.reduce((a, b) => a + b, 0)
    expect(n / grid.blocked.length).toBeGreaterThan(0.1)
    expect(n / grid.blocked.length).toBeLessThan(0.6)
  })

  it('every nav spot is on a walkable cell and reaches every other', () => {
    const spots = Object.values(GRAPH.spots)
    for (const a of spots) expect(grid.blocked[cellAt(grid, a.x, a.z)], a.id).toBe(0)
    for (const b of spots) {
      const D = distanceField(grid, cellAt(grid, b.x, b.z))
      for (const a of spots) expect(Number.isFinite(D[cellAt(grid, a.x, a.z)]), `${a.id}->${b.id}`).toBe(true)
    }
  })

  it('1,000 random walkable start/goal pairs: all found, smoothed legs never cross a blocked cell', () => {
    let seed = 12345
    const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
    const free: number[] = []
    for (let c = 0; c < grid.blocked.length; c++) if (!grid.blocked[c]) free.push(c)
    // the main region (a few pockets between furniture may be cut off: not reachable pairs)
    const D0 = distanceField(grid, cellAt(grid, GRAPH.spots.hall_mid.x, GRAPH.spots.hall_mid.z))
    const main = free.filter((c) => Number.isFinite(D0[c]))
    let ok = 0
    let crossings = 0
    let ms = 0
    for (let k = 0; k < 1000; k++) {
      const a = centre(grid, main[Math.floor(rnd() * main.length)])
      const b = centre(grid, main[Math.floor(rnd() * main.length)])
      const t0 = performance.now()
      const p = findPath(grid, a, b)
      ms += performance.now() - t0
      if (!p) continue
      ok++
      for (let i = 1; i < p.length; i++) if (!lineClear(grid, p[i - 1], p[i])) crossings++
    }
    console.log(`grid paths: ${ok}/1000 found (${free.length - main.length} of ${free.length} walkable cells are cut-off pockets), crossings ${crossings}, ${(ms / 1000).toFixed(2)} ms per path`)
    expect(ok).toBe(1000)
    expect(crossings).toBe(0)
  })

  it('a desk seat is reached through its dock', () => {
    const s = GRAPH.spots.work_0
    const p = findPath(grid, GRAPH.spots.hall_mid, s)!
    expect(p).not.toBeNull()
    expect(dist(p[p.length - 1], s)).toBeLessThan(1e-9)
  })
})
