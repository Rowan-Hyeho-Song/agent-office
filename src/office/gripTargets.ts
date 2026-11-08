// Where an object is held and touched, read from the model (#164): `<obj>_grip_<r|l>` (the hand's own `_grip` frame goes
// onto it) and `<obj>_contact_<finger>[_l]` (a fingertip lands there; +y of the exported node is the outward normal).
// Shared by the app (PlayStage) and the tests / the generator of gripFit.data.ts.

import { Euler, Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import { fingerModelOf, type Hand } from './rig'
import { GRIPS, fitContact, type ContactIn, type Finger } from './grip'
import { GRIP_OFFSETS } from './gripFit.data'

export interface Contact {
  finger: Exclude<Finger, 'palm'>
  /** in the object's frame (the world frame for an object that is part of the room) */
  p: Vector3
  n: Vector3
}
export interface GripTarget {
  key: string
  kind: string
  side: 'l' | 'r'
  /** the object that moves (null: a fixture, its frame is the world) */
  obj: Object3D | null
  /** the object's grip frame in its own frame */
  pg: Matrix4
  contacts: Contact[]
}

const FINGER_ORDER = ['index', 'middle', 'ring', 'little', 'thumb'] as const

/** the grip target of `objName` for a `kind` of grip, or null when the model has no grip empty for that hand */
export function resolveTarget(scene: Object3D, objName: string, kind: string, side: 'l' | 'r'): GripTarget | null {
  const spec = GRIPS[kind]?.[side]
  const grip = scene.getObjectByName(`${objName}_grip_${side}`)
  if (!spec || !grip) return null
  scene.updateMatrixWorld(true)
  const obj = scene.getObjectByName(objName) ?? null
  const inv = new Matrix4()
  if (obj) inv.copy(obj.matrixWorld).invert()
  const local = (o: Object3D) => inv.clone().multiply(o.matrixWorld)
  const contacts: Contact[] = []
  for (const f of spec.contacts) {
    if (f === 'palm') continue
    const node = scene.getObjectByName(`${objName}_contact_${f}${side === 'l' ? '_l' : ''}`) ?? scene.getObjectByName(`${objName}_contact_${f}`)
    if (!node) continue
    const m = local(node)
    contacts.push({ finger: f, p: new Vector3().setFromMatrixPosition(m), n: new Vector3(0, 1, 0).transformDirection(m) })
  }
  return { key: `${objName}:${side}`, kind, side, obj, pg: local(grip), contacts }
}

/** the hand's `_grip` frame in the hand's own frame */
export const handGripMatrix = (hand: Hand) => (hand.grip ? new Matrix4().compose(hand.grip.position, hand.grip.quaternion, new Vector3(1, 1, 1)) : new Matrix4())

/** the target's contacts in the frame of a hand whose grip is exactly on the object's grip */
export function contactsInHand(t: GripTarget, hand: Hand): ContactIn[] {
  const spec = GRIPS[t.kind][t.side]!
  const toHand = handGripMatrix(hand).multiply(new Matrix4().copy(t.pg).invert())
  const out: ContactIn[] = []
  for (const c of t.contacts) {
    const k = FINGER_ORDER.indexOf(c.finger)
    const model = fingerModelOf(hand, c.finger === 'thumb' ? 'thumb' : k, t.side)
    if (!model) continue
    out.push({
      finger: c.finger,
      model,
      p: c.p.clone().applyMatrix4(toHand),
      n: c.n.clone().transformDirection(toHand),
      a0: spec.hold[c.finger === 'thumb' ? 4 : k],
      b0: c.finger === 'thumb' ? spec.hold[5] : 0,
    })
  }
  return out
}

/** the hand offset the generator stored for this target and agent (identity when there is none) */
export function offsetOf(key: string, agent: number): Matrix4 {
  const v = GRIP_OFFSETS[`${key}:${agent}`]
  return v ? composeOffset(v) : new Matrix4()
}

export function composeOffset(v: readonly number[]): Matrix4 {
  return new Matrix4().compose(new Vector3(v[0], v[1], v[2]), new Quaternion().setFromEuler(new Euler(v[3], v[4], v[5], 'XYZ')), new Vector3(1, 1, 1))
}

export interface FitResult {
  finger: Exclude<Finger, 'palm'>
  a: number
  b: number
  /** tip-to-contact distance, m, and how far the tip stands off the surface along the normal (negative = through it) */
  err: number
  off: number
}

/** every contact finger's bend for a hand placed at `offset` from "grip on grip" */
export function fitFingers(t: GripTarget, hand: Hand, offset: Matrix4): FitResult[] {
  const inv = new Matrix4().copy(offset).invert()
  return contactsInHand(t, hand).map((c) => {
    const f = fitContact(c.model, c.p.clone().applyMatrix4(inv), c.n.clone().transformDirection(inv), c.a0, c.b0)
    return { finger: c.finger, a: f.a, b: f.b, err: f.err, off: f.off }
  })
}
