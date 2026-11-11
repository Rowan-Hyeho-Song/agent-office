// Passing a paper from one agent to another (#262, docs/design/paper-pass.md 2-5): handing it over, sliding it across the desk, a toss.
// (The paper plane is plane.ts.) One pass at a time. Each method is a script: a function of the time since it began that gives the paper's
// pose and fold, who holds it, and where each hand goes. The paper and the hands are both placed from the script, so the paper never
// jumps and never leaves a hand it is held by (the #228 guards watch exactly that).
//
// The frame of the sheet (paperProp.ts): x the short side, z the long side, +y the text side, +z the text's TOP edge. The receiver holds the
// sheet by its two LONG edges (#374, paper-pass.md 2.1-2.3 and 5, grips.md "낱장 옆 쥐고 읽기": thumb on the text face, four fingers on the
// back, 1.5 cm in from the edge, 45 % up) and reads it where it is looked at: 0.26 ahead of the face screen's centre, VIEW.down below it,
// tilted 40 degrees back from vertical, the text side toward the face. The giver holds the short edge far from the receiver (the top, since
// the sheet is turned to read the right way up for the receiver), so the hands never overlap. The grips are paperGrip.ts's.
import { Box3, DoubleSide, MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import { cue } from '../audio/cues'
import { HAND_POSES, type AgentRig, type PropBank } from './rig'
import { POSES, toVec, type HandAngles } from './handPose'
import { reachFrame } from './reach'
import { DeskStuff, Furniture, chooseMethod, findLane, timesFor, tossApex, arcY, type Choice, type Method, type Times } from './paperPass'
import { PAPER, paperOf, placePaper, type PaperProp } from './paperProp'
import { SideGrips } from './paperGrip'
import { VIEW } from './paperSide'

export { VIEW }
import type { OfficeMessage } from './status'
import type { Object3D } from 'three'

const UP = new Vector3(0, 1, 0)
const CHEST = 0.95
const DESK_TOP = 0.745
/** how high the slid sheet is lifted off the desk before the hand has it by its edge, m (the fingers go under the edge) */
const RAISE = 0.05
const ONE = new Vector3(1, 1, 1)

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}
const seg = (s: number, a: number, b: number) => (b > a ? smooth((s - a) / (b - a)) : s >= b ? 1 : 0)

/** the sheet's rotation for its top edge direction and its text side's direction */
function quatOf(top: Vector3, normal: Vector3, out = new Quaternion()) {
  const z = top.clone().normalize()
  const y = normal.clone().addScaledVector(z, -normal.dot(z)).normalize()
  const x = new Vector3().crossVectors(y, z)
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
}

const TWO_HANDED = new Set(['watering_can', 'book'])

/**
 * Which of an agent's hands are busy (paper-pass.md 3 "받는 손 고르기"). The rig's `want` is the one prop it holds and in which hand; a two-handed hold
 * (the can while it pours, the open book) also drives the other hand. A paper it already holds does not count (it is the pass's own).
 */
export function handsOf(rig: AgentRig): { busy: 'l' | 'r' | null; both: boolean } {
  const w = rig.want
  if (!w || w.attached === false || w.kind === 'paper') return { busy: null, both: false }
  const other = w.side === 'r' ? 'l' : 'r'
  const d = rig.drive?.[other]
  // (only these holds use the other hand: a typing hand or a resting one is not "busy")
  return { busy: w.side, both: TWO_HANDED.has(w.kind) && !!d && d.w > 0.5 }
}

/** the receiver's hands that take the sheet, in the order they take it: the right one if it is free, else the left alone (both free: right first) */
const sidesFor = (busy: 'l' | 'r' | null): ('l' | 'r')[] => (busy === 'r' ? ['l'] : busy === 'l' ? ['r'] : ['r', 'l'])

/** a paper that lies on a receiver's desk because both its hands were busy, waiting for a hand to be free */
interface Lying {
  pos: Vector3
  quat: Quaternion
  id: string
  from: AgentRig
  to: AgentRig
  times: Times
  since: number
}

/** a paper that nobody could pick up for this long fades where it lies, s */
const LYING_MAX = 40

export interface HandCmd {
  who: 'from' | 'to'
  side: 'l' | 'r'
  /** where the contact point of the hand goes (world) */
  pinch: Vector3
  /** the palm's direction, world (null: the hand's own default) */
  palm: Vector3 | null
  pose: HandAngles
  /** 0..1: how much the hand is on this place instead of its own pose's */
  w: number
  /** the hand holds the sheet by its long side `side` (paperGrip.ts): `pinch` and `pose` are not used, `mix` 0..1 is pre-grip to closed */
  grip?: boolean
  mix?: number
}

export interface PassState {
  /** the paper node's pose and fold */
  pos: Vector3
  quat: Quaternion
  fold: number
  opacity: number
  /** who holds it now (want: the prop bank's holder) */
  holder: { from: boolean; to: boolean }
  hands: HandCmd[]
}

interface Event {
  at: number
  fn: () => void
}

/** a pass being played */
interface Pass {
  method: Method
  id: string
  from: AgentRig
  to: AgentRig
  t0: number
  dur: number
  times: Times
  reduced: boolean
  state: (s: number, out: PassState) => void
  events: Event[]
  fired: number
  /** how long the giver looks (and keeps its hand on the job), s */
  fromSpan: number
  /** the giver's hand's last place while it held the paper (it goes back from there) */
  keep: Vector3 | null
  /** each look target (the other's head), kept up to date */
  lookFrom: Vector3
  lookTo: Vector3
  /** the receiver starts looking at the paper (its hand holds it at the reading place) from this time */
  readAt: number
  /** the hand the receiver already has busy (a mug, the can, a racket) when the pass begins: it holds the sheet with the other one only */
  busy: 'l' | 'r' | null
  /** the receiver's hands that hold the sheet, in the order they take it */
  sides: ('l' | 'r')[]
  /** both of the receiver's hands are busy and nothing can be put down: a toss lands on its desk and waits there (see `lying`) */
  lay: boolean
  /** debug / tests: the last state */
  last: PassState
}

const state = (): PassState => ({ pos: new Vector3(), quat: new Quaternion(), fold: 0, opacity: 1, holder: { from: false, to: false }, hands: [] })

export class PaperPasses {
  readonly paper: PaperProp | null
  readonly furniture: Furniture | null
  readonly desks: DeskStuff | null
  private pass: Pass | null = null
  private lying: Lying | null = null
  /** one frame after a pass: the paper goes home (the frame it let go of its last hand it had not moved) */
  private homing = false
  private home = { pos: new Vector3(), quat: new Quaternion() }
  private opacityNow = 1
  /** passes played (the debug panel shows it) */
  played = 0
  /** how each method went, newest last (tests and the debug hook) */
  readonly log: { id: string; method: Method; from: string; to: string }[] = []
  private pinchOff = new Map<string, Vector3>()
  private readonly grips: SideGrips | null
  private half = new Matrix4()

  constructor(props: PropBank, nodes: Record<string, Object3D>) {
    this.paper = paperOf(nodes)
    let root: Object3D | null = this.paper?.node ?? null
    while (root?.parent) root = root.parent
    this.grips = root ? new SideGrips(root) : null
    const hasFurn = Object.values(nodes).some((n) => n.userData.atlas)
    this.furniture = hasFurn ? Furniture.from(nodes) : null
    this.desks = hasFurn ? DeskStuff.from(nodes) : null
    if (this.paper) {
      const p = this.paper
      p.node.updateWorldMatrix(true, false)
      this.home.pos.copy(p.node.position)
      this.home.quat.copy(p.node.quaternion)
      props.borrowed.add(p.node)
      // its own materials: fading never touches anything else
      // (both sides: the receiver holds it text side to its face, so everybody else sees the back)
      for (const m of p.meshes) {
        const mat = (m.material as import('three').Material).clone()
        mat.side = DoubleSide
        m.material = mat
      }
      this.hide()
    }
  }

  get busy() {
    return !!this.pass || this.homing || !!this.lying
  }

  /**
   * A pass that has to wait for the receiver (paper-pass.md 3): with both hands busy (nothing can be put down in this scope) a hand-over or a slide is
   * started again when a hand is free; a toss lands on the desk instead (with reduced motion it waits as well). The caller keeps the message.
   */
  static deferred(to: AgentRig, method: Method, reduced: boolean) {
    return handsOf(to).both && (method === 'hand' || method === 'slide' || (method === 'toss' && reduced))
  }

  /** the method for two agents now (paper-pass.md 1) */
  choose(from: AgentRig, to: AgentRig, rigs: Record<string, AgentRig>): Choice {
    const others = Object.values(rigs).filter((r) => r !== from && r !== to && r.visible)
    return chooseMethod({ x: from.x, z: from.z, ry: from.heading }, { x: to.x, z: to.z, ry: to.heading }, { furniture: this.furniture, desks: this.desks, others })
  }

  /** a lane for a forced slide (the least-shift line that clears the desk, else the straight one) */
  laneFor(from: AgentRig, to: AgentRig) {
    const l = findLane(this.desks, { x: from.x, z: from.z, ry: from.heading }, { x: to.x, z: to.z, ry: to.heading })
    return l ?? findLane(null, { x: from.x, z: from.z, ry: from.heading }, { x: to.x, z: to.z, ry: to.heading })
  }

  /** can this pair do a pass at all: both in, both at a place (a walker turns to the plane instead) */
  static ready(from: AgentRig, to: AgentRig) {
    return from.visible && to.visible && !!from.arrived && !!to.arrived
  }

  // ------------------------------------------------------------ the paper itself

  private hide() {
    const p = this.paper!
    p.node.visible = p.a.visible = p.b.visible = false
    this.setOpacity(1)
    placePaper(p, this.home.pos, this.home.quat, 0)
  }

  private setOpacity(o: number) {
    if (!this.paper || o === this.opacityNow) return
    this.opacityNow = o
    for (const m of this.paper.meshes) {
      const mat = m.material as import('three').MeshStandardMaterial
      mat.transparent = o < 1
      mat.opacity = o
      mat.depthWrite = o >= 1
    }
  }

  /** tests / debug: the sheet's opacity now */
  get fade() {
    return this.opacityNow
  }

  /** tests: the last state played (null before any) */
  get lastState(): PassState | null {
    return this.pass?.last ?? null
  }

  get method(): Method | null {
    return this.pass?.method ?? null
  }

  /** the pass's clock: seconds since it began (null when none) */
  age(t: number) {
    return this.pass ? t - this.pass.t0 : null
  }

  // ------------------------------------------------------------ hands

  /** where the pinch (index and thumb tips meeting) is, in the hand node's frame, measured once per hand in the pinch shape */
  private offset(rig: AgentRig, side: 'l' | 'r') {
    const key = `${rig.id}:${side}`
    let o = this.pinchOff.get(key)
    if (!o) {
      rig.poseNow(side, HAND_POSES.pinch)
      const hand = rig.parts.hands[side].node
      o = hand.worldToLocal(rig.pinchPoint(side, new Vector3()))
      this.pinchOff.set(key, o)
    }
    return o
  }

  private tmpQ = new Quaternion()
  private tmpQ2 = new Quaternion()
  private tmpV = new Vector3()
  private tmpP = new Vector3()

  /** drive a hand so that its contact point is at `pinch` and it points along the reach (grips.md 1.1) */
  private drive(rig: AgentRig, c: HandCmd, t: number, reduced: boolean) {
    if (c.grip) {
      // the long-side grip: the hand's pose is the fitted one on the sheet's lower half (paperGrip.ts), the fingers from pre-grip to closed
      const g = this.grips?.place(rig, c.side, this.half, c.mix ?? 1)
      if (g) {
        rig.drive[c.side] = { target: g.target, w: c.w, curl: null, angles: g.angles, wc: c.w, spread: null, reach: true }
        rig.applyDrive(c.side, t, reduced)
        return
      }
    }
    const hand = rig.parts.hands[c.side]
    const root = rig.parts.root
    root.updateWorldMatrix(true, false)
    root.getWorldQuaternion(this.tmpQ)
    const inv = this.tmpQ2.copy(this.tmpQ).invert()
    const local = root.worldToLocal(this.tmpP.copy(c.pinch))
    const palm = c.palm ? this.tmpV.copy(c.palm).applyQuaternion(inv) : null
    const r = reachFrame(c.side, local, rig.seatLift, palm)
    const q = this.tmpQ.clone().multiply(r.quat)
    const pos = c.pinch.clone().sub(this.offset(rig, c.side).clone().multiply(hand.node.scale).applyQuaternion(q))
    rig.drive[c.side] = { target: new Matrix4().compose(pos, q, hand.node.scale), w: c.w, curl: null, angles: toVec(c.pose), wc: c.w, spread: null }
    rig.applyDrive(c.side, t, reduced)
  }

  // ------------------------------------------------------------ playing

  /** world point of a pinch spot of the sheet at its pose and fold (the far spot sits on the half that folds over: placePaper) */
  private spot(near: boolean, st: PassState, out = new Vector3()) {
    const p = this.paper!
    const local = (near ? p.gripNear : p.gripFar).clone()
    if (!near) local.applyAxisAngle(AX, -st.fold)
    return out.copy(local).applyQuaternion(st.quat).add(st.pos)
  }

  /** a long-side grip command for the receiver's hand `side` */
  private holdCmd(side: 'l' | 'r', w: number, mix: number): HandCmd {
    return { who: 'to', side, pinch: this.tmpP.clone(), palm: null, pose: HAND_POSES.pinch, w, grip: true, mix }
  }

  start(msg: OfficeMessage, method: Exclude<Method, 'plane'>, choice: Choice, from: AgentRig, to: AgentRig, t: number, reduced: boolean) {
    if (!this.paper) return false
    const hs = handsOf(to)
    if (PaperPasses.deferred(to, method, reduced)) return false
    const fast = from.gestureMin > 0 || to.gestureMin > 0
    const min = Math.max(from.gestureMin, to.gestureMin)
    const length = choice.lane?.length ?? 1
    const T = timesFor(choice.d, length, { fast, min })
    const lookFrom = new Vector3()
    const lookTo = new Vector3()
    const build = reduced ? this.buildReduced : method === 'hand' ? this.buildHand : method === 'slide' ? this.buildSlide : this.buildToss
    // a hand that is busy with something else (the mug, the can, a racket) is left to it: the other one holds the sheet alone (paper-pass.md 5 "한 손")
    const busy = hs.busy
    const sides = sidesFor(busy)
    const p: Pass = { method, id: msg.id, from, to, t0: t, dur: 0, times: T, reduced, state: () => {}, events: [], fired: 0, lookFrom, lookTo, readAt: 0, last: state(), fromSpan: 0, keep: null, busy, sides, lay: hs.both }
    build.call(this, p, choice)
    this.pass = p
    this.homing = false
    this.played++
    this.log.push({ id: msg.id, method, from: from.id, to: to.id })
    const headOf = (r: AgentRig, out: Vector3) => r.parts.head.getWorldPosition(out)
    headOf(to, lookFrom)
    headOf(from, lookTo)
    // look and turn (aim.ts): both look at the other all through, calmly (the faces are paper-pass.md 4's), the hands are driven here
    this.look(from, lookFrom, p.fromSpan, t, reduced)
    this.look(to, lookTo, p.dur, t, reduced)
    return true
  }

  /** a rig looks at `at` and turns to it for `span` s; its hands are the pass's (aim.ts) */
  private look(r: AgentRig, at: Vector3, span: number, t: number, reduced: boolean) {
    r.startGesture('catch', t, at, { reduced, flyFor: Math.min(0.5, span / 2), holdS: Math.max(0.1, span - Math.min(0.5, span / 2)), oneHand: true, calm: true })
    r.gesture!.handsOff = true
  }

  /** a hand is free now: the paper that lies on the desk is picked up (a hand goes down to it, takes its long edge, lifts it to the reading place) */
  private pickup(L: Lying, busy: 'l' | 'r' | null, t: number, rigs: Record<string, AgentRig>) {
    const p: Pass = {
      method: 'toss', id: L.id, from: L.from, to: L.to, t0: t, dur: 0, times: L.times, reduced: false, state: () => {}, events: [], fired: 0,
      lookFrom: new Vector3(), lookTo: new Vector3(), readAt: 0, last: state(), fromSpan: 0, keep: null, busy, sides: sidesFor(busy), lay: false,
    }
    this.buildPickup(p, L)
    this.pass = p
    this.homing = false
    L.from.parts.head.getWorldPosition(p.lookTo)
    this.look(L.to, p.lookTo, p.dur, t, false)
    this.update(t, rigs, false)
  }

  update(t: number, rigs: Record<string, AgentRig>, reduced: boolean) {
    const p = this.pass
    if (!p && this.lying) {
      this.stepLying(t, rigs)
      return
    }
    if (!p) {
      if (this.homing) {
        // the frame after the last hand let go: back where it rests, hidden
        this.hide()
        this.homing = false
      }
      return
    }
    const { from, to } = p
    const s = t - p.t0
    // the heads: the targets of the looks follow the bodies
    from.parts.head.getWorldPosition(p.lookTo)
    to.parts.head.getWorldPosition(p.lookFrom)
    const st = p.last
    st.hands.length = 0
    p.state(s, st)
    // events at their times (the sounds, the faces)
    while (p.fired < p.events.length && s >= p.events[p.fired].at) p.events[p.fired++].fn()
    const paper = this.paper!
    placePaper(paper, st.pos, st.quat, st.fold)
    this.half.compose(st.pos, st.quat, ONE)
    this.setOpacity(st.opacity)
    paper.node.visible = paper.a.visible = paper.b.visible = st.opacity > 0.001
    // who holds it: the prop bank's holder (rig.want), set after the stage reset it this frame
    if (st.holder.from) from.want = { kind: 'paper', side: 'r', prefer: paper.node.name, attached: true }
    if (st.holder.to) to.want = { kind: 'paper', side: p.sides[0], prefer: paper.node.name, attached: true }
    // reading starts: the receiver's catching hand is the reading hand (rig.handPose) from now on
    const ge = to.gesture
    if (ge && s >= p.readAt && p.readAt > 0) {
      ge.handsOff = false
      ge.caught = true
    }
    for (const c of st.hands) this.drive(c.who === 'from' ? from : to, c, t, reduced)
    if (s >= p.dur) {
      this.pass = null
      if (p.lay) {
        // it lies on the desk where it landed, until a hand is free
        this.lying = { pos: st.pos.clone(), quat: st.quat.clone(), id: p.id, from, to, times: p.times, since: t }
      } else {
        // let go first: the hands no longer drive (the frame the holders go the paper has not moved), then it goes home next frame
        this.homing = true
      }
    }
    void rigs
  }

  /** the paper on the desk: it lies still; when a hand of the receiver is free it is picked up, and after LYING_MAX it fades where it lies */
  private stepLying(t: number, rigs: Record<string, AgentRig>) {
    const L = this.lying!
    const paper = this.paper!
    const hs = handsOf(L.to)
    if (L.to.visible && L.to.arrived && !hs.both) {
      this.lying = null
      this.pickup(L, hs.busy, t, rigs)
      return
    }
    placePaper(paper, L.pos, L.quat, 0)
    paper.node.visible = paper.a.visible = paper.b.visible = true
    const late = t - L.since - LYING_MAX
    this.setOpacity(1 - seg(late, 0, 0.5))
    if (late >= 0.5 || !L.to.visible) {
      this.lying = null
      this.hide()
    }
  }

  // ------------------------------------------------------------ geometry shared by the scripts

  /** the agent's facing in the world (its root's -z) */
  private facing(rig: AgentRig, out = new Vector3()) {
    rig.parts.root.updateWorldMatrix(true, false)
    return out.set(0, 0, -1).applyQuaternion(rig.parts.root.getWorldQuaternion(this.tmpQ)).setY(0).normalize()
  }

  /**
   * Where the sheet is read by `rig` (paper-pass.md 5): the sheet's centre and rotation. 0.26 in front of the face screen's centre and VIEW.down below
   * it, the top edge up and leaning away, the text side toward the face and up. With one hand busy the centre is in front of the body's centre line
   * and the body faces it, not the turned head.
   */
  private view(rig: AgentRig, one: boolean, centre = new Vector3(), quat = new Quaternion()) {
    rig.parts.root.updateWorldMatrix(true, true)
    const head = rig.parts.head.getWorldPosition(this.tmpV2)
    const face = rig.parts.face ? new Box3().setFromObject(rig.parts.face).getCenter(this.tmpV3) : this.tmpV3.copy(head)
    const body = this.facing(rig, this.tmpV4)
    const f = this.tmpV5.copy(face).sub(head).setY(0)
    if (one || f.lengthSq() < 1e-6) f.copy(body)
    else f.normalize()
    if (one) {
      const root = rig.parts.root.getWorldPosition(this.tmpV2)
      const ahead = this.tmpV6.copy(face).sub(root).dot(body)
      centre.copy(root).addScaledVector(body, ahead + VIEW.ahead)
    } else centre.copy(face).addScaledVector(f, VIEW.ahead)
    centre.y = face.y - VIEW.down
    // the top edge: up and away from the face; the text side: toward the face and up
    const top = new Vector3().copy(UP).multiplyScalar(Math.cos(VIEW.tilt)).addScaledVector(f, Math.sin(VIEW.tilt))
    const normal = new Vector3().copy(f).multiplyScalar(-Math.cos(VIEW.tilt)).addScaledVector(UP, Math.sin(VIEW.tilt))
    quatOf(top, normal, quat)
    return { centre, quat }
  }
  private tmpV2 = new Vector3()
  private tmpV3 = new Vector3()
  private tmpV4 = new Vector3()
  private tmpV5 = new Vector3()
  private tmpV6 = new Vector3()

  private fadeOf(s: number, g0: number) {
    return 1 - seg(s, g0, g0 + 0.3)
  }

  // ------------------------------------------------------------ method: handing it over (paper-pass.md 2.1)

  buildHand(p: Pass) {
    const { from, to, times: T } = p
    const S = new Vector3(from.x, 0, from.z)
    const R = new Vector3(to.x, 0, to.z)
    const u = R.clone().sub(S).setY(0).normalize()
    const fwd = this.facing(from)
    const d = S.distanceTo(R)
    const hs = from.seatLift
    const hr = to.seatLift
    // the sheet turned so it reads the right way up for the receiver: its top edge toward the giver, who holds that short edge (the one far from the receiver)
    const P0 = S.clone().addScaledVector(fwd, 0.4).setY(DESK_TOP + PAPER.t / 2)
    const C = S.clone().addScaledVector(u, Math.min(0.3, d / 2 - 0.1)).setY(CHEST + hs)
    const M = S.clone().addScaledVector(u, d / 2).setY(CHEST + (hs + hr) / 2)
    const Q0 = quatOf(fwd.clone().negate(), UP)
    const Q1 = quatOf(u.clone().negate(), UP)
    const a = T.pick
    const b = a + T.signal
    const c = b + T.reach
    const dd = c + T.shared
    const e = dd + T.lift
    const f = e + T.look
    const g = f + T.fade
    p.dur = g + 0.3
    p.fromSpan = dd + 0.3
    p.readAt = dd
    const rs = Math.max(a, b - 0.1) + T.late
    // the left hand takes its edge 0.3 s after the right (paper-pass.md 2.1), in the same proportion when the times are shortened
    const tl = c + (0.3 * (T.shared + T.lift)) / 0.45
    const pose = HAND_POSES.pinch
    const one = p.busy !== null
    const readC = new Vector3()
    const readQ = new Quaternion()
    const sideSign = (r: AgentRig, at: Vector3) => sideOf(r, at)
    p.events.push(
      { at: b - T.signal * 0.5, fn: () => from.giverFace('yield', p.t0 + dd, sideSign(from, to.parts.root.position)) },
      { at: c, fn: () => cue('handoff.give', { pos: M.clone(), agent: to.id, key: `handoff:${p.id}:give` }) },
      { at: c + 0.03, fn: () => to.paperReaction('nod', p.t0 + c + 0.03, false) },
    )
    p.state = (s, st) => {
      // the sheet
      if (s < b) {
        const k = seg(s, a, b)
        st.pos.lerpVectors(P0, C, k)
        st.quat.slerpQuaternions(Q0, Q1, k)
        st.opacity = s < 0 ? 0 : Math.min(1, s / T.appear)
      } else if (s < dd) {
        const k = seg(s, b, c)
        st.pos.lerpVectors(C, M, k)
        st.quat.copy(Q1)
        st.opacity = 1
      } else {
        // out of the giver's hand and up to the reading place, the receiver's hands on its long edges
        const k = seg(s, dd, e)
        this.view(to, one, readC, readQ)
        st.pos.lerpVectors(M, readC, k)
        st.quat.slerpQuaternions(Q1, readQ, k)
        st.opacity = this.fadeOf(s, f)
      }
      st.fold = 0
      st.holder.from = s >= a * 0.85 && s < dd
      st.holder.to = s >= c && s < g
      // the giver's right hand: down onto the far short edge, up with it, out to the middle, let go after the shared hold, back
      const far = this.spot(false, st, new Vector3())
      if (s < dd) p.keep = far.clone()
      const sendW = Math.min(seg(s, 0, a * 0.7), 1 - seg(s, dd, dd + T.back))
      if (sendW > 0.001) {
        const hover = s < a * 0.85 ? 0.05 * (1 - seg(s, 0, a * 0.85)) : 0
        st.hands.push({ who: 'from', side: 'r', pinch: s < dd ? far.setY(far.y + hover) : p.keep!.clone(), palm: palmIn(from), pose, w: sendW })
      }
      // the receiver: late behind the giver, one hand to its long edge (the right one takes the right edge), takes it; 0.3 s into the way back the left takes the left edge
      const out = 1 - seg(s, g, g + 0.3)
      const first = Math.min(seg(s, rs, c), out)
      if (first > 0.001) st.hands.push(this.holdCmd(p.sides[0], s >= c ? out : first, seg(s, c - 0.1, c + 0.05)))
      if (p.sides[1]) {
        const second = Math.min(seg(s, dd, tl), out)
        if (second > 0.001) st.hands.push(this.holdCmd(p.sides[1], second, seg(s, tl - 0.1, tl + 0.05)))
      }
    }
  }

  // ------------------------------------------------------------ method: slide across the desk (paper-pass.md 2.2)

  buildSlide(p: Pass, choice: Choice) {
    const { from, to, times: T } = p
    const lane = choice.lane!
    const y = DESK_TOP + PAPER.t / 2
    const put = lane.put.clone().setY(y)
    const reach = lane.reach.clone().setY(y)
    const stop = lane.stop.clone().setY(y)
    const dir = lane.dir.clone()
    // text toward the receiver, top edge toward the giver (it reads the right way up for the receiver); the giver's fingers are on that top edge
    const Q = quatOf(dir.clone().negate(), UP)
    const a = T.signal
    const b = a + T.push
    const c = b + T.slide
    const dd = c + T.block
    const e = dd + 0.15
    const ee = e + T.lift
    const f = ee + T.look
    const g = f + T.fade
    p.dur = g + 0.3
    p.fromSpan = b + 0.3
    p.readAt = e
    const pulled = stop.clone().addScaledVector(dir, 0.1)
    const one = p.busy !== null
    const readC = new Vector3()
    const readQ = new Quaternion()
    const lifted = pulled.clone().setY(y + RAISE)
    p.events.push(
      { at: 0, fn: () => from.giverFace('yield', p.t0 + c, sideOf(from, to.parts.root.position)) },
      { at: b, fn: () => cue('handoff.slide', { pos: reach.clone(), agent: from.id, dur: T.slide, key: `handoff:${p.id}:slide` }) },
      { at: c, fn: () => to.paperReaction('nod', p.t0 + c, false) },
    )
    p.state = (s, st) => {
      st.fold = 0
      if (s < a) {
        st.pos.copy(put)
        st.quat.copy(Q)
        st.opacity = Math.min(1, Math.max(0, s) / T.appear)
      } else if (s < b) {
        st.pos.lerpVectors(put, reach, seg(s, a, b))
        st.quat.copy(Q)
      } else if (s < c) {
        // released at its fastest and slowing to the stop: cubic ease-out
        const k = Math.min(1, (s - b) / T.slide)
        st.pos.lerpVectors(reach, stop, 1 - (1 - k) ** 3)
        st.quat.copy(Q)
      } else if (s < e) {
        // blocked by the palm, drawn 0.1 m in, then lifted off the desk (RAISE) so the fingers go under its edge
        st.pos.lerpVectors(stop, pulled, seg(s, c, dd))
        st.pos.y += RAISE * seg(s, dd, e)
        st.quat.copy(Q)
      } else {
        const k = seg(s, e, ee)
        this.view(to, one, readC, readQ)
        st.pos.lerpVectors(lifted, readC, k)
        st.quat.slerpQuaternions(Q, readQ, k)
        st.opacity = this.fadeOf(s, f)
      }
      st.holder.from = false
      st.holder.to = s >= e && s < g
      // the giver: two fingers on the near (top) edge, along the lane, then off (not flicked) and back
      const sw = Math.min(seg(s, 0, a * 0.8), 1 - seg(s, b, b + T.back))
      if (sw > 0.001) {
        if (s < b) p.keep = this.spot(false, st, new Vector3())
        const at = p.keep!.clone()
        st.hands.push({ who: 'from', side: 'r', pinch: at, palm: DOWN, pose: HAND_POSES.point, w: sw })
      }
      // the receiver: the palm stands on the paper 0.2 s before it stops and draws it in; then the hand goes to the paper's long edge (fingers under it, thumb on top)
      // and lifts it, and the other hand takes the other edge on the way to the reading place
      const out = 1 - seg(s, g, g + 0.3)
      const rw = Math.min(seg(s, c - 0.2, c), out)
      if (rw > 0.001) {
        if (s < e) {
          const at = this.tmpP.copy(st.pos).setY(st.pos.y + 0.035)
          st.hands.push({ who: 'to', side: p.sides[0], pinch: at.clone(), palm: DOWN, pose: POSES.support, w: rw })
        }
        if (s >= dd) st.hands.push(this.holdCmd(p.sides[0], Math.min(seg(s, dd, e), out), seg(s, e - 0.12, e + 0.03)))
      }
      if (p.sides[1]) {
        const second = Math.min(seg(s, e, ee), out)
        if (second > 0.001) st.hands.push(this.holdCmd(p.sides[1], second, seg(s, ee - 0.1, ee + 0.05)))
      }
    }
  }

  // ------------------------------------------------------------ method: a toss (paper-pass.md 2.3)

  buildToss(p: Pass, choice: Choice) {
    const { from, to, times: T } = p
    const paper = this.paper!
    const S = new Vector3(from.x, 0, from.z)
    const R = new Vector3(to.x, 0, to.z)
    const u = R.clone().sub(S).setY(0).normalize()
    const fwd = this.facing(from)
    const hs = from.seatLift
    const hr = to.seatLift
    const P0 = S.clone().addScaledVector(fwd, 0.3).setY(DESK_TOP + PAPER.t / 2)
    const C = S.clone().addScaledVector(u, 0.3).setY(CHEST + hs)
    const Q0 = quatOf(fwd, UP)
    // thrown top edge first, the thrower holding the near short edge; it turns half a turn more than whole ones in the air and lands top edge toward the thrower:
    // the right way up for the receiver, whose right hand takes the sheet's right long edge
    const Qf = quatOf(u, UP)
    const Qland = quatOf(u.clone().negate(), UP)
    const one = p.busy !== null
    const a = T.pick
    const b = a + T.lift
    const c = b + T.fold
    const dd = c + T.signal
    const rel = dd + T.throw
    const land = rel + T.fly
    const e = land + T.unfold
    const f = e + T.look
    const g = f + T.fade
    p.dur = p.lay ? e : g + 0.3
    p.fromSpan = rel + 0.9
    p.readAt = p.lay ? 0 : land
    // the release: 0.45 in front of the thrower at 0.9; the catch: 0.35 toward the thrower from the catcher, in front of the chest
    const release = S.clone().addScaledVector(u, 0.45).setY(0.9 + hs)
    const catchAt = R.clone().addScaledVector(u, -0.35).setY(CHEST + 0.05 + hr)
    // both of the receiver's hands busy: it lands flat on the desk 0.3 m in front of the body and lies there (paper-pass.md 3)
    const lay = p.lay
    const deskAt = R.clone().addScaledVector(this.facing(to), 0.3).setY(DESK_TOP + PAPER.t / 2)
    if (lay) catchAt.copy(deskAt)
    const apex = tossApex(release.y, catchAt.y, choice.between.maxTop)
    const readC = new Vector3()
    const readQ = new Quaternion()
    const spinTurns = Math.max(1, Math.round(T.fly))
    const foldedPinch = (st: PassState) => this.spot(true, st, new Vector3())
    // the thrower's hand: held out (signal), pulled back 0.12 m over the first 0.15 s of the throw, then forward to the release point
    const held = C.clone().addScaledVector(u, 0.1)
    const back = held.clone().addScaledVector(u, -0.12)
    const wind = dd + 0.15 * (T.throw / 0.35)
    const pinchC = C.clone().add(paper.gripNear.clone().applyQuaternion(Qf))
    const pinchPath = (s: number, out: Vector3) => (s < wind ? out.lerpVectors(held, back, seg(s, dd, wind)) : out.lerpVectors(back, release, seg(s, wind, rel)))
    // the sheet's centre when the right hand's grip (the right long edge) sits at the catch point
    const gripR = this.grips?.target(p.sides[0])?.pg
    const gripOff = gripR ? new Vector3().setFromMatrixPosition(gripR) : new Vector3((p.sides[0] === 'r' ? -1 : 1) * 0.09, 0, -0.0148)
    const centerCatch = lay ? deskAt.clone() : catchAt.clone().sub(gripOff.clone().applyQuaternion(Qland))
    p.events.push(
      { at: b, fn: () => from.giverFace('yield', p.t0 + rel, sideOf(from, to.parts.root.position)) },
      { at: rel, fn: () => cue('handoff.toss', { pos: release.clone(), agent: from.id, key: `handoff:${p.id}:toss` }) },
      { at: rel, fn: () => from.giverFace('happy', p.t0 + rel + 0.8, 1) },
      { at: land, fn: () => cue('handoff.catch', { pos: catchAt.clone(), agent: to.id, key: `handoff:${p.id}:catch` }) },
      { at: land, fn: () => to.paperReaction('surprise', p.t0 + land, false) },
    )
    // before the flight the sheet is placed from the throwing hand's pinch (the near edge), so it stays in the fingers
    const heldPose = (pinch: Vector3, fold: number, st: PassState) => {
      st.fold = fold
      st.quat.copy(Qf)
      st.pos.copy(pinch).sub(paper.gripNear.clone().applyQuaternion(Qf))
    }
    p.state = (s, st) => {
      st.opacity = 1
      st.holder.from = s >= a * 0.85 && s < rel
      st.holder.to = !lay && s >= land && s < g
      if (s < b) {
        const k = seg(s, a, b)
        st.fold = 0
        st.pos.lerpVectors(P0, C, k)
        st.quat.slerpQuaternions(Q0, Qf, k)
        st.opacity = Math.min(1, Math.max(0, s) / T.appear)
      } else if (s < dd) {
        // folded in the air: the far half comes up and over (0.4 of the 0.6 s), the crease is pressed (0.2); the near half stays in the thrower's fingers
        const fold = Math.PI * seg(s, b, b + T.fold * 0.67)
        st.fold = fold
        st.quat.copy(Qf)
        st.pos.copy(C)
        if (s >= c) heldPose(this.tmpV.lerpVectors(pinchC, held, seg(s, c, dd)), Math.PI, st)
      } else if (s < rel) {
        heldPose(pinchPath(s, this.tmpV), Math.PI, st)
      } else if (s < land) {
        // the arc: flat, spinning about its own normal (a second a turn, and half a turn more so it lands top edge toward the thrower), the apex over what is between
        const k = (s - rel) / T.fly
        const centerRel = release.clone().sub(paper.gripNear.clone().applyQuaternion(Qf))
        st.pos.set(MathUtils.lerp(centerRel.x, centerCatch.x, k), arcY(centerRel.y, centerCatch.y, apex, k), MathUtils.lerp(centerRel.z, centerCatch.z, k))
        st.fold = Math.PI
        st.quat.copy(Qf).multiply(this.tmpQ.setFromAxisAngle(UP, Math.PI * 2 * (spinTurns + 0.5) * k))
      } else {
        // caught, then lifted to the reading place while the far half is opened out; both hands stay on the near half, so nothing is regripped
        const k = seg(s, land, e)
        if (lay) {
          st.pos.copy(centerCatch)
          st.quat.copy(Qland)
          st.opacity = 1
        } else {
          this.view(to, one, readC, readQ)
          st.pos.lerpVectors(centerCatch, readC, k)
          st.quat.slerpQuaternions(Qland, readQ, k)
          st.opacity = this.fadeOf(s, f)
        }
        st.fold = Math.PI * (1 - seg(s, land + 0.05, e))
      }
      // the thrower: right hand on the sheet through the fold and the throw; the left holds it up from underneath while it is folded
      const rw = Math.min(seg(s, 0, a * 0.7), 1 - seg(s, rel, rel + T.back))
      if (rw > 0.001) {
        if (s < rel) p.keep = foldedPinch(st)
        const at = p.keep!.clone()
        st.hands.push({ who: 'from', side: 'r', pinch: at, palm: palmIn(from), pose: HAND_POSES.pinch, w: rw })
      }
      const lw = Math.min(seg(s, b - 0.1, b + 0.15), 1 - seg(s, dd, dd + 0.3))
      if (lw > 0.001) st.hands.push({ who: 'from', side: 'l', pinch: new Vector3(st.pos.x, st.pos.y - 0.03, st.pos.z), palm: UPV, pose: POSES.support, w: lw })
      // the catcher: a hand up toward the thrower from the signal on, palm to them; as the sheet lands it takes the right long edge and closes on it
      const out = 1 - seg(s, g, g + 0.3)
      const cw = lay ? 0 : Math.min(seg(s, c - 0.1, dd), s < land ? 1 : 0)
      if (cw > 0.001) st.hands.push({ who: 'to', side: p.sides[0], pinch: catchAt.clone(), palm: u.clone().negate(), pose: HAND_POSES.wave, w: cw })
      const gw = lay ? 0 : Math.min(seg(s, land - 0.12, land), out)
      if (gw > 0.001) st.hands.push(this.holdCmd(p.sides[0], s >= land ? out : gw, seg(s, land - 0.1, land + 0.05)))
      // the other hand takes the left long edge of the folded sheet and opens it out with the far half
      if (p.sides[1] && !lay) {
        const uw = Math.min(seg(s, land + 0.03, land + 0.15), out)
        if (uw > 0.001) st.hands.push(this.holdCmd(p.sides[1], uw, seg(s, land + 0.08, land + 0.2)))
      }
    }
  }

  // ------------------------------------------------------------ picking up what lies on the desk (paper-pass.md 3, both hands were busy)

  /** a hand goes down to the sheet (flat, text side up, on the desk), takes its long edge, lifts it to the reading place; then it is read and fades as always */
  buildPickup(p: Pass, L: Lying) {
    const { to, times: T } = p
    const r = 0.35
    const e = r + 0.15
    const ee = e + T.lift
    const f = ee + T.look
    const g = f + T.fade
    p.dur = g + 0.3
    p.readAt = e
    const one = p.busy !== null
    const readC = new Vector3()
    const readQ = new Quaternion()
    const lifted = L.pos.clone().setY(L.pos.y + RAISE)
    p.events.push({ at: e, fn: () => to.paperReaction('nod', p.t0 + e, false) })
    p.state = (s, st) => {
      st.fold = 0
      if (s < e) {
        st.pos.copy(L.pos)
        st.pos.y += RAISE * seg(s, r, e)
        st.quat.copy(L.quat)
        st.opacity = 1
      } else {
        const k = seg(s, e, ee)
        this.view(to, one, readC, readQ)
        st.pos.lerpVectors(lifted, readC, k)
        st.quat.slerpQuaternions(L.quat, readQ, k)
        st.opacity = this.fadeOf(s, f)
      }
      st.holder.from = false
      st.holder.to = s >= e && s < g
      const out = 1 - seg(s, g, g + 0.3)
      const rw = Math.min(seg(s, 0, r), out)
      if (rw > 0.001 && s < e) st.hands.push({ who: 'to', side: p.sides[0], pinch: this.tmpP.clone().copy(st.pos).setY(st.pos.y + 0.035), palm: DOWN, pose: POSES.support, w: rw })
      if (s >= r) st.hands.push(this.holdCmd(p.sides[0], Math.min(seg(s, r, e), out), seg(s, e - 0.12, e + 0.03)))
      if (p.sides[1]) {
        const second = Math.min(seg(s, e, ee), out)
        if (second > 0.001) st.hands.push(this.holdCmd(p.sides[1], second, seg(s, ee - 0.1, ee + 0.05)))
      }
    }
  }

  // ------------------------------------------------------------ reduced motion (paper-pass.md 5)

  /** no flight, slide or fold: it fades out of the giver's hand and in at the receiver's reading place (0.12 s), the faces still change */
  buildReduced(p: Pass) {
    const { from, to, times: T, method } = p
    const paper = this.paper!
    const a = T.appear
    const b = a + T.appear
    const f = b + T.look
    const g = f + T.fade
    p.dur = g + 0.2
    p.fromSpan = b
    p.readAt = a
    const one = p.busy !== null
    const readC = new Vector3()
    const readQ = new Quaternion()
    const giverP = new Vector3()
    p.events.push(
      { at: 0, fn: () => from.giverFace('yield', p.t0 + b, sideOf(from, to.parts.root.position)) },
      { at: a, fn: () => cue('handoff.give', { pos: this.view(to, one, new Vector3()).centre, agent: to.id, key: `handoff:${p.id}:give` }) },
      { at: a, fn: () => (method === 'toss' ? to.paperReaction('surprise', p.t0 + a, true) : to.paperReaction('nod', p.t0 + a, true)) },
    )
    p.state = (s, st) => {
      st.fold = 0
      st.holder.from = s > 0 && s < a
      st.holder.to = s >= a && s < g
      if (s < a) {
        // in the giver's hand, fading out
        from.pinchPoint('r', giverP)
        st.quat.copy(quatOf(this.facing(from), UP))
        st.pos.copy(giverP).sub(paper.gripNear.clone().applyQuaternion(st.quat))
        st.opacity = Math.max(0, 1 - s / a)
        if (s < 0.0001) st.opacity = 1
      } else {
        this.view(to, one, readC, readQ)
        st.quat.copy(readQ)
        st.pos.copy(readC)
        st.opacity = Math.min((s - a) / T.appear, 1 - seg(s, f, f + T.fade))
        for (const side of p.sides) st.hands.push(this.holdCmd(side, 1, 1))
      }
    }
  }
}

const AX = new Vector3(1, 0, 0)
const DOWN = new Vector3(0, -1, 0)
const UPV = new Vector3(0, 1, 0)

/** the palm's direction for a hand pinching: inward (toward the body's centre line) and down */
function palmIn(rig: AgentRig, side: 'l' | 'r' = 'r') {
  const sx = side === 'l' ? -1 : 1
  const q = rig.parts.root.getWorldQuaternion(new Quaternion())
  return new Vector3(-sx * 0.6, -0.8, 0).applyQuaternion(q)
}

/** which side of the agent `at` is on: +1 to its left (the viewer's right on its face), -1 to its right */
function sideOf(rig: AgentRig, at: Vector3) {
  const q = rig.parts.root.getWorldQuaternion(new Quaternion())
  const local = at.clone().sub(rig.parts.root.getWorldPosition(new Vector3())).applyQuaternion(q.invert())
  return local.x <= 0 ? 1 : -1
}

