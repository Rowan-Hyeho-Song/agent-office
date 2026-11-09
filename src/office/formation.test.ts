import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from './footprint.data'
import { formation, SEAT_R, stepBack, turnToward } from './formation'
import { buildGrid, cellAt, decodeFootprint } from './grid'
import { dist } from './nav'
import { GRAPH } from './navSpots.fixture'

// one meeting circle (#195): its ry is the way to the whiteboard, the ring is turned with it
const board = GRAPH.spots.meet_center
const floor = board
const deg = (a: number) => (a * 180) / Math.PI
/** angle of a seat seen from the centre, 0° = toward the board (the centre's ry), + toward +x */
const angleOf = (c: { x: number; z: number; ry?: number }, p: { x: number; z: number }) => (deg(Math.atan2(p.x - c.x, -(p.z - c.z)) + (c.ry ?? 0)) + 360) % 360
/** the angle between where a slot faces and the direction to a point */
const off = (s: { x: number; z: number; ry: number }, to: { x: number; z: number }) => Math.abs(deg(Math.atan2(Math.sin(Math.atan2(-(to.x - s.x), -(to.z - s.z)) - s.ry), Math.cos(Math.atan2(-(to.x - s.x), -(to.z - s.z)) - s.ry))))

describe('formation (#141)', () => {
  it('open circle: 2 face each other at ±90°, 3 at 113/180/247, 4 at 92/150/210/268 (66-67° apart, see formation.ts), all facing the centre', () => {
    const want = { 2: [90, 270], 3: [113, 180, 247], 4: [80, 147, 213, 280] } as const
    for (const n of [2, 3, 4] as const) {
      const f = formation(board, n, true)
      expect(f.map((s) => Math.round(angleOf(board, s)))).toEqual(want[n])
      for (const s of f) {
        expect(dist(s, board)).toBeCloseTo(SEAT_R)
        expect(off(s, board)).toBeLessThan(0.01)
      }
    }
  })
  it('the board side (0° ± 60°) stays empty with a decision', () => {
    for (const n of [1, 2, 3, 4, 5]) for (const s of formation(board, n, true)) expect(Math.abs(((angleOf(board, s) + 180) % 360) - 180)).toBeGreaterThanOrEqual(60)
  })
  it('closed circle without a decision: 2 face each other, 3 and 4 spread evenly, one stands at 180°', () => {
    expect(formation(floor, 1, false).map((s) => Math.round(angleOf(floor, s)))).toEqual([180])
    expect(formation(floor, 2, false).map((s) => Math.round(angleOf(floor, s)))).toEqual([90, 270])
    expect(formation(floor, 3, false).map((s) => Math.round(angleOf(floor, s)))).toEqual([60, 180, 300])
    expect(formation(floor, 4, false).map((s) => Math.round(angleOf(floor, s)))).toEqual([45, 135, 225, 315])
  })
  it("two seats are never closer than the planner's 0.8 m, and every seat is walkable floor of the committed footprint", () => {
    const grid = buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH)
    for (const [c, open] of [[board, true], [floor, false], [floor, true]] as const)
      for (const n of [1, 2, 3, 4, 5]) {
        const f = formation(c, n, open)
        for (let i = 0; i < f.length; i++) {
          const cell = cellAt(grid, f[i].x, f[i].z)
          expect(cell, `${n} seats, seat ${i}`).toBeGreaterThanOrEqual(0)
          expect(grid.blocked[cell], `${n} seats at (${f[i].x.toFixed(2)}, ${f[i].z.toFixed(2)})`).toBe(0)
          for (let j = i + 1; j < f.length; j++) expect(dist(f[i], f[j])).toBeGreaterThanOrEqual(0.8)
        }
      }
  })
  it('five seats (#193): open 70/125/180/235/290 (55° apart, 0.83 m), closed every 72°, all facing the centre, board gap 70°', () => {
    const open = formation(board, 5, true)
    expect(open.map((s) => Math.round(angleOf(board, s)))).toEqual([70, 125, 180, 235, 290])
    expect(formation(floor, 5, false).map((s) => Math.round(angleOf(floor, s)))).toEqual([0, 72, 144, 216, 288])
    for (const s of [...open, ...formation(floor, 5, false)]) {
      expect(dist(s, board)).toBeCloseTo(SEAT_R)
      expect(off(s, board)).toBeLessThan(0.01)
    }
    for (const s of open) expect(Math.abs(((angleOf(board, s) + 180) % 360) - 180)).toBeGreaterThanOrEqual(70 - 0.5)
  })
  it('turnToward turns at most 15° toward the board; stepBack moves 0.3 m away from the centre', () => {
    const [s] = formation(board, 3, true)
    const t = turnToward(s, GRAPH.spots.whiteboard, 15)
    expect(Math.abs(deg(Math.atan2(Math.sin(t.ry - s.ry), Math.cos(t.ry - s.ry))))).toBeCloseTo(15)
    expect(off(t, GRAPH.spots.whiteboard)).toBeLessThan(off(s, GRAPH.spots.whiteboard))
    const b = stepBack(board, s, 0.3, GRAPH.spots.work_3)
    expect(dist(b, board)).toBeCloseTo(SEAT_R + 0.3)
    expect(off(b, GRAPH.spots.work_3)).toBeLessThan(0.01)
  })
})
