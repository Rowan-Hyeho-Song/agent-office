import { Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice } from './glbLoad'
import { meshesOf } from './nodes'
import { LOOP_RING_DIR } from './rig'

// #479: LOOP's ring over its head (agent_3_tip) turns the way its arrowhead points. The arrowhead is read from office.glb: the
// ring is a torus r 0.13 open by 40°, the arrowhead a cone (r 0.03) at one end of it, pointing along the ring into the gap.
describe('the loop ring (agent_3_tip)', () => {
  it('turns the way its arrowhead points', async () => {
    const { scene, nodes } = await loadOffice()
    const node = nodes.agent_3_tip
    expect(node, 'agent_3_tip').toBeDefined()
    scene.updateMatrixWorld(true)
    const toNode = node.matrixWorld.clone().invert()
    const pts: Vector3[] = []
    for (const m of meshesOf(node)) {
      const pos = m.geometry.getAttribute('position')
      const toLocal = new Matrix4().multiplyMatrices(toNode, m.matrixWorld)
      for (let i = 0; i < pos.count; i++) pts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(toLocal))
    }
    // the ring lies in its local xz plane (it spins about local y)
    expect(Math.max(...pts.map((p) => Math.abs(p.y)))).toBeLessThan(0.035)
    const off = (p: Vector3) => Math.abs(Math.hypot(p.x, p.z) - 0.13)
    const tube = pts.filter((p) => off(p) <= 0.015)
    const cone = pts.filter((p) => off(p) > 0.015)
    expect(cone.length, 'the arrowhead').toBeGreaterThan(4)
    // the gap: the widest empty arc between the tube's vertices
    const angles = tube.map((p) => Math.atan2(p.z, p.x)).sort((a, b) => a - b)
    let gap = { width: angles[0] + 2 * Math.PI - angles[angles.length - 1], mid: angles[angles.length - 1] + (angles[0] + 2 * Math.PI - angles[angles.length - 1]) / 2 }
    for (let i = 1; i < angles.length; i++) if (angles[i] - angles[i - 1] > gap.width) gap = { width: angles[i] - angles[i - 1], mid: (angles[i] + angles[i - 1]) / 2 }
    expect(gap.width).toBeGreaterThan((25 * Math.PI) / 180)
    // the arrowhead's base, and the way along the ring from it into the gap
    const base = cone.reduce((a, p) => a.add(p), new Vector3()).divideScalar(cone.length)
    const at = Math.atan2(base.z, base.x)
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    const toGap = Math.sign(wrap(gap.mid - at))
    expect(Math.abs(wrap(gap.mid - at)), 'the arrowhead is at the gap').toBeLessThan(Math.PI / 2)
    const points = new Vector3(-Math.sin(at), 0, Math.cos(at)).multiplyScalar(toGap)
    // spin the node as the rig does (rotation.y = LOOP_RING_DIR * spin, spin growing): the arrowhead moves the way it points
    const world = (spin: number) => {
      node.rotation.y = LOOP_RING_DIR * spin
      node.updateMatrixWorld(true)
      return { p: base.clone().applyMatrix4(node.matrixWorld), d: points.clone().transformDirection(node.matrixWorld) }
    }
    const a = world(0)
    const b = world(0.05)
    expect(b.p.sub(a.p).dot(a.d)).toBeGreaterThan(0)
    // from above it turns clockwise (the arrowhead's own direction, office_bake.py): about world y the turn is negative
    const c = world(0.05)
    const d0 = world(0)
    const yawOf = (v: Vector3) => Math.atan2(v.x, v.z)
    const center = new Vector3().setFromMatrixPosition(node.matrixWorld)
    expect(wrap(yawOf(c.p.clone().sub(center)) - yawOf(d0.p.clone().sub(center)))).toBeLessThan(0)
  })
})
