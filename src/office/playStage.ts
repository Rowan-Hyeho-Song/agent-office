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
import { GRIPS, GripClock, STONE_H, STONE_PITCH, STONE_PITCH_FLAT, handFor, stoneGrip, stoneRoll, tipAt, type Curl, type StoneGrip } from './grip'
import { contactNormal, fitFingers, handGripMatrix, offsetOf, resolveTarget, type GripTarget } from './gripTargets'
import { fingerModelOf, type AgentRig, type PropBank } from './rig'
import { meshesOf } from './nodes'
import type { StatusMap } from './status'
import { gameAt, N, type OmokView } from '../play/omok'
import { rallyAt, type Dims, type Rally } from '../play/pingpong'
import { HOLD_DEFAULT, PLANTS, canPose, dropAt, landing, plantAhead, plantsFrom, solvePour, spoutOf, type Plant } from './water'
import { type Place, ease, followWeight, habitOf, placeSequence, swingTilt, swingTravel } from '../play/choreo'
import { sessionsAt, sessionTime, type PlaySession } from '../play/session'

const UP = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
const ONE = new Vector3(1, 1, 1)

/** the table tennis table the model has (pp_table extras size / net_h) with the engine's default reach */
const dimsOf = (size: number[], netH: number): Dims => ({ L: size[0], W: size[1], netH, ballR: 0.02, reach: 0.25, floorY: -0.76 })
/** the blade's centre above the paddle node's origin, along its y */
const BLADE_Y = 0.175
/** ball centre to the paddle face at contact: the ball radius and half the blade */
const FACE_GAP = 0.023
/** the held object rises from where it rests to where it is held in this long, s */
const LIFT_S = 0.35
/** carrying a prop back to where it rests, s */
const PUT_S = 0.4

export interface StageIn {
  /** office time, ms */
  now: number
  /** the clock the rigs' own animation runs on, s (the scene clock in the timelapse) */
  t: number
  dt: number
  reduced: boolean
  replaying: boolean
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

export class PlayStage {
  private clocks = new Map<string, GripClock>()
  private targets = new Map<string, GripTarget | null>()
  private fits = new Map<string, { curl: number[]; spread: number[] } | null>()
  private lastHand = new Map<string, Matrix4>()
  private forced = new Set<Object3D>()
  private arrivedAt = new Map<string, number>()
  /** what each hand carries: when its activity ends the hand puts the prop back where it came from, then lets go (no prop moves on its own) */
  private carry = new Map<string, { rig: AgentRig; side: 'l' | 'r'; kind: string; objName: string; prefer?: string; held: Matrix4; seen: boolean; putStart: number | null; extra: ((pose: Matrix4) => void) | null }>()

  // ping-pong
  private tableNode: Object3D | undefined
  private dims: Dims = dimsOf([2.05, 1.14], 0.15)
  private ball: Object3D | undefined
  private ballHome = new Vector3()
  private shadow: Mesh
  private paddlePos = new Map<string, Vector3>()
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
  /** each mover's place sequence of this frame (tests read it) */
  readonly lastPlace: Record<string, Place> = {}
  private stoneFrames = new Map<string, StoneGrip[]>()

  // water and the book
  private drops: InstancedMesh | null = null
  private spout: Object3D | undefined
  private bookHalves: { l: Object3D; r: Object3D } | null = null

  private sceneRef: Object3D

  constructor(
    scene: Object3D,
    private nodes: Record<string, Object3D>,
    private props: PropBank,
  ) {
    this.sceneRef = scene
    scene.updateMatrixWorld(true)
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
    const drops = new InstancedMesh(new SphereGeometry(0.003, 6, 5), new MeshBasicMaterial({ color: '#9bd8ff' }), 28)
    drops.count = 0
    drops.frustumCulled = false
    scene.add(drops)
    this.drops = drops
    const book = nodes.prop_book
    const l = nodes.prop_book_l
    const r = nodes.prop_book_r
    if (book && l && r) {
      book.attach(l)
      book.attach(r)
      this.bookHalves = { l, r }
    }
  }

  // ------------------------------------------------------------------------------------------------ the grip itself

  private clock(key: string) {
    let c = this.clocks.get(key)
    if (!c) this.clocks.set(key, (c = new GripClock()))
    return c
  }

  private target(objName: string, kind: string, side: 'l' | 'r') {
    const key = `${objName}:${side}`
    if (!this.targets.has(key)) this.targets.set(key, resolveTarget(this.sceneRef, objName, kind, side))
    return this.targets.get(key)!
  }

  /** the finger values at the closed stage for this hand and object: the table's, each touching finger bent onto its contact */
  private holdFit(rig: AgentRig, side: 'l' | 'r', t: GripTarget) {
    const seat = Number(rig.id.split('_')[1])
    const key = `${t.key}:${seat}`
    if (!this.fits.has(key)) {
      const spec = GRIPS[t.kind][side]!
      const curl = [...spec.hold]
      const spread = [0, 0, 0, 0]
      const fits = fitFingers(t, rig.parts.hands[side], offsetOf(t.key, seat))
      for (const f of fits) {
        const k = ['index', 'middle', 'ring', 'little'].indexOf(f.finger)
        if (f.finger === 'thumb') {
          curl[4] = f.a
          curl[5] = f.b
        } else {
          curl[k] = f.a
          spread[k] = f.b
        }
      }
      this.fits.set(key, { curl, spread })
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
    const o = { gestureMin: rig.gestureMin, reduced: inp.reduced }
    const out = clock.step(inp.t, want && rig.visible, o)
    if (!spec || !tgt) {
      // a model without the grip empties: the old way, the prop in the hand's grip
      if (out.attached && !tgt) rig.want = { kind, side, prefer }
      return false
    }
    const hand = rig.parts.hands[side]
    const info = tgt.obj ? this.props.info(rig, kind, prefer ?? objName) : null
    const home = tgt.obj ? this.props.homeWorld(tgt.obj) : new Matrix4()
    let pose = home
    if (out.attached && held) pose = blend(home, held, ease((inp.t - (clock.attachedAt ?? inp.t)) / Math.max(LIFT_S, rig.gestureMin)))
    else if (out.attached && !tgt.obj) pose = held ?? home
    const seat = Number(rig.id.split('_')[1])
    const target = handFor(pose, tgt.pg, handGripMatrix(hand)).multiply(offsetOf(tgt.key, seat))
    const lastKey = `${key}:${objName}`
    if (out.stage === 'release') {
      const last = this.lastHand.get(lastKey)
      if (last) target.copy(last)
    } else if (out.stage !== 'rest') this.lastHand.set(lastKey, target.clone())
    if (out.stage === 'rest') return false
    const fit = this.holdFit(rig, side, tgt)
    const hold = fit.curl as unknown as Curl
    const curl = [0, 1, 2, 3, 4, 5].map((k) => spec.pre[k] * out.mix[0] + hold[k] * out.mix[1] + spec.after[k] * out.mix[2])
    rig.drive[side] = { target, w: out.wHand, curl, wc: out.wCurl, spread: fit.spread.map((s) => s * out.mix[1]) }
    if (tgt.obj && info) {
      rig.want = { kind, side: 'r' === side || kind !== 'book' ? side : side, prefer: prefer ?? objName, attached: out.attached }
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
        if (kk < 1) {
          const pose = blend(e.held, this.props.homeWorld(obj), ease(kk))
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
    this.tag = null
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
    const sessions = inp.forcedSessions?.length ? inp.forcedSessions : inp.replaying ? [] : sessionsAt(inp.now, ids, busy)
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
    for (const id of ids) this.solo(inp.rigs[id], inp.goals[id], inp, pp, og)
    this.demo(inp)
    this.putBack(inp)
    for (const id of ids) {
      inp.rigs[id].applyDrive('l')
      inp.rigs[id].applyDrive('r')
    }
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
      const ready = new Vector3(planeX + dir * 0.12, 0.2, 0)
      const key = `${s.players[side]}`
      let st = this.paddlePos.get(key)
      if (!st) this.paddlePos.set(key, (st = ready.clone()))
      const pos = new Vector3()
      let tilt = 0
      const sw = rally.swing && rally.swing.side === side ? rally.swing : null
      const b = playing && rally.ballPos ? rally.ballPos : null
      let w = 0
      const goal = ready.clone()
      if (sw) {
        w = 1
        goal.set(sw.at[0] - dir * FACE_GAP, sw.at[1], sw.at[2])
      } else if (b && rally.hitter !== side) {
        w = followWeight(Math.abs(b[0] - planeX))
        goal.set(b[0] - dir * FACE_GAP, b[1], b[2])
      }
      goal.y = Math.max(goal.y, 0.08)
      goal.z = Math.max(-d.W! / 2 - 0.3, Math.min(d.W! / 2 + 0.3, goal.z))
      if (w > 0.001) {
        pos.copy(st).lerp(goal, w)
        st.copy(pos)
      } else {
        st.lerp(ready, 1 - Math.exp(-8 * inp.dt))
        pos.copy(st)
      }
      if (sw) {
        pos.x += dir * swingTravel(sw.t01)
        tilt = swingTilt(sw.t01)
      }
      // the face looks along the hit direction, tipped up a little (and over the swing)
      const z = new Vector3(dir, 0.12 + tilt * 0.3, 0).normalize()
      const y = UP.clone().addScaledVector(z, -UP.dot(z)).normalize()
      const x = new Vector3().crossVectors(y, z)
      const worldBlade = this.tableWorld([pos.x, pos.y, pos.z])
      const held = frame(x, y, z, worldBlade.addScaledVector(y, -BLADE_Y))
      this.grip(rig, 'r', 'paddle', `prop_paddle_${side === 0 ? 'a' : 'b'}`, true, held, inp, `prop_paddle_${side === 0 ? 'a' : 'b'}`)
    }
    // the tag over the net for 2 s after a point: the score, as the server's side reads it
    const before = playing ? rallyAt(s.seed, s.players, tMs - 2000, d, true) : null
    if (playing && before && (before.score[0] !== rally.score[0] || before.score[1] !== rally.score[1]) && before.game === rally.game)
      this.tag = { text: `${rally.score[0]} : ${rally.score[1]}`, at: this.tableWorld([0, d.netH! + 0.35, 0]) }
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
      const roll = stoneRoll(models, top, { index: hold[0], middle: hold[1] })
      // carrying: the hand pitched 40°; sliding in it lays flatter (30°)
      // a fit every 2° from the carrying pitch to the flat one; the wrist is blended between neighbours so the tips stay on the stone throughout
      f = Array.from({ length: 11 }, (_, k) => stoneGrip(models, top, { index: hold[0], middle: hold[1] }, STONE_PITCH + ((STONE_PITCH_FLAT - STONE_PITCH) * k) / 10, roll))
      this.stoneFrames.set(rig.id, f)
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
    const bowlBottom = bowl.contact.clone().addScaledVector(UP, -STONE_H)
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
    const curl = [0, 1, 2, 3, 4, 5].map((k) => {
      const held = k === 0 ? mix(sf[f0].index.a, sf[f0 + 1].index.a) : k === 1 ? mix(sf[f0].middle.a, sf[f0 + 1].middle.a) + 0.02 * p.press : spec.hold[k]
      // the pick is a thumb + index pinch; the arc re-grips it into the go grip
      const pinch = [0.6, 0.25, 0.3, 0.35, 0.15, 0.7][k]
      const grip = pinch + (held - pinch) * p.regrip
      const closed = spec.pre[k] + (grip - spec.pre[k]) * p.close
      return closed + (spec.after[k] - closed) * free(k === 5 || k === 4 ? 2 : k)
    })
    rig.drive[side] = { target: hand, w: p.w, curl, wc: p.w, spread: [mix(sf[f0].index.b, sf[f0 + 1].index.b) * p.close * (1 - p.freeRest), mix(sf[f0].middle.b, sf[f0 + 1].middle.b) * p.close * (1 - p.freeMiddle), 0, 0] }
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
    // the planner's stamp (the owner decided something)
    if (inp.stamp && seat === 0) {
      const home = this.props.info(rig, 'stamp')
      const c = (inp.t * 1000) % 1200
      const lift = 0.05 * (c < 350 ? ease(c / 350) : c < 450 ? 1 : c < 550 ? 1 - ease((c - 450) / 100) : 0)
      if (home) {
        const m = this.props.homeWorld(home.node)
        m.elements[13] += lift
        this.grip(rig, 'r', 'stamp', home.node.name, true, m, inp)
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
        const sipping = k < 0.12 ? Math.sin((k / 0.12) * Math.PI) : 0
        const tilt = 30 * DEG * sipping
        // in front of the chest, the handle to the right; the sip tips it toward the face and lifts it 8 cm
        const q = yaw(heading).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt))
        const held = new Matrix4().compose(local(0.17, 0.98 + 0.08 * sipping, -0.26), q, ONE)
        this.grip(rig, 'r', 'cup', cup.node.name, true, held, inp)
      }
      return
    }
    if (goal.pose === 'water' && resting) {
      const can = this.props.info(rig, 'watering_can')
      if (can) {
        // 0.6 s to tip 30°, held 1.5 s, back in 0.6 s, a rest, every 7 s
        const c = u % 7
        const tilt = c < 0.6 ? ease(c / 0.6) : c < 2.1 ? 1 : c < 2.7 ? 1 - ease((c - 2.1) / 0.6) : 0
        // the can is held where the stream from its spout lands on the soil of the plant in front (water.ts)
        const plant = plantAhead(rig.x, rig.z, heading, 1.6, this.plants) ?? this.plants[0]
        const pour = this.spoutLocal ? solvePour(plant, rig.x, rig.z, heading, this.spoutLocal) : null
        const held = canPose(rig.x, rig.z, heading, pour?.hold ?? HOLD_DEFAULT, tilt)
        const attached = this.grip(rig, 'r', 'watering_can', can.node.name, true, held, inp)
        const gl = this.props.info(rig, 'watering_can')
        void gl
        // the left hand carries the can's belly (grip_l), following it
        if (attached) {
          const tl = this.target(can.node.name, 'watering_can', 'l')
          if (tl) {
            this.leftHand(rig, 'watering_can', tl, held, can.node.name, inp)
            this.setExtra(rig, 'r', can.node.name, (m) => this.leftHand(rig, 'watering_can', tl, m, can.node.name, inp))
          }
        }
        this.pouring = { on: attached && tilt > 0.5 && !inp.reduced, rig, held, soilY: plant.soilY }
      }
      return
    }
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
        if (attached) {
          const tr = this.target(book.node.name, 'book', 'r')
          if (tr) {
            this.rightHand(rig, 'book', tr, held, inp)
            this.setExtra(rig, 'l', book.node.name, (m) => this.rightHand(rig, 'book', tr, m, inp))
          }
        }
        this.reading = { rig, openAt: (this.clocks.get(`${rig.id}:l`)?.attachedAt ?? t), turnAt: u }
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
    if (goal.pose === 'type' && seat === 2 && inp.tablet && resting) {
      const pen = this.props.info(rig, 'tablet_pen')
      const tab = this.nodes.desk_2_tablet
      if (pen && tab) {
        const c = tab.getWorldPosition(new Vector3())
        const sc = Math.max(0, u)
        const nib = new Vector3(c.x + 0.05 * Math.sin(sc * 1.1) + 0.02 * Math.sin(sc * 4), c.y + 0.005, c.z + 0.04 * Math.cos(sc * 0.8) + 0.02 * Math.cos(sc * 5))
        const held = this.writing(nib, fwd.clone().negate(), 0.071, 45 * DEG, 8 * DEG * Math.sin(sc * 5))
        this.grip(rig, 'r', 'tablet_pen', pen.node.name, true, held, inp)
        // the other hand keeps typing (the pose); nothing more here
      }
      return
    }
    if (goal.pose === 'idle' && resting && goal.spot === `work_${seat}` && (seat === 0 || seat === 1 || seat === 3)) {
      this.grip(rig, 'r', 'mouse', `desk_${seat}_mouse`, true, null, inp)
    }
  }

  private setExtra(rig: AgentRig, side: 'l' | 'r', objName: string, fn: (pose: Matrix4) => void) {
    // the carry entry of the hand that holds the prop (water: the right hand, the book: the left)
    const e = [...this.carry.values()].find((x) => x.rig === rig && x.objName === objName && x.side === (side === 'r' ? 'r' : 'l'))
    if (e) e.extra = fn
  }

  private pouring: { on: boolean; rig: AgentRig; held: Matrix4; soilY: number } | null = null
  /** the spout node in the can's frame (water.ts: +z = the water's direction) */
  private spoutLocal: Matrix4 | null = null
  private plants: Plant[] = PLANTS
  private reading: { rig: AgentRig; openAt: number; turnAt: number } | null = null

  /** the left hand's part of a two-handed hold, placed from the object's pose with its own grip empty */
  private leftHand(rig: AgentRig, kind: string, tgt: GripTarget, objPose: Matrix4, objName: string, inp: StageIn) {
    void objName
    const spec = GRIPS[kind].l!
    const hand = rig.parts.hands.l
    const target = handFor(objPose, tgt.pg, handGripMatrix(hand))
    rig.drive.l = { target, w: 1, curl: spec.hold, wc: 1, spread: null }
    void inp
  }
  private rightHand(rig: AgentRig, kind: string, tgt: GripTarget, objPose: Matrix4, inp: StageIn) {
    const spec = GRIPS[kind].r!
    const hand = rig.parts.hands.r
    const seat = Number(rig.id.split('_')[1])
    const target = handFor(objPose, tgt.pg, handGripMatrix(hand)).multiply(offsetOf(tgt.key, seat))
    const fit = this.holdFit(rig, 'r', tgt)
    rig.drive.r = { target, w: 1, curl: fit.curl, wc: 1, spread: fit.spread }
    void spec
    void inp
  }

  /** the coffee machine's button: the index fingertip on its contact point, pressed 0.1 s */
  private button(rig: AgentRig, name: string, u: number, inp: StageIn) {
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
    const press = u > 0.5 && u < 0.6 ? 0.012 : 0
    // the hand points in along −n, palm down
    const y = n.clone().negate()
    const z = UP.clone().negate()
    const x = new Vector3().crossVectors(y, z).normalize()
    z.crossVectors(x, y)
    const c1 = spec.hold[0] + (u > 0.5 && u < 0.6 ? 0.07 : 0)
    const tip = tipAt(idx, c1, 0)
    const basis = new Matrix4().makeBasis(x, y, z)
    const origin = P.clone().addScaledVector(n, press).sub(tip.clone().applyMatrix4(new Matrix4().extractRotation(basis)))
    const target = basis.clone().setPosition(origin)
    const curl = [0, 1, 2, 3, 4, 5].map((k) => spec.pre[k] * out.mix[0] + (k === 0 ? c1 : spec.hold[k]) * out.mix[1] + spec.after[k] * out.mix[2])
    rig.drive.r = { target, w: out.wHand, curl, wc: out.wCurl, spread: null }
  }

  // ------------------------------------------------------------------------------------------- the book and the water

  private book(inp: StageIn) {
    const h = this.bookHalves
    if (!h) return
    const r = this.reading
    this.reading = null
    if (!r || inp.reduced) {
      // closed on its shelf, or (reduced motion) open without the turning
      h.l.rotation.z = r ? Math.PI : 0
      h.r.rotation.z = 0
      return
    }
    const open = ease((inp.t - r.openAt) / 0.5)
    h.l.rotation.z = Math.PI * open
    const c = (r.turnAt - 1) % 6
    h.r.rotation.z = open >= 1 && c >= 0 && c < 0.4 ? Math.PI * 0.96 * ease(c / 0.4) : 0
  }

  private water(inp: StageIn) {
    const dr = this.drops
    const p = this.pouring
    this.pouring = null
    if (!dr) return
    if (!p?.on || !this.spoutLocal) {
      dr.count = 0
      return
    }
    // drops leave the spout (placed from the can's pose of this frame) and are gone where they reach the soil
    const { tip, dir } = spoutOf(p.held, this.spoutLocal!)
    const hit = landing(tip, dir, p.soilY)
    const m = new Matrix4()
    const pos = new Vector3()
    const life = hit ? hit.tau : 0.4
    let n = 0
    for (let i = 0; i < 28; i++) {
      const tau = (((inp.t + (i / 28) * life) % life) + life) % life
      dropAt(tip, dir, tau, pos)
      m.makeTranslation(pos.x, pos.y, pos.z)
      dr.setMatrixAt(n++, m)
    }
    dr.count = n
    dr.instanceMatrix.needsUpdate = true
  }
}

