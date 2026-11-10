import { BufferGeometry, Float32BufferAttribute, Mesh, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { PaperPlanes } from './plane'
import { HAND_POSES } from './rig'
import { POSES } from './handPose'

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

describe('HAND_POSES (#62, #134, #282)', () => {
  it('the nine shapes of agents.md 2.7 are named poses of hand-poses.md 2', () => {
    expect(Object.keys(HAND_POSES)).toEqual(['rest', 'type', 'hold', 'pinch', 'point', 'wave', 'frame', 'stamp', 'yield'])
    expect(HAND_POSES.rest).toBe(POSES.rest)
    expect(HAND_POSES.hold).toBe(POSES.wrap)
    expect(HAND_POSES.pinch).toBe(POSES.ok)
    expect(HAND_POSES.frame.thumb).toEqual({ cmcFlex: -15, cmcAbd: 10, mcp: 0, ip: 0 })
  })
  it('pinch: 끝 집기, the index bent onto the opposed thumb, the other three stretched', () => {
    const { pinch } = HAND_POSES
    expect(pinch.f[0].mcp).toBeGreaterThanOrEqual(40)
    expect(pinch.f[1].mcp).toBeLessThan(20)
    expect(pinch.thumb.ip).toBe(50)
  })
})
