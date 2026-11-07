import { BufferGeometry, Float32BufferAttribute, Mesh, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { PaperPlanes } from './plane'
import { HAND_SHAPES } from './rig'

/** a paper plane like prop_plane: nose at −z (a point), tail at +z (wings ±3 cm), keel down to y −0.011 at the tail */
function plane() {
  const g = new BufferGeometry()
  // left wing, right wing, keel
  g.setAttribute('position', new Float32BufferAttribute(
    [0, 0, -0.0425, -0.03, 0.006, 0.0375, 0, 0, 0.0375,
     0, 0, -0.0425, 0, 0, 0.0375, 0.03, 0.006, 0.0375,
     0, 0, -0.0425, 0, 0, 0.0375, 0, -0.011, 0.0375], 3))
  const node = new Object3D()
  node.add(new Mesh(g))
  node.position.set(1, 2, 3) // anywhere in the room: the spot is in the plane's own frame
  node.updateMatrixWorld(true)
  return node
}

describe('PaperPlanes.pinchSpot (#62)', () => {
  it('on the keel, 15% of the length in from the tail', () => {
    const s = PaperPlanes.pinchSpot(plane())
    expect(s.x).toBe(0)
    expect(s.z).toBeCloseTo(0.0375 - 0.08 * 0.15, 5)
    // halfway down the keel there: below the wings, above the keel's edge
    expect(s.y).toBeLessThan(0)
    expect(s.y).toBeGreaterThan(-0.011)
  })

  it('at least 70% of the plane is ahead of the fingers', () => {
    const s = PaperPlanes.pinchSpot(plane())
    expect((s.z - -0.0425) / 0.08).toBeGreaterThanOrEqual(0.7)
  })

  it('an empty node: the origin', () => {
    expect(PaperPlanes.pinchSpot(new Object3D()).toArray()).toEqual([0, 0, 0])
  })
})

describe('HAND_SHAPES (#62)', () => {
  it('pinch: the index folds over onto the thumb, the other fingers only half bend', () => {
    const { pinch, hold } = HAND_SHAPES
    expect(pinch.index).toBeGreaterThan(hold.index)
    expect(pinch.fingers).toBeLessThan(hold.fingers)
    expect(pinch.iz).toBeLessThan(0)
    expect(pinch.tz).toBeLessThan(0)
  })
})
