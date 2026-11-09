import { BufferGeometry, Float32BufferAttribute, Mesh, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { PaperPlanes } from './plane'
import { HAND_SHAPES, jointAngles } from './rig'

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

describe('HAND_SHAPES (#62, #134)', () => {
  it('the nine shapes of agents.md 2.7, one bend per finger', () => {
    expect(Object.keys(HAND_SHAPES)).toEqual(['rest', 'type', 'hold', 'pinch', 'point', 'wave', 'frame', 'stamp', 'yield'])
    expect(HAND_SHAPES.rest).toEqual({ f: [0.25, 0.25, 0.3, 0.35], thumb: [0.2, 0] })
    expect(HAND_SHAPES.hold).toEqual({ f: [0.85, 0.88, 0.9, 0.92], thumb: [0.7, 1] })
    expect(HAND_SHAPES.frame.thumb).toEqual([0, -0.85])
  })
  it('pinch: the index folds onto a straight thumb turned across the palm (the tips meet on the #148 hand)', () => {
    const { pinch } = HAND_SHAPES
    expect(pinch.f[0]).toBeGreaterThanOrEqual(0.85)
    expect(pinch.thumb[0]).toBe(0)
    expect(pinch.thumb[1]).toBeGreaterThan(0.5)
  })
})

describe('jointAngles (#134)', () => {
  const D = Math.PI / 180
  it('root 75°·c, middle 90°·c, tip 60°·c', () => {
    const a = jointAngles(HAND_SHAPES.hold, 'r')
    expect(a.f[0][0]).toBeCloseTo(75 * D * 0.85)
    expect(a.f[1][1]).toBeCloseTo(90 * D * 0.88)
    expect(a.f[3][2]).toBeCloseTo(60 * D * 0.92)
  })
  it('the thumb: Rz(sx·60°·oppose)·Rx(55°·bend), tip Rx(70°·bend); the left hand opposes the other way', () => {
    const r = jointAngles(HAND_SHAPES.hold, 'r')
    const l = jointAngles(HAND_SHAPES.hold, 'l')
    expect(r.t1z).toBeCloseTo(60 * D)
    expect(l.t1z).toBeCloseTo(-60 * D)
    expect(r.t1x).toBeCloseTo(55 * D * 0.7)
    expect(r.t2x).toBeCloseTo(70 * D * 0.7)
    // 메시's frame opens the thumb outward
    expect(jointAngles(HAND_SHAPES.frame, 'r').t1z).toBeLessThan(0)
  })
})
