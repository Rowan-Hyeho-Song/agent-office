/// <reference types="node" />
// The five pull-out books stand on the SECOND shelf (#280, room-280.md 9.2 / 9.3): 0 · 1 · 2 on its bottom row, 3 · 4 on its top row, each with its
// grip child. The shelf stand (grips.md 2.1) is in front of that shelf; from there a hand reaches every book within the body's reach (water.ts REACH).
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice } from './glbLoad'
import { REACH } from './water'

/** where the book-picking agent stands and faces: in front of the second shelf (x 4.41), facing the wall (-z) */
export const SHELF_BOOK_STAND = { x: 4.65, z: -3.3 }
/** the right shoulder in the agent's local frame (grips.md 1.1): 0.24 out, 0.98 up; facing -z the agent's right is +x */
const SHOULDER = new Vector3(0.24, 0.98, 0)

describe('the pull-out books on the second shelf', () => {
  it('five books: 0 · 1 · 2 on the bottom row (top board 0.5125), 3 · 4 on the top row (1.3525), extras shelf 2 / shelf_row / shelf_slot (slot counted from the left)', async () => {
    const { nodes } = await loadOffice()
    const want = [
      [0, 1, 2, 0.5125],
      [1, 1, 1, 0.5125],
      [2, 1, 0, 0.5125],
      [3, 3, 1, 1.3525],
      [4, 3, 0, 1.3525],
    ]
    for (const [i, row, slot, board] of want) {
      const b = nodes[`prop_shelfbook_${i}`]
      expect(b, `prop_shelfbook_${i}`).toBeTruthy()
      expect(b.userData).toMatchObject({ prop: 'book', shelf: 2, shelf_row: row, shelf_slot: slot })
      // the book rests on its board: its centre is half its height above it (< 14 cm: a book standing 18 cm tall has its centre at most 0.12 up)
      expect(b.position.y - board).toBeGreaterThan(0.08)
      expect(b.position.y - board).toBeLessThan(0.14)
      expect(nodes[`prop_shelfbook_${i}_grip_r`]?.userData.grip_for).toBe('r')
    }
    // right end of the second shelf (x 4.41 +- 0.35): 4.70 · 4.665 · 4.629 on the bottom row, 4.70 · 4.664 on the top
    expect(nodes.prop_shelfbook_0.position.x).toBeCloseTo(4.7, 2)
    expect(nodes.prop_shelfbook_1.position.x).toBeCloseTo(4.665, 2)
    expect(nodes.prop_shelfbook_2.position.x).toBeCloseTo(4.629, 2)
    expect(nodes.prop_shelfbook_3.position.x).toBeCloseTo(4.7, 2)
    expect(nodes.prop_shelfbook_4.position.x).toBeCloseTo(4.664, 2)
  })

  it('from the stand in front of the second shelf the right hand reaches every book within REACH (measured, logged with FIT_LOG)', async () => {
    const { nodes } = await loadOffice()
    const shoulder = new Vector3(SHELF_BOOK_STAND.x + SHOULDER.x, SHOULDER.y, SHELF_BOOK_STAND.z)
    const dists: number[] = []
    for (let i = 0; i < 5; i++) {
      const d = shoulder.distanceTo(nodes[`prop_shelfbook_${i}`].position)
      dists.push(+d.toFixed(3))
      expect(d, `book ${i}`).toBeLessThanOrEqual(REACH)
    }
    if (process.env.FIT_LOG) console.log('shelf book reach (m):', dists.join(' '))
    // the first shelf's stand (nav spot shelf, 3.45 -3.2) is more than 0.6 m away: two readers do not stand on each other (2R)
    expect(Math.hypot(SHELF_BOOK_STAND.x - 3.45, SHELF_BOOK_STAND.z + 3.2)).toBeGreaterThan(0.6)
  })
})
