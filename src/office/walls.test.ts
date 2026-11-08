import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { SHELF, WALL_NODES, WALL_SPLIT, fadeGroupOfNode, wallOfLoose } from './walls'

const wallOfNode = (name: string) => WALL_NODES.find((r) => r.match.test(name))?.wall ?? null
const box = (min: [number, number, number], max: [number, number, number]) => new Box3(new Vector3(...min), new Vector3(...max))

describe('wall objects vs furniture', () => {
  it('things hanging on a wall are cut with it', () => {
    for (const n of ['surface_whiteboard', 'surface_bulletin']) expect(wallOfNode(n)).toBe('n')
    for (const n of ['door', 'screen_door', 'clock_hand_h', 'clock_hub', 'hit_clock']) expect(wallOfNode(n)).toBe('w')
  })
  it('the bookshelf (binders, plates, hit box) is furniture: never cut, a fade group of its own', () => {
    for (const n of ['shelf_r0_b0', 'shelf_r2_b9_label', 'screen_shelf_r1', 'hit_library']) {
      expect(wallOfNode(n)).toBeNull()
      expect(fadeGroupOfNode(n)).toBe(SHELF)
    }
  })
  it('desks and their screens are furniture too', () => {
    for (const n of ['desk_0', 'desk_2_lamp', 'screen_work_1']) expect(wallOfNode(n)).toBeNull()
    expect(fadeGroupOfNode('desk_2_lamp')).toBe('desk2')
  })
  it('the merged wall mesh: the shelf region is not a wall; the rest of the back wall and the left wall are', () => {
    expect(WALL_SPLIT.wall_items(2.8, 1.2, -2.5)).toBe(SHELF)
    expect(WALL_SPLIT.wall_items(0.6, 1.4, -2.7)).toBe('n') // whiteboard / bulletin side
    expect(WALL_SPLIT.wall_items(-3.5, 1.8, 1.3)).toBe('w') // clock
    expect(WALL_SPLIT.room(0, 1.3, -2.85)).toBe('n')
    expect(WALL_SPLIT.room(-3.55, 1.3, 0)).toBe('w')
    expect(WALL_SPLIT.room(0, 0.0, 0)).toBeNull() // floor
  })
  it('lounge parts: floor-touching ones are furniture, hung ones go with the wall, shelf contents with the shelf', () => {
    expect(wallOfLoose(box([-3.5, 0, 0.9], [-2.9, 1.3, 1.7]))).toBeNull() // coffee counter
    expect(wallOfLoose(box([-0.4, 0.4, -2.57], [-0.27, 1.2, -2.46]))).toBe('n') // hung on the back wall
    expect(wallOfLoose(box([2.16, 0.28, -2.45], [2.28, 0.6, -2.35]))).toBe(SHELF) // books at its left edge
    expect(wallOfLoose(box([2.5, 0.5, -2.5], [2.6, 0.8, -2.4]))).toBe(SHELF)
    expect(wallOfLoose(box([-0.6, 0.08, 1.7], [1.3, 0.3, 2.6]))).toBeNull() // sofa
  })
})
