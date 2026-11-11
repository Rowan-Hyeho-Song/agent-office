// Play in 3D (#135) and the hands that take hold of things (#164). Each frame, from the office time alone:
//  - ping-pong: the ball and the paddles follow rallyAt (the same rally for every visitor at the same office time),
//  - omok: the stones on the board follow gameAt, and the mover's hand picks a stone from its bowl, carries it, thinks, places
//    it and withdraws (choreo.ts), the stone held between the index and middle fingertips,
//  - the solo things: the mug, the watering can with its water, the book that opens and turns a page, the marker on the
//    whiteboard, 휴's tablet pen, the stamp, the mouse under a resting hand, the coffee machine's button.
// Everything that holds something goes through grip(): the hand's own _grip frame goes onto the object's _grip frame (plus the
// stored offset, gripFit.data.ts), the fingers go pre-grip → closed → after (grip.ts) and each touching fingertip is bent onto
// its contact point.

import {
  BoxGeometry,
  CircleGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three'
import type { Goal } from './director'
import type { GripDemo } from './debugPlay'
import { GRIPS, GripClock, STONE_ABD, STONE_FALLBACK_M, STONE_H, STONE_PITCH, STONE_PITCH_FLAT, handFor, stoneGrip, stoneRoll, tipAt, type StoneGrip } from './grip'
import { DIP_K, POSES, fingerFromC, toVec } from './handPose'
import { contactNormal, fitFingers, handGripMatrix, offsetOf, resolveTarget, type GripTarget } from './gripTargets'
import { fingerModelOf, type AgentRig, type PropBank } from './rig'
import { LIFT, OPEN_ANGLE, halfAngle } from './bookGeom'
import { LeafBend, PINCH_LET_GO, TURN_S, fingerWeight, leafAngle, pinchArc, poseWeight } from './bookLeaf'
import { noteTourEvent } from './tourEvents'
import { meshesOf } from './nodes'
import type { StatusMap } from './status'
import { gameAt, N, type OmokView } from '../play/omok'
import { rallyAt, type Dims, type Rally, type V3 } from '../play/pingpong'
import { CARRY_HOLD, HOLD_DEFAULT, PLANTS, POUR_TILT, canPose, dropAt, landing, lerpHold, plantsFrom, pourAt, solvePour, spoutOf, type Plant } from './water'
import { WATER_S } from './waterRun'
import { PARTICLE_CAP, circleAt, flowAt, habitEnv, habitSeconds, habitU, levelFor, shakeAt, type HabitKind } from './waterFx'
import { WaterScene, isMobileish } from './waterScene'
import { READ_HOLD, READ_S } from './readRun'
import { type Place, SEQ, ease, habitOf, placeSequence } from '../play/choreo'
import { strokeAt } from '../play/stroke'
import { sessionsAt, sessionTime, type PlaySession } from '../play/session'
import { PlaySounds } from '../audio/playSounds'
import { Typist } from './typist'
import { LoungeActs } from './loungeActs'

const UP = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
const ONE = new Vector3(1, 1, 1)

/** the table tennis table the model has (pp_table extras size / net_h) with the engine's default reach */
const dimsOf = (size: number[], netH: number): Dims => ({ L: size[0], W: size[1], netH, ballR: 0.02, reach: 0.25, floorY: -0.76 })
/** the blade's centre above the paddle node's origin, along its y */
const BLADE_Y = 0.175
/** ball centre to the paddle face at contact: the ball radius and half the blade */
const FACE_GAP = 0.023
/** the hand goes to the leaf's corner in this long before the turn, and comes back in this long after it, s (grips.md: 0.2) */
const LEAD_S = 0.2
const BACK_S = 0.3
/** the held object rises from where it rests to where it is held in this long, s */
const LIFT_S = 0.35
/** the grips whose approach turns the hand along the reach direction (#255, grips.md 1.1): the high-shelf book, the board marker, the ping-pong paddle */
const REACH_KINDS = new Set(['book', 'marker', 'paddle'])
/** carrying a prop back to where it rests, s */
const PUT_S = 0.4
/** a go stone is carried within this far of the player's spot (m); farther, the body leans in, by at most LEAN_MAX_M */
const STONE_COMFORT_M = 0.7
const LEAN_MAX_M = 0.08
/** watering (watering.md 2): the body dips this far as the hand takes the can, the wrist sags this much (of POUR_TILT: 5°), the body leans this far toward the pot while it pours */
const WEIGHT_DIP_M = 0.03
const WRIST_SAG = (5 * Math.PI) / 180 / ((30 * Math.PI) / 180)
const LEAN_IN_M = 0.05

export interface StageIn {
  /** office time, ms */
  now: number
  /** the clock the rigs' own animation runs on, s (the scene clock in the timelapse) */
  t: number
  dt: number
  reduced: boolean
  replaying: boolean
  /** the replay's speed (#158): 1 live; the water's details thin out at 16 (waterFx.levelFor) */
  speed?: number
  rigs: Record<string, AgentRig>
  goals: Record<string, Goal>
  status: StatusMap
  /** 휴's tablet is lit (she is editing) / the planner is stamping a decision */
  tablet: boolean
  stamp: boolean
  /** agent id → its colour, for the winning rings */
  colors: Record<string, string>
  /** ?debug=1: pair games started by hand (debugPlay.ts) instead of the schedule's, and a grip demo to loop */
  forcedSessions?: PlaySession[]
  gripDemo?: GripDemo | null
}

/** the 2 s score tag over the net after a point */
export interface Tag {
  text: string
  at: Vector3
}

const blend = (a: Matrix4, b: Matrix4, k: number, out = new Matrix4()) => {
  const pa = new Vector3()
  const pb = new Vector3()
  const qa = new Quaternion()
  const qb = new Quaternion()
  a.decompose(pa, qa, new Vector3())
  b.decompose(pb, qb, new Vector3())
  return out.compose(pa.lerp(pb, k), qa.slerp(qb, k), ONE)
}

/** a frame from three axes (columns) and an origin */
const frame = (x: Vector3, y: Vector3, z: Vector3, o: Vector3) => new Matrix4().makeBasis(x, y, z).setPosition(o)

/** a finger's [MCP, PIP, total abduction] into a 20-angle vector (DIP follows the PIP, k · PIP) */
function setFingerJoints(vec: number[], k: number, j: readonly number[]) {
  vec[k * 4] = j[0]
  vec[k * 4 + 1] = j[1]
  vec[k * 4 + 2] = DIP_K[k] * j[1]
  vec[k * 4 + 3] = j[2]
}
/** pre-grip / closed / after as 20-angle vectors, weighted by the grip stage's mix */
function mixVec(pre: readonly number[], hold: readonly number[], after: readonly number[], mix: readonly number[]) {
  return pre.map((x, i) => x * mix[0] + hold[i] * mix[1] + after[i] * mix[2])
}

export class PlayStage {
  /** the hands at the keyboard and the mouse (#225) */
  readonly typist: Typist
  /** the agents that typed this frame (the others' typing drive fades out) */
  private typed = new Set<string>()
  /** the play sounds (#194 ②): one line at each event below */
  private sounds = new PlaySounds()
  private clocks = new Map<string, GripClock>()
  /** when each hand was last driven by grip() (the scene clock, s) */
  private lastGripT = new Map<string, number>()
  private targets = new Map<string, GripTarget | null>()
  private fits = new Map<string, { hold: number[] } | null>()
  private lastHand = new Map<string, Matrix4>()
  private forced = new Set<Object3D>()
  /** the object pose the last grip() call placed the hand from (the partner hand of a two-handed hold follows it) */
  private lastObjPose = new Matrix4()
  private arrivedAt = new Map<string, number>()
  /** what each hand carries: when its activity ends the hand puts the prop back where it came from, then lets go (no prop moves on its own) */
  private carry = new Map<string, { rig: AgentRig; side: 'l' | 'r'; kind: string; objName: string; prefer?: string; held: Matrix4; seen: boolean; putStart: number | null; down?: boolean; extra: ((pose: Matrix4) => void) | null }>()

  // ping-pong
  private tableNode: Object3D | undefined
  private dims: Dims = dimsOf([2.05, 1.14], 0.15)
  private ball: Object3D | undefined
  private ballHome = new Vector3()
  private shadow: Mesh
  /** the 2 s score tag; null when none */
  tag: Tag | null = null

  // omok
  private grid: { o: Vector3; n: number; cell: number } | null = null
  private bowl: Record<'b' | 'w', { mouth: Vector3; contact: Vector3 } | undefined> = { b: undefined, w: undefined }
  private stones: { b: InstancedMesh; w: InstancedMesh } | null = null
  private shadows: InstancedMesh | null = null
  private rings: Mesh[] = []
  private line: Mesh | null = null
  private reactedGame = new Map<string, number>()
  /** the faces of a result (#193): the games and points already answered, the coffee drinkers who had their first sip */
  private faced = new Set<string>()
  private lastPoint = new Map<string, string>()
  private sipped = new Map<string, number>()
  /** each mover's place sequence of this frame (tests read it) */
  readonly lastPlace: Record<string, Place> = {}
  /** per mover: whether the move's hand began from the pick (a move first seen after its pick, a seat taken mid-move, is left to the board: no hand ever took its stone) */
  private handMove: Record<string, { key: string; ok: boolean }> = {}
  private stoneFrames = new Map<string, StoneGrip[]>()
  /** per agent, decided once from the fits: the go grip, or (when its tips cannot land on the stone's discs within STONE_FALLBACK_M at some pitch) the tripod pinch */
  private stoneModes = new Map<string, 'go' | 'pinch'>()

  // water and the book
  private drops: InstancedMesh | null = null
  /** the water's effects (waterScene.ts): the stream, the wet soil, the leaves' sway and drips */
  private fx: WaterScene | null = null
  private fxT = -1
  private spout: Object3D | undefined
  private bookHalves: { l: Object3D; r: Object3D } | null = null
  /** the one leaf that turns (#231): bent about the spine, hidden while the book is read without a turn */
  private leaf: LeafBend | null = null
  private leafTargets = new Map<string, GripTarget | null>()
  private mCorner = new Matrix4()
  private mCornerWorld = new Matrix4()
  private vPos = new Vector3()
  private vScale = new Vector3()
  private vArc = new Vector3()
  private qPose = new Quaternion()

  private sceneRef: Object3D
  /** the lounge's acts, drawn (#280, loungeActs.ts): the fridge door, the dispenser, the turntable, the pillow, the lever, the mat */
  readonly lounge: LoungeActs

  constructor(
    scene: Object3D,
    private nodes: Record<string, Object3D>,
    private props: PropBank,
  ) {
    this.sceneRef = scene
    scene.updateMatrixWorld(true)
    this.typist = new Typist(nodes)
    this.lounge = new LoungeActs(scene, nodes, props, {
      grip: (rig, side, kind, objName, want, held, inp, prefer) => this.grip(rig, side, kind, objName, want, held, inp, prefer),
      partner: (rig, kind, side, objName, primary) => {
        const tgt = this.target(objName, kind, side)
        if (tgt) this.partner(rig, kind, side, tgt, this.lastObjPose, primary)
      },
      button: (rig, name, u, inp, holdS, depth) => this.button(rig, name, u, inp, holdS, depth),
      arrivedAt: (id) => this.arrivedAt.get(id),
    })
    this.tableNode = scene.getObjectByName('pp_table') ?? undefined
    const ex = this.tableNode?.userData as { size?: number[]; net_h?: number } | undefined
    if (ex?.size) this.dims = dimsOf(ex.size, ex.net_h ?? 0.15)
    this.ball = nodes.pp_ball
    if (this.ball) this.ballHome.copy(this.ball.position)
    this.shadow = new Mesh(new CircleGeometry(1, 20).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false }))
    this.shadow.visible = false
    this.shadow.renderOrder = 2
    scene.add(this.shadow)

    const g = scene.getObjectByName('omok_grid')
    if (g) {
      const ud = g.userData as { n?: number; cell?: number }
      this.grid = { o: g.getWorldPosition(new Vector3()), n: ud.n ?? N, cell: ud.cell ?? 0.0257 }
    }
    for (const c of ['b', 'w'] as const) {
      const bowl = scene.getObjectByName(`omok_bowl_${c}`)
      const contact = scene.getObjectByName(`omok_bowl_${c}_contact_index`)
      if (bowl && contact) this.bowl[c] = { mouth: bowl.getWorldPosition(new Vector3()), contact: contact.getWorldPosition(new Vector3()) }
    }
    // the stones on the board: the two samples are hidden and instanced
    const sb = nodes.omok_stone_b
    const sw = nodes.omok_stone_w
    if (sb && sw && this.grid) {
      const make = (node: Object3D) => {
        const mesh = meshesOf(node)[0]
        node.visible = false
        const im = new InstancedMesh(mesh.geometry as BufferGeometry, mesh.material as Material, N * N)
        im.count = 0
        im.frustumCulled = false
        scene.add(im)
        return im
      }
      this.stones = { b: make(sb), w: make(sw) }
      const sh = new InstancedMesh(new CircleGeometry(0.0125, 20).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }), N * N)
      sh.count = 0
      sh.frustumCulled = false
      sh.renderOrder = 1
      scene.add(sh)
      this.shadows = sh
      for (let i = 0; i < 5; i++) {
        const ring = new Mesh(new RingGeometry(0.0125, 0.0152, 28).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }))
        ring.visible = false
        ring.renderOrder = 3
        scene.add(ring)
        this.rings.push(ring)
      }
      const line = new Mesh(new BoxGeometry(1, 0.0012, 0.0024), new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }))
      line.visible = false
      line.renderOrder = 3
      scene.add(line)
      this.line = line
    }
    // water for the can, and the book's two halves
    this.spout = nodes.prop_watering_can_spout
    this.plants = plantsFrom(scene)
    const canNode = nodes.prop_watering_can
    if (canNode && this.spout) {
      canNode.updateWorldMatrix(true, true)
      this.spoutLocal = new Matrix4().copy(canNode.matrixWorld).invert().multiply(this.spout.matrixWorld)
    }
    // one InstancedMesh for every drop of water, never more than the cap (watering.md 3: 40, 20 on a phone): the can's stream and the leaf drips, and the dispenser's tap
    const mobile = isMobileish()
    const drops = new InstancedMesh(new SphereGeometry(0.003, 6, 5), new MeshBasicMaterial({ color: '#dff3ff', transparent: true, opacity: 0.75, depthWrite: false }), mobile ? PARTICLE_CAP.mobile : PARTICLE_CAP.desktop)
    drops.count = 0
    drops.frustumCulled = false
    scene.add(drops)
    this.drops = drops
    this.fx = new WaterScene(scene, drops, this.plants, mobile)
    const book = nodes.prop_book
    const l = nodes.prop_book_l
    const r = nodes.prop_book_r
    if (book && l && r) {
      book.attach(l)
      book.attach(r)
      this.bookHalves = { l, r }
      const page = nodes.prop_book_page
      if (page) {
        book.attach(page)
        this.leaf = new LeafBend(page)
        page.visible = false
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ the grip itself

  private clock(key: string) {
    let c = this.clocks.get(key)
    if (!c) this.clocks.set(key, (c = new GripClock()))
    return c
  }

  private target(objName: string, kind: string, side: 'l' | 'r') {
    const key = `${objName}:${kind}:${side}`
    if (!this.targets.has(key)) this.targets.set(key, resolveTarget(this.sceneRef, objName, kind, side))
    return this.targets.get(key)!
  }

  /**
   * The fingers at the closed stage for this hand and object, as 20 joint angles (handPose.toVec): the table's hold (hand-poses.md 3), each
   * touching finger replaced by the joints that put its tip on its contact (grip.ts fitContact: a finger MCP / PIP / abduction, the thumb
   * CMC flex / abduct / MCP / IP). What is fitted is exactly what the rig shows.
   */
  private holdFit(rig: AgentRig, side: 'l' | 'r', t: GripTarget) {
    const seat = Number(rig.id.split('_')[1])
    const key = `${t.key}:${seat}`
    if (!this.fits.has(key)) {
      const spec = GRIPS[t.kind][side]!
      const hold = rig.curlVec(side, spec.hold)
      for (const f of fitFingers(t, rig.parts.hands[side], offsetOf(t.key, seat))) {
        if (f.finger === 'thumb') hold.splice(16, 4, ...f.joints)
        else setFingerJoints(hold, ['index', 'middle', 'ring', 'little'].indexOf(f.finger), f.joints)
      }
      this.fits.set(key, { hold })
    }
    return this.fits.get(key)!
  }

  /**
   * One hand and one object for this frame. `want`: should the hand be holding. `held`: the object's world pose while it is held
   * (null: where it rests; for a fixture like a mouse, always where it is). Returns whether the object is the hand's now.
   */
  private grip(rig: AgentRig, side: 'l' | 'r', kind: string, objName: string, want: boolean, held: Matrix4 | null, inp: StageIn, prefer?: string, carryCall = false): boolean {
    const spec = GRIPS[kind]?.[side]
    const tgt = this.target(objName, kind, side)
    const key = `${rig.id}:${side}`
    const clock = this.clock(key)
    // the hand has not been driven for a while (it rested on the mouse at its desk, then walked away): whatever stage the clock was left in is
    // over. Taking something now starts from the reach, so a thing is never "already in the hand" at the first frame (#228)
    const last = this.lastGripT.get(key)
    if (last !== undefined && inp.t - last > 0.25 && clock.current.stage !== 'rest') clock.reset()
    this.lastGripT.set(key, inp.t)
    const o = { gestureMin: rig.gestureMin, reduced: inp.reduced }
    const out = clock.step(inp.t, want && rig.visible, o)
    if (!spec || !tgt) {
      // a model without the grip empties: the old way, the prop in the hand's grip
      if (out.attached && !tgt) rig.want = { kind, side, prefer }
      return false
    }
    const hand = rig.parts.hands[side]
    // the mouse body is live but not a prop (#305): the hand is placed on the body where it is now, wherever the typist has slid it
    const body = kind === 'mouse' ? tgt.obj : null
    if (body) body.updateWorldMatrix(true, false)
    // the closed book's grip is the same prop as the open one (PropBank knows props by their own kind)
    const propKind = kind === 'bookclosed' ? 'book' : kind
    const info = tgt.obj && !body ? this.props.info(rig, propKind, prefer ?? objName) : null
    const home = body ? body.matrixWorld.clone() : tgt.obj ? this.props.homeWorld(tgt.obj) : new Matrix4()
    let pose = home
    // reduced motion: the can is simply in the hand (watering.md 5); everything else is lifted from where it rests
    if (body) pose = home
    else if (out.attached && held) pose = inp.reduced && kind === 'watering_can' ? held : blend(home, held, ease((inp.t - (clock.attachedAt ?? inp.t)) / Math.max(LIFT_S, rig.gestureMin)))
    else if (out.attached && !tgt.obj) pose = held ?? home
    this.lastObjPose = pose
    const seat = Number(rig.id.split('_')[1])
    const target = handFor(pose, tgt.pg, handGripMatrix(hand)).multiply(offsetOf(tgt.key, seat))
    const lastKey = `${key}:${objName}`
    if (out.stage === 'release') {
      const last = this.lastHand.get(lastKey)
      if (last) target.copy(last)
    } else if (out.stage !== 'rest') this.lastHand.set(lastKey, target.clone())
    if (out.stage === 'rest') return false
    const fit = this.holdFit(rig, side, tgt)
    rig.drive[side] = { target, w: out.wHand, curl: null, angles: mixVec(rig.curlVec(side, spec.pre), fit.hold, rig.curlVec(side, spec.after), out.mix), wc: out.wCurl, spread: null, reach: REACH_KINDS.has(kind) }
    if (tgt.obj && info && !body) {
      rig.want = { kind: propKind, side, prefer: prefer ?? objName, attached: out.attached }
      if (out.attached) {
        this.props.force(tgt.obj, pose)
        this.forced.add(tgt.obj)
        if (!carryCall) {
          const e = this.carry.get(lastKey)
          this.carry.set(lastKey, { rig, side, kind, objName, prefer, held: pose.clone(), seen: true, putStart: null, extra: e?.extra ?? null })
        }
      }
    }
    return out.attached
  }

  /** ?debug=1: the grip stages in a loop in place (6 s: held from 0.4 s to 3.4 s, then put back and let go), for close-ups */
  private demo(inp: StageIn) {
    const d = inp.gripDemo
    if (!d) return
    const rig = inp.rigs[d.agent]
    if (!rig?.visible || rig.arrived !== inp.goals[d.agent]?.spot) return
    const c = inp.t % 6
    if (c < 0.4 || c > 3.4) return
    const tgt = this.target(d.obj, d.kind, d.side)
    if (!tgt) return
    const held = tgt.obj ? this.props.homeWorld(tgt.obj) : null
    if (held) held.elements[13] += 0.06
    this.grip(rig, d.side, d.kind, d.obj, true, held, inp, d.obj)
  }

  /** objects whose activity has ended: carried home by the hand (0.4 s), then let go with the "after" opening */
  private putBack(inp: StageIn) {
    for (const [k, e] of this.carry) {
      if (e.seen) continue
      const clock = this.clock(`${e.rig.id}:${e.side}`)
      const obj = this.target(e.objName, e.kind, e.side)?.obj
      if (clock.current.attached && obj && e.rig.visible) {
        e.putStart ??= inp.t
        const dur = inp.reduced ? 0 : Math.max(PUT_S, e.rig.gestureMin)
        const kk = dur > 0 ? (inp.t - e.putStart) / dur : 1
        // the last frame in the hand is exactly where it rests, so letting go moves nothing (#228: at any frame rate)
        if (kk < 1 || !e.down) {
          if (kk >= 1) e.down = true
          const pose = blend(e.held, this.props.homeWorld(obj), ease(Math.min(1, kk)))
          this.grip(e.rig, e.side, e.kind, e.objName, true, pose, inp, e.prefer, true)
          e.extra?.(pose)
          continue
        }
        // down: put it exactly where it came from, then open the hand
        this.props.force(obj, this.props.homeWorld(obj))
        this.forced.add(obj)
      }
      this.grip(e.rig, e.side, e.kind, e.objName, false, null, inp, e.prefer, true)
      if (clock.current.stage === 'rest') this.carry.delete(k)
    }
  }

  // ------------------------------------------------------------------------------------------------------------- frame

  update(inp: StageIn) {
    for (const node of this.forced) this.props.force(node, null)
    this.forced.clear()
    this.typed.clear()
    this.tag = null
    this.lounge.begin()
    for (const id in inp.rigs) {
      const r = inp.rigs[id]
      r.drive = { l: null, r: null }
      r.glance = null
      r.headExtra = { pitch: 0, yaw: 0, roll: 0 }
      r.chin = false
      r.want = null
      const g = inp.goals[id]
      if (r.arrived && g && r.arrived === g.spot) {
        if (!this.arrivedAt.has(id)) this.arrivedAt.set(id, inp.t)
      } else this.arrivedAt.delete(id)
    }
    const ids = Object.keys(inp.rigs)
    const busy = new Set(ids.filter((a) => inp.status[a]?.state === 'working' || inp.status[a]?.state === 'off' || inp.status[a]?.night === 'duty'))
    const sessions = inp.forcedSessions?.length ? inp.forcedSessions : sessionsAt(inp.now, ids, busy)
    let pp: PlaySession | null = null
    let og: PlaySession | null = null
    for (const s of sessions) {
      const ready = s.players.every((id) => {
        const r = inp.rigs[id]
        const g = inp.goals[id]
        return r?.visible && g?.pose === s.kind && r.arrived === g.spot
      })
      if (!ready) continue
      if (s.kind === 'pingpong') pp = s
      else og = s
    }
    this.pingpong(pp, inp)
    this.omok(og, inp)
    for (const e of this.carry.values()) e.seen = false
    for (const id of ids) if (inp.gripDemo?.agent !== id) this.solo(inp.rigs[id], inp.goals[id], inp, pp, og)
    this.demo(inp)
    this.putBack(inp)
    for (const id of ids) if (!this.typed.has(id)) this.typist.fade(inp.rigs[id], inp.dt)
    for (const id of ids) {
      inp.rigs[id].applyDrive('l', inp.t, inp.reduced)
      inp.rigs[id].applyDrive('r', inp.t, inp.reduced)
    }
    this.lounge.update(inp)
    this.book(inp)
    this.water(inp)
  }

  // --------------------------------------------------------------------------------------------------------- ping-pong

  private tableWorld(p: readonly number[], out = new Vector3()) {
    const o = this.tableNode ? this.tableNode.getWorldPosition(new Vector3()) : new Vector3()
    return out.set(o.x + p[0], o.y + p[1], o.z + p[2])
  }

  private pingpong(s: PlaySession | null, inp: StageIn) {
    const ball = this.ball
    this.shadow.visible = false
    if (!s || !this.tableNode) {
      if (ball) {
        ball.visible = true
        ball.position.copy(this.ballHome)
      }
      return
    }
    const tMs = sessionTime(s, inp.now)
    const d = this.dims
    const rally: Rally = rallyAt(s.seed, s.players, Math.max(tMs, -1), d, inp.reduced)
    const playing = tMs >= 0
    if (playing) this.sounds.pingpong(s.seed, tMs, rally, d.ballR!, rally.ballPos ? this.tableWorld(rally.ballPos) : null)
    if (ball) {
      if (playing && rally.ballPos) {
        ball.visible = true
        this.tableWorld(rally.ballPos, ball.position)
        const h = rally.ballPos[1] - d.ballR!
        const over = Math.abs(rally.ballPos[0]) < d.L! / 2 && Math.abs(rally.ballPos[2]) < d.W! / 2
        this.shadow.visible = over
        this.shadow.position.set(ball.position.x, this.tableWorld([0, 0, 0]).y + 0.002, ball.position.z)
        this.shadow.scale.setScalar(d.ballR! * (1.1 + h * 0.8))
        ;(this.shadow.material as MeshBasicMaterial).opacity = 0.4 / (1 + h * 3)
      } else {
        ball.visible = !playing || inp.reduced // between points the ball is in somebody's pocket; at the start it waits on the table
        ball.position.copy(this.ballHome)
      }
    }
    for (const side of [0, 1] as const) {
      const rig = inp.rigs[s.players[side]]
      const dir = side === 0 ? 1 : -1
      const planeX = -dir * (d.L! / 2 + d.reach!)
      const ready: V3 = [planeX + dir * 0.12, 0.2, 0]
      // read the ball, take the paddle there while it flies, wait drawn back, swing so the face meets it (#416 ③, play.md 7)
      const sp = strokeAt(
        rally.contacts.filter((c) => c.side === side),
        playing ? tMs : -Infinity,
        ready,
        dir,
        FACE_GAP,
      )
      const pos = new Vector3(sp.pos[0], Math.max(sp.pos[1], 0.08), Math.max(-d.W! / 2 - 0.3, Math.min(d.W! / 2 + 0.3, sp.pos[2])))
      // the face looks along the hit direction, tipped up a little; the wrist turns it about the vertical: drawn back toward the paddle
      // hand's side while ready, through the ball at contact (mirrored on the backhand side, where the blade is turned over)
      const hand = (sp.backhand ? -1 : 1) * dir // the paddle hand's side along z (the right hand: +z facing +x)
      const z = new Vector3(dir * Math.cos(sp.wrist), 0.12, -hand * Math.sin(sp.wrist)).normalize()
      const y = UP.clone().addScaledVector(z, -UP.dot(z)).normalize()
      const x = new Vector3().crossVectors(y, z)
      if (sp.backhand) {
        // the other face to the ball: the blade turned half round its handle
        x.negate()
        z.negate()
      }
      const worldBlade = this.tableWorld([pos.x, pos.y, pos.z])
      const held = frame(x, y, z, worldBlade.addScaledVector(y, -BLADE_Y))
      this.grip(rig, 'r', 'paddle', `prop_paddle_${side === 0 ? 'a' : 'b'}`, true, held, inp, `prop_paddle_${side === 0 ? 'a' : 'b'}`)
    }
    // the tag over the net for 2 s after a point: the score, as the server's side reads it
    const before = playing ? rallyAt(s.seed, s.players, tMs - 2000, d, true) : null
    if (playing && before && (before.score[0] !== rally.score[0] || before.score[1] !== rally.score[1]) && before.game === rally.game) {
      this.tag = { text: `${rally.score[0]} : ${rally.score[1]}`, at: this.tableWorld([0, d.netH! + 0.35, 0]) }
      // the one who lost the point is startled (놀람); once per point
      const pk = `${rally.game}|${rally.score[0]}:${rally.score[1]}`
      if (this.lastPoint.get(s.spot) !== pk) {
        this.lastPoint.set(s.spot, pk)
        inp.rigs[s.players[rally.score[0] > before.score[0] ? 1 : 0]]?.faceEvent('surprised', inp.t)
      }
      for (const p of s.players) noteTourEvent(p, 2500) // the tour (#207): a point is an event at both players
    }
  }

  // -------------------------------------------------------------------------------------------------------------- omok

  private cellPos(cell: number, out = new Vector3()) {
    const g = this.grid!
    return out.set(g.o.x + (cell % g.n) * g.cell, g.o.y, g.o.z + Math.floor(cell / g.n) * g.cell)
  }

  /** which finger's contact on the go stone faces up (it presses from above) */
  private stoneTop(): 'index' | 'middle' {
    const n = this.sceneRef.getObjectByName('prop_piece_a_contact_index')
    return n && contactNormal(this.sceneRef, n).y > 0 ? 'index' : 'middle'
  }

  /** the stone's frame in the right hand when it is held 바둑식 (cached per agent) */
  private stoneFrame(rig: AgentRig) {
    let f = this.stoneFrames.get(rig.id)
    if (!f) {
      const hand = rig.parts.hands.r
      const hold = GRIPS.piece.r!.hold
      const models = { index: fingerModelOf(hand, 0, 'r')!, middle: fingerModelOf(hand, 1, 'r')! }
      // the finger that presses from above is the one whose contact empty on the stone faces up (data, not code)
      const top = this.stoneTop()
      // carrying: the hand pitched 40°; sliding in it lays flatter (30°)
      // a fit every 2° from the carrying pitch to the flat one; the wrist is blended between neighbours so the tips stay on the stone throughout
      f = Array.from({ length: 11 }, (_, k) => {
        const pitch = STONE_PITCH + ((STONE_PITCH_FLAT - STONE_PITCH) * k) / 10
        return stoneGrip(models, top, { index: hold[0], middle: hold[1] }, pitch, stoneRoll(models, top, { index: hold[0], middle: hold[1] }, pitch))
      })
      this.stoneFrames.set(rig.id, f)
      this.stoneModes.set(rig.id, f.every((g) => g.err[top] <= STONE_FALLBACK_M) ? 'go' : 'pinch')
    }
    return f
  }

  private omok(s: PlaySession | null, inp: StageIn) {
    const st = this.stones
    if (!st || !this.grid) return
    const key = s ? `${s.spot}` : '-'
    const mat = new Matrix4()
    if (!s) {
      // block over (or the players left): the stones are swept off in 2.5 s, in a fixed scatter
      this.sweep(inp)
      return
    }
    const tMs = sessionTime(s, inp.now)
    if (tMs < 0) {
      this.sweep(inp)
      return
    }
    const view = gameAt(s.seed, s.players, tMs, inp.reduced)
    this.sounds.omokStone(s.seed, view.game, view.moveIndex, view.lastMove >= 0 ? this.cellPos(view.lastMove) : null)
    this.sweepState = { start: null, board: view.board.slice() }
    // stones on the board
    let nb = 0
    let nw = 0
    let ns = 0
    const pos = new Vector3()
    const recent = view.lastMove >= 0 && inp.reduced ? this.fadeK(s, tMs, view) : 1
    for (let cell = 0; cell < view.board.length; cell++) {
      const c = view.board[cell]
      if (!c) continue
      this.cellPos(cell, pos)
      let k = cell === view.lastMove ? recent : 1
      let from: Vector3 | null = null
      if (view.phase === 'reset') {
        const bowl = this.bowl[c === 1 ? 'b' : 'w']
        const rank = ((cell * 37) % 61) / 61
        const e = ease(view.resetT01 * 1.5 - rank * 0.5)
        if (bowl) from = bowl.mouth
        if (from) pos.lerp(from, e)
        k = 1 - 0.6 * e
        if (e >= 1) continue
        pos.y += Math.sin(e * Math.PI) * 0.05
      }
      mat.compose(pos, new Quaternion(), new Vector3(k, k, k))
      if (c === 1) st.b.setMatrixAt(nb++, mat)
      else st.w.setMatrixAt(nw++, mat)
      if (view.phase !== 'reset') {
        this.cellPos(cell, pos)
        pos.y += 0.0004
        this.shadows!.setMatrixAt(ns++, mat.compose(pos, new Quaternion(), new Vector3(k, 1, k)))
      }
    }
    st.b.count = nb
    st.w.count = nw
    st.b.instanceMatrix.needsUpdate = true
    st.w.instanceMatrix.needsUpdate = true
    this.shadows!.count = ns
    this.shadows!.instanceMatrix.needsUpdate = true
    // the win: a ring of the winner's colour on each of the five, then a line across them in 0.4 s
    const showWin = view.phase === 'won' && view.line && view.winner
    for (const r of this.rings) r.visible = false
    if (this.line) this.line.visible = false
    if (showWin) {
      const winnerIdx = view.winner === 1 ? view.black : (1 - view.black) as 0 | 1
      const col = inp.colors[s.players[winnerIdx]] ?? '#ffffff'
      const cells = [...view.line!].sort((a, b) => a - b).slice(0, 5)
      cells.forEach((cell, i) => {
        const ring = this.rings[i]
        ring.visible = true
        this.cellPos(cell, ring.position)
        ring.position.y += STONE_H + 0.0008
        ;(ring.material as MeshBasicMaterial).color.set(col)
      })
      const a = this.cellPos(cells[0])
      const b = this.cellPos(cells[cells.length - 1])
      const k = ease((view.wonMs - 300) / 400)
      if (this.line && k > 0) {
        this.line.visible = true
        const mid = a.clone().lerp(b, 0.5)
        mid.y += STONE_H + 0.0012
        this.line.position.copy(mid)
        const dir = b.clone().sub(a)
        this.line.rotation.set(0, Math.atan2(-dir.z, dir.x), 0)
        this.line.scale.set(dir.length() * k, 1, 1)
        ;(this.line.material as MeshBasicMaterial).color.set(col)
      }
    }
    // the faces of the result: the winner is glad (기쁨), the loser embarrassed (당황); an expression is information, reduced motion keeps it
    if (view.phase === 'won' && view.winner && view.wonMs > 500) {
      const fk = `${key}:${view.game}`
      if (!this.faced.has(fk)) {
        this.faced.add(fk)
        const w = (view.winner === 1 ? view.black : (1 - view.black)) as 0 | 1
        inp.rigs[s.players[w]]?.faceEvent('joy', inp.t)
        inp.rigs[s.players[1 - w]]?.faceEvent('embarrassed', inp.t)
      }
    }
    if (inp.reduced) return
    // the hands
    this.omokHands(s, view, inp)
    // reactions (play.md 2.5): the winner's small fist, the loser's three claps and a bow
    if (view.phase === 'won' && view.winner) {
      const winnerIdx = view.winner === 1 ? view.black : (1 - view.black) as 0 | 1
      const k = `${key}:${view.game}`
      const wr = inp.rigs[s.players[winnerIdx]]
      const lr = inp.rigs[s.players[1 - winnerIdx]]
      if (view.wonMs > 500 && this.reactedGame.get(k) === undefined) {
        this.reactedGame.set(k, inp.t)
        noteTourEvent(s.players[winnerIdx], 5000) // the tour (#207)
        wr.reaction = { kind: 'fist', t0: inp.t, dur: 1.0 }
        lr.reaction = { kind: 'clap', t0: inp.t + 0.4, dur: 1.4 }
      }
      const t0 = this.reactedGame.get(k)
      if (t0 !== undefined && inp.t - t0 < 0.8) lr.headExtra.pitch = -0.25 * Math.sin(Math.min(1, (inp.t - t0) / 0.8) * Math.PI)
    }
  }

  private sweepState: { start: number | null; board: Uint8Array } | null = null

  /** nobody is playing any more: whatever is on the board is cleared in 2.5 s (play.md: the block-end clean-up) */
  private sweep(inp: StageIn) {
    const st = this.stones!
    const sw = this.sweepState
    for (const r of this.rings) r.visible = false
    if (this.line) this.line.visible = false
    if (!sw) {
      st.b.count = 0
      st.w.count = 0
      this.shadows!.count = 0
      return
    }
    if (sw.start === null) sw.start = inp.t
    const k = inp.reduced ? 1 : (inp.t - sw.start) / 2.5
    if (k >= 1) {
      this.sweepState = null
      st.b.count = 0
      st.w.count = 0
      this.shadows!.count = 0
      return
    }
    let nb = 0
    let nw = 0
    const mat = new Matrix4()
    const pos = new Vector3()
    for (let cell = 0; cell < sw.board.length; cell++) {
      const c = sw.board[cell]
      if (!c) continue
      const rank = ((cell * 37) % 61) / 61
      const e = ease(k * 1.6 - rank * 0.6)
      if (e >= 1) continue
      const bowl = this.bowl[c === 1 ? 'b' : 'w']
      this.cellPos(cell, pos)
      if (bowl) pos.lerp(bowl.mouth, e)
      pos.y += Math.sin(e * Math.PI) * 0.05
      const sc = 1 - 0.6 * e
      mat.compose(pos, new Quaternion(), new Vector3(sc, sc, sc))
      if (c === 1) st.b.setMatrixAt(nb++, mat)
      else st.w.setMatrixAt(nw++, mat)
    }
    st.b.count = nb
    st.w.count = nw
    st.b.instanceMatrix.needsUpdate = true
    st.w.instanceMatrix.needsUpdate = true
    this.shadows!.count = 0
  }

  /** reduced motion: the newest stone fades in over 0.12 s (shown as a growth from nothing; the stones are lit solids) */
  private fadeK(s: PlaySession, tMs: number, view: OmokView) {
    let present = 0
    for (let a = 1; a <= 3; a++) if (gameAt(s.seed, s.players, tMs - a * 40, true).board[view.lastMove]) present++
    return 1 - present / 3
  }

  private omokHands(s: PlaySession, view: OmokView, inp: StageIn) {
    const mv = view.move
    if (!mv || (view.phase !== 'thinking' && view.phase !== 'pick' && view.phase !== 'place')) return
    const id = s.players[mv.mover]
    const rig = inp.rigs[id]
    const wantColor = view.black === mv.mover ? 1 : 2
    const bowl = this.bowl[wantColor === 1 ? 'b' : 'w']
    if (!bowl || !this.grid) return
    const habit = habitOf(id)
    const p = placeSequence(mv.sinceMs, mv.thinkMs, habit)
    this.lastPlace[id] = p
    const mk = `${s.seed}:${view.game}:${mv.cell}`
    if (this.handMove[id]?.key !== mk) this.handMove[id] = { key: mk, ok: mv.sinceMs < SEQ.pick }
    if (!this.handMove[id].ok) return
    if (p.stage === 'rest' && !p.landed) return
    const stone = this.props.info(rig, 'piece', `prop_piece_${wantColor === 1 ? 'a' : 'b'}`)
    // the opponent's last stone: a 10° glance while thinking; the chin hand and the 5° tilt of the defensive one
    if (mv.sinceMs < mv.thinkMs) {
      if (view.lastMove >= 0) rig.glance = { at: this.cellPos(view.lastMove), max: 10 * DEG }
      if (p.chin) {
        rig.chin = true
        rig.headExtra.roll = 5 * DEG
      }
    }
    // the stone's path: its bottom from the bowl's contact (under the mouth) to the intersection
    const target = this.cellPos(mv.cell)
    // the stone is taken where it rests (the proxy on the bowl, 4 cm above the pile's contact point in the model): no jump at the grasp (#228)
    const bowlBottom = stone ? new Vector3().setFromMatrixPosition(this.props.homeWorld(stone.node)).addScaledVector(UP, -STONE_H / 2) : bowl.contact.clone().addScaledVector(UP, -STONE_H)
    const bottom = bowlBottom.clone().lerp(target, p.u)
    const fwdDir = new Vector3(target.x - rig.x, 0, target.z - rig.z).normalize()
    if (isFinite(fwdDir.x)) bottom.addScaledVector(fwdDir, -p.back * p.u)
    bottom.y += p.h
    bottom.x += p.dx
    bottom.z += p.dz
    const fwd = new Vector3(target.x - rig.x, 0, target.z - rig.z).normalize()
    if (!isFinite(fwd.x)) fwd.set(1, 0, 0)
    const xs = fwd
    const ys = UP.clone()
    const zs = new Vector3().crossVectors(xs, ys)
    const rollQ = new Quaternion().setFromAxisAngle(xs, p.roll)
    const centre = bottom.clone().addScaledVector(UP, STONE_H / 2)
    // a cell farther than an arm from the player's spot (the far corners of the board): the body leans over it by the difference, up to LEAN_MAX_M (water.ts REACH is 0.75)
    const over = Math.min(LEAN_MAX_M, Math.max(0, Math.hypot(centre.x - rig.x, centre.z - rig.z) - STONE_COMFORT_M))
    if (over > 0) rig.leanOver(fwd.x * over, fwd.z * over)
    // 휴 rolls the stone about the finger axis through its centre
    const stoneWorld = frame(xs, ys, zs, centre)
    if (p.roll) stoneWorld.premultiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z)).premultiply(new Matrix4().makeRotationFromQuaternion(rollQ)).premultiply(new Matrix4().makeTranslation(centre.x, centre.y, centre.z))
    const sf = this.stoneFrame(rig)
    const fk = p.flat * 10
    const f0 = Math.min(9, Math.floor(fk))
    const fr = fk - f0
    const hand = blend(stoneWorld.clone().multiply(new Matrix4().copy(sf[f0].m).invert()), stoneWorld.clone().multiply(new Matrix4().copy(sf[f0 + 1].m).invert()), fr)
    hand.elements[13] += p.lift + p.rise
    if (isFinite(fwdDir.x)) {
      hand.elements[12] -= fwdDir.x * p.retreat
      hand.elements[14] -= fwdDir.z * p.retreat
    }
    const mix = (a: number, b: number) => a + (b - a) * fr
    const side = 'r'
    const spec = GRIPS.piece.r!
    // the fingers: pre-grip → the 바둑식 grip as the stone is picked, each letting go when it should
    const free = (k: number) => (k === 0 ? p.freeIndex : k === 1 ? p.freeMiddle : p.freeRest)
    const fan = rig.fanOf(side)
    const curlJ = (k: number, c: number) => {
      const f = fingerFromC(k, c, fan[k])
      return [f.mcp, f.pip, f.abd]
    }
    const curl = [0, 1, 2, 3, 4, 5].map((k) => {
      const held = k === 5 || k === 4 ? spec.hold[k] : k < 2 ? spec.hold[k] : spec.hold[k]
      // the pick is a thumb + index pinch; the arc re-grips it into the go grip
      const pinch = [0.6, 0.25, 0.3, 0.35, 0.15, 0.7][k]
      const grip = pinch + (held - pinch) * p.regrip
      const closed = spec.pre[k] + (grip - spec.pre[k]) * p.close
      return closed + (spec.after[k] - closed) * free(k === 5 || k === 4 ? 2 : k)
    })
    const angles = rig.curlVec(side, curl)
    // the index and the middle finger: full joints (MCP, PIP, abduction) from the stone fits, blended pre-grip → pinch → go grip → after like the curls above
    for (const k of [0, 1]) {
      const held = [0, 1, 2].map((i) => mix(sf[f0][k === 0 ? 'index' : 'middle'].j[i], sf[f0 + 1][k === 0 ? 'index' : 'middle'].j[i]))
      if (k === 1) {
        held[0] += 1.7 * p.press
        held[1] += 2 * p.press
      }
      const pinch = curlJ(k, [0.6, 0.25][k])
      const pre = curlJ(k, spec.pre[k])
      const after = curlJ(k, spec.after[k])
      const j = [0, 1, 2].map((i) => {
        const grip = pinch[i] + (held[i] - pinch[i]) * p.regrip
        const closed = pre[i] + (grip - pre[i]) * p.close
        return closed + (after[i] - closed) * free(k)
      })
      setFingerJoints(angles, k, j)
    }
    // an agent whose fingers cannot reach the stone's discs holds it with the tripod pinch instead (decided once per agent from the fits, deterministic)
    const pinch = this.stoneModes.get(rig.id) === 'pinch'
    if (pinch) {
      const tri = toVec(POSES.tripod)
      const pre = rig.curlVec(side, spec.pre)
      const after = rig.curlVec(side, spec.after)
      angles.forEach((_, i) => {
        const closed = pre[i] + (tri[i] - pre[i]) * p.close
        angles[i] = closed + (after[i] - closed) * free(0)
      })
    }
    rig.drive[side] = { target: hand, w: p.w, curl: null, angles, abdLimits: pinch ? null : [STONE_ABD.index, STONE_ABD.middle, undefined, undefined], wc: p.w, spread: null }
    // the stone: the prop piece, in the hand until it lands; the board's own instance shows from the landing
    if (stone) {
      rig.want = { kind: 'piece', side, prefer: `prop_piece_${wantColor === 1 ? 'a' : 'b'}`, attached: p.attached }
      if (p.attached) {
        this.props.force(stone.node, stoneWorld)
        this.forced.add(stone.node)
      }
    }
  }

  // ----------------------------------------------------------------------------------------------------- solo activities

  /** a pen-like thing writing: the nib on `nib`, the body leaning toward `toward` (horizontal, toward the writer) by `tilt` */
  private writing(nib: Vector3, toward: Vector3, nibLen: number, tilt: number, wrist: number) {
    const z = new Vector3().copy(UP).multiplyScalar(Math.sin(tilt)).addScaledVector(toward, Math.cos(tilt)).normalize()
    const x = new Vector3().crossVectors(UP, toward).normalize()
    x.applyAxisAngle(z, wrist)
    const y = new Vector3().crossVectors(z, x)
    return frame(x, y, z, nib.clone().addScaledVector(z, nibLen))
  }

  private solo(rig: AgentRig, goal: Goal | undefined, inp: StageIn, pp: PlaySession | null, og: PlaySession | null) {
    if (!goal || !rig.visible) return
    const seat = Number(rig.id.split('_')[1])
    const resting = rig.arrived === goal.spot
    const t = inp.t
    const u = resting ? t - (this.arrivedAt.get(rig.id) ?? t) : -1
    const root = rig.parts.root
    const local = (x: number, y: number, z: number) => root.localToWorld(new Vector3(x, y, z))
    const yaw = (a: number) => new Quaternion().setFromAxisAngle(UP, a)
    const sit = 0
    void sit
    const heading = rig.heading
    const fwd = new Vector3(-Math.sin(heading), 0, -Math.cos(heading))
    const right = new Vector3(Math.cos(heading), 0, -Math.sin(heading))
    void pp
    void og
    // the watering errand: first, so nothing else (the stamp) takes the right hand while it carries the can
    if (goal.pose === 'water') return this.errand(rig, goal, inp)
    // the lounge acts (fridge, dispenser, turntable), the pillow on the sofa, the door lever (loungeActs.ts)
    if (this.lounge.solo(rig, goal, inp)) return
    // the planner's stamp (the owner decided something)
    if (inp.stamp && seat === 0) {
      const home = this.props.info(rig, 'stamp')
      const c = (inp.t * 1000) % 1200
      const lift = 0.05 * (c < 350 ? ease(c / 350) : c < 450 ? 1 : c < 550 ? 1 - ease((c - 450) / 100) : 0)
      if (home) {
        const m = this.props.homeWorld(home.node)
        m.elements[13] += lift
        this.grip(rig, 'r', 'stamp', home.node.name, true, m, inp)
        this.sounds.stamp(inp.t, home.node.getWorldPosition(new Vector3()))
        noteTourEvent(rig.id, 2500) // the tour (#207)
      }
      return
    }
    if (goal.pose === 'coffee' && resting) {
      // press the machine's button with the index fingertip, then take the mug and drink now and then
      const cup = this.props.info(rig, 'cup')
      const pressing = u < 1.8
      if (pressing) this.button(rig, 'coffee_button', u, inp)
      else if (cup) {
        const k = ((u - 1.8) % 12) / 12
        // the first sip of the cup (기쁨)
        if (u - 1.8 > 0.7 && this.sipped.get(rig.id) !== this.arrivedAt.get(rig.id)) {
          this.sipped.set(rig.id, this.arrivedAt.get(rig.id) ?? 0)
          rig.faceEvent('joy', inp.t)
        }
        const sipping = k < 0.12 ? Math.sin((k / 0.12) * Math.PI) : 0
        const tilt = 30 * DEG * sipping
        // in front of the chest, the handle to the right; the sip tips it toward the face and lifts it 8 cm
        const q = yaw(heading).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt))
        const held = new Matrix4().compose(local(0.17, 0.98 + 0.08 * sipping, -0.26), q, ONE)
        this.grip(rig, 'r', 'cup', cup.node.name, true, held, inp)
      }
      return
    }
    // the reading errand (readRun.ts): the book from the low table to the sofa seat and back
    if (goal.pose === 'books' && goal.read) return this.readErrand(rig, goal.read, inp)
    if (goal.pose === 'books' && resting) {
      const book = this.props.info(rig, 'book')
      if (book) {
        // before the shelf the book is closed in the hand; it opens in 0.5 s and a page turns every 6 s
        // the page faces the reader (tipped up 30°), the spine runs down, the left page on the reader's left
        const face = new Vector3(0, 0.5, 0.87).applyQuaternion(yaw(heading)).normalize()
        const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, face, new Vector3().crossVectors(right, face)))
        const bob = inp.reduced ? 0 : Math.sin(t * 1.3 + seat) * 0.004
        const held = new Matrix4().compose(local(-0.02, 1.0 + bob, -0.32), q, ONE)
        const attached = this.grip(rig, 'l', 'book', book.node.name, true, held, inp)
        const tr = this.target(book.node.name, 'book', 'r')
        if (tr) {
          this.rightHand(rig, 'book', tr, this.lastObjPose)
          if (attached) this.setExtra(rig, 'l', book.node.name, (m) => this.rightHand(rig, 'book', tr, m))
        }
        const openAt = this.clocks.get(`${rig.id}:l`)?.attachedAt ?? t
        this.reading = { rig, openAt, turnAt: u }
        if (attached && tr) this.turnLeaf(rig, book.node.name, u, openAt, this.lastObjPose, inp)
      }
      return
    }
    if (goal.pose === 'post' && resting) {
      const m = this.props.info(rig, 'marker', `prop_marker_${seat % 3}`)
      if (m) {
        // writing on the whiteboard: small strokes, the wrist circling ±8°
        const board = this.sceneRef.getObjectByName('surface_whiteboard')
        const bp = board ? board.getWorldPosition(new Vector3()) : new Vector3(1.1, 1.5, -3.46)
        const sc = u > 0 ? u : 0
        const nib = new Vector3(bp.x + 0.18 * Math.sin(sc * 1.3) + 0.12 * Math.sin(sc * 4), 1.38 + 0.07 * Math.cos(sc * 1.7) + 0.03 * Math.sin(sc * 5), bp.z + 0.004)
        const held = this.writing(nib, new Vector3(0, 0, 1), 0.06, 45 * DEG, 8 * DEG * Math.sin(sc * 5))
        this.grip(rig, 'r', 'marker', m.node.name, u > 0.2, held, inp)
      }
      return
    }
    if (((goal.pose === 'type' && inp.tablet) || goal.pose === 'write') && seat === 2 && resting) {
      const pen = this.props.info(rig, 'tablet_pen')
      const tab = this.nodes.desk_2_tablet
      if (pen && tab) {
        const c = tab.getWorldPosition(new Vector3())
        const sc = Math.max(0, u)
        const nib = new Vector3(c.x + 0.05 * Math.sin(sc * 1.1) + 0.02 * Math.sin(sc * 4), c.y + 0.005, c.z + 0.04 * Math.cos(sc * 0.8) + 0.02 * Math.cos(sc * 5))
        const held = this.writing(nib, fwd.clone().negate(), 0.071, 45 * DEG, 8 * DEG * Math.sin(sc * 5))
        this.grip(rig, 'r', 'tablet_pen', pen.node.name, true, held, inp)
        // the other hand keeps typing: the left types, the right holds the pen
        if (goal.pose === 'type') this.typeAtDesk(rig, inp, seat, true)
      }
      return
    }
    if (goal.pose === 'idle' && resting && goal.spot === `work_${seat}` && (seat === 0 || seat === 1 || seat === 3 || seat === 4)) {
      this.grip(rig, 'r', 'mouse', `desk_${seat}_mouse`, true, null, inp)
    }
    if (goal.pose === 'type' && resting) this.typeAtDesk(rig, inp, seat, false)
  }

  /**
   * Working at the desk (#225): the hands type what the schedule says, the right hand now and then goes to the mouse (the grip stage of the
   * mouse, blended with the keyboard hand), clicks and scrolls. `leftOnly`: the right hand holds the tablet pen.
   */
  private typeAtDesk(rig: AgentRig, inp: StageIn, seat: number, leftOnly: boolean) {
    // a plane gesture owns the hands while it lasts
    if (rig.gesture && inp.t < rig.gesture.until) return
    const ty = this.typist
    const t = ty.frozen[rig.id] ?? inp.t
    const frame = ty.step(rig, seat, {
      t,
      dt: inp.dt,
      reduced: inp.reduced,
      activity: inp.status[rig.id]?.activity,
      dilation: rig.gestureMin > 0 ? rig.gestureMin / 0.15 : 1,
      still: rig.ambient === 0,
      leftOnly,
      hasMouse: seat !== 2,
    })
    if (!frame) return
    this.typed.add(rig.id)
    ty.warm(rig, seat, 1.5, inp.reduced)
    if (leftOnly || seat === 2) return
    this.grip(rig, 'r', 'mouse', `desk_${seat}_mouse`, frame.mouseWant, null, inp)
    ty.mouseBlend(rig, seat, frame, rig.drive.r !== frame.kb ? rig.drive.r : null, t, inp.reduced)
  }

  /**
   * The watering errand (#228, waterRun.ts decides the stage and how long it has lasted; this only draws it). The hand takes hold of the can
   * where it rests, with the body standing beside it (lift), carries it at its side (carry, return), tips it over the plant (pour) and
   * lowers it to exactly where it rests before it lets go (put). The can is never moved by anything but the hand.
   */
  private errand(rig: AgentRig, goal: Goal, inp: StageIn) {
    const w = goal.water
    const can = this.props.info(rig, 'watering_can')
    if (!w || !can) return
    const lv = levelFor(inp.speed ?? 1, inp.reduced)
    const root = rig.parts.root
    const x = root.position.x
    const z = root.position.z
    const heading = rig.heading
    const home = this.props.homeWorld(can.node)
    const plant = this.plants.find((p) => p.name === w.plant) ?? this.plants[0]
    const habitS = habitSeconds(w.habit)
    // the weight of it (watering.md 2): the body dips 3 cm as the hand takes the can and comes up with it, the wrist sags 5° and recovers, and while it is carried it swings a little with each step
    let sag = 0
    if (lv.body) {
      if (w.stage === 'lift') {
        rig.bodyDip = WEIGHT_DIP_M * Math.sin(Math.PI * Math.min(1, w.u / WATER_S.lift))
        sag = WRIST_SAG * ease((w.u - 0.35) / 0.4)
      } else if (w.stage === 'carry') sag = WRIST_SAG * (1 - ease(w.u / 0.5))
      if (w.stage === 'carry' || w.stage === 'return') sag += this.carrySway(rig, inp)
    }
    const carrying = canPose(x, z, heading, CARRY_HOLD, sag)
    let want = true
    let held: Matrix4 = carrying
    let hands = 0
    let flow = 0
    // walking to the can, or (reduced motion) to the plant: the hands are free
    if (w.stage === 'fetch' || (w.stage === 'carry' && inp.reduced)) return
    if (w.stage === 'lift') rig.headExtra.pitch = -0.2
    else if (w.stage === 'pour') {
      const pr = pourAt(plant.name, w.u, habitS)
      const pour = this.spoutLocal ? solvePour(plant, x, z, heading, this.spoutLocal) : null
      // the spout circles the stem while it pours (4 cm, less over a small pot), the wrist turns twice to shake off the last drops
      const circ = lv.body ? circleAt(plant.name, plant.r, w.u) : { fwd: 0, lat: 0 }
      const ph = pour?.hold ?? HOLD_DEFAULT
      held = canPose(x, z, heading, lerpHold(CARRY_HOLD, { fwd: ph.fwd + circ.fwd, lat: ph.lat + circ.lat, y: ph.y }, pr.hold), pr.tilt + (inp.reduced ? 0 : shakeAt(plant.name, w.u, lv.shakes) / POUR_TILT))
      hands = pr.hold
      flow = flowAt(plant.name, w.u, habitS)
      // it steps in to the pot: the body leans toward it (10°, about 5 cm) and the head bows 15°
      if (lv.body) {
        rig.leanOver(-Math.sin(heading) * LEAN_IN_M * pr.hold, -Math.cos(heading) * LEAN_IN_M * pr.hold)
        rig.headExtra.pitch = -0.26 * pr.hold
      }
    } else if (w.stage === 'put') {
      const dur = Math.max(WATER_S.lower, rig.gestureMin)
      rig.headExtra.pitch = -0.2
      if (inp.reduced) {
        // reduced motion: the can is just gone from the hand, back where it rests
        want = false
        home.decompose(can.node.position, can.node.quaternion, new Vector3())
      } else if (w.u < dur + 0.06) held = blend(carrying, home, ease(Math.min(1, w.u / dur))) // exactly at rest for the last frames in the hand
      else want = false
    }
    const attached = this.grip(rig, 'r', 'watering_can', can.node.name, want, held, inp)
    // the left hand supports the can's belly while it pours, following it (grip_l), fading in and out with the settle
    const tl = this.target(can.node.name, 'watering_can', 'l')
    if (tl && hands > 0) this.partner(rig, 'watering_can', 'l', tl, this.lastObjPose, 'r', hands)
    // the plant-side habit (watering.md 4), once the can is upright and shaken: the other hand or the head, over the habit's own 0.7 s
    const hu = w.stage === 'pour' && lv.body ? habitU(plant.name, w.habit, w.u) : null
    if (hu !== null && w.habit) this.habit(rig, plant, w.habit, hu, habitEnv(hu, habitS), inp)
    this.pouring = attached && w.stage === 'pour' ? { rig, held, plant, flow, u: w.u, shakes: lv.shakes } : null
  }

  /** the can swings a little with each step while it is carried (watering.md 2: ±3° per step); how much follows how fast the body moves */
  private carrySway(rig: AgentRig, inp: StageIn) {
    const root = rig.parts.root
    const m = this.carryAmp.get(rig.id) ?? { x: root.position.x, z: root.position.z, amp: 0 }
    const v = Math.hypot(root.position.x - m.x, root.position.z - m.z) / Math.max(inp.dt, 1e-3)
    m.x = root.position.x
    m.z = root.position.z
    m.amp += (Math.min(1, v / 0.4) - m.amp) * (1 - Math.exp(-inp.dt / 0.15))
    this.carryAmp.set(rig.id, m)
    return ((3 * DEG) / POUR_TILT) * m.amp * Math.sin(inp.t * Math.PI * 2 * 1.8)
  }

  /**
   * The reading errand (#280, readRun.ts decides the stage and how long it has lasted; this only draws it). The left hand takes the CLOSED book where it rests on the low
   * table (pick: the bake's prop_book_grip_l, thumb on the edge, grip kind bookclosed) and carries it closed at the chest (carry, return: the body's own height, so
   * seated it is lower). Once seated it opens to 150° (READ_S.open) while the hand moves from the closed grip to the reading grip and the right hand comes
   * to the other cover (both blended, nothing jumps), and a leaf turns every 6 s; READ_S.close before the end it closes again and the hands go back to the closed grip.
   * Put: lowered closed to exactly where it rests before the hand lets go. The book is never moved by anything but the hand.
   */
  private readErrand(rig: AgentRig, r: NonNullable<Goal['read']>, inp: StageIn) {
    if (r.stage === 'fetch') return
    const book = this.props.info(rig, 'book')
    if (!book) return
    const t = inp.t
    const name = book.node.name
    const seat = Number(rig.id.split('_')[1])
    const root = rig.parts.root
    const yaw = new Quaternion().setFromAxisAngle(UP, rig.heading)
    const right = new Vector3(Math.cos(rig.heading), 0, -Math.sin(rig.heading))
    // the cover faces the reader (tipped up 30°), the spine runs down; at the chest of the body as it is now (sitting lowers it)
    const face = new Vector3(0, 0.5, 0.87).applyQuaternion(yaw).normalize()
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, face, new Vector3().crossVectors(right, face)))
    const drop = rig.parts.head.position.y - rig.parts.headRestY
    const bob = inp.reduced ? 0 : Math.sin(t * 1.3 + seat) * 0.004
    // seated it comes down into the lap and a little out (READ_HOLD, #395), as far as the body has sat
    const sat = Math.min(1, Math.max(0, -drop / READ_HOLD.sitM))
    const carrying = new Matrix4().compose(root.localToWorld(new Vector3(-0.02, 1.0 + drop + bob - READ_HOLD.down * sat, -0.32 - READ_HOLD.forward * sat)), q, ONE)
    let held = carrying
    let want = true
    if (r.stage === 'put') {
      const dur = Math.max(READ_S.lower, rig.gestureMin)
      const k = inp.reduced ? 1 : ease(Math.min(1, r.u / dur))
      held = blend(carrying, this.props.homeWorld(book.node), k)
      // exactly at rest for the last frames in the hand
      if (r.u >= dur + 0.06) want = false
    }
    // how far the book is open: 0 closed (every stage but reading), 1 open (the middle of the reading)
    const closeFrom = READ_S.read - READ_S.close
    const w = r.stage !== 'read' ? 0 : r.u < READ_S.open ? ease(r.u / READ_S.open) : r.u > closeFrom ? 1 - ease((r.u - closeFrom) / READ_S.close) : 1
    // the left hand: the closed grip, and (while the book is open at all) the reading grip mixed in by w
    const attached = this.grip(rig, 'l', 'bookclosed', name, want, held, inp)
    const shut = rig.drive.l
    if (w > 0 && shut?.target && shut.angles) {
      const a = { target: shut.target.clone(), angles: [...shut.angles], w: shut.w, wc: shut.wc }
      this.grip(rig, 'l', 'book', name, want, held, inp)
      const op = rig.drive.l
      if (op?.target && op.angles) rig.drive.l = { ...op, target: blend(a.target, op.target, w), angles: op.angles.map((x, i) => a.angles[i] * (1 - w) + x * w), w: a.w * (1 - w) + op.w * w, wc: a.wc * (1 - w) + op.wc * w }
    }
    const tr = this.target(name, 'book', 'r')
    if (tr && w > 0) this.partner(rig, 'book', 'r', tr, this.lastObjPose, 'l', w)
    this.reading = r.stage === 'read' ? { rig, openAt: t - r.u, turnAt: r.u, closeAt: t - (r.u - closeFrom) } : null
    if (attached && tr && w >= 1) this.turnLeaf(rig, name, r.u, t - r.u, this.lastObjPose, inp)
    else this.hideLeaf()
  }

  private setExtra(rig: AgentRig, side: 'l' | 'r', objName: string, fn: (pose: Matrix4) => void) {
    // the carry entry of the hand that holds the prop (water: the right hand, the book: the left)
    const e = [...this.carry.values()].find((x) => x.rig === rig && x.objName === objName && x.side === (side === 'r' ? 'r' : 'l'))
    if (e) e.extra = fn
  }

  private pouring: { rig: AgentRig; held: Matrix4; plant: Plant; flow: number; u: number; shakes: number } | null = null
  private carryAmp = new Map<string, { x: number; z: number; amp: number }>()
  /** the spout node in the can's frame (water.ts: +z = the water's direction) */
  private spoutLocal: Matrix4 | null = null
  private plants: Plant[] = PLANTS
  private reading: { rig: AgentRig; openAt: number; turnAt: number; closeAt?: number } | null = null

  /** the other hand of a two-handed hold: it goes to the object with the first hand's stages (reach, pre-grip, close, hold, let go) */
  private partner(rig: AgentRig, kind: string, side: 'l' | 'r', tgt: GripTarget, objPose: Matrix4, primary: 'l' | 'r', scale = 1) {
    const out = this.clock(rig.id + ':' + primary).current
    if (out.stage === 'rest') return
    const spec = GRIPS[kind][side]!
    const hand = rig.parts.hands[side]
    const seat = Number(rig.id.split('_')[1])
    const target = handFor(objPose, tgt.pg, handGripMatrix(hand)).multiply(offsetOf(tgt.key, seat))
    const hold = tgt.contacts.length ? this.holdFit(rig, side, tgt).hold : rig.curlVec(side, spec.hold)
    rig.drive[side] = { target, w: out.wHand * scale, curl: null, angles: mixVec(rig.curlVec(side, spec.pre), hold, rig.curlVec(side, spec.after), out.mix), wc: out.wCurl * scale, spread: null }
  }
  private rightHand(rig: AgentRig, kind: string, tgt: GripTarget, objPose: Matrix4) {
    this.partner(rig, kind, 'r', tgt, objPose, 'l')
  }

  /** the coffee machine's button: the index fingertip on its contact point, pressed 0.1 s */
  private button(rig: AgentRig, name: string, u: number, inp: StageIn, holdS = 0.1, depth = 0.012) {
    const contact = this.sceneRef.getObjectByName(`${name}_contact_index`)
    if (!contact) return
    const clock = this.clock(`${rig.id}:r:button`)
    const out = clock.step(inp.t, true, { gestureMin: rig.gestureMin, reduced: inp.reduced })
    const hand = rig.parts.hands.r
    const idx = fingerModelOf(hand, 0, 'r')
    if (!idx) return
    const spec = GRIPS.button.r!
    const m = contact.matrixWorld
    const P = new Vector3().setFromMatrixPosition(m)
    const n = contactNormal(this.sceneRef, contact) // out of the button, toward the hand
    const pressed = u > 0.5 && u < 0.5 + holdS
    const press = pressed ? depth : 0
    // the hand points in along −n, palm down
    const y = n.clone().negate()
    const z = UP.clone().negate()
    const x = new Vector3().crossVectors(y, z).normalize()
    z.crossVectors(x, y)
    const c1 = spec.hold[0] + (pressed ? 0.07 : 0)
    const tip = tipAt(idx, c1, 0)
    const basis = new Matrix4().makeBasis(x, y, z)
    const origin = P.clone().addScaledVector(n, press).sub(tip.clone().applyMatrix4(new Matrix4().extractRotation(basis)))
    const target = basis.clone().setPosition(origin)
    const curl = [0, 1, 2, 3, 4, 5].map((k) => spec.pre[k] * out.mix[0] + (k === 0 ? c1 : spec.hold[k]) * out.mix[1] + spec.after[k] * out.mix[2])
    rig.drive.r = { target, w: out.wHand, curl, wc: out.wCurl, spread: null }
  }

  /**
   * The other hand's habit at the plant (watering.md 4), over its own 0.7 – 0.8 s: 메모 pokes the soil with a finger and nods, 메시 tips the head and looks the plant
   * over, 휴 strokes a leaf with a fingertip, 루프 taps the pot twice, 에코 tips the head to listen. `env` fades it in and out (the can stays in the right hand).
   */
  private habit(rig: AgentRig, plant: Plant, kind: HabitKind, s: number, env: number, inp: StageIn) {
    const len = habitSeconds(kind)
    const k = s / len
    const fwd = new Vector3(-Math.sin(rig.heading), 0, -Math.cos(rig.heading))
    const right = new Vector3(Math.cos(rig.heading), 0, -Math.sin(rig.heading))
    const centre = new Vector3(plant.x, plant.soilY, plant.z)
    if (kind === 'listen') rig.headExtra.roll += 10 * DEG * env
    else if (kind === 'look') {
      rig.headExtra.roll += 8 * DEG * env
      rig.headExtra.pitch += 0.3 * Math.sin(k * Math.PI * 2) * env
    } else if (kind === 'poke') {
      rig.headExtra.pitch += -2 * DEG * Math.sin(k * Math.PI) * env
      // the fingertip comes down on the soil's near side, left of the stem, and presses
      const down = Math.sin(Math.PI * Math.min(1, Math.max(0, (k - 0.25) / 0.4)))
      this.fingerTouch(rig, centre.clone().addScaledVector(fwd, -0.45 * plant.r).addScaledVector(right, -0.4 * plant.r).add(new Vector3(0, 0.045 * (1 - down), 0)), fwd, down > 0.8, env)
    } else if (kind === 'tap') {
      // twice on the pot's side, 0.15 s each
      const ph = Math.min(1, Math.max(0, (k - 0.15) / 0.7))
      const lift = 0.025 * (1 - Math.abs(Math.sin(ph * Math.PI * 2)))
      const rim = plant.r + 0.035
      this.fingerTouch(rig, centre.clone().addScaledVector(fwd, -rim).addScaledVector(right, -0.03).add(new Vector3(0, -0.035 + lift, 0)), fwd, lift < 0.004, env)
    } else if (kind === 'leaf' && this.fx) {
      // the leaf tip nearest the body, brushed a little sideways; the hand stays within an arm of the chest
      const root = rig.parts.root.position
      let best: Vector3 | null = null
      for (let i = 0; i < 3; i++) {
        const t = this.fx.tipOf(plant.name, i)
        if (t && (!best || Math.hypot(t.x - root.x, t.z - root.z) < Math.hypot(best.x - root.x, best.z - root.z))) best = t
      }
      if (!best) return
      const chest = new Vector3(root.x, 1.0, root.z)
      const rel = best.sub(chest)
      if (rel.length() > 0.55) rel.setLength(0.55)
      this.fingerTouch(rig, chest.add(rel).addScaledVector(right, 0.015 * Math.sin(k * Math.PI * 3)).add(new Vector3(0, -0.02, 0)), fwd, false, env)
    }
    void inp
  }

  /** the left index fingertip on a point, the hand pointing along `dir` (and a little down), palm down; blended with whatever the hand does now by `env` */
  private fingerTouch(rig: AgentRig, point: Vector3, dir: Vector3, press: boolean, env: number) {
    const hand = rig.parts.hands.l
    const idx = fingerModelOf(hand, 0, 'l')
    if (!idx) return
    const spec = GRIPS.button.r!
    const y = dir.clone().multiplyScalar(0.8).addScaledVector(UP, -0.6).normalize()
    const z = UP.clone().negate()
    const x = new Vector3().crossVectors(y, z).normalize()
    z.crossVectors(x, y)
    const c1 = spec.hold[0] + (press ? 0.07 : 0)
    const tip = tipAt(idx, c1, 0)
    const basis = new Matrix4().makeBasis(x, y, z)
    const origin = point.clone().sub(tip.clone().applyMatrix4(new Matrix4().extractRotation(basis)))
    const target = basis.clone().setPosition(origin)
    const prev = rig.drive.l
    const curl = [0, 1, 2, 3, 4, 5].map((k) => (k === 0 ? c1 : spec.hold[k]))
    const touch = env > 0.5
    rig.drive.l = {
      target: prev?.target ? blend(prev.target, target, env) : target,
      w: prev ? prev.w * (1 - env) + env : env,
      curl: touch ? curl : null,
      angles: touch ? undefined : prev?.angles,
      wc: prev ? prev.wc * (1 - env) + env : env,
      spread: null,
    }
  }

  // ------------------------------------------------------------------------------------------- the book and the water

  private book(inp: StageIn) {
    const h = this.bookHalves
    if (!h) return
    const r = this.reading
    this.reading = null
    // the halves do not turn on their own after the opening: a page is one leaf (turnLeaf). Open = 150°: the upper half lies at π − LIFT, the lower one is lifted by LIFT
    if (!r) this.hideLeaf()
    if (!r || inp.reduced) {
      // closed on its shelf, or (reduced motion) open without the turning
      const shut = !r || (r.closeAt !== undefined && inp.t >= r.closeAt)
      h.l.rotation.z = shut ? 0 : halfAngle('l')
      h.r.rotation.z = shut ? 0 : halfAngle('r')
      return
    }
    // it closes in the hand before it is put down (readErrand: closeAt)
    const open = ease((inp.t - r.openAt) / 0.5) * (r.closeAt === undefined ? 1 : 1 - ease((inp.t - r.closeAt) / READ_S.close))
    h.l.rotation.z = halfAngle('l') * open
    h.r.rotation.z = LIFT * open
  }

  private hideLeaf() {
    const lf = this.leaf
    if (!lf) return
    lf.node.visible = false
    if (lf.theta !== 0) lf.set(0)
  }

  /**
   * One leaf turns every 6 s (grips.md "한 장 넘기기"; the timeline of bookLeaf.ts leafAngle). The right thumb and index go to the leaf's lower (baked)
   * corner along an arc that keeps them out of the book (lead, 0.2 s) while the corner lifts, take it, and turn it 0 → 150° about the spine (on the lifted page) in
   * 0.75 s with the outer third lagging (LeafBend); the hand follows the leaf's own corner frame, so what is fitted (thumb on its top face,
   * index under it) is what is shown. Half way through the turn (PINCH_LET_GO: the index is under the leaf, which must not land on it) the hand lets go
   * and goes home along the same arc (0.3 s after the turn's end) while the leaf finishes lying down on the left page. Reduced motion: nothing
   * turns (the leaf stays hidden). A timelapse (rig.gestureMin) stretches each stage to at least that long, and the 6 s beat grows if the
   * stages no longer fit in it.
   */
  private turnLeaf(rig: AgentRig, bookName: string, u: number, openAt: number, pose: Matrix4, inp: StageIn) {
    const lf = this.leaf
    if (!lf) return
    const gm = inp.reduced ? 0 : rig.gestureMin
    const lead = Math.max(LEAD_S, gm)
    const dur = Math.max(TURN_S, gm)
    const back = Math.max(BACK_S, gm)
    const c = u - 1 + lead
    if (inp.reduced || inp.t - openAt < 0.5 || c < 0) return this.hideLeaf()
    const tau = (c % Math.max(6, lead + dur + back + 1)) - lead
    if (tau >= dur + back) return this.hideLeaf()
    const theta = leafAngle(tau, dur, lead)
    lf.set(theta)
    lf.node.visible = theta < OPEN_ANGLE - 1e-3
    // the hand's weight: 0 = on the reading grip, 1 = pinching. It lets go at PINCH_LET_GO of the turn (the index is under the leaf, which must not land on it)
    const go = PINCH_LET_GO * dur
    const a = tau < 0 ? ease((tau + lead) / lead) : tau < go ? 1 : 1 - ease((tau - go) / (dur + back - go))
    const drive = rig.drive.r
    if (a <= 0 || !drive?.target || !drive.angles) return
    if (!this.leafTargets.has(bookName)) this.leafTargets.set(bookName, resolveTarget(this.sceneRef, bookName, 'leaf', 'r'))
    const pt = this.leafTargets.get(bookName)
    if (!pt) return
    const seat = Number(rig.id.split('_')[1])
    lf.corner(this.mCorner, tau < go ? theta : leafAngle(go, dur, lead))
    this.mCornerWorld.copy(pose).multiply(this.mCorner)
    const target = handFor(this.mCornerWorld, pt.pg, handGripMatrix(rig.parts.hands.r)).multiply(offsetOf(pt.key, seat))
    const pinch = this.holdFit(rig, 'r', pt).hold
    drive.target = blend(drive.target, target, poseWeight(a))
    // out along the arc (book frame → world), so the fingers never cross the book
    pose.decompose(this.vPos, this.qPose, this.vScale)
    pinchArc(a, this.vArc).applyQuaternion(this.qPose)
    drive.target.elements[12] += this.vArc.x
    drive.target.elements[13] += this.vArc.y
    drive.target.elements[14] += this.vArc.z
    const fw = fingerWeight(a)
    drive.angles = drive.angles.map((x, i) => x * (1 - fw) + pinch[i] * fw)
  }

  private water(inp: StageIn) {
    const dr = this.drops
    const fx = this.fx
    const p = this.pouring
    this.pouring = null
    if (!dr || !fx) return
    // the office clock's step: the stream, the soil and the leaves run on it, so the speed only covers more clock per frame
    const dt = this.fxT < 0 ? 0 : Math.min(0.5, Math.max(0, inp.t - this.fxT))
    this.fxT = inp.t
    const lv = levelFor(inp.speed ?? 1, inp.reduced)
    let tipNow: Vector3 | null = null
    if (p && this.spoutLocal) {
      const { tip, dir } = spoutOf(p.held, this.spoutLocal)
      tipNow = tip
      fx.frame(dt, { plant: p.plant, tip, dir, flow: p.flow, u: p.u, shakes: p.shakes }, lv)
    } else fx.frame(dt, null, lv)
    // the can's own sound while water runs (the cue water, 3 s renewed)
    const running = !!tipNow && !!p && p.flow > 0.05 && !inp.reduced
    this.sounds.water(running, inp.t, running ? tipNow : null)
    // the water dispenser's tap pours the same way (loungeActs.ts; its own sound is the cue dispenser.pour), when the can is not using the drops
    const tap = this.lounge.stream()
    if (tap && !fx.busy && !running) this.drops_(dr, tap.tip, tap.dir, tap.soilY, inp)
  }

  private drops_(dr: InstancedMesh, tip: Vector3, dir: Vector3, soilY: number, inp: StageIn) {
    const hit = landing(tip, dir, soilY)
    const m = new Matrix4()
    const pos = new Vector3()
    const life = hit ? hit.tau : 0.4
    let n = 0
    const cap = Math.min(28, dr.instanceMatrix.count)
    for (let i = 0; i < cap; i++) {
      const tau = (((inp.t + (i / cap) * life) % life) + life) % life
      dropAt(tip, dir, tau, pos)
      m.makeTranslation(pos.x, pos.y, pos.z)
      dr.setMatrixAt(n++, m)
    }
    dr.count = n
    dr.instanceMatrix.needsUpdate = true
  }
}

