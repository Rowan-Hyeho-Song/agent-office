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
  Box3,
  Color,
  CircleGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from 'three'
import type { Goal } from './director'
import type { GripDemo } from './debugPlay'
import { GRIPS, GripClock, curlOf, handFor, objectFor, tipAt } from './grip'
import { DIP_K } from './handPose'
import { contactNormal, fitFingers, handGripMatrix, chessCardTarget, chessTripodTarget, composeOffset, holoFlickTarget, holoPinchTarget, offsetOf, resolveTarget, solveTarget, type GripTarget } from './gripTargets'
import { HOLO_GRIP_OFFSETS } from './holoGrip.data'
import { CELL as HOLO_CELL, HoloBoard, N as HOLO_N, STONE_H as HOLO_STONE_H, STONE_Y as HOLO_STONE_Y } from './holoBoard'
import { chessPinch, flickHand, pinchSequence, pinchTimes, type Pinch } from '../play/holoPinch'
import { ALK_HAND, alkkagiAt, type AlkView } from '../play/alkkagiTimeline'
import { CHESS_HAND, chessAt, type ChessView } from '../play/chessTimeline'
import { KING, QUEEN } from '../play/chess'
import { fingerModelOf, type AgentRig, type PropBank } from './rig'
import { LIFT, OPEN_ANGLE, halfAngle } from './bookGeom'
import { LeafBend, PINCH_LET_GO, TURN_S, fingerWeight, leafAngle, pinchArc, poseWeight } from './bookLeaf'
import { noteTourEvent } from './tourEvents'
import { meshesOf } from './nodes'
import type { StatusMap } from './status'
import { gameAt, type OmokView } from '../play/omok'
import { hash } from './play'
import { rallyAt, type Dims, type Rally, type V3 } from '../play/pingpong'
import { CARRY_HOLD, HOLD_DEFAULT, PLANTS, POUR_TILT, canPose, dropAt, landing, lerpHold, plantsFrom, pourAt, solvePour, spoutOf, type Plant } from './water'
import { WATER_S } from './waterRun'
import { PARTICLE_CAP, circleAt, flowAt, habitEnv, habitSeconds, habitU, levelFor, shakeAt, type HabitKind } from './waterFx'
import { WaterScene, isMobileish } from './waterScene'
import { READ_HOLD, READ_S } from './readRun'
import { TrayPile } from './tray'
import { localBox } from './localBox'

/** #137 ② (play.md 2.5) the win ring and line when the visitor won: ivory */
export const VISITOR_RING = '#f3ead8'

/** #370 C3 the stamping, s from the decision (props.ts STAMP_MS = 2 s): to the ink pad, two dabs, back and pressed on the paper; hover 1 cm, arc 4 cm */
export const STAMP_INK = { toPad: [0.35, 0.7], dabs: [0.7, 1.1], press: [1.45, 1.7], hover: 0.01, arc: 0.04 } as const

/**
 * #559 how far each pressed button goes in, m: the fingertip goes in with it. None is a moving part of the model (the coffee button is baked into the
 * machine, the taps and the lamp switch are empties): 0, the fingertip stops on the surface (designer: 2–3 mm would not show from 1 m). A button the
 * model makes movable gets its travel here.
 */
export const BUTTON_TRAVEL: Record<string, number> = { coffee_button: 0, water_tap_0: 0, water_tap_1: 0, desk_3_signal: 0, desk_2_lamp_switch: 0, desk_1_turntable: 0 }
/** #559 the press's tap: the hand 1 mm in and back over 0.08 s as it starts */
export const PRESS_TAP = { m: 0.001, s: 0.08 }


/** #370 B3b the IN pile squared at the tidy-up: lifted 4 cm, stood 70° on its near edge, tapped down 1.2 cm; the palms 2 mm off its sides (the hand frame 9 mm behind the palm), 2 cm in from its near edge */
export const PILE_TIDY = { lift: 0.04, standDeg: 70, tap: 0.012, out: 0.002, palm: 0.009, near: 0.02 }
import { HEADPHONES, KEYCAP_ROLL, cupSwivel, LEAF_STROKE, MIXER, PAPER_READ, SHAPE_TURN, SNAP, SWATCH, leafAt, TOUCH_PROP, TOUCH_S, TURNTABLE_PUSH, type Touch } from './deskTouch'
import { SIP_TOP_S, TREAT_HOLD, TREAT_LOOK, TREAT_PROP, takeSounds, treatPhase, type SnackKind } from './treatHold'
import { handsOf } from './paperRun'
import { SHELF_BOOKS, SHELF_PULL_M, SHELF_S, SHELF_SINK_M, pageTau, rowOf } from './shelfRun'
import { cue, cue as treatCue } from '../audio/cues'
import { ease } from '../play/choreo'
import { STEP, stepAt, strokeAt } from '../play/stroke'
import { VISITOR, sessionsAt, sessionTime, type PlaySession } from '../play/session'
import { PlaySounds } from '../audio/playSounds'
import { Typist } from './typist'
import { LoungeActs } from './loungeActs'
import { WriteDesk } from './writeDesk'
import { DRINK_PROP_KINDS } from './lounge'
import { BOUNCE, bounceAt, cheerAt } from './gapMotion'

const UP = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
const ONE = new Vector3(1, 1, 1)

/** the table tennis table the model has (pp_table extras size / net_h) with the engine's default reach */
const dimsOf = (size: number[], netH: number): Dims => ({ L: size[0], W: size[1], netH, ballR: 0.02, reach: 0.25, floorY: -0.76 })
/** the blade's centre above the paddle node's origin, along its y */
/**
 * #538 a live neon of the projector (holo_panel, holo_turn_b / _w): its own copy of the material, its colour the bake's glow_color times k (0 dark,
 * 1 full); a node without glow_color keeps its own colour as full
 */
function holoNeon(node: Object3D | undefined, dark = '#000000'): (k: number) => void {
  const off = new Color(dark)
  const parts: { mat: MeshBasicMaterial; base: Color }[] = []
  const glow = (node?.userData as { glow_color?: string } | undefined)?.glow_color
  node?.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh || !(mesh.material as MeshBasicMaterial)?.color) return
    const mat = (mesh.material as MeshBasicMaterial).clone()
    mat.toneMapped = false
    mesh.material = mat
    // under the film: drawn before it (the film is renderOrder -1 and writes no depth), so it only shows faintly through (hologram.md 1.4, #648:
    // a transparent neon drawn after the film came out on top of it)
    mesh.renderOrder = -2
    parts.push({ mat, base: glow ? new Color(glow) : mat.color.clone() })
  })
  let last = -1
  return (k: number) => {
    if (k === last) return
    last = k
    // dark: its unlit face (the panel off is a dark glass, not a hole: #111317, designer #648), the light added over it
    for (const p of parts) p.mat.color.copy(p.base).multiplyScalar(k).add(off)
  }
}
/** #538 (hologram.md 1.5) the projector's panel while the board is on, and the turn lights: the side to move, the other, the board off */
const HOLO_NEON = { panel: 0.1, turn: 1, idle: 0.15 } as const
/** #538 the panel switched off: a dark glass that sits with the bezel (designer, #648), not pure black */
const HOLO_PANEL_OFF = '#111317'

/** #604 a chess glyph's height by kind (hologram.md 11.2: rows of 3.6 mm; pawn 8 … king 14), m */
const CHESS_GLYPH_H = [0, 8, 12, 12, 10, 13, 14].map((rows) => rows * 0.0036)

/** #538 the thumb and index opened over the fount before the pinch (2.4 cm between their tips, hologram.md 4.3) */
const PINCH_WIDE = curlOf([0.02, 0.25, 0.3, 0.35], [0, 0.1])
const BLADE_Y = 0.175
/** #600 a stone hand no longer driven lets go over this long (s) */
const STONE_LET_GO_S = 0.4
/** ball centre to the paddle face at contact: the ball radius and half the blade */
const FACE_GAP = 0.023
/** #490 B waiting for a partner (play.md 9.2): the blade's centre in front of the body (the root's frame: right, up, − forward), m; the paddle's own rise and fall with each bounce, m */
const WAIT_BLADE = { x: 0.16, y: 0.95, z: -0.36, rise: 0.012 } as const
/** the hand goes to the leaf's corner in this long before the turn, and comes back in this long after it, s (grips.md: 0.2) */
const LEAD_S = 0.2
const BACK_S = 0.3
/** the held object rises from where it rests to where it is held in this long, s */
const LIFT_S = 0.35
/** the grips whose approach turns the hand along the reach direction (#255, grips.md 1.1): the high-shelf book, the board marker, the ping-pong paddle */
const REACH_KINDS = new Set(['book', 'marker', 'paddle'])
/** carrying a prop back to where it rests, s */
const PUT_S = 0.4
/** #457 a reach with a waypoint (grip `via`): this share of the approach takes the hand to it, the rest goes on in */
const VIA_SHARE = 0.4
/** a go stone is carried within this far of the player's spot (m); farther, the body leans in, by at most LEAN_MAX_M */
const STONE_COMFORT_M = 0.7
const LEAN_MAX_M = 0.08
/** watering (watering.md 2): the body dips this far as the hand takes the can, the wrist sags this much (of POUR_TILT: 5°), the body leans this far toward the pot while it pours */
const WEIGHT_DIP_M = 0.03
const WRIST_SAG = (5 * Math.PI) / 180 / ((30 * Math.PI) / 180)
const LEAN_IN_M = 0.05
/** the paddle hand's shoulder, from the body's spot: height above the floor and sideways toward the right hand (rig.ts's throw: 1.0 m, 0.12–0.15 m) */
const SHOULDER_Y = 1.0
const SHOULDER_SIDE = 0.15
/** reduced motion: the can's appearance in the hand / on its stand (watering.md 5) */
const CAN_FADE_MS = 120
/** watering.md 1: over the monstera it leans 2° more (12° instead of 10°: the lean's 5 cm scaled the same way, #397) */
const LEAN_MORE: Record<string, number> = { plant_sofa: 12 / 10 }

export interface StageIn {
  /** #370 B3b sheets in the planner's IN pile now (props.ts inbox) */
  inbox?: number
  /** #370 A a hand on a thing of its own desk, by agent (deskTouch.ts) */
  touches?: Record<string, Touch>
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
  /** #137 ② a visitor's game with the agent at the board (omokVisit/store.ts): drawn instead of the board's own game, in this tab only */
  visitorOmok?: { agent: string; view: OmokView } | null
  /** #137 ③ the visitor's match with the agent at the far end (pingpong_b): its rally (visitorPingpong.ts rallyOf) on the match clock, this tab only */
  visitorPingpong?: { agent: string; rally: Rally; tMs: number } | null
  /** #455 the treats taken in a hand: which, and when it landed (office ms) */
  treats?: Record<string, { kind: SnackKind; at: number }>
  gripDemo?: GripDemo | null
  /** #604 where the camera is (the hologram chess pieces turn to face it) */
  camera?: Vector3
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
  /** #538 the hologram board (holoBoard.ts) over the projector's surface_holo: the light grid, stones and marks */
  private holo: HoloBoard | null = null
  /** the scene clock of the last omok frame: a jump of more than 1 s (a seek in the timelapse) draws the result, no animation (hologram.md 6.2) */
  private holoT = Number.NEGATIVE_INFINITY
  /** the last frame's phase of the game on the board (a reset begins a new game: its rows are wiped) */
  private holoPhase: OmokView['phase'] | null = null
  /** per agent: the pinch on the light stone, solved once (the hand offset and the fitted thumb and index) */
  private pinchFits = new Map<string, { tgt: GripTarget; offset: Matrix4; hold: number[] }>()
  /** #604 the game the board last showed (it goes off as that game) */
  private holoGame: 'omok' | 'chess' | 'alkkagi' = 'omok'
  /** #605 the alkkagi phase last frame, the flick whose events were last sounded (and how far into its motion), the stone's place at the aim */
  private alkPhase: AlkView['phase'] | null = null
  private alkHeard: { key: string; ms: number } | null = null
  private alkAimAt = new Map<string, { key: string; x: number; y: number }>()
  /** #604 per mover and half-move: the held piece's facing and the grip (card pinch side) chosen at the pick, kept while it is held */
  private chessHold = new Map<string, { key: string; yaw: number; flip: boolean }>()
  /** #604 the chess phase last frame (a reset begins a new game) */
  private chessPhase: ChessView['phase'] | null = null
  /** #538 the projector's live neons (hologram.md 1.5) */
  private holoPanel: (k: number) => void = () => {}
  private holoTurn: Record<1 | 2, (k: number) => void> = { 1: () => {}, 2: () => {} }
  /** #538 the visitor's chair (the nav spot game_b), for its stone fount and turn line */
  private visitorChair: Vector3 | null = null
  /** the picks already sounded and flashed (seed:game:cell:pick) */
  private picked = new Set<string>()
  private reactedGame = new Map<string, number>()
  /** the faces of a result (#193): the games and points already answered, the coffee drinkers who had their first sip */
  private faced = new Set<string>()
  private lastPoint = new Map<string, string>()
  private sipped = new Map<string, number>()
  /** #490 B a watcher's last cheer (gapMotion cheerAt) */
  private cheered = new Map<string, number>()
  /** each mover's place sequence of this frame (tests read it) */
  readonly lastPlace: Record<string, Pinch> = {}
  /** per mover: whether the move's hand began from the pick (a move first seen after its pick, a seat taken mid-move, is left to the board: no hand ever took its stone) */
  private handMove: Record<string, { key: string; ok: boolean }> = {}
  /** #600 the stone hand's last drive per agent; a frame without it (the record over mid-move, an errand taking over) lets go over STONE_LET_GO_S */
  private stoneLetGo = new Map<string, { side: 'l' | 'r'; drive: NonNullable<AgentRig['drive']['l']>; seen: boolean; from: number | null }>()

  // water and the book
  private drops: InstancedMesh | null = null
  /** the water's effects (waterScene.ts): the stream, the wet soil, the leaves' sway and drips */
  private fx: WaterScene | null = null
  private fxT = -1
  private spout: Object3D | undefined
  private bookHalves: { l: Object3D; r: Object3D } | null = null
  /** #450 the second bookshelf's books' halves, by book */
  private shelfHalves = new Map<string, { l: Object3D; r: Object3D }>()
  /** #450 the shelf books' turning leaves, and the turns already heard (book.page) */
  private shelfLeaves = new Map<string, LeafBend>()
  private shelfPaged = new Set<string>()
  /** #450 the shelf book cues already fired (book.out / book.in once per stage) */
  private shelfCued = new Set<string>()
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
  /** #481 the card and the pen on the writing desk (writeDesk.ts) */
  readonly writeDesk: WriteDesk

  constructor(
    scene: Object3D,
    private nodes: Record<string, Object3D>,
    private props: PropBank,
  ) {
    this.sceneRef = scene
    scene.updateMatrixWorld(true)
    this.typist = new Typist(nodes)
    this.writeDesk = new WriteDesk(scene)
    this.lounge = new LoungeActs(scene, nodes, props, {
      grip: (rig, side, kind, objName, want, held, inp, prefer, via) => this.grip(rig, side, kind, objName, want, held, inp, prefer, false, via),
      partner: (rig, kind, side, objName, primary) => {
        const tgt = this.target(objName, kind, side)
        if (tgt) this.partner(rig, kind, side, tgt, this.lastObjPose, primary)
      },
      button: (rig, name, u, inp, holdS) => this.button(rig, name, u, inp, holdS),
      arrivedAt: (id) => this.arrivedAt.get(id),
      // #457 a drink that has faded out of the hand: nothing carries it home (it is back on its shelf, hidden), the hand is free at once
      drop: (rig, side, objName) => {
        for (const k of [...this.carry.keys()]) if (k.startsWith(`${rig.id}:${side}:`) && this.carry.get(k)!.objName === objName) this.carry.delete(k)
        this.clock(`${rig.id}:${side}`).reset()
      },
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

    // #538 the board is light over the projector (hologram.md 6.1): its grid is the hologram's (columns +x, rows +z, cell 0 at o)
    const surface = scene.getObjectByName('surface_holo')
    if (surface) {
      this.holo = new HoloBoard(scene, surface)
      this.grid = { o: this.holo.cellPos(0), n: HOLO_N, cell: HOLO_CELL }
    }
    this.visitorChair = scene.getObjectByName('nav_game_b')?.getWorldPosition(new Vector3()) ?? null
    this.holoPanel = holoNeon(scene.getObjectByName('holo_panel'), HOLO_PANEL_OFF)
    this.holoTurn = { 1: holoNeon(scene.getObjectByName('holo_turn_b')), 2: holoNeon(scene.getObjectByName('holo_turn_w')) }
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
    // #450 the second bookshelf's books open the same way: their halves hang on them
    for (const b of SHELF_BOOKS) {
      const node = nodes[b.name]
      const hl = nodes[`${b.name}_l`]
      const hr = nodes[`${b.name}_r`]
      if (node && hl && hr) {
        node.attach(hl)
        node.attach(hr)
        this.shelfHalves.set(b.name, { l: hl, r: hr })
        // its one leaf that turns (as the low table's book: grips.md "한 장 넘기기"), hidden between the turns
        const page = nodes[`${b.name}_page`]
        if (page) {
          node.attach(page)
          const lf = new LeafBend(page)
          page.visible = false
          this.shelfLeaves.set(b.name, lf)
        }
      }
    }
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
    // the grip kind too: two grips of one hand on one object (#450: a shelf book's spine and its open cover) fit their own fingers
    const key = `${t.kind}:${t.key}:${seat}`
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
  private grip(rig: AgentRig, side: 'l' | 'r', kind: string, objName: string, want: boolean, held: Matrix4 | null, inp: StageIn, prefer?: string, carryCall = false, via?: Vector3): boolean {
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
    // the closed book's grip (and #450 a shelf book's spine grip) is the same prop as the open one (PropBank knows props by their own kind)
    const propKind = kind === 'bookclosed' || kind === 'bookspine' ? 'book' : kind
    const info = tgt.obj && !body ? this.props.info(rig, propKind, prefer ?? objName) : null
    const home = body ? body.matrixWorld.clone() : tgt.obj ? this.props.homeWorld(tgt.obj) : new Matrix4()
    let pose = home
    // reduced motion: the can (watering.md 5) and a drink from the fridge (lounge-props.md 5.5) are simply in the hand; everything else is lifted from where it rests
    if (body) pose = home
    else if (out.attached && held) pose = inp.reduced && (kind === 'watering_can' || kind in DRINK_PROP_KINDS) ? held : blend(home, held, ease((inp.t - (clock.attachedAt ?? inp.t)) / Math.max(LIFT_S, rig.gestureMin)))
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
    // #457 designer: a reach through an opening goes by `via` (where the grip point would be, in front of it) for the first 40% of the approach,
    // then straight in for the rest, so the hand does not cut across the opening's edge
    let w = out.wHand
    if (via && out.stage === 'approach' && out.k !== undefined) {
      const at = new Vector3().setFromMatrixPosition(new Matrix4().multiplyMatrices(pose, tgt.pg))
      const end = new Vector3().setFromMatrixPosition(target)
      const front = end.clone().add(via.clone().sub(at))
      if (out.k < VIA_SHARE) {
        target.setPosition(front)
        w = ease(out.k / VIA_SHARE)
      } else {
        target.setPosition(front.lerp(end, ease((out.k - VIA_SHARE) / (1 - VIA_SHARE))))
        w = 1
      }
    }
    const fit = this.holdFit(rig, side, tgt)
    rig.drive[side] = { target, w, curl: null, angles: mixVec(rig.curlVec(side, spec.pre), fit.hold, rig.curlVec(side, spec.after), out.mix), wc: out.wCurl, spread: null, reach: REACH_KINDS.has(kind) }
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
    // #137 ② the visitor sat down opposite: their game on the board (the agent at game_a, the visitor at the empty chair, no hand of theirs).
    // #538 from the moment the visitor sits (hologram.md 2: the visitor turns the board on too), not only once the agent reached its chair: the
    // visitor's moves before that were neither drawn nor heard (sound, #648). The agent's hand waits for its chair (omokHands)
    const vo = inp.visitorOmok
    if (vo) og = { kind: 'boardgame', spot: 'game_a', players: [vo.agent, VISITOR], seed: hash(`visitor|${vo.agent}`), startMs: 0, game: 'omok', visitor: vo.view }
    // #137 ③ the visitor holds the near paddle: their match, the agent at the far end (no hand at the near one)
    const vp = inp.visitorPingpong
    if (vp) pp = inp.rigs[vp.agent]?.arrived === 'pingpong_b' ? { kind: 'pingpong', spot: 'pingpong_a', players: [VISITOR, vp.agent], seed: hash(`visitor|pp|${vp.agent}`), startMs: 0 } : null
    this.pingpong(pp, inp)
    for (const e of this.stoneLetGo.values()) e.seen = false
    // #604 the board's game (hologram.md 10.2): chess or omok on the one projector; with nobody there, the last game's board goes off
    if (og) this.holoGame = og.game === 'chess' ? 'chess' : og.game === 'alkkagi' ? 'alkkagi' : 'omok'
    if (this.holoGame === 'chess') this.chess(og?.game === 'chess' ? og : null, inp)
    else if (this.holoGame === 'alkkagi') this.alkkagi(og?.game === 'alkkagi' ? og : null, inp)
    else this.omok(og, inp)
    for (const e of this.carry.values()) e.seen = false
    // #481 writing the wrap-up cards: the card on the desk, the pen hand on the pen; nothing else takes the hands meanwhile
    const writing = new Set(ids.filter((id) => this.writeDesk.drive(inp.rigs[id], inp.goals[id], inp)))
    for (const id of ids) if (inp.gripDemo?.agent !== id && !writing.has(id)) this.solo(inp.rigs[id], inp.goals[id], inp, pp, og)
    this.demo(inp)
    this.putBack(inp)
    this.stoneLetGoStep(inp)
    for (const id of ids) if (!this.typed.has(id)) this.typist.fade(inp.rigs[id], inp.dt)
    // #455 a treat in a free hand: over whatever that hand was doing
    this.treatHands(inp)
    for (const id of ids) {
      inp.rigs[id].applyDrive('l', inp.t, inp.reduced)
      inp.rigs[id].applyDrive('r', inp.t, inp.reduced)
    }
    this.treatDraw(inp)
    for (const id of ids) this.writeDesk.draw(inp.rigs[id], inp.goals[id], inp)
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
    const vp = s.players[0] === VISITOR ? inp.visitorPingpong : null
    const tMs = vp ? vp.tMs : sessionTime(s, inp.now)
    const d = this.dims
    const rally: Rally = vp ? vp.rally : rallyAt(s.seed, s.players, Math.max(tMs, -1), d, inp.reduced)
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
        // the visitor reads the depth from it (play.md 3.2): darker in their match
        ;(this.shadow.material as MeshBasicMaterial).opacity = (vp ? 0.75 : 0.4) / (1 + h * 3)
      } else {
        ball.visible = !playing || inp.reduced // between points the ball is in somebody's pocket; at the start it waits on the table
        ball.position.copy(this.ballHome)
      }
    }
    for (const side of [0, 1] as const) {
      const rig = inp.rigs[s.players[side]]
      // the visitor's end has no hand: their paddle floats (PingpongVisitRig)
      if (!rig) continue
      const dir = side === 0 ? 1 : -1
      const planeX = -dir * (d.L! / 2 + d.reach!)
      const ready: V3 = [planeX + dir * 0.12, 0.2, 0]
      // a ball out of reach of the paddle shoulder: the body steps along the end line first (max 0.4 m at 1.2 m/s, play.md 7, #397); not under reduced motion
      if (rig && !inp.reduced) {
        const o = this.tableWorld([0, 0, 0])
        const shoulder: V3 = [rig.x - o.x, SHOULDER_Y - o.y, rig.z - o.z + dir * SHOULDER_SIDE]
        const want = stepAt(rally.contacts.filter((c) => c.side === side), playing ? tMs : -Infinity, shoulder, dir, FACE_GAP)
        // the rally clock (office time) and the frames do not tick together: the step is also held to 1.2 m/s of frame time (#448: 1.38 at peaks)
        const was = this.sideSteps.get(rig.id) ?? 0
        const step = was + Math.max(-STEP.mps * inp.dt, Math.min(STEP.mps * inp.dt, want - was))
        this.sideSteps.set(rig.id, step)
        rig.nudge(0, step)
      }
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
    const before = playing && !vp ? rallyAt(s.seed, s.players, tMs - 2000, d, true) : null
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

  /** #137 ③ the ping-pong table for the visitor's match: its top's middle (the rally's origin) and its size; null before the model */
  get pingpongTable(): { o: Vector3; dims: Dims } | null {
    return this.tableNode ? { o: this.tableWorld([0, 0, 0]), dims: this.dims } : null
  }

  /** #137 ② for the visitor's input: the board's points (origin, count, step: column i is +x, row j is +z), null before the model */
  get omokGrid(): { o: Vector3; n: number; cell: number } | null {
    return this.grid
  }
  /** the point a world point is over (within half a step of it), or null */
  omokCellAt(p: Vector3): number | null {
    const g = this.grid
    if (!g) return null
    const i = Math.round((p.x - g.o.x) / g.cell)
    const j = Math.round((p.z - g.o.z) / g.cell)
    if (i < 0 || j < 0 || i >= g.n || j >= g.n) return null
    return Math.hypot(p.x - (g.o.x + i * g.cell), p.z - (g.o.z + j * g.cell)) <= g.cell / 2 + 1e-9 ? j * g.n + i : null
  }
  /** a point's place on the board (world), or null before the model */
  omokPoint(cell: number, out = new Vector3()): Vector3 | null {
    return this.grid ? this.cellPos(cell, out) : null
  }

  /** #538 the pinch on the light stone for this agent's right hand (gripTargets.ts holoPinchTarget), solved once: deterministic per agent */
  private pinchFit(rig: AgentRig) {
    let f = this.pinchFits.get(rig.id)
    if (!f) {
      const hand = rig.parts.hands.r
      const tgt = holoPinchTarget()
      const offset = this.holoOffset(tgt, rig)
      const hold = rig.curlVec('r', GRIPS.holo.r!.hold)
      for (const fit of fitFingers(tgt, hand, offset)) {
        if (fit.finger === 'thumb') hold.splice(16, 4, ...fit.joints)
        else setFingerJoints(hold, ['index', 'middle', 'ring', 'little'].indexOf(fit.finger), fit.joints)
      }
      f = { tgt, offset, hold }
      this.pinchFits.set(rig.id, f)
    }
    return f
  }

  /**
   * #538 (hologram.md 2 · 3 · 4 · 8) omok on the hologram board: it is on while someone sits at it (an agent arrived at its chair, or the visitor's
   * game), the stones and marks follow the game, each seated player has a stone fount on its side, the turn line shows whose move it is. The hands
   * pinch a stone from the fount (omokHands). The sounds: holo.board.on / .off, holo.pick, holo.place (the visitor's own move as 'ui').
   */
  private omok(s: PlaySession | null, inp: StageIn) {
    const holo = this.holo
    if (!holo || !this.grid) return
    const snap = inp.t - this.holoT > 1 || inp.t < this.holoT
    this.holoT = inp.t
    const key = s ? `${s.spot}` : '-'
    const tMs = s ? (s.visitor ? 0 : sessionTime(s, inp.now)) : -1
    const view = s && tMs >= 0 ? (s.visitor ?? gameAt(s.seed, s.players, tMs, inp.reduced)) : null
    // who sits at the board: the agents at their chairs, and the visitor (no rig: across the board from the agent)
    const centre = holo.cellPos((HOLO_N * HOLO_N - 1) / 2)
    const seats: { seat: Vector3; color: 1 | 2; id: string }[] = []
    if (s) {
      const ids = s.solo ? [s.players[0]] : s.players
      ids.forEach((id, i) => {
        const rig = inp.rigs[id]
        if (rig && (rig.arrived === 'game_a' || rig.arrived === 'game_b')) seats.push({ seat: rig.parts.root.position.clone(), color: s.solo ? (view?.toMove ?? 1) : view && view.black === i ? 1 : 2, id })
      })
      // the visitor is seated from the start of its game (hologram.md 2: the first one to sit, the visitor too, turns the board on), in the empty
      // chair at game_b (OmokVisitRig's seat), whether or not the agent has reached its own yet (sound: the board came on only with the agent, 4–6 s late)
      if (s.visitor) {
        const chair = this.visitorChair ?? (seats[0] ? centre.clone().multiplyScalar(2).sub(seats[0].seat) : null)
        if (chair) seats.push({ seat: chair.clone(), color: view && view.black === 1 ? 1 : 2, id: VISITOR })
      }
    }
    const on = !!s && seats.length > 0
    const phase = view?.phase ?? null
    const playing = phase === 'thinking' || phase === 'pick' || phase === 'place'
    if (view && on) {
      const visitorColor = view.black === 1 ? 1 : 2
      this.sounds.holoStone(s!.seed, view.game, view.moveIndex, view.lastMove >= 0 ? this.cellPos(view.lastMove) : null, !!s!.visitor && view.lastMove >= 0 && view.board[view.lastMove] === visitorColor)
    }
    // the hand first (it says where the stone between its fingers is); reduced motion has no hand, the stone appears on the board
    const held = view && on && !inp.reduced && s && playing ? this.omokHands(s, view, inp, seats) : null
    const r = holo.update({
      t: inp.t,
      reduced: inp.reduced,
      snap,
      on,
      board: view && phase !== 'reset' ? view.board : null,
      lastMove: view && phase !== 'reset' ? view.lastMove : -1,
      win: view && phase === 'won' && view.line && view.winner ? { line: view.line, color: view.winner } : null,
      newGame: phase === 'reset' && this.holoPhase !== 'reset',
      turn: view && playing ? view.toMove : null,
      players: seats.map((p) => ({ seat: p.seat, color: p.color })),
      held: held ? { pos: held.pos, color: held.color, since: held.since } : null,
      pick: held?.pick,
    })
    this.holoPhase = phase
    this.holoNeons(r.boardOn, view && playing ? view.toMove : null)
    if (r.boardOnStart) this.sounds.holoBoard(true, centre, inp.reduced)
    if (r.boardOffStart) this.sounds.holoBoard(false, centre, inp.reduced)
    if (!s || !view) return
    // the faces of the result: the winner is glad (기쁨), the loser embarrassed (당황); an expression is information, reduced motion keeps it
    // a record placed alone has no winner to be glad and no loser to clap (#137 ①)
    if (view.phase === 'won' && view.winner && view.wonMs > 500 && !s.solo && !s.visitor) {
      const fk = `${key}:${view.game}`
      if (!this.faced.has(fk)) {
        this.faced.add(fk)
        const w = (view.winner === 1 ? view.black : (1 - view.black)) as 0 | 1
        inp.rigs[s.players[w]]?.faceEvent('joy', inp.t)
        inp.rigs[s.players[1 - w]]?.faceEvent('embarrassed', inp.t)
      }
    }
    if (inp.reduced) return
    // #137 ② against the visitor (play.md 2.5): the agent claps three times when the visitor won, makes a small fist when it did (its face and words come with the game)
    if (view.phase === 'won' && view.winner && s.visitor) {
      const k = `${key}:visitor:${view.game}`
      const rig = inp.rigs[s.players[0]]
      if (rig && view.wonMs > 500 && this.reactedGame.get(k) === undefined) {
        this.reactedGame.set(k, inp.t)
        rig.reaction = view.winner === 2 ? { kind: 'fist', t0: inp.t, dur: 1.0 } : { kind: 'clap', t0: inp.t + 0.4, dur: 1.4 }
      }
    }
    // reactions (play.md 2.5): the winner's small fist, the loser's three claps and a bow (not when one agent placed both sides)
    if (view.phase === 'won' && view.winner && !s.solo && !s.visitor) {
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

  /**
   * #600 the stone hand drives the rig directly (no grip clock): when the record ends mid-move or an errand takes the agent (the white bowl's
   * run home began the frame the record ended, with a stone in the hand), it used to drop to rest in one frame (0.35 m). It lets go from where it
   * was over STONE_LET_GO_S instead; a hand another action takes meanwhile is that action's.
   */
  private stoneLetGoStep(inp: StageIn) {
    for (const [id, e] of this.stoneLetGo) {
      if (e.seen) continue
      const rig = inp.rigs[id]
      if (!rig || rig.drive[e.side]) {
        this.stoneLetGo.delete(id)
        continue
      }
      e.from ??= inp.t
      const k = inp.reduced ? 1 : (inp.t - e.from) / STONE_LET_GO_S
      if (k >= 1) {
        this.stoneLetGo.delete(id)
        continue
      }
      const w = 1 - ease(k)
      rig.drive[e.side] = { ...e.drive, w: e.drive.w * w, wc: e.drive.wc * w }
    }
  }

  /**
   * #604 (hologram.md 10 · 11) chess on the hologram board, the agents' games from the session's seed (chessTimeline.ts, computed a few half-moves
   * a frame: a seek catches up without a stop). The board is on while someone sits at it; the mover's hand takes the piece from its square and
   * puts it down (chessHands); the sounds: holo.pick, chess.place / chess.capture, chess.check, holo.board.on / .off.
   */
  private chess(s: PlaySession | null, inp: StageIn) {
    const holo = this.holo
    if (!holo) return
    const snap = inp.t - this.holoT > 1 || inp.t < this.holoT
    this.holoT = inp.t
    const tMs = s ? sessionTime(s, inp.now) : -1
    const view = s && tMs >= 0 ? chessAt(s.seed, s.players, tMs) : null
    // the seated (white is the side holding view.white; a record alone: the colour to move)
    const seats: { seat: Vector3; color: 1 | 2; id: string }[] = []
    if (s) {
      const ids = s.solo ? [s.players[0]] : s.players
      ids.forEach((id, i) => {
        const rig = inp.rigs[id]
        if (!rig || (rig.arrived !== 'game_a' && rig.arrived !== 'game_b')) return
        const white = s.solo ? view?.toMove === 0 : view ? view.white === i : i === 0
        seats.push({ seat: rig.parts.root.position.clone(), color: white ? 2 : 1, id })
      })
    }
    const on = !!s && seats.length > 0
    const phase = view?.phase ?? null
    const playing = phase === 'thinking' || phase === 'pick' || phase === 'place'
    const held = view && on && !inp.reduced && s && view.move && phase !== 'catching' ? this.chessHands(s, view, inp, seats) : null
    const mv = view?.move
    const landedAt = mv && phase === 'place' ? inp.t - (mv.sinceMs - mv.thinkMs - CHESS_HAND.land) / 1000 : null
    const r = holo.update({
      t: inp.t,
      reduced: inp.reduced,
      // catching up (a seek, a first sight) draws no move events (move is null then) but is no jump of the board: its coming on still unfolds (#653)
      snap,
      on,
      game: 'chess',
      board: null,
      lastMove: -1,
      win: null,
      newGame: phase === 'reset' && this.chessPhase !== 'reset',
      turn: view && playing ? (view.toMove === 0 ? 2 : 1) : null,
      players: seats.map((p) => ({ seat: p.seat, color: p.color })),
      held,
      chess: view
        ? {
            board: view.board,
            lastMove: view.lastMove,
            check: view.check,
            captured: { 2: view.takenByWhite.map((kind) => ({ kind, color: 1 as const })), 1: view.takenByBlack.map((kind) => ({ kind, color: 2 as const })) },
            move:
              mv && landedAt !== null
                ? {
                    id: view.game * 1000 + view.moveIndex,
                    from: mv.from,
                    to: mv.to,
                    at: landedAt,
                    capture: mv.capture ? { sq: mv.captureAt, kind: mv.capture, color: mv.side === 0 ? (1 as const) : (2 as const) } : null,
                    castle: mv.castle,
                    ...(mv.promo ? { promotion: mv.promo } : {}),
                  }
                : null,
            end: view.end ? { result: view.end.kind === 'win' ? ('mate' as const) : ('draw' as const), ...(view.end.kind === 'win' ? { loser: view.end.side === 0 ? (1 as const) : (2 as const) } : {}), since: inp.t - view.end.sinceMs / 1000 } : null,
            camera: inp.camera,
          }
        : undefined,
    })
    this.chessPhase = phase
    this.holoNeons(r.boardOn, view && playing ? (view.toMove === 0 ? 2 : 1) : null)
    const centre = holo.squarePos(27).lerp(holo.squarePos(36), 0.5)
    if (r.boardOnStart) this.sounds.holoBoard(true, centre, inp.reduced)
    if (r.boardOffStart) this.sounds.holoBoard(false, centre, inp.reduced)
    if (!s || !view || !on) return
    if (phase !== 'catching') this.sounds.chessPiece(s.seed, view.game, view.moveIndex, view.lastMove ? holo.squarePos(view.lastMove.to) : null, !!(mv && phase === 'place' && mv.capture))
    if (r.checkStart && view.check !== null) this.sounds.chessCheck(s.seed, view.game, view.moveIndex, holo.squarePos(view.check))
    // the faces of the result, as in omok (play.md 2.5): the winner glad, the loser embarrassed; a draw has none; not a record alone
    const end = view.end
    if (end && end.kind === 'win' && end.sinceMs > 500 && !s.solo) {
      const fk = `chess:${s.spot}:${view.game}`
      if (!this.faced.has(fk)) {
        this.faced.add(fk)
        const winner = end.side === 0 ? view.white : ((1 - view.white) as 0 | 1)
        inp.rigs[s.players[winner]]?.faceEvent('joy', inp.t)
        inp.rigs[s.players[1 - winner]]?.faceEvent('embarrassed', inp.t)
        if (!inp.reduced && this.reactedGame.get(fk) === undefined) {
          this.reactedGame.set(fk, inp.t)
          noteTourEvent(s.players[winner], 5000)
          const wr = inp.rigs[s.players[winner]]
          const lr = inp.rigs[s.players[1 - winner]]
          if (wr) wr.reaction = { kind: 'fist', t0: inp.t, dur: 1.0 }
          if (lr) lr.reaction = { kind: 'clap', t0: inp.t + 0.4, dur: 1.4 }
        }
      }
    }
  }

  /**
   * #538 (hologram.md 1.5) the projector's live neons for every game: the panel glows while the board is on; the turn light of the colour to
   * move is lit, the other dim, both dark with the board off (#605: chess and alkkagi left the panel at its bake, bright through the film)
   */
  private holoNeons(lit: boolean, turn: 1 | 2 | null) {
    this.holoPanel(lit ? HOLO_NEON.panel : 0)
    for (const c of [1, 2] as const) this.holoTurn[c](!lit ? 0 : turn === c ? HOLO_NEON.turn : HOLO_NEON.idle)
  }

  /**
   * #605 (hologram.md 12) alkkagi on the hologram board, the agents' games from the session's seed (alkkagiTimeline.ts, a flick per frame at most:
   * a seek catches up). The stones move by the engine's own path; the mover's index flicks the stone (alkHands). The sounds: alkkagi.flick at the
   * nail, alkkagi.hit / .drop at each engine event, holo.board.on / .off.
   */
  private alkkagi(s: PlaySession | null, inp: StageIn) {
    const holo = this.holo
    if (!holo) return
    const snap = inp.t - this.holoT > 1 || inp.t < this.holoT
    this.holoT = inp.t
    const tMs = s ? sessionTime(s, inp.now) : -1
    const view = s && tMs >= 0 ? alkkagiAt(s.seed, s.players, tMs) : null
    // the seated: the side flicking first (engine side 0) is cyan (colour 1), the other ivory (2); a game alone: the side to flick
    const seats: { seat: Vector3; color: 1 | 2; id: string }[] = []
    if (s) {
      const ids = s.solo ? [s.players[0]] : s.players
      ids.forEach((id, i) => {
        const rig = inp.rigs[id]
        if (!rig || (rig.arrived !== 'game_a' && rig.arrived !== 'game_b')) return
        const side0 = s.solo ? view?.toMove === 0 : view ? view.first === i : i === 0
        seats.push({ seat: rig.parts.root.position.clone(), color: side0 ? 1 : 2, id })
      })
    }
    const on = !!s && seats.length > 0
    const phase = view?.phase ?? null
    const f = view?.flick ?? null
    const fh = f ? flickHand(f.sinceMs, f.thinkMs) : null
    if (view && on && !inp.reduced && s && f && phase !== 'catching') this.alkHands(s, view, inp)
    // the scene clock of a moment of the motion (ms since the nail)
    const atMotion = (ms: number) => inp.t - ((f?.motionMs ?? 0) - ms) / 1000
    const r = holo.update({
      t: inp.t,
      reduced: inp.reduced,
      snap,
      on,
      game: 'alkkagi',
      board: null,
      lastMove: -1,
      win: null,
      newGame: phase === 'reset' && this.alkPhase !== 'reset',
      turn: view && (phase === 'thinking' || phase === 'aim' || phase === 'moving' || phase === 'settle') ? (view.toMove === 0 ? 1 : 2) : null,
      players: seats.map((p) => ({ seat: p.seat, color: p.color })),
      held: null,
      alkkagi: view
        ? {
            stones: view.stones,
            hits: view.events.flatMap((e) => (e.kind === 'hit' ? [{ a: e.a, b: e.b, speed: e.speed, at: atMotion(e.atMs) }] : [])),
            outs: view.events.flatMap((e) => {
              if (e.kind !== 'out') return []
              const st = view.stones[e.a]
              const n = Math.hypot(st.x, st.y) || 1
              return [{ a: e.a, at: atMotion(e.atMs), dir: { x: st.x / n, y: st.y / n } }]
            }),
            aim: f && fh && fh.aim !== null && !fh.flicked ? { stone: f.flick.stone, dx: f.flick.dx, dy: f.flick.dy, power: f.flick.power, grow: fh.aim } : null,
            end: view.end ? { winner: view.end.kind === 'win' ? view.end.side : null, since: inp.t - view.end.sinceMs / 1000 } : null,
          }
        : undefined,
    })
    this.alkPhase = phase
    this.holoNeons(r.boardOn, view && (phase === 'thinking' || phase === 'aim' || phase === 'moving' || phase === 'settle') ? (view.toMove === 0 ? 1 : 2) : null)
    const centre = holo.alkPos(0, 0)
    if (r.boardOnStart) this.sounds.holoBoard(true, centre, inp.reduced)
    if (r.boardOffStart) this.sounds.holoBoard(false, centre, inp.reduced)
    if (!s || !view || !on || !f) return
    // the sounds of this flick: the nail, then each event passed since the last frame (a jump, or a flick first seen mid-way, plays nothing)
    const key = `${s.seed}:${view.game}:${view.turn}`
    const ms = f.sinceMs - f.thinkMs - ALK_HAND.flick
    const prev = this.alkHeard?.key === key ? this.alkHeard.ms : null
    if (!snap && prev !== null && ms >= 0) {
      if (prev < 0) {
        const st = view.stones[f.flick.stone]
        this.sounds.alkFlick(s.seed, view.game, view.turn, holo.alkPos(st.x, st.y))
      }
      for (const e of view.events)
        if (e.atMs > prev && e.atMs <= f.motionMs) {
          const st = view.stones[e.kind === 'hit' ? e.a : e.a]
          const p = e.kind === 'hit' ? holo.alkPos((st.x + view.stones[e.b].x) / 2, (st.y + view.stones[e.b].y) / 2) : holo.alkPos(st.x, st.y)
          this.sounds.alkEvent(s.seed, view.game, view.turn, e.kind === 'hit' ? { kind: 'hit', step: e.step, speed: e.speed } : { kind: 'out', step: e.step }, p)
        }
    }
    this.alkHeard = { key, ms: ms < 0 ? -1 : f.motionMs }
    // the faces of the result, as chess
    const end = view.end
    if (end && end.kind === 'win' && end.sinceMs > 500 && !s.solo) {
      const fk = `alkkagi:${s.spot}:${view.game}`
      if (!this.faced.has(fk)) {
        this.faced.add(fk)
        const winner = end.side === 0 ? view.first : ((1 - view.first) as 0 | 1)
        inp.rigs[s.players[winner]]?.faceEvent('joy', inp.t)
        inp.rigs[s.players[1 - winner]]?.faceEvent('embarrassed', inp.t)
      }
    }
  }

  /**
   * #605 (hologram.md 12.4) the mover's right hand: over the chosen stone while it thinks, low behind it, aiming, the index cocked on the thumb and
   * snapped out so its tip meets the stone's back at the nail's frame; it stays where the stone was while the stone flies. The stone's place and
   * the direction are taken at the aim (a flick first seen after its nail has no hand)
   */
  private alkHands(s: PlaySession, view: AlkView, inp: StageIn) {
    const holo = this.holo!
    const f = view.flick!
    const id = s.players[f.mover]
    const rig = inp.rigs[id]
    if (!rig || (rig.arrived !== 'game_a' && rig.arrived !== 'game_b')) return
    const p = flickHand(f.sinceMs, f.thinkMs)
    if (p.stage === 'rest') return
    const key = `${s.seed}:${view.game}:${view.turn}`
    let place = this.alkAimAt.get(id)
    if (!place || place.key !== key) {
      if (p.flicked) return
      const st = view.stones[f.flick.stone]
      place = { key, x: st.x, y: st.y }
      this.alkAimAt.set(id, place)
    }
    const c = holo.alkPos(place.x, place.y)
    c.y += HOLO_STONE_Y + 0.0023
    const ahead = holo.alkPos(place.x + f.flick.dx / 1000, place.y + f.flick.dy / 1000)
    const dir = new Vector3(ahead.x - c.x, 0, ahead.z - c.z).normalize()
    if (!isFinite(dir.x)) return
    const across = new Vector3().crossVectors(UP, dir)
    const at = c.clone().addScaledVector(dir, -p.back)
    at.y += p.h
    const stoneWorld = new Matrix4().makeBasis(across, UP, dir).setPosition(at)
    const fit = this.flickFit(rig)
    const hand = handFor(stoneWorld, fit.tgt.pg, handGripMatrix(rig.parts.hands.r)).multiply(fit.offset)
    const spec = GRIPS.holo_flick.r!
    const cock = rig.curlVec('r', spec.pre)
    const ext = rig.curlVec('r', spec.after)
    const angles = cock.map((v, i) => v * p.cock + fit.hold[i] * p.strike + ext[i] * p.extend)
    rig.drive.r = { target: hand, w: p.w, curl: null, angles, abdLimits: null, wc: p.w, spread: null }
    this.stoneLetGo.set(rig.id, { side: 'r', drive: rig.drive.r!, seen: true, from: null })
    if (f.sinceMs < f.thinkMs) rig.glance = { at: c, max: 10 * DEG }
  }

  /** #605 the flick's fit for this agent (the stored offset, the index fitted on the stone's back) */
  private flickFit(rig: AgentRig) {
    const key = `${rig.id}:flick`
    let f = this.pinchFits.get(key)
    if (!f) {
      const hand = rig.parts.hands.r
      const tgt = holoFlickTarget()
      const offset = this.holoOffset(tgt, rig)
      const hold = rig.curlVec('r', GRIPS.holo_flick.r!.hold)
      for (const fit of fitFingers(tgt, hand, offset)) {
        if (fit.finger === 'thumb') hold.splice(16, 4, ...fit.joints)
        else setFingerJoints(hold, ['index', 'middle', 'ring', 'little'].indexOf(fit.finger), fit.joints)
      }
      f = { tgt, offset, hold }
      this.pinchFits.set(key, f)
    }
    return f
  }

  /**
   * #604 (hologram.md 11.4) the mover's right hand: over its own edge of the board while it thinks, then over the piece, the pinch on the glyph's
   * thickness like a card (front and back faces at 70% of its height; the side chosen so the fingers point the player's way), an arc to the
   * square, put down. The piece keeps the facing it had when taken. Returns the held piece for the board.
   */
  private chessHands(s: PlaySession, view: ChessView, inp: StageIn, seats: { seat: Vector3; color: 1 | 2; id: string }[]) {
    const holo = this.holo!
    const mv = view.move!
    const id = s.players[mv.mover]
    const rig = inp.rigs[id]
    if (!rig || (rig.arrived !== 'game_a' && rig.arrived !== 'game_b')) return null
    const p = chessPinch(mv.sinceMs, mv.thinkMs)
    const mk = `${s.seed}:${view.game}:${view.moveIndex}:${mv.from}`
    // a half-move first seen after its pick is left to the board (no hand took it)
    if (this.handMove[id]?.key !== mk) this.handMove[id] = { key: mk, ok: mv.sinceMs < mv.thinkMs + CHESS_HAND.pick }
    if (!this.handMove[id].ok || p.stage === 'rest') return null
    const at = rig.parts.root.position
    const mid = holo.squarePos(27).lerp(holo.squarePos(36), 0.5)
    const fwd = new Vector3(mid.x - at.x, 0, mid.z - at.z).normalize()
    if (!isFinite(fwd.x)) fwd.set(1, 0, 0)
    // the grip point: 70% of the glyph's height over the piece's foot
    // the king and the queen: three fingers just under the top (one voxel down); the others: the card pinch at 70% of the height
    const big = mv.kind === KING || mv.kind === QUEEN
    const gripH = big ? CHESS_GLYPH_H[mv.kind] - 0.0036 * 1.5 : CHESS_GLYPH_H[mv.kind] * 0.7
    const from = holo.squarePos(mv.from)
    const to = holo.squarePos(mv.to)
    const edge = mid.clone().addScaledVector(fwd, -0.18)
    const hover = new Vector3(edge.x, from.y, edge.z)
    const foot = p.a < 1 ? hover.clone().lerp(from, p.a) : from.clone().lerp(to, p.u)
    foot.y += p.h
    // the facing and the grip side, chosen at the pick and kept while held
    let hold = this.chessHold.get(id)
    if (!hold || hold.key !== mk) {
      const cam = inp.camera ?? at
      const yaw = Math.atan2(cam.x - from.x, cam.z - from.z)
      // the piece's +x across the glyph; the card pinch's fingers run along +x (A) or −x (B): the one nearer the player's forward
      const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
      hold = { key: mk, yaw, flip: across.dot(fwd) < 0 }
      this.chessHold.set(id, hold)
    }
    const pieceWorld = new Matrix4().makeRotationY(hold.yaw).setPosition(foot.x, foot.y + gripH, foot.z)
    const over = Math.min(LEAN_MAX_M, Math.max(0, Math.hypot(foot.x - at.x, foot.z - at.z) - STONE_COMFORT_M))
    if (over > 0) rig.leanOver(fwd.x * over, fwd.z * over)
    if (mv.sinceMs < mv.thinkMs && view.lastMove) rig.glance = { at: holo.squarePos(view.lastMove.to), max: 10 * DEG }
    const fit = this.cardFit(rig, hold.flip, big)
    const hand = handFor(pieceWorld, fit.tgt.pg, handGripMatrix(rig.parts.hands.r)).multiply(fit.offset)
    hand.elements[12] -= fwd.x * p.pull
    hand.elements[13] += p.rise
    hand.elements[14] -= fwd.z * p.pull
    const spec = (big ? GRIPS.holo_tripod : GRIPS.holo).r!
    const pre = rig.curlVec('r', spec.pre)
    const wide = rig.curlVec('r', PINCH_WIDE)
    const angles = pre.map((v, i) => {
      const open = v + (wide[i] - v) * p.open
      return open + (fit.hold[i] - open) * p.close
    })
    rig.drive.r = { target: hand, w: p.w, curl: null, angles, abdLimits: null, wc: p.w, spread: null }
    this.stoneLetGo.set(rig.id, { side: 'r', drive: rig.drive.r!, seen: true, from: null })
    const pickKey = `${mk}:pick`
    if (p.held && !this.picked.has(pickKey)) {
      this.picked.add(pickKey)
      this.sounds.holoPick(s.seed, view.game, view.moveIndex + 1, from)
    }
    if (!p.held) return null
    const color: 1 | 2 = mv.side === 0 ? 2 : 1
    void seats
    return { pos: foot, color, since: inp.t - (mv.sinceMs - mv.thinkMs - CHESS_HAND.pick) / 1000, kind: mv.kind, facing: hold.yaw, from: mv.from }
  }

  /**
   * #538 · #604 the hand's offset on a light piece: stored per agent (holoGrip.data.ts, solved by holoGrip.test.ts); solving it here held the main
   * thread 2–5 s the first time an agent took a piece (#653). A seat without stored values (a new agent) is solved once
   */
  private holoOffset(tgt: GripTarget, rig: AgentRig) {
    const v = HOLO_GRIP_OFFSETS[`${tgt.key}:${Number(rig.id.split('_')[1])}`]
    return v ? composeOffset(v) : solveTarget(tgt, rig.parts.hands.r).offset
  }

  /** #604 the card pinch on a chess glyph for this agent, solved once per side choice (gripTargets.ts chessCardTarget) */
  private cardFit(rig: AgentRig, flip: boolean, tripod = false) {
    const key = `${rig.id}:${tripod ? 'tripod' : 'card'}:${flip ? 'b' : 'a'}`
    let f = this.pinchFits.get(key)
    if (!f) {
      const hand = rig.parts.hands.r
      const tgt = tripod ? chessTripodTarget(flip) : chessCardTarget(flip)
      const offset = this.holoOffset(tgt, rig)
      const hold = rig.curlVec('r', GRIPS[tgt.kind].r!.hold)
      for (const fit of fitFingers(tgt, hand, offset)) {
        if (fit.finger === 'thumb') hold.splice(16, 4, ...fit.joints)
        else setFingerJoints(hold, ['index', 'middle', 'ring', 'little'].indexOf(fit.finger), fit.joints)
      }
      f = { tgt, offset, hold }
      this.pinchFits.set(key, f)
    }
    return f
  }

  /**
   * #538 (hologram.md 4 · agents.md 2.7 pinch) the mover's right hand: over its stone fount while it thinks, the pinch closing on the fount makes the
   * stone between the thumb and the index (holo.pick), an arc to the intersection, put down as it is (holoPinch.ts). The stone is held palm down,
   * across its diameter, its forward the player's toward the board. Returns the held stone (its centre, colour, when it was picked) for the board.
   */
  private omokHands(s: PlaySession, view: OmokView, inp: StageIn, seats: { seat: Vector3; color: 1 | 2; id: string }[]) {
    const mv = view.move
    if (!mv || !this.holo) return null
    const id = s.players[mv.mover]
    const rig = inp.rigs[id]
    if (!rig || id === VISITOR) return null
    // a hand only from the chair (an agent still walking to the visitor's game: its stone appears on the board without a hand)
    if (rig.arrived !== 'game_a' && rig.arrived !== 'game_b') return null
    const color: 1 | 2 = view.black === mv.mover ? 1 : 2
    const p = pinchSequence(mv.sinceMs, mv.thinkMs)
    this.lastPlace[id] = p
    // a move first seen after its pick (a seat taken mid-move) is left to the board: no hand ever took its stone
    const times = pinchTimes(mv.thinkMs)
    const mk = `${s.seed}:${view.game}:${mv.cell}`
    if (this.handMove[id]?.key !== mk) this.handMove[id] = { key: mk, ok: mv.sinceMs < times.pick }
    if (!this.handMove[id].ok || p.stage === 'rest') return null
    const at = rig.parts.root.position
    const fount = this.holo.fountPos(at)
    const target = this.cellPos(mv.cell)
    // the stone's centre on its way: from the fount to the intersection, its bottom on the light plane
    const lift = HOLO_STONE_Y + HOLO_STONE_H / 2
    const a = new Vector3(fount.x, target.y + lift, fount.z)
    const b = new Vector3(target.x, target.y + lift, target.z)
    const centre = a.lerp(b, p.u)
    centre.y += p.h
    // the opponent's last stone: a 10° glance while thinking
    if (mv.sinceMs < mv.thinkMs && view.lastMove >= 0) rig.glance = { at: this.cellPos(view.lastMove), max: 10 * DEG }
    // forward: from the player toward the board's middle
    const mid = this.holo.cellPos((HOLO_N * HOLO_N - 1) / 2)
    const fwd = new Vector3(mid.x - at.x, 0, mid.z - at.z).normalize()
    if (!isFinite(fwd.x)) fwd.set(1, 0, 0)
    const side = new Vector3().crossVectors(UP, fwd)
    const stoneWorld = new Matrix4().makeBasis(side, UP, fwd).setPosition(centre)
    // a cell farther than an arm from the player's spot (the far corners): the body leans over it by the difference, up to LEAN_MAX_M
    const over = Math.min(LEAN_MAX_M, Math.max(0, Math.hypot(centre.x - at.x, centre.z - at.z) - STONE_COMFORT_M))
    if (over > 0) rig.leanOver(fwd.x * over, fwd.z * over)
    const fit = this.pinchFit(rig)
    const hand = handFor(stoneWorld, fit.tgt.pg, handGripMatrix(rig.parts.hands.r)).multiply(fit.offset)
    hand.elements[12] -= fwd.x * p.pull
    hand.elements[13] += p.rise
    hand.elements[14] -= fwd.z * p.pull
    // the fingers: their pre pose (wider still while it opens over the fount) → the pinch fitted on the rim
    const spec = GRIPS.holo.r!
    const pre = rig.curlVec('r', spec.pre)
    const wide = rig.curlVec('r', PINCH_WIDE)
    const angles = pre.map((v, i) => {
      const open = v + (wide[i] - v) * p.open
      return open + (fit.hold[i] - open) * p.close
    })
    rig.drive.r = { target: hand, w: p.w, curl: null, angles, abdLimits: null, wc: p.w, spread: null }
    this.stoneLetGo.set(rig.id, { side: 'r', drive: rig.drive.r!, seen: true, from: null })
    // the pick: the frame the pinch closes (once per move); the fount of the mover's seat flashes
    const pickKey = `${mk}:pick`
    const pick = p.held && this.handMove[id].key === mk && !this.picked.has(pickKey) ? seats.findIndex((x) => x.id === id) : -1
    if (p.held && !this.picked.has(pickKey)) {
      this.picked.add(pickKey)
      if (this.picked.size > 400) this.picked = new Set([...this.picked].slice(-100))
      this.sounds.holoPick(s.seed, view.game, view.moveIndex + 1, fount)
    }
    if (!p.held) return null
    return { pos: centre, color, since: inp.t - (mv.sinceMs - times.pick) / 1000, pick: pick >= 0 ? pick : undefined }
  }

  // ----------------------------------------------------------------------------------------------------- solo activities

  /**
   * #490 B 공 튀기기 (play.md 9.2): waiting for the partner at the table, the paddle face up in front of the body and the ball bouncing on it, once every
   * BOUNCE.everyS, BOUNCE.heightM high, with the rally's paddle click. Reduced motion: the ball lies on the still paddle, no sound.
   */
  private pingpongWait(rig: AgentRig, goal: Goal, u: number, inp: StageIn) {
    const root = rig.parts.root
    const b = bounceAt(u, inp.reduced)
    const phase = b.n < 0 ? 0.5 : u / BOUNCE.everyS - b.n
    // the paddle meets the ball going up and sinks a little while it flies
    const rise = inp.reduced ? 0 : WAIT_BLADE.rise * Math.cos(phase * Math.PI * 2)
    const blade = root.localToWorld(new Vector3(WAIT_BLADE.x, WAIT_BLADE.y, WAIT_BLADE.z))
    blade.y += rise
    const y = new Vector3(0, 0, -1).applyQuaternion(root.getWorldQuaternion(new Quaternion()))
    y.setY(0).normalize()
    const z = UP.clone()
    const x = new Vector3().crossVectors(y, z)
    const name = `prop_paddle_${goal.spot.endsWith('_b') ? 'b' : 'a'}`
    this.grip(rig, 'r', 'paddle', name, true, frame(x, y, z, blade.clone().addScaledVector(y, -BLADE_Y)), inp, name)
    const ball = this.ball
    if (!ball) return
    ball.visible = true
    ball.position.copy(blade).addScaledVector(UP, FACE_GAP + b.h)
    this.sounds.paddleBounce(rig.id, b.n, `pingpong:wait:${rig.id}:${Math.floor(inp.now / (BOUNCE.everyS * 1000))}`, ball.position)
  }

  /** #490 B 구경 (play.md 9.2): a watcher's cheer, every CHEER.everyS: three claps and a glad face (the hands stay down with reduced motion) */
  private cheer(rig: AgentRig, u: number, inp: StageIn) {
    const n = cheerAt(u)
    if (n < 0 || this.cheered.get(rig.id) === n) return
    this.cheered.set(rig.id, n)
    rig.reaction = { kind: 'clap', t0: inp.t, dur: 1.4 }
    rig.faceEvent('joy', inp.t)
  }

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
    // #457 a drink from the fridge in the left hand (loungeActs.ts): carried, sipped, faded out; nothing else takes the hands meanwhile
    if (this.lounge.drink(rig, goal, inp)) return
    // the watering errand: first, so nothing else (the stamp) takes the right hand while it carries the can
    if (goal.pose === 'water') return this.errand(rig, goal, inp)
    // the lounge acts (fridge, dispenser, turntable), the pillow on the sofa, the door lever (loungeActs.ts)
    if (this.lounge.solo(rig, goal, inp)) return
    // #490 B (play.md 9.2): at the ping-pong table before the partner is there, the ball bounces on the paddle (a pair without its rally, as in the
    // timelapse, waits still and empty-handed: #416); a watcher cheers now and then
    if (goal.pose === 'pingpong' && goal.partnerWait && resting && !pp) return this.pingpongWait(rig, goal, u, inp)
    if (goal.watching && resting) return this.cheer(rig, u, inp)
    if (goal.watching) this.cheered.delete(rig.id)
    // #370 B3b the planner's tidy-up squares its IN pile (not with reduced motion, not an empty pile)
    if (goal.pose === 'tidy' && seat === 0 && resting && this.pileTidy(rig, goal, inp)) return
    // #370 A a hand on a thing of its own desk (deskTouch.ts), the other one typing on
    if (resting && goal.spot === `work_${seat}` && this.deskTouch(rig, goal, inp, seat)) return
    // the planner's stamp (the owner decided something)
    if (inp.stamp && seat === 0) {
      const home = this.props.info(rig, 'stamp')
      if (home) {
        if (this.stampAt === null) this.stampAt = inp.t
        const s = inp.t - this.stampAt
        this.grip(rig, 'r', 'stamp', home.node.name, true, this.stampPose(home.node, s, inp), inp)
        // each dab heard soft as the face meets the felt (the middle of each half of the dabs: 0.8 s, 1.0 s; not with reduced motion: no dabs)
        const pad = this.sceneRef.getObjectByName('desk_0_inkpad')
        const [d0, d1] = STAMP_INK.dabs
        for (const [i, at] of [d0 + (d1 - d0) / 4, d0 + ((d1 - d0) * 3) / 4].entries())
          if (pad && !inp.reduced && s >= at && this.stampInked < i + 1) {
            this.stampInked = i + 1
            cue('stamp.ink', { pos: pad.getWorldPosition(new Vector3()), agent: rig.id, key: `stamp.ink:${Math.round(this.stampAt * 1000)}:${i}` })
          }
        // the stamp heard as it meets the paper (the middle of the press, where it has come down from its hover), once a decision
        if (s >= (STAMP_INK.press[0] + STAMP_INK.press[1]) / 2 && !this.stampHeard) {
          this.stampHeard = true
          cue('stamp', { pos: home.node.getWorldPosition(new Vector3()) })
        }
        noteTourEvent(rig.id, 2500) // the tour (#207)
      }
      return
    }
    if (seat === 0) {
      this.stampAt = null
      this.stampHeard = false
      this.stampInked = 0
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
    // #450 the shelf book (shelfRun.ts): out of its slot, read standing, back in the same slot
    if (goal.pose === 'shelfbook' && goal.shelf) return this.shelfErrand(rig, goal.shelf, inp)
    if (goal.pose === 'books' && resting) {
      const book = this.props.info(rig, 'book', 'prop_book')
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
    // 휴 drawing on the tablet (#164). Not while writing a wrap-up card: that is the card's own pose, beside the monitor with the body turned (#461)
    if (goal.pose === 'type' && inp.tablet && seat === 2 && resting) {
      const pen = this.props.info(rig, 'tablet_pen')
      const tab = this.nodes.desk_2_tablet
      if (pen && tab) {
        const c = tab.getWorldPosition(new Vector3())
        const sc = Math.max(0, u)
        const nib = new Vector3(c.x + 0.05 * Math.sin(sc * 1.1) + 0.02 * Math.sin(sc * 4), c.y + 0.005, c.z + 0.04 * Math.cos(sc * 0.8) + 0.02 * Math.cos(sc * 5))
        const held = this.writing(nib, fwd.clone().negate(), 0.071, 45 * DEG, 8 * DEG * Math.sin(sc * 5))
        this.grip(rig, 'r', 'tablet_pen', pen.node.name, true, held, inp)
        // the other hand on the keyboard's left third, a shortcut every 3–6 s (#461: it typed whole words before, leaning the hands to one side)
        this.typeAtDesk(rig, inp, seat, true, 'tablet')
      }
      return
    }
    // (not in a gap: the stretch takes both hands up, #490 B)
    if (goal.pose === 'idle' && resting && !goal.gap && goal.spot === `work_${seat}` && (seat === 0 || seat === 1 || seat === 3 || seat === 4)) {
      this.grip(rig, 'r', 'mouse', `desk_${seat}_mouse`, true, null, inp)
    }
    if (goal.pose === 'type' && resting) this.typeAtDesk(rig, inp, seat, false)
  }

  /**
   * Working at the desk (#225): the hands type what the schedule says, the right hand now and then goes to the mouse (the grip stage of the
   * mouse, blended with the keyboard hand), clicks and scrolls. `leftOnly`: the right hand holds the tablet pen.
   */
  private typeAtDesk(rig: AgentRig, inp: StageIn, seat: number, leftOnly: boolean, activity?: string) {
    // a plane gesture owns the hands while it lasts
    if (rig.gesture && inp.t < rig.gesture.until) return
    const ty = this.typist
    const t = ty.frozen[rig.id] ?? inp.t
    const frame = ty.step(rig, seat, {
      t,
      dt: inp.dt,
      reduced: inp.reduced,
      activity: activity ?? inp.status[rig.id]?.activity,
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
        const lean = LEAN_IN_M * (LEAN_MORE[plant.name] ?? 1) * pr.hold
        rig.leanOver(-Math.sin(heading) * lean, -Math.cos(heading) * lean)
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
    // reduced motion: a jump (stand → hand at the pour, hand → stand at the put) fades in instead of flying
    this.fadeCan(can.node, inp.reduced && (w.stage === 'pour' || w.stage === 'put') ? `${rig.id}:${w.stage}` : '', inp.t * 1000)
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
    const book = this.props.info(rig, 'book', 'prop_book')
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

  /** #455 each treat held: its hand, its prop, its pose this frame, its own materials (to fade it), the cues fired */
  private treatsHeld = new Map<string, { at: number; side: 'l' | 'r'; prop: string; kind: SnackKind; mats: Material[] | null; opacity: number; cued: Set<string>; pg?: Matrix4 }>()

  /**
   * #455 (office-ui.md 12.2): the treat taken in the free hand (paper-pass.md 3: the right one, the left when the right is busy; both busy: not held, the icon
   * shows as before), held before the chest, a coffee sipped once (#457's height), faded after TREAT_HOLD.holdS. The hand is driven to the treat's grip at
   * the hold (the bake's _grip_<side>), the fingers fitted to its contacts; the prop is out of the PropBank while it is held (drawn in treatDraw).
   */
  private treatHands(inp: StageIn) {
    const want = inp.treats ?? {}
    for (const [id, h] of [...this.treatsHeld]) {
      const t = want[id]
      if (!t || t.at !== h.at || !treatPhase(h.kind, (inp.now - h.at) / 1000, inp.reduced)) this.treatEnd(id)
    }
    for (const [id, t] of Object.entries(want)) {
      const rig = inp.rigs[id]
      if (!rig?.visible) continue
      const u = (inp.now - t.at) / 1000
      const ph = treatPhase(t.kind, u, inp.reduced)
      if (!ph) continue
      let h = this.treatsHeld.get(id)
      if (!h) {
        const hands = handsOf(rig)
        if (hands.both) continue
        const side: 'l' | 'r' = hands.busy === 'r' ? 'l' : 'r'
        h = { at: t.at, side, prop: TREAT_PROP[t.kind], kind: t.kind, mats: null, opacity: 1, cued: new Set() }
        this.treatsHeld.set(id, h)
        const node = this.sceneRef.getObjectByName(h.prop)
        if (node) this.props.borrowed.add(node)
      }
      const tgt = this.target(h.prop, `treat_${h.kind}`, h.side)
      if (!tgt) continue
      const hand = rig.parts.hands[h.side]
      const root = rig.parts.root
      root.updateWorldMatrix(true, false)
      const rq = root.getWorldQuaternion(new Quaternion())
      const sx = h.side === 'r' ? 1 : -1
      const head = rig.parts.head.position
      const H = TREAT_HOLD.hold
      const S = TREAT_HOLD.sip
      // before the chest; a sip lifts it before the face and tips it back
      const at = root.localToWorld(new Vector3(sx * H.side * (1 - ph.sip), head.y - H.belowHead + (H.belowHead - S.belowHead) * ph.sip, -H.forward + (H.forward - S.forward) * ph.sip))
      const right = new Vector3(1, 0, 0).applyQuaternion(rq)
      const q = new Quaternion().setFromAxisAngle(right, ((S.tiltDeg * Math.PI) / 180) * ph.sip).multiply(rq)
      const pose = new Matrix4().compose(at, q, ONE)
      const seat = Number(rig.id.split('_')[1])
      h.pg = this.treatGrip(h.kind, tgt.pg, ph.sip)
      const target = handFor(pose, h.pg, handGripMatrix(hand)).multiply(offsetOf(tgt.key, seat))
      const fit = this.holdFit(rig, h.side, tgt)
      rig.drive[h.side] = { target, w: ph.w, curl: null, angles: fit.hold, wc: ph.w, spread: null }
      h.opacity = ph.opacity
      // the sounds: the hand has it (not when that is within 0.2 s of the arrival), the coffee's sip at its top (none with reduced motion)
      const pos = at.clone()
      if (u >= TREAT_HOLD.takeAtS && takeSounds() && !h.cued.has('take')) {
        h.cued.add('take')
        treatCue('treat.take', { pos, agent: id, key: `treat:take:${id}:${t.at}` })
      }
      if (h.kind === 'coffee' && !inp.reduced && u >= SIP_TOP_S && !h.cued.has('sip')) {
        h.cued.add('sip')
        treatCue('drink.sip', { pos, agent: id, key: `treat:sip:${id}:${t.at}` })
      }
    }
  }

  /** #455 the treat's grip as it is drawn (TREAT_LOOK): its place scaled with the treat, lowered down it, turned about its up in a sip */
  private treatGrip(kind: SnackKind, pg: Matrix4, sip: number): Matrix4 {
    const look = TREAT_LOOK[kind]
    const p = new Vector3()
    const q = new Quaternion()
    const sc = new Vector3()
    pg.decompose(p, q, sc)
    p.multiplyScalar(look.scale)
    p.y -= look.gripDown
    const m = new Matrix4().compose(p, q, ONE)
    if (look.sipYawDeg && sip > 0) m.premultiply(new Matrix4().makeRotationY(((look.sipYawDeg * Math.PI) / 180) * sip))
    return m
  }

  /** #455 after the drives: each held treat where its hand's grip has it, faded in / out */
  private treatDraw(inp: StageIn) {
    for (const [id, h] of this.treatsHeld) {
      const rig = inp.rigs[id]
      const node = this.sceneRef.getObjectByName(h.prop)
      const tgt = this.target(h.prop, `treat_${h.kind}`, h.side)
      if (!rig || !node || !tgt) continue
      const hand = rig.parts.hands[h.side]
      hand.node.updateMatrixWorld(true)
      objectFor(hand.node.matrixWorld, handGripMatrix(hand), h.pg ?? tgt.pg).decompose(node.position, node.quaternion, node.scale)
      node.scale.setScalar(TREAT_LOOK[h.kind].scale)
      node.visible = rig.visible && h.opacity > 0.01
      if (!h.mats) {
        h.mats = []
        for (const m of meshesOf(node)) {
          m.material = (m.material as Material).clone()
          h.mats.push(m.material as Material)
        }
      }
      for (const mat of h.mats) {
        mat.transparent = h.opacity < 1
        mat.opacity = h.opacity
        mat.depthWrite = h.opacity >= 1
      }
    }
  }

  /** #455 a treat is over: back to the PropBank, hidden where it rests */
  private treatEnd(id: string) {
    const h = this.treatsHeld.get(id)
    if (!h) return
    this.treatsHeld.delete(id)
    const node = this.sceneRef.getObjectByName(h.prop)
    if (node) {
      this.props.borrowed.delete(node)
      node.visible = false
      node.scale.set(1, 1, 1)
    }
    for (const mat of h.mats ?? []) {
      mat.transparent = false
      mat.opacity = 1
      mat.depthWrite = true
    }
  }

  /** #455 tests and the debug panel: the hand a treat is in, or null */
  treatSide(agent: string) {
    return this.treatsHeld.get(agent)?.side ?? null
  }

  /**
   * #450 (lounge-props.md 6): a book from the second bookshelf. Pull: the right hand takes the spine (bookspine), the book comes 0.15 m out of its slot and
   * up before the chest (the low row: the body sinks 0.25 m and rises). Open: the left hand takes its open-book grip, the right one goes from the spine to the
   * other cover, the halves open. Read: before the face (0.28 m ahead, 0.18 m under the head), the open face 50° up. Close: it shuts and the right hand takes
   * the spine again. Put: before its slot, then pushed in with the spine to exactly its home, and let go. The book is never moved by anything but the hands.
   */
  private shelfErrand(rig: AgentRig, s: NonNullable<Goal['shelf']>, inp: StageIn) {
    if (s.stage === 'fetch') return
    const node = this.sceneRef.getObjectByName(s.book)
    if (!node) return
    const name = s.book
    const root = rig.parts.root
    const yaw = new Quaternion().setFromAxisAngle(UP, rig.heading)
    const right = new Vector3(Math.cos(rig.heading), 0, -Math.sin(rig.heading))
    const quat = (upDeg: number) => {
      const face = new Vector3(0, Math.cos((upDeg * Math.PI) / 180), Math.sin((upDeg * Math.PI) / 180)).applyQuaternion(yaw).normalize()
      return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, face, new Vector3().crossVectors(right, face)))
    }
    // before the chest closed (the cover to the reader, tipped 30°, as the low table's book is carried); open before the face, the pages 50° up
    const chest = new Matrix4().compose(root.localToWorld(new Vector3(-0.02, 1.0, -0.32)), quat(60), ONE)
    const head = rig.parts.headRestY
    const reading = new Matrix4().compose(root.localToWorld(new Vector3(0, head - 0.18, -0.28)), quat(40), ONE)
    const home = this.props.homeWorld(node)
    // out of the slot: toward the room (the spines face it), along the stand's line
    const out = home.clone().premultiply(new Matrix4().makeTranslation(Math.sin(rig.heading) * SHELF_PULL_M, 0, Math.cos(rig.heading) * SHELF_PULL_M))
    const lowRow = rowOf(name) === 1
    const u = s.u
    let held = chest
    let spine = false
    let open = 0
    let left = false
    const clockR = this.clocks.get(`${rig.id}:r`)
    if (s.stage === 'pull') {
      spine = true
      // the book stays in its slot until the hand has it, then 0.15 m out (to 0.6 s) and up before the chest (to 1.0 s)
      const got = clockR?.attachedAt
      const since = got == null ? -1 : inp.t - got
      held = since < 0 ? home : since < SHELF_S.pullOut ? blend(home, out, ease(since / SHELF_S.pullOut)) : blend(out, chest, ease((since - SHELF_S.pullOut) / SHELF_S.toChest))
      if (since >= 0) this.shelfCue('book.out', rig, node, `${s.block}:out`)
    } else if (s.stage === 'open') {
      // (designer) the right hand keeps the spine while the left comes to its grip; only once the left has the book does the right go over to the other
      // cover and the book open: a hand is on the book in every frame
      left = true
      spine = true
      const gotL = this.clocks.get(`${rig.id}:l`)?.attachedAt
      const sinceL = gotL == null ? -1 : inp.t - gotL
      open = inp.reduced ? 1 : sinceL < 0 ? 0 : ease(sinceL / SHELF_S.openSwap)
      held = blend(chest, reading, open)
    } else if (s.stage === 'read') {
      left = true
      spine = true
      open = 1
      held = reading
    } else if (s.stage === 'close') {
      left = true
      spine = true
      open = inp.reduced ? 0 : 1 - ease(u / SHELF_S.close)
      held = blend(chest, reading, open)
    } else {
      // put: before the slot (half the time), then pushed in to its home; the hand lets go once it is there
      // home by SHELF_S.putIn, a few frames there in the hand, then it lets go (the rest of the stage the hand opens and goes)
      spine = u < SHELF_S.putIn + 0.06
      const half = SHELF_S.putIn / 2
      held = inp.reduced || u >= SHELF_S.putIn ? home : u < half ? blend(chest, out, ease(u / half)) : blend(out, home, ease((u - half) / half))
      if (u >= SHELF_S.putIn / 2) this.shelfCue('book.in', rig, node, `${s.block}:in`)
    }
    // the low row: the body sinks while the book is taken out and put back (hover lower), up again as it comes away (or once it is in)
    if (lowRow && !inp.reduced) {
      const sink = s.stage === 'pull' ? Math.min(ease(u / 0.5), ease((SHELF_S.pull - u) / 0.5)) : s.stage === 'put' ? Math.min(ease(u / 0.35), ease((SHELF_S.put + 0.4 - u) / 0.4)) : 0
      rig.bodyDip = Math.max(rig.bodyDip, SHELF_SINK_M * Math.max(0, sink))
    }
    // the left hand on the open book first, then the right one's spine grip, which places the book (it has held it since the pull: the left's own lift
    // from where the book rests would pull it back to its slot), and the right hand goes over to the other cover as the book opens (its drive only)
    if (left) this.grip(rig, 'l', 'book', name, true, held, inp)
    this.grip(rig, 'r', 'bookspine', name, spine, held, inp)
    const pose = this.lastObjPose.clone()
    const tr = this.target(name, 'book', 'r')
    // the right hand from the spine grip to the other cover by the opening, blended (target, fingers, weight): never back to its own pose between the two
    const sp = rig.drive.r
    const fromSpine = sp?.target && sp.angles ? { target: sp.target.clone(), angles: [...sp.angles], w: sp.w, wc: sp.wc } : null
    if (left && tr && open > 0) {
      this.partner(rig, 'book', 'r', tr, pose, 'l', 1)
      const op = rig.drive.r
      if (fromSpine && op?.target && op.angles)
        rig.drive.r = { ...op, target: blend(fromSpine.target, op.target, open), angles: op.angles.map((x, i) => fromSpine.angles[i] * (1 - open) + x * open), w: fromSpine.w * (1 - open) + op.w * open, wc: fromSpine.wc * (1 - open) + op.wc * open }
    }
    // a page turns every 25–40 s while it is read (not with reduced motion), and book.page is heard as it starts
    const lf = this.shelfLeaves.get(name)
    if (lf) {
      const gm = inp.reduced ? 0 : rig.gestureMin
      const lead = Math.max(LEAD_S, gm)
      const dur = Math.max(TURN_S, gm)
      const back = Math.max(BACK_S, gm)
      const tau = s.stage === 'read' && !inp.reduced ? pageTau({ agent: rig.id, block: s.block }, u, lead, dur, back) : null
      if (tau === null) {
        lf.node.visible = false
        if (lf.theta !== 0) lf.set(0)
      } else {
        this.leafTurn(rig, name, lf, tau, lead, dur, back, pose)
        const k = `${rig.id}:${s.block}:${name}:${Math.round((u - tau) * 10)}`
        if (tau >= 0 && !this.shelfPaged.has(k)) {
          this.shelfPaged.add(k)
          if (this.shelfPaged.size > 64) this.shelfPaged.delete(this.shelfPaged.values().next().value!)
          cue('book.page', { pos: node.getWorldPosition(new Vector3()), agent: rig.id, key: `lounge:book.page:${k}` })
        }
      }
    }
    // the halves open with the reading grip
    const h = this.shelfHalves.get(name)
    if (h) {
      h.l.rotation.z = halfAngle('l') * open
      h.r.rotation.z = LIFT * open
    }
  }

  private shelfCue(name: 'book.out' | 'book.in', rig: AgentRig, node: Object3D, key: string) {
    const k = `${rig.id}:${key}`
    if (this.shelfCued.has(k)) return
    this.shelfCued.add(k)
    if (this.shelfCued.size > 64) this.shelfCued.delete(this.shelfCued.values().next().value!)
    cue(name, { pos: node.getWorldPosition(new Vector3()), agent: rig.id, key: `lounge:${name}:${k}` })
  }

  private setExtra(rig: AgentRig, side: 'l' | 'r', objName: string, fn: (pose: Matrix4) => void) {
    // the carry entry of the hand that holds the prop (water: the right hand, the book: the left)
    const e = [...this.carry.values()].find((x) => x.rig === rig && x.objName === objName && x.side === (side === 'r' ? 'r' : 'l'))
    if (e) e.extra = fn
  }

  /** each ping-pong player's side step as drawn last frame (#397) */
  private sideSteps = new Map<string, number>()
  private pouring: { rig: AgentRig; held: Matrix4; plant: Plant; flow: number; u: number; shakes: number } | null = null
  /**
   * Reduced motion (watering.md 5, #397): the can does not travel; it appears in the hand when the pour begins and back on its stand when it
   * is put, each with a 0.12 s fade. Its meshes get their own copy of the material the first time (the atlas material is shared).
   */
  private canFade: { key: string; t0: number; mats: Material[] | null; o: number } = { key: '', t0: 0, mats: null, o: 1 }
  /** `now`: the rigs' clock, ms (inp.t: it runs in the timelapse and the tests too) */
  private fadeCan(node: Object3D, key: string, now: number) {
    const f = this.canFade
    if (key !== f.key) {
      f.key = key
      f.t0 = now
    }
    const o = key ? Math.min(1, Math.max(0, (now - f.t0) / CAN_FADE_MS)) : 1
    if (o === f.o) return
    if (!f.mats) {
      f.mats = []
      for (const m of meshesOf(node)) {
        m.material = (m.material as Material).clone()
        f.mats.push(m.material as Material)
      }
    }
    f.o = o
    for (const mat of f.mats) {
      mat.transparent = o < 1
      mat.opacity = o
      mat.depthWrite = o >= 1
    }
  }
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
  /**
   * #370 A (desk-props.md 4, grips.md): the right hand on a thing of its own desk while deskTouch.ts says (the thing itself is moved by DeskLive on
   * the same clock): the signal's top light tapped, the lamp's switch pressed, the turntable's button pressed and its platter pushed 90° round by
   * the rim, the ring light's knob turned, the calendar's page lifted by its corner, the hourglass pinched at its pillars, lifted and put down
   * (turned between the fingers). The left hand types on (the keyboard's left third) when it was typing. False: no touch now, or its nodes are not
   * in the model.
   */
  private deskTouch(rig: AgentRig, goal: Goal, inp: StageIn, seat: number): boolean {
    const tc = inp.touches?.[rig.id]
    if (!tc) return false
    const { kind, u } = tc
    const want = u < TOUCH_S[kind].back
    const node = (name: string) => this.sceneRef.getObjectByName(name)
    if (kind === 'signal') this.button(rig, 'desk_3_signal', u, inp, 0.1, want)
    else if (kind === 'lamp') this.button(rig, 'desk_2_lamp_switch', u - (TOUCH_S.lamp.at - 0.5), inp, 0.12, want)
    else if (kind === 'turntable') {
      const c = node('desk_1_turntable_rim_contact_index')
      const tt = node('desk_1_turntable')
      if (u < 1.0 || !c || !tt) this.button(rig, 'desk_1_turntable', Math.min(u, 0.95), inp, 0.12, true)
      else {
        // the index on the rim, carried round with the push (the contact rests where the platter is unturned)
        const k = inp.reduced ? (u >= TURNTABLE_PUSH.from ? 1 : 0) : ease(Math.min(1, Math.max(0, (u - TURNTABLE_PUSH.from) / TURNTABLE_PUSH.s)))
        const pv = (tt.userData.pivot_at as number[] | undefined) ?? tt.getWorldPosition(new Vector3()).toArray()
        const pivot = new Vector3(pv[0], pv[1], pv[2])
        const q = new Quaternion().setFromAxisAngle(UP, k * TURNTABLE_PUSH.deg * DEG)
        const P = c.getWorldPosition(new Vector3()).sub(pivot).applyQuaternion(q).add(pivot)
        const n = contactNormal(this.sceneRef, c).applyQuaternion(q)
        this.indexOn(rig, P, n, 0, false, inp, want)
      }
    } else if (kind === 'knob' && node('desk_1_ringlight_knob_grip_r')) {
      // #370 C (designer): the knob pinched by the thumb (over it) and the index (under it), the hand turning with it (DeskLive turns it 20°)
      const k = node('desk_1_ringlight_knob')!
      k.updateWorldMatrix(true, false)
      this.grip(rig, 'r', 'ringknob', 'desk_1_ringlight_knob', want, k.matrixWorld.clone(), inp)
    } else if (kind === 'knob' || kind === 'calendar') {
      const c = node(kind === 'knob' ? 'desk_1_ringlight_knob_contact_index' : 'desk_0_calendar_page_contact_index')
      if (!c) return false
      c.updateWorldMatrix(true, false)
      this.indexOn(rig, c.getWorldPosition(new Vector3()), contactNormal(this.sceneRef, c), 0, false, inp, want)
    } else if (kind === 'paper') {
      if (!this.paperTouch(rig, u, inp)) return false
    } else if (kind === 'mixer') {
      // #370 C4 the right index and middle on fader_0's cap, going with it along its slot (its contact rests where the fader rests); the left hand
      // pinches knob_0 and turns with it, MIXER.lag later
      const c = node('desk_4_fader_0_contact_index')
      const f = node('desk_4_fader_0')
      if (!c || !f) return false
      const rest = (f.userData.liveRest as { p: Vector3 } | undefined)?.p
      const slid = rest ? f.position.clone().sub(rest) : new Vector3()
      if (f.parent) slid.transformDirection(f.parent.matrixWorld).multiplyScalar(f.position.clone().sub(rest ?? f.position).length())
      this.indexOn(rig, c.getWorldPosition(new Vector3()).add(slid), contactNormal(this.sceneRef, c), 0, false, inp, want)
      const k = node('desk_4_knob_0')
      if (k && node('desk_4_knob_0_grip_l')) {
        k.updateWorldMatrix(true, false)
        this.grip(rig, 'l', 'mixerknob', 'desk_4_knob_0', u >= MIXER.lag && u < TOUCH_S.mixer.back + MIXER.lag, k.matrixWorld.clone(), inp)
      }
    } else if (kind === 'snap') {
      if (!this.snapHand(rig, u, inp)) return false
    } else if (kind === 'leaf') {
      // #370 C3 the index fingertip along the leaf from its touch start to its end, riding it down as it gives (about the leaf's own pivot)
      const a = node('succulent_leaf_touch_0')
      const b = node('succulent_leaf_touch_1')
      const lf = node('succulent_leaf')
      if (!a || !b || !lf) return false
      const L = leafAt(u, inp.reduced)
      const first = LEAF_STROKE.strokes[0][0]
      const k = L.k >= 0 ? L.k : u < first ? 0 : u < LEAF_STROKE.strokes[1][0] ? 0 : 1
      const P = a.getWorldPosition(new Vector3()).lerp(b.getWorldPosition(new Vector3()), k)
      // the leaf turned by its sway about its own x through its pivot (as DeskLive turns it): the point under the finger goes with it
      const pv = lf.userData.pivot_at as number[]
      const pivot = new Vector3(pv[0], pv[1], pv[2])
      const ax = new Vector3(1, 0, 0).transformDirection(lf.matrixWorld)
      const turn = new Quaternion().setFromAxisAngle(ax, (L.sway * Math.PI) / 180)
      P.sub(pivot).applyQuaternion(turn).add(pivot)
      const n = contactNormal(this.sceneRef, a).applyQuaternion(turn)
      // between the strokes the finger is off it 1.5 cm (going back to the start)
      const off = L.k < 0 && u > first ? 0.015 : 0
      this.indexOn(rig, P, n, -off, false, inp, want)
    } else if (kind === 'swatch') {
      if (!this.swatchTouch(rig, tc.k ?? 0, u, inp)) return false
    } else if (TOUCH_PROP[kind]) {
      if (!this.deskProp(rig, kind, u, inp)) return false
    } else {
      // the hourglass: pinched at two pillars across (the thumb -x, the index +x: its turn axis through both), lifted and put
      // down; the hand does not turn with it
      const hg = node('desk_0_hourglass')
      const rest = hg?.userData.liveRest as { p: Vector3; q: Quaternion } | undefined
      if (!hg || !rest || !node('desk_0_hourglass_contact_thumb')) return false
      // where it is now (DeskLive lifts it by the touch and by as much as its turn would sink its plates into the coaster), turned as it rests: the
      // pinch is on its turn axis, so the fingers stay on it as it turns between them
      hg.updateWorldMatrix(true, false)
      const rq = rest.q.clone()
      if (hg.parent) rq.premultiply(new Quaternion().setFromRotationMatrix(hg.parent.matrixWorld))
      const held = new Matrix4().compose(hg.getWorldPosition(new Vector3()), rq, ONE)
      this.grip(rig, 'r', 'hourglass', 'desk_0_hourglass', want, held, inp)
    }
    // the shape takes both hands
    if (goal.pose === 'type' && kind !== 'shape' && kind !== 'swatch' && kind !== 'paper' && kind !== 'mixer') this.typeAtDesk(rig, inp, seat, true)
    return true
  }

  /**
   * #370 B3b (desk-props.md 4: 정리 때 IN 더미를 세워 탁탁 두 번): in the tidy-up's own beats, the planner's hands close on the IN pile's sides
   * (gather), stand it up 70° on its near edge 4 cm over the tray and tap it down twice (the taps), set it back exactly where it rests (keys) and
   * open (lean). False with no pile to square: the tidy-up's usual hands.
   */
  private pileTidy(rig: AgentRig, goal: Goal, inp: StageIn): boolean {
    const pile = TrayPile.of(this.sceneRef.getObjectByName('desk_0_in'))
    const b = goal.beat
    if (!pile || !b || inp.reduced || !(inp.inbox && inp.inbox > 0)) {
      pile?.pose(null)
      return false
    }
    const T = PILE_TIDY
    const e = (x: number) => ease(Math.min(1, Math.max(0, x)))
    // how far it stands (0..1) and how far it is tapped down (0..1)
    const stand = b.kind === 'tap' ? (b.k === 0 ? e(b.u / 0.4) : 1) : b.kind === 'keys' ? 1 - e(b.u) : 0
    const tap = b.kind === 'tap' && (b.k > 0 || b.u > 0.4) ? Math.sin(Math.PI * (b.k > 0 ? b.u : (b.u - 0.4) / 0.6)) : 0
    const size = pile.pileSize
    const rest = pile.pileRest()
    const edge = new Vector3(0, 0, size.max.z)
    const local = new Matrix4()
      .makeTranslation(0, T.lift * stand - T.tap * tap, 0)
      .multiply(new Matrix4().makeTranslation(edge.x, edge.y, edge.z))
      .multiply(new Matrix4().makeRotationX(T.standDeg * DEG * stand))
      .multiply(new Matrix4().makeTranslation(-edge.x, -edge.y, -edge.z))
    const pose = rest.clone().multiply(local)
    pile.pose(stand > 0 || tap !== 0 ? pose : null)
    // the hands on its sides, palms toward each other, the fingers along it away from the reader, at half its drawn height, near its near edge
    const w = b.kind === 'gather' ? e(b.u) : b.kind === 'lean' ? 1 - e(b.u / 0.4) : 1
    if (w <= 0) return b.kind !== 'lean'
    const q = new Quaternion().setFromRotationMatrix(pose)
    const px = new Vector3(1, 0, 0).applyQuaternion(q)
    const pz = new Vector3(0, 0, 1).applyQuaternion(q)
    // the hands at its near corners (2 cm in): the wrist cuffs, wider than the palms, stay off it; the fingers flat on its sides (curled, they go in)
    const cz = size.max.z - PILE_TIDY.near
    for (const side of ['l', 'r'] as const) {
      const x = side === 'l' ? size.min.x - T.out : size.max.x + T.out
      const at = new Vector3(x, size.height / 2, cz).applyMatrix4(pose)
      const palm = side === 'l' ? px.clone() : px.clone().negate()
      const fingers = pz.clone().negate()
      const target = new Matrix4().makeBasis(new Vector3().crossVectors(fingers, palm).normalize(), fingers, palm).setPosition(at.addScaledVector(palm, -T.palm))
      rig.drive[side] = { target, w, curl: [0, 0, 0, 0, 0.15, 0.3], wc: w, spread: null }
    }
    return true
  }

  /**
   * #370 B3 (grips.md 서류 한 장 집기, desk-props.md 4): the IN pile's top sheet pinched at its front-right corner, lifted before the chest and tipped
   * 55° up toward the face, held by both long sides as a sheet handed over is read (grips.md 낱장 옆 쥐고 읽기), and laid back on the pile squared (the count never changes: IN is what waits for the
   * owner). The sheet is the pile's own top sheet (TrayPile.lift), so nothing appears or goes.
   */
  private paperTouch(rig: AgentRig, u: number, inp: StageIn): boolean {
    const pile = TrayPile.of(this.sceneRef.getObjectByName('desk_0_in'))
    if (!pile) return false
    const P = PAPER_READ
    const S = TOUCH_S.paper
    const rest = pile.topRest()
    const squared = pile.topRest(true)
    const root = rig.parts.root
    root.updateWorldMatrix(true, false)
    // read before the chest, the sheet's own yaw kept (its +z toward the reader), tipped up toward the face
    const rq = new Quaternion().setFromRotationMatrix(rest)
    const right = new Vector3(Math.cos(rig.heading), 0, -Math.sin(rig.heading))
    const q = new Quaternion().setFromAxisAngle(right, P.tiltDeg * DEG).multiply(rq)
    const read = new Matrix4().compose(root.localToWorld(new Vector3(0.02, rig.parts.headRestY - 0.2, -0.28)), q, ONE)
    const k = (a: number, b: number) => ease(Math.min(1, Math.max(0, (u - a) / (b - a))))
    const held = u < P.take[0] ? rest : u < P.put[0] ? blend(rest, read, k(P.take[0], P.take[1])) : blend(read, squared, k(P.put[0], P.put[1]))
    if (u < S.back) pile.lift(u < P.take[0] ? null : held)
    else pile.lift(null, true)
    this.grip(rig, 'r', 'paper_corner', 'desk_0_in_top', u < S.back, u < S.back ? held : squared, inp)
    // both hands on the long sides while it is read (0.2 s from the corner to the side as it comes up, and back before it is laid down)
    const s2 = k(P.sides[0], P.sides[1]) * (1 - k(P.unside[0], P.unside[1]))
    if (s2 > 0) {
      const seat = Number(rig.id.split('_')[1])
      const side = (h: 'l' | 'r') => {
        const t = this.target('desk_0_in_top', 'paper_tray_side', h)
        if (!t) return null
        return { target: handFor(held, t.pg, handGripMatrix(rig.parts.hands[h])).multiply(offsetOf(t.key, seat)), angles: this.holdFit(rig, h, t).hold }
      }
      const r = side('r')
      const d = rig.drive.r
      if (r && d?.target && d.angles) rig.drive.r = { ...d, target: blend(d.target, r.target, s2), angles: d.angles.map((x, i) => x * (1 - s2) + r.angles[i] * s2), w: 1, wc: 1 }
      const l = side('l')
      if (l) rig.drive.l = { target: l.target, w: s2, curl: null, angles: l.angles, wc: s2, spread: null }
    }
    return true
  }

  /**
   * #370 B2 (grips.md 색견본 부채): the left hand closes round the fan's stand (desk_2_swatch_grip_l), the right index on the outermost chip's face as
   * the fan spreads (DeskLive turns the chips), then on chip `k`'s face 2.5 cm under its tip, pointing at it; both let go as the fan closes.
   */
  private swatchTouch(rig: AgentRig, k: number, u: number, inp: StageIn): boolean {
    const gl = this.sceneRef.getObjectByName('desk_2_swatch_grip_l')
    const chip = (i: number) => this.sceneRef.getObjectByName(`desk_2_swatch_leaf_${i}`)
    if (!gl || !chip(0)) return false
    const S = TOUCH_S.swatch
    // the left hand on the stand
    const hl = rig.parts.hands.l
    const wl = ease(Math.min(1, Math.max(0, u / 0.5))) * (1 - ease(Math.min(1, Math.max(0, (u - S.back) / 0.4))))
    gl.updateWorldMatrix(true, false)
    const spec = GRIPS.swatch.l!
    rig.drive.l = { target: handFor(gl.matrixWorld, new Matrix4(), handGripMatrix(hl)), w: wl, curl: spec.hold, wc: wl, spread: null }
    // the right index: on the outermost chip while it spreads, then on the chip pointed at
    const c = chip(u < SWATCH.point[0] ? 3 : k)
    const tip = c && this.sceneRef.getObjectByName(`${c.name}_tip`)
    if (!c || !tip) return true
    c.updateWorldMatrix(true, true)
    const up = new Vector3(0, 1, 0).transformDirection(c.matrixWorld)
    const n = new Vector3(0, 0, 1).transformDirection(c.matrixWorld)
    // the face toward the designer
    if (n.dot(rig.parts.root.position.clone().sub(c.getWorldPosition(new Vector3()))) < 0) n.negate()
    const P = tip.getWorldPosition(new Vector3()).addScaledVector(up, -0.025).addScaledVector(n, 0.0015)
    this.indexOn(rig, P, n, 0, false, inp, u >= 0.3 && u < S.back)
    return true
  }

  /**
   * #370 C4 (agents.md 2.11) 에코's finger snap: the right hand beside the face screen (the head's middle height, SNAP.out outside its right side, at its
   * front), the palm forward, the thumb and the middle tips together (the middle 0.6, the thumb (0.4, 0.9)); the middle flicked to 0.9 over 0.08 s, the
   * cue 'snap' as it lands. Reduced motion: no hand, the cue only.
   */
  private snapHand(rig: AgentRig, u: number, inp: StageIn): boolean {
    const [f0, f1] = SNAP.flick
    if (u >= f1 && this.snapped !== rig.id + ':' + Math.round(inp.t - u)) {
      this.snapped = rig.id + ':' + Math.round(inp.t - u)
      cue('snap', { pos: rig.parts.head.getWorldPosition(new Vector3()), agent: rig.id, key: `snap:${rig.id}:${Math.round((inp.now - u * 1000) / 1000)}` })
    }
    if (inp.reduced) return true
    const head = rig.parts.head
    head.updateWorldMatrix(true, true)
    const b = (this.headBoxes ??= new Map()).get(rig.id) ?? localBox(head)
    this.headBoxes.set(rig.id, b)
    const at = head.localToWorld(new Vector3(b.max.x + SNAP.out, (b.min.y + b.max.y) / 2, b.min.z))
    const hq = head.getWorldQuaternion(new Quaternion())
    const fwd = new Vector3(0, 0, -1).applyQuaternion(hq)
    const up = new Vector3(0, 1, 0).applyQuaternion(hq)
    const target = new Matrix4().makeBasis(new Vector3().crossVectors(up, fwd).normalize(), up, fwd).setPosition(at)
    const e = (x: number) => ease(Math.min(1, Math.max(0, x)))
    const w = u < SNAP.up ? e(u / SNAP.up) : 1 - e((u - SNAP.down[0]) / (SNAP.down[1] - SNAP.down[0]))
    const mid = 0.6 + 0.3 * e((u - f0) / (f1 - f0))
    rig.drive.r = { target, w, curl: [0.5, mid, 0.8, 0.85, 0.4, 0.9], wc: w, spread: null }
    return true
  }
  private snapped = ''
  private headBoxes: Map<string, Box3> | undefined

  /**
   * #370 C3 (desk-props.md 4 도장에 인주 묻혀 찍기): where the stamp is `s` s into a decision's stamping: taken where it rests, over to the ink pad
   * (an arc 4 cm up), dabbed twice (its face down onto the felt, `press` into it), back over to where it rests and pressed down there. Its face is the
   * bottom of its own box. Reduced motion: no dabs, lifted and pressed where it rests.
   */
  private stampPose(node: Object3D, s: number, inp: StageIn): Matrix4 {
    const home = this.props.homeWorld(node)
    const pad = this.sceneRef.getObjectByName('desk_0_inkpad')
    const I = STAMP_INK
    const k = (a: number, b: number) => ease(Math.min(1, Math.max(0, (s - a) / (b - a))))
    const hq = new Quaternion().setFromRotationMatrix(home)
    const hp = new Vector3().setFromMatrixPosition(home)
    const up = new Vector3(0, 1, 0)
    // the press on the paper: down from the hover over where it rests, and it stays there
    const pressed = () => hp.clone().addScaledVector(up, I.hover * (1 - k(I.press[0], (I.press[0] + I.press[1]) / 2)))
    if (!pad || inp.reduced) return new Matrix4().compose(s < I.press[0] ? hp.clone().addScaledVector(up, I.hover * k(0.2, 0.5)) : pressed(), hq, ONE)
    const face = (this.stampFace ??= localBox(node).min.y)
    const padPos = pad.getWorldPosition(new Vector3()).sub(new Vector3(0, face, 0).applyQuaternion(hq))
    const press = Number(pad.userData.press) || 0.002
    let p: Vector3
    if (s < I.toPad[0]) p = hp.clone()
    else if (s < I.toPad[1]) {
      const t = k(I.toPad[0], I.toPad[1])
      p = hp.clone().lerp(padPos.clone().addScaledVector(up, I.hover), t).addScaledVector(up, I.arc * Math.sin(Math.PI * t))
    } else if (s < I.dabs[1]) {
      // two dabs: down onto the felt (`press` into it) and up again, each half the time
      const f = ((s - I.dabs[0]) / (I.dabs[1] - I.dabs[0])) * 2
      p = padPos.clone().addScaledVector(up, I.hover - (I.hover + press) * Math.sin(Math.PI * (f % 1)))
    } else if (s < I.press[0]) {
      const t = k(I.dabs[1], I.press[0])
      p = padPos.clone().addScaledVector(up, I.hover).lerp(hp.clone().addScaledVector(up, I.hover), t).addScaledVector(up, I.arc * Math.sin(Math.PI * t))
    } else p = pressed()
    return new Matrix4().compose(p, hq, ONE)
  }
  private stampAt: number | null = null
  private stampHeard = false
  private stampInked = 0
  private stampFace: number | undefined

  /**
   * #370 C2 where the headphones are held for one cup to the right ear: the cup axis (their x, from the near cup to the far) along the head's side
   * turned HEADPHONES.tiltDeg out, the headband up, the near cup (swivelled HEADPHONES.swivelDeg: its cushion now faces their -z, the head) with its
   * cushion's centre on the side of the head at the ear's height. The head is the head's box at rest.
   */
  private headphoneHold(rig: AgentRig): { pos: Vector3; q: Quaternion } | null {
    const cup = this.sceneRef.getObjectByName('prop_headphones_cup')
    const hp = this.sceneRef.getObjectByName('prop_headphones')
    if (!cup || !hp) return null
    // the cushion in the headphones' frame as swivelled: the cup's rest (as attached to them) turned on its yoke, its cushion face (its own +x) at its
    // middle; the cushion's normal is the cup's +x
    const rest = cup.userData.liveRest as { p: Vector3; q: Quaternion } | undefined
    if (!rest) return null
    const c = (this.cushionAt ??= (() => {
      const box = localBox(cup)
      return new Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)
    })())
    const sw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (HEADPHONES.swivelDeg * Math.PI) / 180)
    const cq = rest.q.clone().multiply(sw)
    const cushion = c.clone().applyQuaternion(cq).add(rest.p)
    const nHp = new Vector3(1, 0, 0).applyQuaternion(cq)
    // the head as it is now (it turns and nods as the agent works): the headphones go with it
    const head = rig.parts.head
    head.updateWorldMatrix(true, true)
    const hq = head.getWorldQuaternion(new Quaternion())
    const right = new Vector3(1, 0, 0).applyQuaternion(hq)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(hq)
    const up = new Vector3(0, 1, 0).applyQuaternion(hq)
    // the cushion faces into the head, turned tiltDeg toward the front (the far cup out from the head's side), the headband up
    const t = (HEADPHONES.tiltDeg * Math.PI) / 180
    const nW = right.clone().multiplyScalar(-Math.cos(t)).addScaledVector(fwd, Math.sin(t))
    const basis = (n: Vector3, u: Vector3) => {
      const z = new Vector3().crossVectors(n, u).normalize()
      const y = new Vector3().crossVectors(z, n).normalize()
      return new Matrix4().makeBasis(n.clone().normalize(), y, z)
    }
    const q = new Quaternion().setFromRotationMatrix(basis(nW, up).multiply(basis(nHp, new Vector3(0, 1, 0)).invert()))
    // the ear: the head's right side at its middle height (the head's box in its own frame, measured once)
    const ear = (this.earAt ??= new Map()).get(rig.id) ?? (() => {
      const b = localBox(head)
      const e = new Vector3(b.max.x, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
      this.earAt!.set(rig.id, e)
      return e
    })()
    const E = head.localToWorld(ear.clone())
    return { pos: E.sub(cushion.applyQuaternion(q)), q }
  }
  /** #370 C2 the right hand on the near cup's shell (prop_headphones_cup_grip_r) where the cup is with the headphones where grip() put them */
  private cupHand(rig: AgentRig, u: number, inp: StageIn) {
    const d = rig.drive.r
    const cup = this.sceneRef.getObjectByName('prop_headphones_cup')
    const rest = cup?.userData.liveRest as { p: Vector3; q: Quaternion } | undefined
    const t = this.target('prop_headphones_cup', 'headphones_cup', 'r')
    if (!d?.target || !cup || !rest || !t) return
    const sw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (cupSwivel(u, inp.reduced) * Math.PI) / 180)
    const cupWorld = this.lastObjPose.clone().multiply(new Matrix4().compose(rest.p, rest.q.clone().multiply(sw), ONE))
    const seat = Number(rig.id.split('_')[1])
    const target = handFor(cupWorld, t.pg, handGripMatrix(rig.parts.hands.r)).multiply(offsetOf(t.key, seat))
    rig.drive.r = { ...d, target, angles: this.holdFit(rig, 'r', t).hold }
  }
  private cushionAt: Vector3 | undefined
  private earAt: Map<string, Vector3> | undefined

  /**
   * #370 B a prop taken from the desk (grips.md): reached, lifted to where it is held (its own rotation as it rests: the duck still faces its owner),
   * held, put back exactly where it rests from back - PUT_S, let go at back. The duck before the face and squeezed once; the keycap before the chest,
   * rolled ±15° between the fingers; the shape at eye height, turned 30° slowly, the left hand open under it.
   */
  private deskProp(rig: AgentRig, kind: Touch['kind'], u: number, inp: StageIn): boolean {
    const name = TOUCH_PROP[kind]!
    const node = this.sceneRef.getObjectByName(name)
    if (!node) return false
    const S = TOUCH_S[kind]
    const root = rig.parts.root
    root.updateWorldMatrix(true, false)
    const head = rig.parts.headRestY
    const home = this.props.homeWorld(node)
    const hq = new Quaternion().setFromRotationMatrix(home)
    const at = (x: number, y: number, z: number) => root.localToWorld(new Vector3(x, y, z))
    const fwd = new Vector3(-Math.sin(rig.heading), 0, -Math.cos(rig.heading))
    let pos: Vector3
    let q = hq.clone()
    if (kind === 'headphones') {
      const h = this.headphoneHold(rig)
      if (!h) return false
      pos = h.pos
      q = h.q
    } else if (kind === 'duck') pos = at(0.02, head - 0.04, -0.2)
    else if (kind === 'keycap') {
      pos = at(0.06, head - 0.38, -0.24)
      const R = KEYCAP_ROLL
      const roll = !inp.reduced && u >= R.from && u < R.to ? R.deg * DEG * Math.sin(((u - R.from) / R.periodS) * Math.PI * 2) : 0
      q = new Quaternion().setFromAxisAngle(fwd, roll).multiply(q)
    } else {
      pos = at(0.03, head - 0.1, -0.28)
      const T = SHAPE_TURN
      const k = inp.reduced ? 0 : ease(Math.min(1, Math.max(0, (u - T.from) / T.s)))
      q = new Quaternion().setFromAxisAngle(UP, T.deg * DEG * k).multiply(q)
    }
    const hold = new Matrix4().compose(pos, q, ONE)
    const k = ease(Math.min(1, Math.max(0, (u - (S.back - PUT_S)) / PUT_S)))
    const held = k > 0 ? blend(hold, home, k) : hold
    this.grip(rig, 'r', kind, name, u < S.back, held, inp, name)
    // #370 C2 (designer, #574): the headphones are carried by the near cup, the palm round its shell pressing it to the ear (the DJ's one-ear
    // listen), not by the headband: the hand's drive goes to the cup's own grip where the cup is now (on the headphones, swivelled on its yoke)
    if (kind === 'headphones') this.cupHand(rig, u, inp)
    // the duck squeezed once (every finger +0.15 of its curl, 0.15 s)
    const d = rig.drive.r
    if (kind === 'duck' && u >= S.at && u < S.at + 0.15 && d?.angles) rig.drive.r = { ...d, angles: d.angles.map((a) => a * 1.15) }
    // the shape: the left hand open under it, palm up, 1 cm below (it stays where it holds as the shape turns)
    if (kind === 'shape') {
      const w = ease(Math.min(1, Math.max(0, (u - 0.7) / 0.3))) * (1 - ease(Math.min(1, Math.max(0, (u - (S.back - PUT_S)) / 0.3))))
      if (w > 0) {
        node.updateWorldMatrix(true, true)
        const bottom = new Box3().setFromObject(node).min.y
        const palmUp = new Matrix4().makeBasis(new Vector3().crossVectors(fwd, UP).normalize(), fwd, UP)
        palmUp.setPosition(pos.x - fwd.x * 0.03, bottom - SHAPE_TURN.under - 0.0225, pos.z - fwd.z * 0.03)
        rig.drive.l = { target: palmUp, w, curl: [0.15, 0.15, 0.15, 0.15, 0.1, 0.2], wc: w, spread: null }
      }
    }
    return true
  }

  /**
   * The right index fingertip pressing `name`'s contact (grips.md 버튼): on its surface, pressed between 0.5 s and 0.5 + holdS into it by the button's
   * own travel (BUTTON_TRAVEL, #559: the fingertip goes in with the button and no further, never into the case around it) and, as the press starts,
   * the whole hand 1 mm closer for 0.08 s (designer: the tap reads with the index's curl +0.07).
   */
  private button(rig: AgentRig, name: string, u: number, inp: StageIn, holdS = 0.1, want = true) {
    const contact = this.sceneRef.getObjectByName(`${name}_contact_index`)
    if (!contact) return
    const P = new Vector3().setFromMatrixPosition(contact.matrixWorld)
    const n = contactNormal(this.sceneRef, contact) // out of the button, toward the hand
    const pressed = u > 0.5 && u < 0.5 + holdS
    const tap = pressed && !inp.reduced && u - 0.5 < PRESS_TAP.s ? PRESS_TAP.m * Math.sin((Math.PI * (u - 0.5)) / PRESS_TAP.s) : 0
    this.indexOn(rig, P, n, pressed ? (BUTTON_TRAVEL[name] ?? 0) + tap : 0, pressed, inp, want)
  }

  /**
   * #370 A the right index fingertip on `P` (the surface's normal `n` out of it, toward the hand), `press` m into it, the other fingers folded
   * (grips.md 버튼): reached, held while `want`, then let go. The clock starts from the reach again after a while the hand was not on a button.
   */
  private indexOn(rig: AgentRig, P: Vector3, n: Vector3, press: number, pressed: boolean, inp: StageIn, want = true) {
    const key = `${rig.id}:r:button`
    const clock = this.clock(key)
    const last = this.lastGripT.get(key)
    if (last !== undefined && inp.t - last > 0.25 && clock.current.stage !== 'rest') clock.reset()
    this.lastGripT.set(key, inp.t)
    const out = clock.step(inp.t, want, { gestureMin: rig.gestureMin, reduced: inp.reduced })
    const hand = rig.parts.hands.r
    const idx = fingerModelOf(hand, 0, 'r')
    if (!idx) return
    const spec = GRIPS.button.r!
    // the hand points in along −n, palm down
    const y = n.clone().negate()
    const z = UP.clone().negate()
    const x = new Vector3().crossVectors(y, z).normalize()
    z.crossVectors(x, y)
    const c1 = spec.hold[0] + (pressed ? 0.07 : 0)
    const tip = tipAt(idx, c1, 0)
    const basis = new Matrix4().makeBasis(x, y, z)
    // (#370 A) it comes in and goes out along the normal (n is out of the surface), from 2 cm off: the blend from where the hand was never dips
    // under the surface
    // and for 0.15 s after it has it, it comes the last 6 mm down onto it (the arm catches up without going into it)
    const since = clock.attachedAt == null ? 0 : (inp.t - clock.attachedAt) / 0.15
    const settle = out.stage === 'approach' || out.stage === 'rest' ? 1 : 1 - ease(Math.min(1, Math.max(0, since)))
    // (#559) `press` is into the surface: n is out of it, toward the hand
    const origin = P.clone().addScaledVector(n, -press + 0.02 * (1 - out.wHand) + 0.006 * settle).sub(tip.clone().applyMatrix4(new Matrix4().extractRotation(basis)))
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
    this.leafTurn(rig, bookName, lf, tau, lead, dur, back, pose)
  }

  /** a leaf at `tau` s into its turn (from -lead to dur + back): the leaf bent, the right hand pinching its corner over the reading grip (#231) */
  private leafTurn(rig: AgentRig, bookName: string, lf: LeafBend, tau: number, lead: number, dur: number, back: number, pose: Matrix4) {
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

