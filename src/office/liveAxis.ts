// A live node moved by the app along or about one of ITS OWN axes (#484). The bake gives each live node its rest pose (position and
// rotation, often turned: the mixer faces the room at 84°) and names the axis in extras (`axis: 'z' | '-z' | 'y' …`) in the node's frame.
// Writing `position.z` or `rotation.y` uses the parent's axes instead and throws the baked rotation away: the faders slid toward the
// next channel and the knobs lost their tilt. Here a slide is rest + restQuat·axis·d and a turn is restQuat × (turn about the axis).

import { Quaternion, Vector3, type Object3D } from 'three'

/** an axis named in extras ('x', '-z', …) as a unit vector in the node's own frame; `fallback` when the name is missing or unknown */
export function axisOf(name: unknown, fallback: Vector3): Vector3 {
  const m = typeof name === 'string' ? /^([+-]?)([xyz])$/.exec(name.trim()) : null
  if (!m) return fallback.clone()
  const v = new Vector3().setComponent('xyz'.indexOf(m[2]), m[1] === '-' ? -1 : 1)
  return v
}

const turnQ = new Quaternion()

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

  /** back to the baked pose */
  reset() {
    this.node.position.copy(this.rest)
    this.node.quaternion.copy(this.restQ)
  }
}
