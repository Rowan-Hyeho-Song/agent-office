// Passing a paper from one agent to another (#262, docs/design/paper-pass.md 2-5): handing it over, sliding it across the desk, a toss.
// (The paper plane is plane.ts.) One pass at a time. Each method is a script: a function of the time since it began that gives the paper's
// pose and fold, who holds it, and where each hand goes. The paper and the hands are both placed from the script, so the paper never
// jumps and never leaves a hand it is held by (the #228 guards watch exactly that).
//
// The frame of the sheet (paperProp.ts): x the short side, z the long side, +y the text side. +z is the text's TOP edge: the edge the
// receiver takes and holds it by, so the sheet reads the right way up where it is looked at (paper-pass.md 5: 0.22 ahead of the face
// screen, 0.10 below it, top edge in the hand, tilted 25 degrees back, the text side toward the face and up).
import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import { cue } from '../audio/cues'
import { HAND_POSES, type AgentRig, type PropBank } from './rig'
import { POSES, toVec, type HandAngles } from './handPose'
import { reachFrame } from './reach'
import { DeskStuff, Furniture, chooseMethod, findLane, timesFor, tossApex, arcY, type Choice, type Method, type Times } from './paperPass'
import { PAPER, paperOf, placePaper, type PaperProp } from './paperProp'
import type { OfficeMessage } from './status'
import type { Object3D } from 'three'

const UP = new Vector3(0, 1, 0)
const CHEST = 0.95
const DESK_TOP = 0.745
const READ_TILT = MathUtils.degToRad(25)
/** how far under LOOK_AT's reading place the sheet is held so that its top edge clears the face screen, m */
const READ_DROP = 0.03

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
  /** debug / tests: the last state */
  last: PassState
}

const state = (): PassState => ({ pos: new Vector3(), quat: new Quaternion(), fold: 0, opacity: 1, holder: { from: false, to: false }, hands: [] })

export class PaperPasses {
  readonly paper: PaperProp | null
  readonly furniture: Furniture | null
  readonly desks: DeskStuff | null
  private pass: Pass | null = null
  /** one frame after a pass: the paper goes home (the frame it let go of its last hand it had not moved) */
  private homing = false
  private home = { pos: new Vector3(), quat: new Quaternion() }
  private opacityNow = 1
  /** passes played (the debug panel shows it) */
  played = 0
  /** how each method went, newest last (tests and the debug hook) */
  readonly log: { id: string; method: Method; from: string; to: string }[] = []
  private pinchOff = new Map<string, Vector3>()

  constructor(props: PropBank, nodes: Record<string, Object3D>) {
    this.paper = paperOf(nodes)
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
      for (const m of p.meshes) m.material = (m.material as import('three').Material).clone()
      this.hide()
    }
  }

  get busy() {
    return !!this.pass || this.homing
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

  /** world point of a pinch spot of the sheet at its pose and fold (the near spot sits on the half that folds) */
  private spot(near: boolean, st: PassState, out = new Vector3()) {
    const p = this.paper!
    const local = (near ? p.gripNear : p.gripFar).clone()
    if (near) local.applyAxisAngle(AX, st.fold)
    return out.copy(local).applyQuaternion(st.quat).add(st.pos)
  }

  start(msg: OfficeMessage, method: Exclude<Method, 'plane'>, choice: Choice, from: AgentRig, to: AgentRig, t: number, reduced: boolean) {
    if (!this.paper) return false
    const fast = from.gestureMin > 0 || to.gestureMin > 0
    const min = Math.max(from.gestureMin, to.gestureMin)
    const length = choice.lane?.length ?? 1
    const T = timesFor(choice.d, length, { fast, min })
    const lookFrom = new Vector3()
    const lookTo = new Vector3()
    const build = reduced ? this.buildReduced : method === 'hand' ? this.buildHand : method === 'slide' ? this.buildSlide : this.buildToss
    const p: Pass = { method, id: msg.id, from, to, t0: t, dur: 0, times: T, reduced, state: () => {}, events: [], fired: 0, lookFrom, lookTo, readAt: 0, last: state(), fromSpan: 0, keep: null }
    build.call(this, p, choice)
    this.pass = p
    this.homing = false
    this.played++
    this.log.push({ id: msg.id, method, from: from.id, to: to.id })
    const headOf = (r: AgentRig, out: Vector3) => r.parts.head.getWorldPosition(out)
    headOf(to, lookFrom)
    headOf(from, lookTo)
    // look and turn (aim.ts): both look at the other all through, calmly (the faces are paper-pass.md 4's), the hands are driven here
    const look = (r: AgentRig, at: Vector3, span: number) => {
      r.startGesture('catch', t, at, { reduced, flyFor: Math.min(0.5, span / 2), holdS: Math.max(0.1, span - Math.min(0.5, span / 2)), oneHand: true, calm: true })
      r.gesture!.handsOff = true
    }
    look(from, lookFrom, p.fromSpan)
    look(to, lookTo, p.dur)
    return true
  }

  update(t: number, rigs: Record<string, AgentRig>, reduced: boolean) {
    const p = this.pass
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
    this.setOpacity(st.opacity)
    paper.node.visible = paper.a.visible = paper.b.visible = st.opacity > 0.001
    // who holds it: the prop bank's holder (rig.want), set after the stage reset it this frame
    if (st.holder.from) from.want = { kind: 'paper', side: 'r', prefer: paper.node.name, attached: true }
    if (st.holder.to) to.want = { kind: 'paper', side: 'r', prefer: paper.node.name, attached: true }
    // reading starts: the receiver's catching hand is the reading hand (rig.handPose) from now on
    const ge = to.gesture
    if (ge && s >= p.readAt && p.readAt > 0) {
      ge.handsOff = false
      ge.caught = true
    }
    for (const c of st.hands) this.drive(c.who === 'from' ? from : to, c, t, reduced)
    if (s >= p.dur) {
      this.pass = null
      // let go first: the hands no longer drive (the frame the holders go the paper has not moved), then it goes home next frame
      this.homing = true
    }
    void rigs
  }

  // ------------------------------------------------------------ geometry shared by the scripts

  /** the agent's facing in the world (its root's -z) */
  private facing(rig: AgentRig, out = new Vector3()) {
    rig.parts.root.updateWorldMatrix(true, false)
    return out.set(0, 0, -1).applyQuaternion(rig.parts.root.getWorldQuaternion(this.tmpQ)).setY(0).normalize()
  }

  /** the reading pose of the sheet held by `rig`'s right hand: pinch point (world), the sheet's rotation, in paper-pass.md 5's place */
  private reading(rig: AgentRig, pinch = new Vector3(), quat = new Quaternion()) {
    rig.parts.root.updateWorldMatrix(true, false)
    pinch.copy(rig.readingPlace('r', this.tmpP)).applyMatrix4(rig.parts.root.matrixWorld)
    // the sheet's top edge stands 1.4 cm past the pinch (the grip is 1.5 cm in from it) and the edge must stay below the face screen (paper-pass.md 5):
    // the hand holds it 3 cm under the plane's reading place
    pinch.y -= READ_DROP
    const f = this.facing(rig)
    // the top edge: up and a little away from the face; the text side: toward the face and up
    const top = new Vector3().copy(UP).multiplyScalar(Math.cos(READ_TILT)).addScaledVector(f, Math.sin(READ_TILT))
    const normal = new Vector3().copy(f).multiplyScalar(-Math.cos(READ_TILT)).addScaledVector(UP, Math.sin(READ_TILT))
    quatOf(top, normal, quat)
    return { pinch, quat }
  }

  private fadeOf(s: number, g0: number) {
    return 1 - seg(s, g0, g0 + 0.3)
  }

  // ------------------------------------------------------------ method: handing it over (paper-pass.md 2.1)

  buildHand(p: Pass) {
    const { from, to, times: T } = p
    const paper = this.paper!
    const S = new Vector3(from.x, 0, from.z)
    const R = new Vector3(to.x, 0, to.z)
    const u = R.clone().sub(S).setY(0).normalize()
    const fwd = this.facing(from)
    const d = S.distanceTo(R)
    const hs = from.seatLift
    const hr = to.seatLift
    const P0 = S.clone().addScaledVector(fwd, 0.3).setY(DESK_TOP + PAPER.t / 2)
    const C = S.clone().addScaledVector(u, Math.min(0.3, d / 2 - 0.1)).setY(CHEST + hs)
    const M = S.clone().addScaledVector(u, d / 2).setY(CHEST + (hs + hr) / 2)
    const Q0 = quatOf(fwd, UP)
    const Q1 = quatOf(u, UP)
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
    const pose = HAND_POSES.pinch
    const tmp = state()
    const readP = new Vector3()
    const readQ = new Quaternion()
    const froz = new Vector3()
    let frozen = false
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
        // M-state pinch (far edge) to the reading place, the sheet turning to hang in the hand
        if (!frozen) {
          tmp.pos.copy(M)
          tmp.quat.copy(Q1)
          tmp.fold = 0
          this.spot(false, tmp, froz)
          frozen = true
        }
        const k = seg(s, dd, e)
        this.reading(to, readP, readQ)
        const pinch = this.tmpV.lerpVectors(froz, readP, k)
        st.quat.slerpQuaternions(Q1, readQ, k)
        st.pos.copy(pinch).sub(paper.gripFar.clone().applyQuaternion(st.quat))
        st.opacity = this.fadeOf(s, f)
      }
      st.fold = 0
      st.holder.from = s >= a * 0.85 && s < dd
      st.holder.to = s >= c && s < g
      // the sender's right hand: down onto the sheet, up with it, out to the middle, let go after the shared hold, back
      const near = this.spot(true, st, new Vector3())
      if (s < dd) p.keep = near.clone()
      const sendW = Math.min(seg(s, 0, a * 0.7), 1 - seg(s, dd, dd + T.back))
      if (sendW > 0.001) {
        const hover = s < a * 0.85 ? 0.05 * (1 - seg(s, 0, a * 0.85)) : 0
        st.hands.push({ who: 'from', side: 'r', pinch: s < dd ? near.setY(near.y + hover) : p.keep!.clone(), palm: palmIn(from), pose, w: sendW })
      }
      // the receiver's right hand: late behind the sender, to the far edge, takes it, then holds it at the reading place
      const recW = Math.min(seg(s, rs, c), 1 - seg(s, g, g + 0.3))
      if (recW > 0.001) st.hands.push({ who: 'to', side: 'r', pinch: this.spot(false, st, new Vector3()), palm: palmIn(to), pose, w: s >= c ? 1 - seg(s, g, g + 0.3) : recW })
    }
  }

  // ------------------------------------------------------------ method: slide across the desk (paper-pass.md 2.2)

  buildSlide(p: Pass, choice: Choice) {
    const { from, to, times: T } = p
    const paper = this.paper!
    const lane = choice.lane!
    const y = DESK_TOP + PAPER.t / 2
    const put = lane.put.clone().setY(y)
    const reach = lane.reach.clone().setY(y)
    const stop = lane.stop.clone().setY(y)
    const dir = lane.dir.clone()
    const Q = quatOf(dir, UP)
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
    const readP = new Vector3()
    const readQ = new Quaternion()
    const froz = new Vector3()
    const tmp = state()
    let frozen = false
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
        // blocked by the palm and drawn 0.1 m in
        st.pos.lerpVectors(stop, pulled, seg(s, c, dd))
        st.quat.copy(Q)
      } else {
        if (!frozen) {
          tmp.pos.copy(pulled)
          tmp.quat.copy(Q)
          tmp.fold = 0
          this.spot(false, tmp, froz)
          frozen = true
        }
        const k = seg(s, e, ee)
        this.reading(to, readP, readQ)
        const pinch = this.tmpV.lerpVectors(froz, readP, k)
        st.quat.slerpQuaternions(Q, readQ, k)
        st.pos.copy(pinch).sub(paper.gripFar.clone().applyQuaternion(st.quat))
        st.opacity = this.fadeOf(s, f)
      }
      st.holder.from = false
      st.holder.to = s >= e && s < g
      // the sender: two fingers on the near edge, along the lane, then off (not flicked) and back
      const sw = Math.min(seg(s, 0, a * 0.8), 1 - seg(s, b, b + T.back))
      if (sw > 0.001) {
        if (s < b) p.keep = this.spot(true, st, new Vector3())
        const at = p.keep!.clone()
        st.hands.push({ who: 'from', side: 'r', pinch: at, palm: DOWN, pose: HAND_POSES.point, w: sw })
      }
      // the receiver: the palm stands on the paper 0.2 s before it stops, draws it in, then pinches the near-to-me edge and lifts
      const rw = Math.min(seg(s, c - 0.2, c), 1 - seg(s, g, g + 0.3))
      if (rw > 0.001) {
        if (s < dd) {
          const at = this.tmpP.copy(st.pos).setY(st.pos.y + 0.035)
          st.hands.push({ who: 'to', side: 'r', pinch: at.clone(), palm: DOWN, pose: POSES.support, w: rw })
        } else {
          const near = this.spot(false, st, new Vector3())
          const k = seg(s, dd, e)
          const palmAt = pulled.clone().setY(pulled.y + 0.035)
          st.hands.push({ who: 'to', side: 'r', pinch: s < e ? palmAt.lerp(near, k) : near, palm: palmIn(to), pose: HAND_POSES.pinch, w: s >= g ? 1 - seg(s, g, g + 0.3) : rw })
        }
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
    const Qf = quatOf(u, UP)
    const a = T.pick
    const b = a + T.lift
    const c = b + T.fold
    const dd = c + T.signal
    const rel = dd + T.throw
    const land = rel + T.fly
    const e = land + T.unfold
    const f = e + T.look
    const g = f + T.fade
    p.dur = g + 0.3
    p.fromSpan = rel + 0.9
    p.readAt = land
    // the release: 0.45 in front of the thrower at 0.9; the catch: 0.35 toward the thrower from the catcher, in front of the chest
    const release = S.clone().addScaledVector(u, 0.45).setY(0.9 + hs)
    const catchAt = R.clone().addScaledVector(u, -0.35).setY(CHEST + 0.05 + hr)
    const apex = tossApex(release.y, catchAt.y, choice.between.maxTop)
    const tmp = state()
    const readP = new Vector3()
    const readQ = new Quaternion()
    const startP = new Vector3()
    const spinTurns = Math.max(1, Math.round(T.fly))
    const foldedPinch = (st: PassState) => this.spot(true, st, new Vector3())
    // the thrower's hand: held out (signal), pulled back 0.12 m over the first 0.15 s of the throw, then forward to the release point
    const held = C.clone().addScaledVector(u, 0.1)
    const back = held.clone().addScaledVector(u, -0.12)
    const wind = dd + 0.15 * (T.throw / 0.35)
    const pinchC = C.clone().add(paper.gripNear.clone().applyAxisAngle(AX, Math.PI).applyQuaternion(Qf))
    const pinchPath = (s: number, out: Vector3) => (s < wind ? out.lerpVectors(held, back, seg(s, dd, wind)) : out.lerpVectors(back, release, seg(s, wind, rel)))
    p.events.push(
      { at: b, fn: () => from.giverFace('yield', p.t0 + rel, sideOf(from, to.parts.root.position)) },
      { at: rel, fn: () => cue('handoff.toss', { pos: release.clone(), agent: from.id, key: `handoff:${p.id}:toss` }) },
      { at: rel, fn: () => from.giverFace('happy', p.t0 + rel + 0.8, 1) },
      { at: land, fn: () => cue('handoff.catch', { pos: catchAt.clone(), agent: to.id, key: `handoff:${p.id}:catch` }) },
      { at: land, fn: () => to.paperReaction('surprise', p.t0 + land, false) },
    )
    // before the flight the sheet is placed from the throwing hand's pinch, so it stays in the fingers
    const heldPose = (pinch: Vector3, fold: number, st: PassState) => {
      st.fold = fold
      st.quat.copy(Qf)
      // the pinch spot (near spot rotated by the fold) sits at `pinch`
      const local = paper.gripNear.clone().applyAxisAngle(AX, fold).applyQuaternion(Qf)
      st.pos.copy(pinch).sub(local)
    }
    p.state = (s, st) => {
      st.opacity = 1
      st.holder.from = s >= a * 0.85 && s < rel
      st.holder.to = s >= land && s < g
      if (s < b) {
        const k = seg(s, a, b)
        st.fold = 0
        st.pos.lerpVectors(P0, C, k)
        st.quat.slerpQuaternions(Q0, Qf, k)
        st.opacity = Math.min(1, Math.max(0, s) / T.appear)
      } else if (s < dd) {
        // folded in the air: the near half comes up and over (0.4 of the 0.6 s), the crease is pressed (0.2)
        const fold = Math.PI * seg(s, b, b + T.fold * 0.67)
        st.fold = fold
        st.quat.copy(Qf)
        st.pos.copy(C)
        if (s >= c) heldPose(this.tmpV.lerpVectors(pinchC, held, seg(s, c, dd)), Math.PI, st)
      } else if (s < rel) {
        heldPose(pinchPath(s, this.tmpV), Math.PI, st)
      } else if (s < land) {
        // the arc: flat, spinning once a second about its own normal, the apex over what is between
        const k = (s - rel) / T.fly
        const centerRel = this.centerAt(release, Math.PI, Qf)
        const centerCatch = this.centerAtFar(catchAt, Qf)
        st.pos.set(MathUtils.lerp(centerRel.x, centerCatch.x, k), arcY(centerRel.y, centerCatch.y, apex, k), MathUtils.lerp(centerRel.z, centerCatch.z, k))
        st.fold = Math.PI
        st.quat.copy(Qf).multiply(this.tmpQ.setFromAxisAngle(UP, Math.PI * 2 * spinTurns * k))
      } else {
        // caught, then lifted to the reading place while both hands open it out
        if (s < land + 1e-6) startP.copy(catchAt)
        const k = seg(s, land, e)
        this.reading(to, readP, readQ)
        const pinch = this.tmpV.lerpVectors(catchAt, readP, k)
        st.quat.slerpQuaternions(Qf, readQ, k)
        st.fold = Math.PI * (1 - seg(s, land + 0.05, e))
        st.pos.copy(pinch).sub(paper.gripFar.clone().applyQuaternion(st.quat))
        st.opacity = this.fadeOf(s, f)
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
      // the catcher: a hand up toward the thrower from the signal on, palm to them; it closes at the catch
      const cw = Math.min(seg(s, c - 0.1, dd), 1 - seg(s, g, g + 0.3))
      if (cw > 0.001) {
        const at = s < land ? catchAt.clone() : this.spot(false, st, new Vector3())
        st.hands.push({ who: 'to', side: 'r', pinch: at, palm: s < land ? u.clone().negate() : palmIn(to), pose: s < land - 0.05 ? HAND_POSES.wave : HAND_POSES.pinch, w: s >= g ? 1 - seg(s, g, g + 0.3) : cw })
      }
      // the other hand opens the fold: pinch on the folded half's edge while it unfolds
      const uw = Math.min(seg(s, land + 0.03, land + 0.15), 1 - seg(s, e, e + 0.3))
      if (uw > 0.001) st.hands.push({ who: 'to', side: 'l', pinch: this.spot(true, st, new Vector3()), palm: palmIn(to, 'l'), pose: HAND_POSES.pinch, w: uw })
    }
    void tmp
  }

  /** the sheet's centre when its pinch spot (the near spot at `fold`) sits at `pinch` with rotation q */
  private foldedAt(pinch: Vector3, q: Quaternion, fold: number) {
    const local = this.paper!.gripNear.clone().applyAxisAngle(AX, fold).applyQuaternion(q)
    return pinch.clone().sub(local)
  }
  private centerAt(pinch: Vector3, fold: number, q: Quaternion) {
    return this.foldedAt(pinch, q, fold)
  }
  /** the sheet's centre when its far spot sits at `pinch` with rotation q */
  private centerAtFar(pinch: Vector3, q: Quaternion) {
    return pinch.clone().sub(this.paper!.gripFar.clone().applyQuaternion(q))
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
    const readP = new Vector3()
    const readQ = new Quaternion()
    const giverP = new Vector3()
    p.events.push(
      { at: 0, fn: () => from.giverFace(method === 'toss' ? 'yield' : 'yield', p.t0 + b, sideOf(from, to.parts.root.position)) },
      { at: a, fn: () => cue('handoff.give', { pos: this.reading(to, new Vector3()).pinch, agent: to.id, key: `handoff:${p.id}:give` }) },
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
        st.opacity = Math.max(0, 1 - s / a) * Math.min(1, 1)
        if (s < 0.0001) st.opacity = 1
      } else {
        this.reading(to, readP, readQ)
        st.quat.copy(readQ)
        st.pos.copy(readP).sub(paper.gripFar.clone().applyQuaternion(readQ))
        st.opacity = Math.min((s - a) / T.appear, 1 - seg(s, f, f + T.fade))
        st.hands.push({ who: 'to', side: 'r', pinch: readP.clone(), palm: palmIn(to), pose: HAND_POSES.pinch, w: 1 })
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

