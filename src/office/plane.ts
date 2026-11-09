// The paper plane (#51, #28 decision): a handoff between agents is a plane thrown from one desk to another.
// The sender folds it in its right hand and throws; it flies an arc through the air (no nav graph: it's above
// the furniture); the receiver raises its hands and catches it (the coder catches one-handed). If the receiver
// isn't in (gone home), it glides down onto the receiver's desk. A caught plane is put down on the receiver's desk.
// It lies there a moment and is gone (#224: it used to ease back to the planner's tray, its home, and the user saw
// it travel to 메모's desk after every handoff). What flies is a copy: the tray's own plane never moves.
// With reduced motion it just appears on the receiver's desk for a moment.

import { Box3, MathUtils, Matrix4, MeshStandardMaterial, Quaternion, Raycaster, Vector3, type Mesh, type Object3D } from 'three'
import { cue } from '../audio/cues'
import type { NavGraph } from './nav'
import { GESTURE_S, type AgentRig, type PropBank } from './rig'
import type { OfficeMessage } from './status'

const FOLD_S = GESTURE_S.throw
/** long enough to see what was caught (#62) */
const HOLD_S = 1.2
/** from the hand down onto the desk after the catch (#224) */
const PUT_DOWN_S = 0.4
/**
 * the catch (#62, designer): pinched by the keel this far in from the tail (of the plane's length), so most of it
 * shows past the fingers; nose up from where the fingers point; one damped wobble as it's caught
 */
const PINCH_FROM_TAIL = 0.15
const NOSE_UP = MathUtils.degToRad(30)
const WOBBLE = { s: 0.2, deg: 8 }
/** the plane's own warm glow, as a fraction of its colour */
const PAPER_GLOW = 0.25
const LAND_S = 3
const REDUCED_S = 2.5
const QUEUE_MAX = 8
/** the desk top, a little in from the front edge, in front of a seat */
const DESK_Y = 0.78
const DESK_IN = 0.33
/** look for the desk's surface (its keyboard, papers, …) from this height down: below the monitor and lamp heads */
const PROBE_Y = 1.0

type Phase = 'fold' | 'fly' | 'held' | 'landed'

interface Flight {
  from: string
  to: string
  phase: Phase
  /** scene clock time the phase started */
  since: number
  flyFor: number
  start: Vector3
  /** where it ends: the receiver's hand, or its desk when it isn't in */
  toHand: boolean
  /** landed: where it was put down from (the catching hand), eased onto the desk; null = already lying there */
  downFrom: { pos: Vector3; quat: Quaternion } | null
}

export class PaperPlanes {
  private queue: OfficeMessage[] = []
  private flight: Flight | null = null
  private plane: { node: Object3D; gripLocal: Matrix4 } | undefined
  /** handoffs flown so far (the debug panel shows it) */
  flown = 0

  private nodes: Record<string, Object3D>
  /** node origin above the plane's underside (it rests on a surface at this height) */
  private lift = 0
  private rests = new Map<string, Vector3>()

  constructor(props: PropBank, nodes: Record<string, Object3D> = {}) {
    this.nodes = nodes
    this.plane = props.find('plane')
    if (this.plane) {
      const node = this.plane.node
      node.updateWorldMatrix(true, true)
      this.lift = Math.max(0, node.getWorldPosition(new Vector3()).y - new Box3().setFromObject(node).min.y)
      this.pinchLocal = PaperPlanes.pinchSpot(node)
      // under the room's cool light the sticky-note yellow (#ffe27a) turns olive: a faint warm glow of its own keeps
      // it a yellow paper plane, in flight too (designer, #62; same as the tray's paper, #59). A copy per mesh.
      node.traverse((o) => {
        const mesh = o as Mesh
        if (!(mesh.material instanceof MeshStandardMaterial)) return
        const m = mesh.material.clone()
        m.emissive.copy(m.color).multiplyScalar(PAPER_GLOW)
        mesh.material = m
      })
      // what flies is a copy (#224): the tray's plane stays where it is, the copy shows only during a handoff
      const flyer = node.clone(true)
      flyer.name = `${node.name}_flight`
      flyer.visible = false
      node.parent?.add(flyer)
      this.tray = node
      this.plane = { node: flyer, gripLocal: this.plane.gripLocal }
    }
  }

  /** the planner's tray plane (#59): never moved by a handoff */
  tray: Object3D | undefined

  /** where the fingers hold the plane, in its own frame: on the keel, near the tail (the model: nose −z, keel −y) */
  private pinchLocal = new Vector3()
  static pinchSpot(node: Object3D) {
    const box = new Box3()
    const inv = new Matrix4().copy(node.matrixWorld).invert()
    const v = new Vector3()
    node.traverse((o) => {
      const pos = (o as Mesh).geometry?.getAttribute('position')
      if (!pos) return
      const rel = new Matrix4().multiplyMatrices(inv, o.matrixWorld)
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(rel))
    })
    if (box.isEmpty()) return new Vector3()
    const len = box.max.z - box.min.z
    // the keel runs from the nose (y ≈ 0) down to the tail's bottom: halfway down it, at the pinch
    const z = box.max.z - len * PINCH_FROM_TAIL
    const keelY = box.min.y * ((z - box.min.z) / len)
    return new Vector3(0, keelY / 2, z)
  }

  private up = new Vector3(0, 1, 0)
  private ax = new Vector3()
  private ay = new Vector3()
  private az = new Vector3()
  private wob = new Quaternion()

  /**
   * the plane pinched in the receiver's right hand: the pinch spot where the index and thumb tips meet, nose 30°
   * up from where the fingers point, wings level; `since` = when it was caught (the wobble)
   */
  private pinched(rig: AgentRig, t: number, since: number | null, reduced: boolean, pos: Vector3, quat: Quaternion) {
    const at = rig.pinchPoint('r', this.p)
    const fwd = rig.fingerDir('r', this.s)
    // nose = forward tipped up; the plane's −z is its nose, +x along the wings (kept level)
    this.az.copy(fwd).multiplyScalar(-Math.cos(NOSE_UP)).addScaledVector(this.up, -Math.sin(NOSE_UP))
    this.ax.crossVectors(this.up, this.az).normalize()
    this.ay.crossVectors(this.az, this.ax)
    quat.setFromRotationMatrix(this.m.makeBasis(this.ax, this.ay, this.az))
    if (since !== null && !reduced) {
      // one swing either way, dying out over 0.2 s (peaks near ±8°), about the wings' axis through the fingers
      const u = (t - since) / WOBBLE.s
      if (u < 1) quat.multiply(this.wob.setFromAxisAngle(this.ax.set(1, 0, 0), MathUtils.degToRad(WOBBLE.deg / 0.76) * Math.sin(u * Math.PI * 2) * (1 - u)))
    }
    // place it so its pinch spot sits between the fingertips
    return pos.copy(this.pinchLocal).applyQuaternion(quat).negate().add(at)
  }

  /**
   * where the plane lies on the receiver's desk: in front of its seat, on top of whatever is there (usually the
   * keyboard: a note left on it gets noticed). Only that desk's own meshes are probed, never an agent's hands.
   */
  restPoint(graph: NavGraph, agent: string, out = new Vector3()) {
    const known = this.rests.get(agent)
    if (known) return out.copy(known)
    const p = PaperPlanes.deskPoint(graph, agent, new Vector3())
    const desk = this.nodes[`desk_${agent.split('_')[1]}`]
    let top = DESK_Y
    if (desk) {
      desk.updateWorldMatrix(true, true)
      const hit = new Raycaster(new Vector3(p.x, PROBE_Y, p.z), new Vector3(0, -1, 0), 0, PROBE_Y).intersectObject(desk, true)[0]
      if (hit) top = hit.point.y
    }
    p.y = top + this.lift
    if (desk) this.rests.set(agent, p.clone())
    return out.copy(p)
  }

  receive(m: OfficeMessage) {
    if (m.kind !== 'handoff' || m.from === m.to) return
    if (this.queue.length < QUEUE_MAX) this.queue.push(m)
  }

  get busy() {
    return !!this.flight
  }

  private m = new Matrix4()
  private end = new Vector3()
  private p = new Vector3()
  private q = new Quaternion()
  private s = new Vector3()

  /** where a hand's grip holds the plane, in world space */
  private inHand(rig: AgentRig, out: Vector3, quat?: Quaternion) {
    const grip = rig.parts.hands.r.grip
    if (!grip || !this.plane) return out.copy(rig.parts.hands.r.node.position)
    grip.updateWorldMatrix(true, false)
    this.m.multiplyMatrices(grip.matrixWorld, this.plane.gripLocal).decompose(out, quat ?? this.q, this.s)
    return out
  }

  /** the receiver's desk top in front of its seat */
  static deskPoint(graph: NavGraph, agent: string, out = new Vector3()) {
    const seat = graph.spots[`work_${agent.split('_')[1]}`]
    if (!seat) return out.set(0, DESK_Y, 0)
    return out.set(seat.x - Math.sin(seat.ry) * DESK_IN, DESK_Y, seat.z - Math.cos(seat.ry) * DESK_IN)
  }

  update(t: number, graph: NavGraph, rigs: Record<string, AgentRig>, reduced: boolean) {
    const plane = this.plane
    if (!plane) return
    if (!this.flight) {
      const next = this.queue.shift()
      if (!next) return
      const sender = rigs[next.from]
      const receiver = rigs[next.to]
      if (!sender || !receiver) return
      this.flown++
      this.flight = {
        from: next.from,
        to: next.to,
        phase: reduced ? 'landed' : sender.visible ? 'fold' : 'fly',
        since: t,
        flyFor: 1,
        // a sender that isn't in: from its own desk (never from the planner's tray)
        start: this.restPoint(graph, next.from, new Vector3()),
        toHand: !reduced && receiver.visible,
        downFrom: null,
      }
      plane.node.position.copy(this.flight.start)
      plane.node.visible = true
      if (!reduced && sender.visible) sender.gesture = { kind: 'throw', until: t + FOLD_S }
      if (this.flight.phase === 'fly') this.beginFlight(t, graph, rigs)
    }

    const f = this.flight!
    const sender = rigs[f.from]
    const receiver = rigs[f.to]
    const age = t - f.since

    switch (f.phase) {
      case 'fold':
        // folded in the sender's hand while the arm winds up
        this.inHand(sender, plane.node.position, plane.node.quaternion)
        if (age >= FOLD_S) {
          f.start.copy(plane.node.position)
          this.beginFlight(t, graph, rigs)
        }
        break
      case 'fly': {
        // an arc from the release point to the receiver's hand (followed as it moves) or its desk
        const end = f.toHand && receiver.visible ? this.pinched(receiver, t, null, reduced, this.end, this.q) : this.restPoint(graph, f.to, this.end)
        const k = Math.min(age / f.flyFor, 1)
        const span = f.start.distanceTo(end)
        const apex = 0.3 + span * 0.15
        const prev = plane.node.position.clone()
        plane.node.position.lerpVectors(f.start, end, k)
        plane.node.position.y += Math.sin(k * Math.PI) * apex
        // nose (local −z) along the flight
        const dir = plane.node.position.clone().sub(prev)
        if (dir.lengthSq() > 1e-8) plane.node.lookAt(plane.node.position.clone().sub(dir))
        if (k >= 1) {
          f.phase = f.toHand && receiver.visible ? 'held' : 'landed'
          f.since = t
          cue('plane.land', { pos: plane.node.position.clone(), agent: f.to })
          // the fingers close on it (rig.ts: the pinch shape while caught)
          if (f.phase === 'held' && receiver.gesture?.kind === 'catch') receiver.gesture.caught = true
        }
        break
      }
      case 'held':
        this.pinched(receiver, t, f.since, reduced, plane.node.position, plane.node.quaternion)
        if (age >= HOLD_S) {
          // looked at: put down on its own desk (not back to anyone else's)
          f.downFrom = { pos: plane.node.position.clone(), quat: plane.node.quaternion.clone() }
          f.phase = 'landed'
          f.since = t
        }
        break
      case 'landed': {
        this.restPoint(graph, f.to, this.end)
        this.q.setFromAxisAngle(this.up, (graph.spots[`work_${f.to.split('_')[1]}`]?.ry ?? 0) + 0.4)
        const k = f.downFrom && !reduced ? Math.min(age / PUT_DOWN_S, 1) : 1
        const e = k * k * (3 - 2 * k)
        if (f.downFrom && k < 1) {
          plane.node.position.lerpVectors(f.downFrom.pos, this.end, e)
          plane.node.quaternion.slerpQuaternions(f.downFrom.quat, this.q, e)
        } else {
          plane.node.position.copy(this.end)
          plane.node.quaternion.copy(this.q)
        }
        plane.node.visible = true
        if (age >= (reduced ? REDUCED_S : LAND_S) + (f.downFrom && !reduced ? PUT_DOWN_S : 0)) this.finish()
        break
      }
    }
  }

  private beginFlight(t: number, graph: NavGraph, rigs: Record<string, AgentRig>) {
    const f = this.flight!
    const receiver = rigs[f.to]
    const end = f.toHand && receiver.visible ? this.pinched(receiver, t, null, false, this.end, this.q) : this.restPoint(graph, f.to, this.end)
    f.flyFor = Math.min(1.8, Math.max(0.9, f.start.distanceTo(end) / 2.2))
    f.phase = 'fly'
    f.since = t
    cue('plane.throw', { pos: f.start.clone(), agent: f.from })
    // the receiver looks up and raises its hands as the plane comes (the coder catches one-handed)
    if (f.toHand) receiver.gesture = { kind: 'catch', until: t + f.flyFor + HOLD_S, oneHand: receiver.id === 'agent_3' }
  }

  /** gone: it does not travel anywhere (#224) */
  private finish() {
    if (this.plane) this.plane.node.visible = false
    this.flight = null
  }

  /** the debug panel / tests: where the flight is */
  get phase(): Phase | null {
    return this.flight?.phase ?? null
  }
}
