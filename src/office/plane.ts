// The paper plane (#51, #28 decision): a handoff between agents is a plane thrown from one desk to another.
// The sender folds it in its right hand and throws; it flies an arc through the air (no nav graph: it's above
// the furniture); the receiver raises its hands and catches it (the coder catches one-handed). If the receiver
// isn't in (gone home), it glides down onto the receiver's desk. Then the plane goes back home onto the planner's
// tray. With reduced motion it just appears on the receiver's desk for a moment.

import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'
import type { NavGraph } from './nav'
import { GESTURE_S, type AgentRig, type PropBank } from './rig'
import type { OfficeMessage } from './status'

const FOLD_S = GESTURE_S.throw
const HOLD_S = 0.9
const LAND_S = 3
const REDUCED_S = 2.5
const QUEUE_MAX = 8
/** the desk top, a little in from the front edge, in front of a seat */
const DESK_Y = 0.78
const DESK_IN = 0.33

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
}

export class PaperPlanes {
  private queue: OfficeMessage[] = []
  private flight: Flight | null = null
  private props: PropBank
  private plane: { node: Object3D; gripLocal: Matrix4 } | undefined
  /** handoffs flown so far (the debug panel shows it) */
  flown = 0

  constructor(props: PropBank) {
    this.props = props
    this.plane = props.find('plane')
  }

  receive(m: OfficeMessage) {
    if (m.kind !== 'handoff' || m.from === m.to) return
    if (this.queue.length < QUEUE_MAX) this.queue.push(m)
  }

  get busy() {
    return !!this.flight
  }

  private m = new Matrix4()
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
      this.props.borrowed.add(plane.node)
      this.flown++
      this.flight = {
        from: next.from,
        to: next.to,
        phase: reduced ? 'landed' : sender.visible ? 'fold' : 'fly',
        since: t,
        flyFor: 1,
        start: plane.node.position.clone(),
        toHand: !reduced && receiver.visible,
      }
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
        const end = f.toHand && receiver.visible ? this.inHand(receiver, this.p) : PaperPlanes.deskPoint(graph, f.to, this.p)
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
        }
        break
      }
      case 'held':
        this.inHand(receiver, plane.node.position, plane.node.quaternion)
        if (age >= HOLD_S) this.finish()
        break
      case 'landed':
        PaperPlanes.deskPoint(graph, f.to, plane.node.position)
        plane.node.rotation.set(0, (graph.spots[`work_${f.to.split('_')[1]}`]?.ry ?? 0) + 0.4, 0)
        plane.node.visible = true
        if (age >= (reduced ? REDUCED_S : LAND_S)) this.finish()
        break
    }
  }

  private beginFlight(t: number, graph: NavGraph, rigs: Record<string, AgentRig>) {
    const f = this.flight!
    const receiver = rigs[f.to]
    const end = f.toHand && receiver.visible ? this.inHand(receiver, this.p) : PaperPlanes.deskPoint(graph, f.to, this.p)
    f.flyFor = Math.min(1.8, Math.max(0.9, f.start.distanceTo(end) / 2.2))
    f.phase = 'fly'
    f.since = t
    // the receiver looks up and raises its hands as the plane comes (the coder catches one-handed)
    if (f.toHand) receiver.gesture = { kind: 'catch', until: t + f.flyFor + HOLD_S, oneHand: receiver.id === 'agent_3' }
  }

  private finish() {
    if (this.plane) this.props.borrowed.delete(this.plane.node) // home again (PropBank eases it back)
    this.flight = null
  }
}
