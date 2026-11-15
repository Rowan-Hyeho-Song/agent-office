// A live node moved by the app along or about one of ITS OWN axes (#484). The bake gives each live node its rest pose (position and
// rotation, often turned: the mixer faces the room at 84°) and names the axis in extras (`axis: 'z' | '-z' | 'y' …`) in the node's frame.
// Writing `position.z` or `rotation.y` uses the parent's axes instead and throws the baked rotation away: the faders slid toward the
// next channel and the knobs lost their tilt. Here a slide is rest + restQuat·axis·d and a turn is restQuat × (turn about the axis).

import { Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three'

/** an axis named in extras ('x', '-z', …) as a unit vector in the node's own frame; `fallback` when the name is missing or unknown */
export function axisOf(name: unknown, fallback: Vector3): Vector3 {
  const m = typeof name === 'string' ? /^([+-]?)([xyz])$/.exec(name.trim()) : null
  if (!m) return fallback.clone()
  const v = new Vector3().setComponent('xyz'.indexOf(m[2]), m[1] === '-' ? -1 : 1)
  return v
}

const turnQ = new Quaternion()
/** turnResting's table: one lift per degree of the turn */
const LIFT_STEPS = 360

export class LiveAxis {
  readonly rest: Vector3
  readonly restQ: Quaternion
  /** the axis in the node's own frame */
  readonly axis: Vector3
  /** the axis in the parent's frame (where position lives): restQ · axis */
  readonly along: Vector3

  constructor(readonly node: Object3D, fallback: Vector3) {
    this.rest = node.position.clone()
    this.restQ = node.quaternion.clone()
    this.axis = axisOf(node.userData.axis, fallback)
    this.along = this.axis.clone().applyQuaternion(this.restQ)
  }

  /** `d` (m) from rest along the node's own axis */
  slide(d: number) {
    this.node.position.copy(this.rest).addScaledVector(this.along, d)
  }

  /** `angle` (rad) about the node's own axis, on top of its baked rotation */
  turn(angle: number) {
    this.node.quaternion.copy(this.restQ).multiply(turnQ.setFromAxisAngle(this.axis, angle))
  }

  /**
   * `angle` (rad) about the node's own axis, never lower than it rests (#493): a node turned about its middle swings its corners below the
   * surface it stands on (the hourglass's plates went 8 mm into the felt coaster at 30°). It is lifted along the parent's up by as much as
   * its lowest vertex would sink below where the lowest one is at rest; at rest and upside down (a symmetric node) the lift is 0.
   */
  turnResting(angle: number) {
    this.turn(angle)
    const f = (this.floor ??= this.floorTable())
    const s = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * LIFT_STEPS
    const i = Math.floor(s)
    const lift = f.lift[i % LIFT_STEPS] + (f.lift[(i + 1) % LIFT_STEPS] - f.lift[i % LIFT_STEPS]) * (s - i)
    this.node.position.copy(this.rest).addScaledVector(f.up, lift)
  }

  private floor: { up: Vector3; lift: Float32Array } | null = null

  /** the lift at each degree of the turn: the node's vertices (in its own frame) turned and measured along the parent's up */
  private floorTable() {
    const node = this.node
    node.updateWorldMatrix(true, true)
    const toNode = node.matrixWorld.clone().invert()
    const pts: Vector3[] = []
    const m = new Matrix4()
    node.traverse((o) => {
      const g = (o as Mesh).isMesh ? (o as Mesh).geometry.getAttribute('position') : undefined
      if (!g) return
      m.multiplyMatrices(toNode, o.matrixWorld)
      for (let k = 0; k < g.count; k++) pts.push(new Vector3().fromBufferAttribute(g, k).applyMatrix4(m).multiply(node.scale))
    })
    const pq = new Quaternion()
    node.parent?.getWorldQuaternion(pq)
    const up = new Vector3(0, 1, 0).applyQuaternion(pq.invert())
    const q = new Quaternion()
    const v = new Vector3()
    const low = (a: number) => {
      q.copy(this.restQ).multiply(turnQ.setFromAxisAngle(this.axis, a))
      let lo = Infinity
      for (const p of pts) lo = Math.min(lo, v.copy(p).applyQuaternion(q).dot(up))
      return lo
    }
    const rest = low(0)
    const lift = new Float32Array(LIFT_STEPS)
    for (let i = 0; i < LIFT_STEPS; i++) lift[i] = pts.length ? Math.max(0, rest - low((i / LIFT_STEPS) * Math.PI * 2)) : 0
    return { up, lift }
  }

  /** back to the baked pose */
  reset() {
    this.node.position.copy(this.rest)
    this.node.quaternion.copy(this.restQ)
  }
}
