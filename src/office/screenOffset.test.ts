import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { SCREEN_OFFSET } from './screenLive'

// #260: at some angles the monitor's canvas went black. The screen plate shares its plane with the monitor's black bed
// (z-fighting, measured on the glb), so the screen material is pulled towards the camera in the depth test.
describe('monitor screen plate (#260)', () => {
  it('is pulled towards the camera in depth (polygon offset, negative = nearer)', () => {
    expect(SCREEN_OFFSET.polygonOffset).toBe(true)
    expect(SCREEN_OFFSET.polygonOffsetFactor).toBeLessThan(0)
    expect(SCREEN_OFFSET.polygonOffsetUnits).toBeLessThan(0)
    const m = new MeshBasicMaterial({ ...SCREEN_OFFSET })
    expect(m.polygonOffset).toBe(true)
  })
  it('the bounds the screen uses to skip redraws enclose the whole plate (no culling at the edges)', () => {
    // the plate of screen_work_0 as baked: 0.57 x 0.33 m, node scale 0.285, so a unit-ish local quad
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0.5, -0.5, 0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3))
    const mesh = new Mesh(g)
    mesh.scale.setScalar(0.57)
    mesh.position.set(-2.5, 1.1, -1.94)
    mesh.updateWorldMatrix(true, false)
    g.computeBoundingSphere()
    const s = g.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const w = mesh.localToWorld(mesh.position.clone().set(p.getX(i), p.getY(i), p.getZ(i)))
      expect(s.distanceToPoint(w)).toBeLessThanOrEqual(1e-6)
    }
  })
})
