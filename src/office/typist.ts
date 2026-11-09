// The hands at the keyboard and the mouse (#225, docs/design/typing.md). The schedule (typingSchedule.ts) says who presses what when; this puts
// it in the scene:
//  - the keycaps: each keyboard's one mesh gets a vertex shader that lowers vertex `_key` by press[_key] x key_travel_m along the keyboard's -y
//    (still one draw call); press goes 0 -> 1 in 40 ms around the key's actuation, back in 60 ms,
//  - the hands: the home position is solved once per seat from the real key tops (the four fingertips 1 cm over the home row), then each key
//    press is a fitted pair of finger poses (hover over the key, down on it), the hand shifting a little toward far keys. The drive carries the
//    hand's world matrix and its 20 joint angles, so the rig shows exactly what was fitted,
//  - the mouse: the right hand goes to the mouse by the grip stage (PlayStage.grip, #164), clicks move the buttons -2 degrees, the wheel turns,
//  - the input bus (inputEvents.ts): the events of the schedule as the clock passes them.
// Nothing here allocates per frame (a chunk, once per 12 s, and a fitted key, once per key, are the exceptions).
import {
  Matrix4,
  Quaternion,
  Vector3,
  type MeshBasicMaterial,
  type Mesh,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { DIP_K, POSES } from './handPose'
import { clampJoints, tipAtJoints, type FingerModel } from './grip'
import { fingerModelOf, palmDown, type AgentRig, type HandDrive } from './rig'
import { emitInput, hasInputListeners } from './inputEvents'
import {
  ChunkCache,
  FINGERING,
  HOME,
  modeOf,
  PRESS_IN_S,
  PRESS_OUT_S,
  chunkIndexAt,
  pressAt,
  type Chunk,
  type Episode,
  type Hand,
  type KeyPress,
  type SchedEvent,
} from './typingSchedule'

const UP = new Vector3(0, 1, 0)
const DEG = Math.PI / 180
/** the fingertips rest this high over the home row; over a key they are about to press */
const HOVER_HOME = 0.01
const HOVER_KEY = 0.006
/** the hand follows a far key this far (share of the distance, at most m) */
const SHIFT_SHARE = 0.5
const SHIFT_MAX = 0.03
/** the most the hand moves from home to reach a key, m */
const SHIFT_REACH = 0.06
/** the hand turns in at most this much about the vertical (wrists out, fingertips in), degrees */
const YAW_MAX = 20
/** the weight of the hands' typing drive ramps in / out this long, s */
const RAMP_S = 0.3
const KEYS = 87
/** the button's press about its local x, degrees (the glb: pivot on the hinge line) */
const BUTTON_DEG = -2
const WHEEL_NOTCH_DEG = 18

type Side = 'l' | 'r'
const SIDES: Side[] = ['l', 'r']
const smooth = (x: number) => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x
  return k * k * (3 - 2 * k)
}
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

// ------------------------------------------------------------------------------------------------------------ keyboards

interface KeyInfo {
  code: string
  idx: number
  /** the top of the keycap, world */
  top: Vector3
}

/** a keyboard's keycap mesh: material with the press shader, the press array, the keys' world tops */
export class Keyboard {
  readonly press = new Float32Array(KEYS)
  readonly byCode = new Map<string, KeyInfo>()
  private dirty = false
  readonly travel: number

  constructor(readonly seat: number, readonly mesh: Mesh) {
    const ud = mesh.userData as { keys?: { code: string; top: number[] }[]; key_travel_m?: number }
    this.travel = typeof ud.key_travel_m === 'number' ? ud.key_travel_m : 0.0035
    mesh.updateWorldMatrix(true, false)
    ;(ud.keys ?? []).forEach((k, idx) => this.byCode.set(k.code, { code: k.code, idx, top: new Vector3(k.top[0], k.top[1], k.top[2]).applyMatrix4(mesh.matrixWorld) }))
    // the model's own material, copied, with the press added to its vertex shader (one program, one draw call)
    const src = mesh.material as MeshBasicMaterial
    const mat = src.clone()
    const uniform = { value: this.press }
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.press = uniform
      shader.uniforms.keyTravel = { value: this.travel }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float _key;\nuniform float press[87];\nuniform float keyTravel;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y -= press[int(_key + 0.5)] * keyTravel;')
    }
    mat.customProgramCacheKey = () => 'keycap-press'
    mesh.material = mat
  }

  /** the keycap top of a key, world (null: this keyboard has no such key) */
  top(code: string): Vector3 | null {
    return this.byCode.get(code)?.top ?? null
  }
  set(idx: number, p: number) {
    if (p > this.press[idx]) this.press[idx] = p
    this.dirty = true
  }
  /** zero every key (before the frame's presses are put in) */
  clear() {
    if (this.dirty) this.press.fill(0)
    this.dirty = false
  }
}

// ------------------------------------------------------------------------------------------------------------- fitting

const tipTmp = new Vector3()
/**
 * Joints that put a finger's tip on `target` (the hand's frame), by a coarse grid over MCP / PIP and a coordinate descent, near `prior`
 * (what it does at home). A finger [MCP, PIP, total abduction]; the thumb [CMC flex, CMC abduct, MCP, IP]. Returns the error, m.
 */
export function solveTip(m: FingerModel, target: Vector3, prior: readonly number[]): { joints: number[]; err: number } {
  const dim = prior.length
  const scale = m.thumb ? [45, 60, 50, 80] : [85, 100, 30]
  const cost = (v: number[]) => {
    tipAtJoints(m, v, tipTmp)
    let p = 0
    for (let k = 0; k < dim; k++) p += ((v[k] - prior[k]) / scale[k]) ** 2
    return tipTmp.distanceToSquared(target) + 2e-6 * p
  }
  const feas = (v: number[]) => clampJoints(m, v)
  let best = { v: feas([...prior]), c: 0 }
  best.c = cost(best.v)
  const consider = (v: number[]) => {
    const w = feas(v)
    const c = cost(w)
    if (c < best.c) best = { v: w, c }
  }
  if (m.thumb) {
    for (let a = -10; a <= 40; a += 25) for (let b = 0; b <= 60; b += 20) for (let c = 0; c <= 50; c += 25) for (let d = -10; d <= 70; d += 27) consider([a, b, c, d])
  } else {
    for (let a = -15; a <= 90; a += 15) for (let b = 0; b <= 100; b += 15) consider([a, b, prior[2]])
  }
  const step = m.thumb ? [8, 8, 8, 10] : [8, 8, 4]
  for (let it = 0; it < 220; it++) {
    let moved = false
    for (let k = 0; k < dim; k++)
      for (const sg of [1, -1]) {
        const v = best.v.slice()
        v[k] += sg * step[k]
        const w = feas(v)
        const c = cost(w)
        if (c < best.c - 1e-20) {
          best = { v: w, c }
          moved = true
        }
      }
    if (!moved) {
      for (let k = 0; k < dim; k++) step[k] *= 0.6
      if (step[0] < 0.02) break
    }
  }
  tipAtJoints(m, best.v, tipTmp)
  return { joints: best.v, err: tipTmp.distanceTo(target) }
}

/** a finger's [MCP, PIP, total abduction] from the typing pose (the prior at every key) */
const typeJoints = (f: number) => [POSES.type.f[f].mcp, POSES.type.f[f].pip, POSES.type.f[f].abd]
const typeThumb = () => [POSES.type.thumb.cmcFlex, POSES.type.thumb.cmcAbd, POSES.type.thumb.mcp, POSES.type.thumb.ip]

export interface KeyFit {
  /** the joints with the fingertip just over the key, and down on it (a finger: 3, the thumb: 4) */
  hover: number[]
  down: number[]
  /** how far the hand moves toward this key, world m */
  shift: Vector3
  /** the fingertip's distance from its target at the bottom of the press, m */
  err: number
}

/** one hand at one desk: where it rests and the finger models it is fitted with */
export interface HandSolve {
  side: Side
  pos: Vector3
  quat: Quaternion
  inv: Quaternion
  /** the finger models: index … little, thumb */
  models: FingerModel[]
  /** each finger's home joints (index … little: 3, thumb: 4) and the world point its tip rests at */
  home: number[][]
  target: Vector3[]
  /** worst home distance, m */
  homeErr: number
  /** the hand's turn about the vertical from the palm-down frame, degrees */
  yaw: number
}

export function solveHand(rig: AgentRig, seat: number, side: Side, kb: Keyboard, heading: number): HandSolve | null {
  const hand = rig.parts.hands[side]
  const models: FingerModel[] = []
  for (let f = 0; f < 4; f++) {
    const m = fingerModelOf(hand, f, side)
    if (!m) return null
    models.push(m)
  }
  const th = fingerModelOf(hand, 'thumb', side)
  if (!th) return null
  models.push(th)
  const q0 = new Quaternion().setFromAxisAngle(UP, heading).multiply(palmDown(side)).multiply(hand.restQuat)
  const target: Vector3[] = []
  for (let f = 0; f < 4; f++) {
    const top = kb.top(HOME[side][f as 0 | 1 | 2 | 3])
    if (!top) return null
    target.push(top.clone().addScaledVector(UP, HOVER_HOME))
  }
  const space = kb.top('Space')
  if (!space) return null
  // the thumbs hang over the space bar, the left a little to the left, the right to the right (local +x of the keyboard is the user's right)
  const along = new Vector3(1, 0, 0).transformDirection(kb.mesh.matrixWorld)
  target.push(space.clone().addScaledVector(along, side === 'r' ? 0.02 : -0.03).addScaledVector(UP, HOVER_HOME))
  // the hand's turn about the vertical (the wrists out, the fingertips in) and place: least squares over the four fingertips of the typing pose
  const tips = [0, 1, 2, 3].map((f) => tipAtJoints(models[f], typeJoints(f)))
  let best = { cost: Infinity, yaw: 0, pos: new Vector3() }
  const q = new Quaternion()
  const yq = new Quaternion()
  for (let deg = -YAW_MAX; deg <= YAW_MAX; deg += 1) {
    yq.setFromAxisAngle(UP, deg * DEG)
    q.copy(yq).multiply(q0)
    const r = tips.map((t) => t.clone().applyQuaternion(q))
    const pos = new Vector3()
    for (let f = 0; f < 4; f++) pos.add(target[f]).sub(r[f])
    pos.multiplyScalar(0.25)
    let cost = 0
    for (let f = 0; f < 4; f++) cost += tips[f].clone().applyQuaternion(q).add(pos).distanceToSquared(target[f])
    if (cost < best.cost) best = { cost, yaw: deg, pos }
  }
  const quat = new Quaternion().setFromAxisAngle(UP, best.yaw * DEG).multiply(q0)
  const inv = quat.clone().invert()
  const home: number[][] = []
  let homeErr = 0
  for (let f = 0; f < 4; f++) {
    const s = solveTip(models[f], target[f].clone().sub(best.pos).applyQuaternion(inv), typeJoints(f))
    home.push(s.joints)
    homeErr = Math.max(homeErr, s.err)
  }
  const ts = solveTip(models[4], target[4].clone().sub(best.pos).applyQuaternion(inv), typeThumb())
  home.push(ts.joints)
  homeErr = Math.max(homeErr, ts.err)
  void seat
  return { side, pos: best.pos, quat, inv, models, home, target, homeErr, yaw: best.yaw }
}

/** how the hand shifts for a key a finger reaches for: toward the key from where that finger rests, flat (the thumb does not shift) */
export function shiftFor(hs: HandSolve, kb: Keyboard, finger: number, code: string, out = new Vector3()): Vector3 {
  out.set(0, 0, 0)
  const top = kb.top(code)
  if (!top || finger === 4) return out
  out.copy(top).sub(hs.target[finger]).setY(0)
  // the finger's own rest above its home key is not a distance to travel: only what the key is away from the home key
  const home = kb.top(HOME[hs.side][finger as 0 | 1 | 2 | 3])
  if (home) out.copy(top).sub(home).setY(0)
  const d = out.length()
  if (d < 1e-6) return out.set(0, 0, 0)
  return out.multiplyScalar(Math.min(SHIFT_MAX, d * SHIFT_SHARE) / d)
}

/** the fitted hover and down joints of a finger for a key, the hand placed at its home plus the shift */
export function fitKey(hs: HandSolve, kb: Keyboard, finger: number, code: string, travel: number, reduced: boolean): KeyFit | null {
  const top = kb.top(code)
  if (!top) return null
  const shift = shiftFor(hs, kb, finger, code)
  if (reduced) shift.set(0, 0, 0)
  const origin = new Vector3()
  const m = hs.models[finger]
  const prior = hs.home[finger]
  // the thumb on the space bar keeps its own lateral place over it
  const at = (up: number) => {
    const w = finger === 4 && code === 'Space' ? new Vector3(hs.target[4].x, top.y, hs.target[4].z) : top.clone()
    return w.addScaledVector(UP, up).sub(origin).applyQuaternion(hs.inv)
  }
  let best: KeyFit | null = null
  // a finger that cannot get there bends as far as it goes and the hand follows what is left (flat), a few rounds
  for (let round = 0; round < 4; round++) {
    origin.copy(hs.pos).add(shift)
    const hover = solveTip(m, at(HOVER_KEY), prior)
    const downTarget = at(-travel + 0.0005)
    const down = solveTip(m, downTarget, hover.joints)
    if (!best || down.err < best.err) best = { hover: hover.joints, down: down.joints, shift: shift.clone(), err: down.err }
    if (down.err < 0.0015 || reduced) break
    const rest = downTarget.sub(tipAtJoints(m, down.joints)).applyQuaternion(hs.quat)
    rest.y = 0
    shift.addScaledVector(rest, 0.9)
    if (shift.length() > SHIFT_REACH) shift.multiplyScalar(SHIFT_REACH / shift.length())
  }
  return best
}

// ---------------------------------------------------------------------------------------------------------------- the typist

interface SeatState {
  kb: Keyboard
  hands: Record<Side, HandSolve>
  heading: number
  fits: Map<string, KeyFit | null>
  /** the same for reduced motion (the hand does not travel) */
  fitsReduced: Map<string, KeyFit | null>
  /** the common keys are all fitted (warm() has nothing left to do): normal / reduced */
  warmed: [boolean, boolean]
  /** the mouse: the buttons and the wheel (null at a desk without one) */
  mouse: { l: Object3D; r: Object3D; wheel: Object3D; restL: Quaternion; restR: Quaternion; restW: Quaternion } | null
  /** the wheel's angle now / wanted, rad */
  wheel: { now: number; want: number }
  /** the wheel's index fit: the joints with the index tip on the wheel, for the hand of the mouse grip (null until it was computed) */
  wheelFit: number[] | null
  /** how far that fit is from the wheel top, m */
  wheelErr: number
  /** how far the hand slides toward the wheel while it scrolls, world m */
  wheelShift: Vector3
}

interface AgentState {
  ramp: number
  lastT: number
  /** the time the events were sent up to */
  sent: number
  drive: Record<Side, HandDrive>
  tmp: Record<Side, Float64Array>
  mouseHold: boolean
  /** the chunk's press lists per hand: all keys of the hand in time order (built once per chunk) */
  byHand: { chunk: Chunk | null; l: KeyPress[]; r: KeyPress[] }
  lastSeen: number
  /** the chunk of the last frame, so a frame asks the cache (and builds its key) only when the 12 s window or the activity changes */
  cur: { chunk: Chunk; index: number; mode: string; d: number; mouse: boolean } | null
}

export interface StepOpts {
  t: number
  dt: number
  reduced: boolean
  activity: string | undefined
  /** the timelapse stretch, 1 = real time */
  dilation: number
  /** no keys, no events (x16): the hands rest at home */
  still: boolean
  /** the right hand holds a pen: only the left types */
  leftOnly: boolean
  hasMouse: boolean
}

export interface TypeFrame {
  /** the right hand should be on the mouse now (an episode window) */
  mouseWant: boolean
  chunk: Chunk
  /** keyboard drive of the right hand, for the mouse blend */
  kb: HandDrive
}

export class Typist {
  private readonly cache = new ChunkCache()
  private readonly keyboards: (Keyboard | null)[] = []
  private readonly seats = new Map<number, SeatState | null>()
  private readonly agents = new Map<string, AgentState>()
  /** ?debug=1: an activity forced from outside */
  forced: Record<string, string | undefined> = {}
  /** ?debug=1: the schedule time an agent is held at (a still for close-ups; the grip stages go on with the real clock) */
  frozen: Record<string, number | undefined> = {}
  private readonly v1 = new Vector3()
  private readonly v2 = new Vector3()
  private readonly q1 = new Quaternion()
  private readonly q2 = new Quaternion()
  private readonly ones = new Vector3(1, 1, 1)
  private readonly shift = new Vector3()
  private readonly shiftB = new Vector3()
  private readonly scl = new Vector3()

  constructor(private readonly nodes: Record<string, Object3D>) {
    // ?debug=1&typing=off: no typing at all (the frame-cost baseline)
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
    if (q?.has('debug') && q.get('typing') === 'off') {
      for (let i = 0; i < 5; i++) this.keyboards.push(null)
      return
    }
    for (let i = 0; i < 5; i++) {
      const mesh = nodes[`kb_${i}_caps`] as Mesh | undefined
      this.keyboards.push(mesh && (mesh.userData as { keys?: unknown }).keys && mesh.geometry.getAttribute('_key') ? new Keyboard(i, mesh) : null)
    }
  }

  keyboard(seat: number) {
    return this.keyboards[seat] ?? null
  }

  /** debug / tests: the fitted state of a seat (built at once) */
  seatState(rig: AgentRig, seat: number): SeatState | null {
    return this.seat(rig, seat)
  }

  private seat(rig: AgentRig, seat: number): SeatState | null {
    let s = this.seats.get(seat)
    if (s !== undefined) return s
    const kb = this.keyboards[seat]
    if (!kb) {
      this.seats.set(seat, null)
      return null
    }
    // the heading the agent sits with: the nav spot's, else its own now
    const nav = rig.parts.root.parent?.getObjectByName(`nav_work_${seat}`)
    const heading = typeof nav?.userData.ry === 'number' ? (nav.userData.ry as number) : rig.heading
    const l = solveHand(rig, seat, 'l', kb, heading)
    const r = solveHand(rig, seat, 'r', kb, heading)
    if (!l || !r) {
      this.seats.set(seat, null)
      return null
    }
    const wheel = this.nodes[`desk_${seat}_mouse_wheel`]
    const bl = this.nodes[`desk_${seat}_mouse_l`]
    const br = this.nodes[`desk_${seat}_mouse_r`]
    s = {
      kb,
      hands: { l, r },
      heading,
      fits: new Map(),
      fitsReduced: new Map(),
      warmed: [false, false],
      mouse: wheel && bl && br ? { l: bl, r: br, wheel, restL: bl.quaternion.clone(), restR: br.quaternion.clone(), restW: wheel.quaternion.clone() } : null,
      wheel: { now: 0, want: 0 },
      wheelFit: null,
      wheelErr: 0,
      wheelShift: new Vector3(),
    }
    this.seats.set(seat, s)
    return s
  }

  /** the fit of a finger for a key; `fid` (hand + finger + code) is its name in the tables */
  private fit(s: SeatState, side: Side, finger: number, code: string, fid: string, reduced: boolean): KeyFit | null {
    const table = reduced ? s.fitsReduced : s.fits
    let f = table.get(fid)
    if (f === undefined) {
      f = fitKey(s.hands[side], s.kb, finger, code, s.kb.travel, reduced)
      table.set(fid, f)
    }
    return f
  }

  /** fit the keys of a chunk before they are needed (a few per frame; called with a time budget in ms) */
  warm(rig: AgentRig, seat: number, budgetMs: number, reduced: boolean) {
    const s = this.seat(rig, seat)
    if (!s) return
    const w = reduced ? 1 : 0
    if (s.warmed[w]) return
    const t0 = performance.now()
    for (const [code, fg, fid] of WARM) {
      if ((reduced ? s.fitsReduced : s.fits).has(fid)) continue
      this.fit(s, fg.hand, fg.finger, code, fid, reduced)
      if (performance.now() - t0 > budgetMs) return
    }
    s.warmed[w] = true
  }

  private agent(id: string, rig: AgentRig): AgentState {
    let a = this.agents.get(id)
    if (!a) {
      const mk = (): HandDrive => ({ target: new Matrix4(), w: 0, curl: null, angles: new Array(20).fill(0), wc: 0, spread: null })
      a = { ramp: 0, lastT: -1, sent: -Infinity, drive: { l: mk(), r: mk() }, tmp: { l: new Float64Array(5 * 4), r: new Float64Array(5 * 4) }, mouseHold: false, byHand: { chunk: null, l: [], r: [] }, lastSeen: -1, cur: null }
      this.agents.set(id, a)
    }
    void rig
    return a
  }

  private chunkOf(a: AgentState, agent: string, activity: string | undefined, index: number, d: number, mouse: boolean): Chunk {
    const mode = modeOf(activity)
    const c = a.cur
    if (c && c.index === index && c.mode === mode && c.d === d && c.mouse === mouse) return c.chunk
    const chunk = this.cache.get(agent, activity, index, { dilation: d, mouse })
    // the loop of send() asks for the chunks between two frames: only the newest one is kept
    a.cur = { chunk, index, mode, d, mouse }
    return chunk
  }

  /** the rig's keyboard side drive this frame, or null when it does not type (call fade() then) */
  step(rig: AgentRig, seat: number, o: StepOpts): TypeFrame | null {
    const s = this.seat(rig, seat)
    if (!s) return null
    const a = this.agent(rig.id, rig)
    const activity = this.forced[rig.id] ?? o.activity
    const d = Math.max(1, o.dilation)
    const t = o.t
    const hasMouse = o.hasMouse && !!s.mouse
    const chunk = this.chunkOf(a, rig.id, activity, chunkIndexAt(t, d), d, hasMouse)
    // a jump of the clock (a seek, a long stall): nothing is sent for the time skipped
    const jump = a.sent === -Infinity || t < a.sent || t - a.sent > 0.5 * d || o.still
    if (!o.still) this.send(rig, s, a, t, activity, d, hasMouse, o, jump)
    else a.sent = -Infinity
    a.lastT = t
    a.ramp = Math.min(1, a.ramp + o.dt / RAMP_S)
    if (a.byHand.chunk !== chunk) {
      a.byHand.chunk = chunk
      a.byHand.l = chunk.keys.filter((k) => k.hand === 'l')
      a.byHand.r = chunk.keys.filter((k) => k.hand === 'r')
    }
    const kb = s.kb
    kb.clear()
    const live = !o.still
    for (const side of SIDES) {
      if (side === 'r' && o.leftOnly) continue
      this.hand(rig, s, a, side, chunk, t, d, o.reduced, live, o)
    }
    if (live) {
      for (const k of chunk.keys) {
        if (k.t - PRESS_IN_S * 0.5 * d > t) break
        if (o.leftOnly && k.hand === 'r') continue
        const info = kb.byCode.get(k.code)
        if (info) kb.set(info.idx, pressAt(k, t, d))
      }
    }
    if (s.mouse) this.mouseVisual(s, chunk, t, o.dt, live)
    let mouseWant = false
    if (live && hasMouse && !o.reduced) for (let i = 0; i < chunk.episodes.length; i++) if (t >= chunk.episodes[i].t0 && t <= chunk.episodes[i].t1) mouseWant = true
    a.drive.l.w = a.drive.l.wc = a.drive.r.w = a.drive.r.wc = a.ramp
    rig.drive.l = a.drive.l
    if (!o.leftOnly) rig.drive.r = a.drive.r
    return { mouseWant, chunk, kb: a.drive.r }
  }

  /** the agent is not typing this frame: let the drive's weight go down (rig.drive is the caller's) */
  fade(rig: AgentRig, dt: number) {
    const a = this.agents.get(rig.id)
    if (!a || a.ramp <= 0) return
    a.ramp = Math.max(0, a.ramp - dt / (RAMP_S * 0.7))
    a.sent = -Infinity
    for (const side of SIDES) {
      const dv = a.drive[side]
      dv.w = dv.wc = a.ramp
      if (a.ramp > 0 && !rig.drive[side]) rig.drive[side] = dv
    }
    const s = this.seats.get(Number(rig.id.split('_')[1]))
    if (s) {
      s.kb.clear()
      s.wheel.want = s.wheel.now
    }
  }

  // ------------------------------------------------------------------------------------------------------------ hands

  /** the hand's drive for time t: its matrix (home plus the shift toward the key in hand) and the 20 angles */
  private hand(rig: AgentRig, s: SeatState, a: AgentState, side: Side, chunk: Chunk, t: number, d: number, reduced: boolean, live: boolean, o: StepOpts) {
    const hs = s.hands[side]
    const dv = a.drive[side]
    const ang = dv.angles as number[]
    const lists = chunk.byFinger[side]
    // the hand's shift: toward the key of the press that started last
    this.shift.set(0, 0, 0)
    if (live && !reduced) this.handShift(s, a, side, t, d)
    this.v1.copy(hs.pos).add(this.shift)
    dv.target!.compose(this.v1, hs.quat, this.ones)
    // each finger
    for (let f = 0; f < 5; f++) {
      const out = a.tmp[side]
      const n = f === 4 ? 4 : 3
      this.fingerAt(s, side, f, live ? lists[f] : EMPTY, t, d, reduced, out, f * 4)
      if (f < 4) {
        ang[f * 4] = out[f * 4]
        ang[f * 4 + 1] = out[f * 4 + 1]
        ang[f * 4 + 2] = DIP_K[f] * out[f * 4 + 1]
        ang[f * 4 + 3] = out[f * 4 + 2]
      } else {
        ang[16] = out[16]
        ang[17] = out[17]
        ang[18] = out[18]
        ang[19] = out[19]
      }
      void n
    }
    // the left fingers tap while a command runs and the right hand waits on the mouse
    if (side === 'l' && live && !reduced && o.hasMouse) {
      let ep: Episode | null = null
      for (let i = 0; i < chunk.episodes.length; i++) {
        const e = chunk.episodes[i]
        if (e.tap && t >= e.t0 + 0.5 * d && t <= e.t1) ep = e
      }
      if (ep) {
        const phase = (t - ep.t0) / (0.5 * d)
        const f = Math.floor(phase) % 4
        const pulse = Math.sin(Math.PI * (phase - Math.floor(phase)))
        ang[f * 4] += 10 * pulse
        ang[f * 4 + 1] += 20 * pulse
        ang[f * 4 + 2] = DIP_K[f] * ang[f * 4 + 1]
      }
    }
    void rig
  }

  private handShift(s: SeatState, a: AgentState, side: Side, t: number, d: number) {
    const list = a.byHand[side]
    if (!list.length) return
    const lead = 0.1 * d
    // the press that started last (shift reaches its value 0.1 d before the key goes down)
    let j = -1
    for (let i = 0; i < list.length; i++) {
      if (list[i].t - lead > t) break
      j = i
    }
    if (j < 0) return
    const k = list[j]
    const hs = s.hands[side]
    shiftFor(hs, s.kb, k.finger, k.code, this.shiftB)
    const rel = k.t + k.hold + PRESS_OUT_S * d
    const next = list[j + 1]
    // before it: from where the one before left it (0 after a long stop)
    let from = 0
    if (j > 0) {
      const p = list[j - 1]
      if (k.t - (p.t + p.hold) < 0.5 * d) {
        shiftFor(hs, s.kb, p.finger, p.code, this.v2)
        from = 1
      }
    }
    const u = smooth((t - (k.t - lead)) / (0.8 * lead))
    this.shift.copy(this.shiftB).multiplyScalar(u)
    if (from) this.shift.addScaledVector(this.v2, 1 - u)
    // after the last key of a run: back to home
    if (t > rel && (!next || next.t - lead > rel + 0.3 * d)) this.shift.multiplyScalar(1 - smooth((t - rel) / (0.25 * d)))
  }

  private jOut: Float64Array = new Float64Array(0)
  private jOff = 0
  private setJ = (a: readonly number[]) => {
    for (let k = 0; k < a.length; k++) this.jOut[this.jOff + k] = a[k]
  }
  private mixJ = (a: readonly number[], b: readonly number[], u: number) => {
    for (let k = 0; k < a.length; k++) this.jOut[this.jOff + k] = a[k] + (b[k] - a[k]) * u
  }

  /** a finger's joints at time t from its list of presses (hover over the next key, down, up, on to the next or home) */
  private fingerAt(s: SeatState, side: Side, f: number, list: readonly KeyPress[], t: number, d: number, reduced: boolean, out: Float64Array, o: number) {
    const hs = s.hands[side]
    const home = hs.home[f]
    let j = -1
    for (let i = 0; i < list.length; i++) {
      if (list[i].t - 0.5 * PRESS_IN_S * d > t) break
      j = i
    }
    const set = this.setJ
    const mix = this.mixJ
    this.jOut = out
    this.jOff = o
    const nextOf = j + 1 < list.length ? list[j + 1] : null
    if (j < 0) {
      if (!nextOf) return set(home)
      const ns = nextOf.t - 0.5 * PRESS_IN_S * d
      const fn = this.fit(s, side, f, nextOf.code, nextOf.fid, reduced)
      if (!fn || t < ns - 0.25 * d) return set(home)
      return mix(home, fn.hover, smooth((t - (ns - 0.25 * d)) / (0.25 * d)))
    }
    const k = list[j]
    const F = this.fit(s, side, f, k.code, k.fid, reduced)
    if (!F) return set(home)
    const start = k.t - 0.5 * PRESS_IN_S * d
    const release = k.t + k.hold
    const end = release + PRESS_OUT_S * d
    if (t < start + PRESS_IN_S * d) return mix(F.hover, F.down, (t - start) / (PRESS_IN_S * d))
    if (t < release) return set(F.down)
    if (t < end) return mix(F.down, F.hover, smooth((t - release) / (PRESS_OUT_S * d)))
    if (!nextOf) return mix(F.hover, home, smooth((t - end) / (0.25 * d)))
    const ns = nextOf.t - 0.5 * PRESS_IN_S * d
    const Fn = this.fit(s, side, f, nextOf.code, nextOf.fid, reduced)
    if (!Fn) return set(F.hover)
    if (ns - end > 0.6 * d) {
      if (t < end + 0.25 * d) return mix(F.hover, home, smooth((t - end) / (0.25 * d)))
      if (t > ns - 0.25 * d) return mix(home, Fn.hover, smooth((t - (ns - 0.25 * d)) / (0.25 * d)))
      return set(home)
    }
    return mix(F.hover, Fn.hover, smooth((t - end) / Math.max(1e-3, ns - end)))
  }

  // ------------------------------------------------------------------------------------------------------------- events

  /** send the schedule's events from the last time sent up to t; the wheel and the buttons use them too */
  private send(rig: AgentRig, s: SeatState, a: AgentState, t: number, activity: string | undefined, d: number, hasMouse: boolean, o: StepOpts, jump: boolean) {
    if (jump) {
      a.sent = t
      return
    }
    const listen = hasInputListeners()
    const from = a.sent
    for (let ci = chunkIndexAt(from, d); ci <= chunkIndexAt(t, d); ci++) {
      const c = this.chunkOf(a, rig.id, activity, ci, d, hasMouse)
      for (const e of c.events) {
        if (e.t <= from) continue
        if (e.t > t) break
        this.emit(rig, s, e, listen, o)
      }
    }
    a.sent = t
  }

  private emit(rig: AgentRig, s: SeatState, e: SchedEvent, listen: boolean, o: StepOpts) {
    if (e.type === 'mouse') {
      if (!s.mouse) return
      if (e.kind === 'wheel') s.wheel.want += WHEEL_NOTCH_DEG * DEG * (e.ticks ?? 1) * (e.dir ?? 1)
      if (!listen) return
      const node = e.kind === 'wheel' ? s.mouse.wheel : e.button === 'r' ? s.mouse.r : s.mouse.l
      emitInput({ type: 'mouse', agent: rig.id, kind: e.kind, ...(e.kind === 'wheel' ? { ticks: e.ticks ?? 1 } : {}), t: e.t, pos: node.getWorldPosition(new Vector3()) })
      return
    }
    if (o.leftOnly && FINGERING[e.code]?.hand === 'r') return
    if (!listen) return
    const top = s.kb.top(e.code)
    if (!top) return
    emitInput({ type: e.type, agent: rig.id, kind: e.kind, t: e.t, pos: top.clone(), key: e.code })
  }

  // ------------------------------------------------------------------------------------------------------------- mouse

  private mouseVisual(s: SeatState, chunk: Chunk, t: number, dt: number, live: boolean) {
    const m = s.mouse!
    // a button is down from its `down` event to the `up` after it, in 40 ms and out in 60 ms
    let pl = 0
    let pr = 0
    if (live) {
      for (let i = 0; i < chunk.mouse.length; i++) {
        const e = chunk.mouse[i]
        if (e.kind !== 'down') continue
        if (e.t - 0.03 > t) break
        let up = e.t + 0.1
        for (let k = i + 1; k < chunk.mouse.length; k++)
          if (chunk.mouse[k].kind === 'up' && chunk.mouse[k].button === e.button) {
            up = chunk.mouse[k].t
            break
          }
        const p = t < up ? clamp01((t - (e.t - 0.02)) / PRESS_IN_S) : 1 - smooth((t - up) / PRESS_OUT_S)
        if (e.button === 'l') pl = Math.max(pl, p)
        else pr = Math.max(pr, p)
      }
    }
    this.q1.setFromAxisAngle(AXIS_X, BUTTON_DEG * DEG * pl)
    m.l.quaternion.copy(m.restL).multiply(this.q1)
    this.q1.setFromAxisAngle(AXIS_X, BUTTON_DEG * DEG * pr)
    m.r.quaternion.copy(m.restR).multiply(this.q1)
    // the wheel catches up with the notches sent (a notch in about 0.1 s)
    const w = s.wheel
    w.now += (w.want - w.now) * (1 - Math.exp(-30 * dt))
    this.q1.setFromAxisAngle(AXIS_X, w.now)
    m.wheel.quaternion.copy(m.restW).multiply(this.q1)
  }

  /**
   * The right hand's drive with the mouse grip mixed in. `g` is what the grip stage made (null: the hand is not on the mouse, the keyboard
   * drive stays). Placed between the keyboard hand and the mouse hand by the stage's weight, lifted 3 cm on the way, and the clicks and
   * the wheel on the fingers once the hand is on the mouse.
   */
  mouseBlend(rig: AgentRig, seat: number, frame: TypeFrame, g: HandDrive | null, t: number, reduced: boolean) {
    const kb = frame.kb
    const s = this.seats.get(seat)
    const a = this.agents.get(rig.id)
    if (!s || !a) return
    if (!g || !g.target) {
      rig.drive.r = kb
      return
    }
    const w = g.w
    const wc = g.wc
    // the matrix between the two (a lift on the way, none with reduced motion)
    kb.target!.decompose(this.v1, this.q1, this.scl)
    g.target.decompose(this.v2, this.q2, this.scl)
    this.v1.lerp(this.v2, w)
    if (!reduced) this.v1.y += 0.03 * Math.sin(Math.PI * w)
    this.q1.slerp(this.q2, w)
    kb.target!.compose(this.v1, this.q1, this.ones)
    const ang = kb.angles as number[]
    const ga = g.angles
    if (ga) for (let i = 0; i < 20; i++) ang[i] += (ga[i] - ang[i]) * wc
    // the grip's weight keeps the hand where it is while the keyboard drive is still ramping in (idle on the mouse -> working)
    kb.w = Math.max(a.ramp, w)
    kb.wc = Math.max(a.ramp, wc)
    rig.drive.r = kb
    if (w < 0.999) return
    if (!s.wheelFit && g.angles) this.fitWheel(rig, seat, g.target, g.angles)
    // on the mouse: the click moves the finger a little, the wheel brings the index over it
    this.clickAndWheel(s, kb, a, frame.chunk, t)
  }

  private clickAndWheel(s: SeatState, kb: HandDrive, a: AgentState, chunk: Chunk, t: number) {
    const ang = kb.angles as number[]
    // a click: the index for the left button, the middle for the right; 7 degrees on MCP and PIP, in and out in 60 ms
    for (let i = 0; i < chunk.mouse.length; i++) {
      const e = chunk.mouse[i]
      if (e.kind !== 'down') continue
      if (e.t - 0.05 > t) break
      let up = e.t + 0.1
      for (let k = i + 1; k < chunk.mouse.length; k++)
        if (chunk.mouse[k].kind === 'up' && chunk.mouse[k].button === e.button) {
          up = chunk.mouse[k].t
          break
        }
      const p = t < up ? clamp01((t - (e.t - 0.04)) / 0.06) : 1 - smooth((t - up) / 0.08)
      if (p <= 0) continue
      const f = e.button === 'l' ? 0 : 1
      ang[f * 4] += 7 * p
      ang[f * 4 + 1] += 7 * p
      ang[f * 4 + 2] = DIP_K[f] * ang[f * 4 + 1]
    }
    // a scroll: the index slides to the wheel, flicks with each notch
    let on = 0
    let flick = 0
    for (const e of chunk.mouse) {
      if (e.kind !== 'wheel') continue
      if (e.t - 0.4 > t) break
      const w = smooth((t - (e.t - 0.4)) / 0.2) * (1 - smooth((t - (e.t + 0.15)) / 0.3))
      if (w > on) on = w
      const u = (t - e.t) / 0.12
      if (u >= 0 && u < 1) flick = Math.max(flick, Math.sin(Math.PI * u))
    }
    if (on > 0 && s.wheelFit) {
      const wf = s.wheelFit
      for (let k = 0; k < 3; k++) {
        const idx = k === 2 ? 3 : k
        ang[idx] += (wf[k] - ang[idx]) * on
      }
      kb.target!.elements[12] += s.wheelShift.x * on
      kb.target!.elements[13] += s.wheelShift.y * on
      kb.target!.elements[14] += s.wheelShift.z * on
      ang[2] = DIP_K[0] * ang[1]
      ang[0] += 5 * flick * on
      ang[1] += 8 * flick * on
      ang[2] = DIP_K[0] * ang[1]
    }
    void a
  }

  /** the wheel fit: the index tip on top of the wheel, for the mouse hand's matrix `hand` (once per seat, when the hand first sits on the mouse) */
  fitWheel(rig: AgentRig, seat: number, hand: Matrix4, holdAngles: readonly number[]) {
    const s = this.seats.get(seat)
    if (!s || !s.mouse || s.wheelFit) return
    const m = fingerModelOf(rig.parts.hands.r, 0, 'r')
    if (!m) return
    const top = s.mouse.wheel.getWorldPosition(new Vector3()).addScaledVector(UP, 0.0055)
    // the wheel lies between the two buttons, a centimetre to the side of the index finger: the hand slides that way a little (it cannot just reach)
    const across = s.mouse.r.getWorldPosition(new Vector3()).sub(s.mouse.l.getWorldPosition(new Vector3())).setY(0).normalize()
    const tip = tipAtJoints(m, [holdAngles[0], holdAngles[1], holdAngles[3]]).applyMatrix4(hand)
    const slide = Math.max(0, top.clone().sub(tip).dot(across))
    const home = new Vector3().setFromMatrixPosition(hand)
    let best: { fit: { joints: number[]; err: number }; shift: Vector3 } | null = null
    for (const k of [1, 1.2, 1.4, 1.7]) {
      const shift = across.clone().multiplyScalar(Math.min(0.02, slide * k))
      const moved = hand.clone().setPosition(home.clone().add(shift))
      const fit = solveTip(m, top.clone().applyMatrix4(moved.invert()), typeJoints(0))
      if (!best || fit.err < best.fit.err) best = { fit, shift }
    }
    s.wheelShift.copy(best!.shift)
    s.wheelFit = best!.fit.joints
    s.wheelErr = best!.fit.err
  }

  /** the episode window the clock is in now, for the debug log */
  episodeAt(chunk: Chunk, t: number): Episode | null {
    return chunk.episodes.find((e) => t >= e.t0 && t <= e.t1) ?? null
  }

  /** the scene time an agent was last stepped at (debug) */
  lastT(agent: string): number {
    return this.agents.get(agent)?.lastT ?? 0
  }

  /** debug: the mouse acts of an agent from time t */
  upcomingMouse(agent: string, activity: string | undefined, t: number, seconds: number) {
    const out: { t: number; kind: string; button: string }[] = []
    for (let ci = chunkIndexAt(t, 1); ci <= chunkIndexAt(t + seconds, 1); ci++)
      for (const m of this.cache.get(agent, activity, ci, { dilation: 1, mouse: true }).mouse) if (m.t >= t && m.t <= t + seconds) out.push({ t: +m.t.toFixed(3), kind: m.kind, button: m.button })
    return out
  }

  /** debug: the next keys of an agent from time t */
  upcoming(agent: string, activity: string | undefined, t: number, seconds: number, mouse = true) {
    const out: { t: number; code: string; hand: Hand; finger: number }[] = []
    const d = 1
    for (let ci = chunkIndexAt(t, d); ci <= chunkIndexAt(t + seconds, d); ci++)
      for (const k of this.cache.get(agent, activity, ci, { dilation: d, mouse }).keys) if (k.t >= t && k.t <= t + seconds) out.push({ t: +k.t.toFixed(3), code: k.code, hand: k.hand, finger: k.finger })
    return out
  }
}

const AXIS_X = new Vector3(1, 0, 0)
const EMPTY: readonly KeyPress[] = []
/** the keys fitted ahead of time (the ones the schedule uses most) */
const WARM_CODES = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  'Space', 'Enter', 'Backspace', 'ControlLeft', 'Period', 'Minus', 'Slash', 'Digit1', 'Digit2', 'Digit3', 'Digit0',
]
const WARM: [string, (typeof FINGERING)[string], string][] = WARM_CODES.map((c) => [c, FINGERING[c], `${FINGERING[c].hand}${FINGERING[c].finger}${c}`])
