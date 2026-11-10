// How a hand takes hold of things (#164, docs/design/grips.md). Pure: three.js math only, no scene.
//
//  - GRIPS: the designer's per-object table (finger values for "pre-grip" / "closed" / "after", which fingers touch where).
//  - GripClock: the three stages (approach 0.3 s with the last 0.15 s opening to pre-grip, close 0.12 s, release: "after" in
//    0.15 s, rest within 0.3 s) as weights, scaled by the replay speed (a stage lasts at least `gestureMin`) and instant under
//    reduced motion.
//  - fitContact: bend one finger (and swing it sideways, or open / oppose the thumb) so its tip lands on a contact point and
//    stays on the outside of the surface (the contact node's +y, the exported form of Blender's +z).

import { Euler as EulerCtor, Matrix4, Quaternion, Vector3 } from 'three'
import { DEG, LIMITS, abdRange, clampFinger, clampThumb, fingerFromC, fingerRootQuat, segmentQuat, thumbFromCurl, thumbRootQuat, type JointSpec, type Range } from './handPose'


/** four finger bends (index … little), then the thumb's bend and opposition */
export type Curl = readonly [number, number, number, number, number, number]
export const curlOf = (f: readonly [number, number, number, number], thumb: readonly [number, number]): Curl => [f[0], f[1], f[2], f[3], thumb[0], thumb[1]]
const all = (c: number, thumb: [number, number]) => curlOf([c, c, c, c], thumb)

export type Finger = 'index' | 'middle' | 'ring' | 'little' | 'thumb' | 'palm'
export const FINGERS: Finger[] = ['index', 'middle', 'ring', 'little', 'thumb']

export const REST: Curl = [0.25, 0.25, 0.3, 0.35, 0.2, 0]

export interface GripSide {
  /** finger values just before the hand closes, when it holds, and just after it lets go */
  pre: Curl
  hold: Curl
  after: Curl
  /** which fingers touch the object (the contact node `<prop>_contact_<finger>[_l]`); palm is only measured */
  contacts: Finger[]
}
export interface GripSpec {
  r?: GripSide
  l?: GripSide
}

/** grips.md 2: every object's three stages (index, middle, ring, little; thumb bend, opposition) */
export const GRIPS: Record<string, GripSpec> = {
  // mug: index and middle through the handle's loop, the thumb on top, ring and little under the body
  cup: { r: { pre: curlOf([0.3, 0.3, 0.2, 0.2], [0.1, 0.3]), hold: curlOf([0.7, 0.75, 0.55, 0.6], [0.35, 0.6]), after: curlOf([0.15, 0.15, 0.2, 0.25], [0.1, 0.2]), contacts: ['index', 'thumb', 'ring'] } },
  watering_can: {
    r: { pre: all(0.3, [0.2, 0.5]), hold: curlOf([0.85, 0.88, 0.9, 0.9], [0.5, 1]), after: REST, contacts: ['palm'] },
    l: { pre: all(0.15, [0.1, 0]), hold: curlOf([0.25, 0.25, 0.3, 0.3], [0.1, 0]), after: REST, contacts: ['palm'] },
  },
  book: {
    l: { pre: all(0.15, [0.1, 0]), hold: curlOf([0.3, 0.3, 0.3, 0.3], [0.3, 0.4]), after: REST, contacts: ['index', 'middle', 'ring', 'little', 'thumb'] },
    r: { pre: all(0.15, [0.1, 0]), hold: curlOf([0.3, 0.3, 0.3, 0.3], [0.3, 0.4]), after: REST, contacts: ['index', 'middle', 'ring', 'little', 'thumb'] },
  },
  // the closed book carried in front of the chest (#280, the bake's prop_book_grip_l / _contact_thumb_l, children of the book itself): the left hand under it, the thumb on its edge
  bookclosed: { l: { pre: all(0.15, [0.1, 0]), hold: curlOf([0.3, 0.3, 0.3, 0.3], [0.3, 0.4]), after: REST, contacts: ['thumb'] } },
  // the right thumb and index pinching the corner of the one leaf that turns (#231): the index 0.6, the thumb (0.25, 0.85), the others 0.3
  leaf: { r: { pre: all(0.15, [0.1, 0]), hold: curlOf([0.6, 0.3, 0.3, 0.3], [0.25, 0.85]), after: REST, contacts: ['index', 'thumb'] } },
  // the loose sheet held by its long sides for reading (#374, grips.md "낱장 옆 쥐고 읽기"): the thumb on the text face, four fingers flat on the back, both hands
  paper_side: {
    l: { pre: curlOf([0.15, 0.15, 0.2, 0.2], [0.1, 0.3]), hold: curlOf([0.25, 0.25, 0.3, 0.3], [0.35, 0.5]), after: REST, contacts: ['index', 'thumb'] },
    r: { pre: curlOf([0.15, 0.15, 0.2, 0.2], [0.1, 0.3]), hold: curlOf([0.25, 0.25, 0.3, 0.3], [0.35, 0.5]), after: REST, contacts: ['index', 'thumb'] },
  },
  paddle: { r: { pre: curlOf([0.15, 0.4, 0.45, 0.5], [0.1, 0.3]), hold: curlOf([0.15, 0.8, 0.85, 0.9], [0.25, 0.7]), after: REST, contacts: ['index', 'thumb'] } },
  // the pen family: a tripod grip, ring and little folded
  tablet_pen: { r: { pre: curlOf([0.3, 0.35, 0.6, 0.65], [0.2, 0.5]), hold: curlOf([0.45, 0.55, 0.8, 0.85], [0.35, 0.8]), after: REST, contacts: ['thumb', 'index', 'middle'] } },
  marker: { r: { pre: curlOf([0.3, 0.35, 0.6, 0.65], [0.2, 0.5]), hold: curlOf([0.4, 0.5, 0.75, 0.8], [0.3, 0.75]), after: REST, contacts: ['thumb', 'index', 'middle'] } },
  stamp: { r: { pre: all(0.3, [0.1, 0.3]), hold: curlOf([0.75, 0.8, 0.82, 0.85], [0.4, 0.9]), after: REST, contacts: ['palm'] } },
  // a hand gripping the mouse body (#305: it slides it about its pad): the palm over the body, the index on the left button, the middle on the right
  mouse: { r: { pre: all(0.2, [0.1, 0.3]), hold: curlOf([0.35, 0.35, 0.45, 0.5], [0.25, 0.6]), after: REST, contacts: ['palm', 'index', 'middle'] } },
  // a finger pressing a button
  button: { r: { pre: curlOf([0, 0.9, 0.92, 0.95], [0.6, 0.6]), hold: curlOf([0.05, 0.9, 0.92, 0.95], [0.6, 0.6]), after: REST, contacts: ['index'] } },
  // the go stone, the Nihon Ki-in grip (agents.md 2.10, #192): the stone on the index nail, the middle fingertip pressing it from above
  piece: { r: { pre: all(0.15, [0.1, 0.3]), hold: curlOf([0.55, 0.12, 0.8, 0.85], [0.4, 0.6]), after: REST, contacts: ['index', 'middle'] } },
}

// ---------------------------------------------------------------------------------------------------- stages

/** seconds (grips.md 1): the approach, of which the last `open` opens to pre-grip; the close; the "after" opening; back to rest */
export const GRIP_S = { approach: 0.3, open: 0.15, close: 0.12, after: 0.15, rest: 0.3 } as const

export type GripStage = 'rest' | 'approach' | 'close' | 'hold' | 'release'

/** weights of the three finger sets in the blend */
export type Mix = [pre: number, hold: number, after: number]

export interface GripOut {
  stage: GripStage
  /** the hand's place: 0 = wherever its pose puts it, 1 = on the object */
  wHand: number
  /** the fingers: 0 = the pose's own curls, 1 = mix of pre / hold / after */
  wCurl: number
  mix: Mix
  /** the object belongs to the hand (from the instant the hand has closed, until it lets go) */
  attached: boolean
}

export interface GripOpts {
  /** the timelapse (#158): a stage lasts at least this many scene seconds */
  gestureMin?: number
  /** reduced motion: no approach, no pre-grip, no "after": hold ↔ rest at once */
  reduced?: boolean
}

const ease = (k: number) => {
  const x = Math.min(1, Math.max(0, k))
  return x * x * (3 - 2 * x)
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/**
 * One hand's grip over time. `step(t, want)` once per frame with the scene clock (s) and whether the hand should be
 * holding; it returns the weights for this frame. Pure state machine: no scene, no clock of its own.
 */
export class GripClock {
  private stage: GripStage = 'rest'
  private t0 = 0
  private last: GripOut = { stage: 'rest', wHand: 0, wCurl: 0, mix: [0, 0, 1], attached: false }
  /** the scene time the object was attached (null while it is not) */
  attachedAt: number | null = null

  reset() {
    this.stage = 'rest'
    this.last = { stage: 'rest', wHand: 0, wCurl: 0, mix: [0, 0, 1], attached: false }
    this.attachedAt = null
  }

  get current() {
    return this.last
  }

  step(t: number, want: boolean, o: GripOpts = {}): GripOut {
    const d = (x: number) => (o.reduced ? 0 : Math.max(x, o.gestureMin ?? 0))
    const go = (s: GripStage) => {
      this.stage = s
      this.t0 = t
    }
    if (want && (this.stage === 'rest' || this.stage === 'release')) go(this.stage === 'rest' ? 'approach' : 'approach')
    if (!want && (this.stage === 'approach' || this.stage === 'close' || this.stage === 'hold')) go('release')
    // advance through finished stages (a zero-length stage passes at once)
    for (let guard = 0; guard < 4; guard++) {
      const el = t - this.t0
      if (this.stage === 'approach' && el >= d(GRIP_S.approach)) go('close')
      else if (this.stage === 'close' && t - this.t0 >= d(GRIP_S.close)) go('hold')
      else if (this.stage === 'release' && el >= d(GRIP_S.rest)) go('rest')
      else break
    }
    const el = t - this.t0
    let out: GripOut
    switch (this.stage) {
      case 'approach': {
        const dur = d(GRIP_S.approach)
        const open = Math.min(d(GRIP_S.open), dur)
        out = { stage: 'approach', wHand: ease(el / dur), wCurl: open > 0 ? ease((el - (dur - open)) / open) : 1, mix: [1, 0, 0], attached: false }
        break
      }
      case 'close': {
        const k = ease(el / d(GRIP_S.close))
        out = { stage: 'close', wHand: 1, wCurl: 1, mix: [1 - k, k, 0], attached: false }
        break
      }
      case 'hold':
        out = { stage: 'hold', wHand: 1, wCurl: 1, mix: [0, 1, 0], attached: true }
        break
      case 'release': {
        const f = this.releaseFrom ?? this.last
        const aft = d(GRIP_S.after)
        const rest = d(GRIP_S.rest)
        const ka = aft > 0 ? ease(el / aft) : 1
        const mix: Mix = [lerp(f.mix[0], 0, ka), lerp(f.mix[1], 0, ka), lerp(f.mix[2], 1, ka)]
        const fade = rest > aft ? ease((el - aft) / (rest - aft)) : 1
        out = { stage: 'release', wHand: f.wHand * (1 - ease(el / rest)), wCurl: f.wCurl * (1 - fade), mix, attached: false }
        break
      }
      default:
        out = { stage: 'rest', wHand: 0, wCurl: 0, mix: [0, 0, 1], attached: false }
    }
    if (out.stage === 'release' && this.last.stage !== 'release') this.releaseFrom = this.last
    if (out.stage !== 'release') this.releaseFrom = null
    if (out.attached && this.attachedAt === null) this.attachedAt = t
    if (!out.attached) this.attachedAt = null
    this.last = out
    return out
  }
  private releaseFrom: GripOut | null = null
}

/** the fingers to show for a GripOut: pre / hold / after mixed, then blended over the pose's own curls */
export function mixCurl(side: GripSide, out: GripOut, pose: readonly number[], hold: Curl = side.hold): number[] {
  const res: number[] = []
  for (let k = 0; k < 6; k++) {
    const g = side.pre[k] * out.mix[0] + hold[k] * out.mix[1] + side.after[k] * out.mix[2]
    res.push(lerp(pose[k], g, out.wCurl))
  }
  return res
}

// ------------------------------------------------------------------------------------------- contact correction

/** a finger (or the thumb) as plain data: where each segment hangs off the one before, its rest turn, and the tip */
export interface FingerModel {
  /** segment origin in its parent's frame (the hand for the first), and the rest rotation; the thumb has three (_t_0, _t_1, _t_2) */
  p: Vector3[]
  rest: Quaternion[]
  /** the tip in the last segment's frame */
  tip: Vector3
  thumb: boolean
  /** +1 right hand, −1 left */
  sx: 1 | -1
  /** which finger, 0 = index … 3 = little (fingers only; default 0) */
  finger?: number
  /** each segment's joint extras (axis, sign) from the glb; without them: flex about local x, abduct about z */
  joint?: (JointSpec | undefined)[]
  /** the fan angle baked into the finger root, degrees (rest_abduct) */
  restAbd?: number
  /** a grip's own abduction range (STONE_ABD), degrees, used instead of the general one (which shrinks with the MCP) */
  abdLimits?: Range
}

const q1 = new Quaternion()
const m1 = new Matrix4()
const one = new Vector3(1, 1, 1)
const NO_JOINT: JointSpec[] = []
const ACC = new Matrix4()

/**
 * The joint angles (degrees) a model has for a table value: a finger [MCP, PIP, abduction (the TOTAL angle, the baked fan included)] from
 * c = `a` and the swing `b` (rad, on top of the fan); the thumb [CMC flex, CMC abduct, MCP, IP] from the bend `a` and the opposition `b`
 * (hand-poses.md 3). Not clamped.
 */
export function tableJoints(m: FingerModel, a: number, b: number): number[] {
  if (m.thumb) {
    const t = thumbFromCurl(a, b)
    return [t.cmcFlex, t.cmcAbd, t.mcp, t.ip]
  }
  const f = fingerFromC(m.finger ?? 0, a, (m.restAbd ?? 0) + b / DEG)
  return [f.mcp, f.pip, f.abd]
}

/** the joints of a model clamped to the limits of hand-poses.md 1 (the abduction range shrinks with the MCP) */
export function clampJoints(m: FingerModel, j: readonly number[]): number[] {
  if (m.thumb) {
    const t = clampThumb({ cmcFlex: j[0], cmcAbd: j[1], mcp: j[2], ip: j[3] })
    return [t.cmcFlex, t.cmcAbd, t.mcp, t.ip]
  }
  const f = clampFinger({ mcp: j[0], pip: j[1], abd: j[2] }, m.finger ?? 0, undefined, m.abdLimits)
  return [f.mcp, f.pip, f.abd]
}

/**
 * The tip in the hand's frame for full joint angles, with exactly the rig's joint math (handPose.ts); limits applied. A finger:
 * [MCP, PIP, total abduction] (DIP = k · PIP). The thumb: [CMC flex, CMC abduct, MCP, IP] (the twist is derived).
 */
export function tipAtJoints(m: FingerModel, joints: readonly number[], out = new Vector3()): Vector3 {
  const acc = ACC.identity()
  const j = m.joint ?? NO_JOINT
  if (m.thumb) {
    const t = clampThumb({ cmcFlex: joints[0], cmcAbd: joints[1], mcp: joints[2], ip: joints[3] })
    acc.compose(m.p[0], thumbRootQuat(m.rest[0], j[0], t, q1), one)
    acc.multiply(m1.compose(m.p[1], segmentQuat(m.rest[1], j[1], t.mcp, q1), one))
    acc.multiply(m1.compose(m.p[2], segmentQuat(m.rest[2], j[2], t.ip, q1), one))
  } else {
    const k = m.finger ?? 0
    const restAbd = m.restAbd ?? 0
    const f = clampFinger({ mcp: joints[0], pip: joints[1], abd: joints[2] }, k, undefined, m.abdLimits)
    const spec = j[0] ?? { flex: { axis: 'x' as const, sign: 1 }, abduct: { axis: 'z' as const, sign: m.sx } }
    acc.compose(m.p[0], fingerRootQuat(m.rest[0], spec, restAbd, f.abd, f.mcp, q1), one)
    acc.multiply(m1.compose(m.p[1], segmentQuat(m.rest[1], j[1], f.pip, q1), one))
    acc.multiply(m1.compose(m.p[2], segmentQuat(m.rest[2], j[2], f.dip!, q1), one))
  }
  return out.copy(m.tip).applyMatrix4(acc)
}

/**
 * The finger's centre line in the hand's frame for full joint angles (same joint math as tipAtJoints): the origin of each segment, then the tip.
 * For checks that no part of a finger is inside something (bookGrip.test.ts), not for the fit.
 */
export function pointsAtJoints(m: FingerModel, joints: readonly number[]): Vector3[] {
  const acc = new Matrix4()
  const mm = new Matrix4()
  const qq = new Quaternion()
  const j = m.joint ?? NO_JOINT
  const pts: Vector3[] = []
  if (m.thumb) {
    const t = clampThumb({ cmcFlex: joints[0], cmcAbd: joints[1], mcp: joints[2], ip: joints[3] })
    acc.compose(m.p[0], thumbRootQuat(m.rest[0], j[0], t, qq), one)
    pts.push(new Vector3().setFromMatrixPosition(acc))
    acc.multiply(mm.compose(m.p[1], segmentQuat(m.rest[1], j[1], t.mcp, qq), one))
    pts.push(new Vector3().setFromMatrixPosition(acc))
    acc.multiply(mm.compose(m.p[2], segmentQuat(m.rest[2], j[2], t.ip, qq), one))
    pts.push(new Vector3().setFromMatrixPosition(acc))
  } else {
    const k = m.finger ?? 0
    const restAbd = m.restAbd ?? 0
    const f = clampFinger({ mcp: joints[0], pip: joints[1], abd: joints[2] }, k, undefined, m.abdLimits)
    const spec = j[0] ?? { flex: { axis: 'x' as const, sign: 1 }, abduct: { axis: 'z' as const, sign: m.sx } }
    acc.compose(m.p[0], fingerRootQuat(m.rest[0], spec, restAbd, f.abd, f.mcp, qq), one)
    pts.push(new Vector3().setFromMatrixPosition(acc))
    acc.multiply(mm.compose(m.p[1], segmentQuat(m.rest[1], j[1], f.pip, qq), one))
    pts.push(new Vector3().setFromMatrixPosition(acc))
    acc.multiply(mm.compose(m.p[2], segmentQuat(m.rest[2], j[2], f.dip!, qq), one))
    pts.push(new Vector3().setFromMatrixPosition(acc))
  }
  pts.push(m.tip.clone().applyMatrix4(acc))
  return pts
}

/**
 * The tip for a table-style value: a finger `a` = c (MCP 85c, PIP 100c, DIP k · PIP), `b` = the swing on top of the baked fan, radians; the
 * thumb `a` = bend, `b` = opposition (hand-poses.md 3). Limits applied.
 */
export function tipAt(m: FingerModel, a: number, b: number, out = new Vector3()): Vector3 {
  return tipAtJoints(m, tableJoints(m, a, b), out)
}

export interface Fit {
  /** the fitted joint angles, degrees, within the limits: a finger [MCP, PIP, total abduction], the thumb [CMC flex, CMC abduct, MCP, IP] */
  joints: number[]
  /** distance from the tip to the contact point, m */
  err: number
  /** how far the tip stands off the surface along its normal, m (≥ 0: not through it) */
  off: number
}

/** how far out of the surface the target is kept, so that a tip that "touches" is never a hair inside */
const SKIN = 0.0003
/** the size of each joint's degrees in the "least change" term (a joint's own range: change / scale, squared) */
const PRIOR_SCALE = { finger: [85, 100, 30], thumb: [45, 60, 50, 80] }
const PRIOR_W = 2e-6

/**
 * Find the joint angles that put the tip on `target` without going through the surface (`normal` points out of it, both in the hand's
 * frame). A finger is solved in 3 DOF (MCP, PIP, abduction; DIP = k · PIP follows PIP), the thumb in 4 (CMC flex, CMC abduct, MCP, IP; the
 * twist is derived), always inside the limits of hand-poses.md 1 including the abduction range that shrinks with the MCP. It starts from the
 * table's angles (`a0`, `b0`: tableJoints) and prefers the least change from them, so a grip that already fits stays as tabled; a tip that
 * would go through is bent less. Deterministic: a coarse grid over the angles that matter most, then a coordinate search with shrinking steps.
 */
export function fitContact(m: FingerModel, target: Vector3, normal: Vector3, a0: number, b0 = 0, G = 14, radius = 0, priorW = PRIOR_W, from?: readonly number[]): Fit {
  const n = normal.clone().normalize()
  const goal = target.clone().addScaledVector(n, SKIN)
  const full = G >= 10
  const raw = from ? from.slice() : tableJoints(m, a0, b0)
  const start = clampJoints(m, raw)
  const dim = start.length
  const scale = m.thumb ? PRIOR_SCALE.thumb : PRIOR_SCALE.finger
  const tip = new Vector3()
  // the contact is a point, or a disc of `radius` round it in the plane across the normal: the distance is to the nearest point of the disc
  const toContact = (p: Vector3, c: Vector3) => {
    const d = p.clone().sub(c)
    const h = d.dot(n)
    if (radius <= 0) return d.length()
    const lat = Math.max(0, d.addScaledVector(n, -h).length() - radius)
    return Math.hypot(h, lat)
  }
  const cost = (v: number[]) => {
    tipAtJoints(m, v, tip)
    const off = tip.clone().sub(target).dot(n)
    let prior = 0
    for (let k = 0; k < dim; k++) prior += ((v[k] - raw[k]) / scale[k]) ** 2
    const e = toContact(tip, goal)
    return e * e + (off < 0 ? 4000 * off * off : 0) + priorW * prior
  }
  const feas = (v: number[]) => clampJoints(m, v)
  // the ranges the grid walks over
  const lo = m.thumb ? [LIMITS.cmcFlex.min, LIMITS.cmcAbd.min, LIMITS.tmcp.min, LIMITS.tip.min] : [0, 0, -1]
  const hi = m.thumb ? [LIMITS.cmcFlex.max, LIMITS.cmcAbd.max, LIMITS.tmcp.max, LIMITS.tip.max] : [90, 100, -1]
  const cells = m.thumb ? (full ? [6, 6, 4, 6] : [2, 2, 2, 2]) : [full ? 12 : 4, full ? 12 : 4, 0]
  const best0 = { v: start, c: cost(start) }
  const consider = (v: number[]) => {
    const w = feas(v)
    const c = cost(w)
    if (c < best0.c) {
      best0.v = w
      best0.c = c
    }
  }
  if (m.thumb) {
    for (let a = 0; a <= cells[0]; a++)
      for (let b = 0; b <= cells[1]; b++)
        for (let c = 0; c <= cells[2]; c++)
          for (let d = 0; d <= cells[3]; d++)
            consider([lo[0] + ((hi[0] - lo[0]) * a) / cells[0], lo[1] + ((hi[1] - lo[1]) * b) / cells[1], lo[2] + ((hi[2] - lo[2]) * c) / cells[2], lo[3] + ((hi[3] - lo[3]) * d) / cells[3]])
  } else {
    // the MCP and PIP matter most; the abduction stays at its table value on the grid
    for (let a = 0; a <= cells[0]; a++) for (let b = 0; b <= cells[1]; b++) consider([lo[0] + ((hi[0] - lo[0]) * a) / cells[0], lo[1] + ((hi[1] - lo[1]) * b) / cells[1], start[2]])
  }
  const step0 = m.thumb ? [10, 10, 8, 12] : [10, 10, 6]
  const descend = (from: number[]) => {
    let best = { v: feas(from), c: 0 }
    best.c = cost(best.v)
    let step = step0.slice()
    for (let it = 0; it < (full ? 160 : 40); it++) {
      let moved = false
      for (let k = 0; k < dim; k++)
        for (const sg of [1, -1]) {
          const v = best.v.slice()
          v[k] += sg * step[k]
          const w = feas(v)
          const c = cost(w)
          if (c < best.c - 1e-18) {
            best = { v: w, c }
            moved = true
          }
        }
      if (!moved) {
        step = step.map((x) => x * 0.6)
        if (step[0] < 0.02) break
      }
    }
    return best
  }
  // from the grid's best and from the table's own angles (and, for a finger, from each end of its abduction range): the cheapest wins
  const starts = [best0.v, start]
  if (!m.thumb && full) {
    const r = abdRange(m.finger ?? 0, best0.v[0])
    starts.push([best0.v[0], best0.v[1], r.min], [best0.v[0], best0.v[1], r.max])
  }
  let best = { v: best0.v, c: Infinity }
  // the coarse fit (inside the hand-offset search) walks from the grid's best only; the final fit tries every start
  for (const s0 of full ? starts : [best0.v]) {
    const r = descend(s0)
    if (r.c < best.c) best = r
  }
  tipAtJoints(m, best.v, tip)
  return { joints: best.v, err: toContact(tip, target), off: tip.clone().sub(target).dot(n) }
}

// ---------------------------------------------------------------------------------------------- hand placement

/**
 * The hand's world matrix that puts its own grip frame onto the object's: M_hand · Hg = M_obj · Pg  →  M_hand = M_obj · Pg · Hg⁻¹.
 * `objWorld` is the object's pose, `objGrip` its `_grip` empty in the object's frame, `handGrip` the hand's `_grip` in the hand's.
 */
export function handFor(objWorld: Matrix4, objGrip: Matrix4, handGrip: Matrix4, out = new Matrix4()): Matrix4 {
  return out.copy(objWorld).multiply(objGrip).multiply(new Matrix4().copy(handGrip).invert())
}

/** the object's world matrix when the hand's grip frame is on its grip: M_obj = M_hand · Hg · Pg⁻¹ */
export function objectFor(handWorld: Matrix4, handGrip: Matrix4, objGrip: Matrix4, out = new Matrix4()): Matrix4 {
  return out.copy(handWorld).multiply(handGrip).multiply(new Matrix4().copy(objGrip).invert())
}

// ------------------------------------------------------------------------------------- hand offset + all fingers

export interface ContactIn {
  finger: Exclude<Finger, 'palm'>
  model: FingerModel
  /** the contact point and its outward normal, in the hand's frame, for a hand whose grip is exactly on the object's */
  p: Vector3
  n: Vector3
  /** the table's value to start from (c, or the thumb's bend) and the thumb's opposition */
  a0: number
  b0: number
  /** the contact is a disc of this radius round `p` across the normal (m), not a point: the pad may land anywhere on it (default 0) */
  radius?: number
}
export interface Solved {
  /** how the hand sits relative to "grip frame on grip frame": hand_world = grip_aligned_world · offset (offset in the hand's frame) */
  offset: Matrix4
  fits: { finger: ContactIn['finger']; joints: number[]; err: number; off: number }[]
  /** the largest tip-to-contact distance, m */
  worst: number
  /** how far the hand had to move from "grip on grip", m */
  moved: number
}

const OFFSET_STEP = [0.012, 0.012, 0.012, 0.2, 0.2, 0.2]

/**
 * The designer's grip frame and the contact points do not always agree with what the fingers can reach (a pen's grip is where
 * the palm goes, but its contacts are where the fingertips go). So: start with the grip frame on the grip frame, and where the
 * fingertips cannot reach, move the hand the least that lets every contact finger land within tolerance, none through the
 * surface. A pattern search over the hand's six offsets, each trial fitting every contact finger. Deterministic.
 * `extra` adds a cost for a trial (the hand's offset matrix, the fits): the book grip uses it to keep every finger segment out of the book's solids.
 * `scatter` adds that many more starts, the hand moved up to 3 cm and turned up to 0.5 rad (a fixed pseudo-random sequence): a cost with solids in it has local minima, and the search from "grip on grip" alone can stop in one.
 */
export function solveContacts(contacts: ContactIn[], keepNear = 0.02, extra?: (offset: Matrix4, fits: Solved['fits']) => number, scatter = 0): Solved {
  const T = new Matrix4()
  const inv = new Matrix4()
  const q = new Quaternion()
  const build = (v: number[], out: Matrix4) => out.compose(new Vector3(v[0], v[1], v[2]), q.setFromEuler(new (EulerCtor)(v[3], v[4], v[5], 'XYZ')), one)
  const trial = (v: number[], full: boolean) => {
    build(v, T)
    inv.copy(T).invert()
    let cost = 0
    let worst = 0
    const fits: Solved['fits'] = []
    for (const c of contacts) {
      const p = c.p.clone().applyMatrix4(inv)
      const n = c.n.clone().transformDirection(inv)
      const f = fitContact(c.model, p, n, c.a0, c.b0, full ? 14 : 6, c.radius ?? 0)
      cost += f.err * f.err + (f.off < 0 ? 4000 * f.off * f.off : 0)
      worst = Math.max(worst, f.err)
      fits.push({ finger: c.finger, joints: f.joints, err: f.err, off: f.off })
    }
    const moved = Math.hypot(v[0], v[1], v[2])
    // a little pull toward the designer's grip frame, so a hand that already reaches stays where it is
    if (extra) cost += extra(T, fits)
    return { cost: cost + (keepNear > 0 ? (moved / keepNear) ** 2 * 1e-6 : 0) + 4e-6 * (v[3] ** 2 + v[4] ** 2 + v[5] ** 2), worst, fits, moved }
  }
  let best: { v: number[]; r: ReturnType<typeof trial> } | null = null
  const starts: number[][] = [[0, 0, 0, 0, 0, 0]]
  for (const d of [0.02, 0.04, 0.06, 0.08]) for (const ax of [1, 2]) for (const sg of [1, -1]) {
    const v = [0, 0, 0, 0, 0, 0]
    v[ax] = sg * d
    starts.push(v)
  }
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
  for (let k = 0; k < scatter; k++) starts.push([0.03 * rnd(), 0.03 * rnd(), 0.03 * rnd(), 0.5 * rnd(), 0.5 * rnd(), 0.5 * rnd()])
  for (const v0 of starts) {
    let v = v0.slice()
    let r = trial(v, false)
    const step = OFFSET_STEP.slice()
    for (let it = 0; it < 90; it++) {
      let moved = false
      for (let k = 0; k < 6; k++)
        for (const sg of [1, -1]) {
          const w = v.slice()
          w[k] += sg * step[k]
          const rr = trial(w, false)
          if (rr.cost < r.cost - 1e-15) {
            v = w
            r = rr
            moved = true
          }
        }
      if (!moved) {
        for (let k = 0; k < 6; k++) step[k] *= 0.6
        if (step[0] < 1e-4) break
      }
    }
    if (!best || r.cost < best.r.cost) best = { v, r }
  }
  // the winner again, with the fine grid
  const v = best!.v
  let r = trial(v, true)
  const step = [0.001, 0.001, 0.001, 0.02, 0.02, 0.02]
  for (let it = 0; it < 40; it++) {
    let moved = false
    for (let k = 0; k < 6; k++)
      for (const sg of [1, -1]) {
        const w = v.slice()
        w[k] += sg * step[k]
        const rr = trial(w, true)
        if (rr.cost < r.cost - 1e-15) {
          v[k] = w[k]
          r = rr
          moved = true
        }
      }
    if (!moved) for (let k = 0; k < 6; k++) step[k] *= 0.5
  }
  build(v, T)
  return { offset: T.clone(), fits: r.fits, worst: r.worst, moved: r.moved }
}

// ------------------------------------------------------------------------------------------------------ the go stone

/** a go stone's thickness, m (omok_grid extras stone_h) */
export const STONE_H = 0.008
/** the stone's contacts are discs, not points (agents.md 2.10): the middle pad lands anywhere on a disc of this radius on the top face, the index nail on the bottom face's */
export let STONE_DISC_R = 0.008
/**
 * The two go-grip variants (#282 omok comparison). 'current': the posture preference start is the table's (index c 0.55, middle c 0.12) and the contact discs
 * are r 8 mm. 'alt' (the designer's alternative): index MCP / PIP about 60 / 55 and middle about 70 / 50 as the start, the discs r 10 mm.
 * STONE_VARIANT_DEFAULT is the one the app uses; setStoneVariant switches it (debug / tests; call before an agent's stone frames are built).
 */
export type StoneVariant = 'current' | 'alt'
export const STONE_VARIANT_DEFAULT: StoneVariant = 'current'
export const STONE_ALT = { disc: 0.01, index: [60, 55], middle: [70, 50] } as const
let stoneVariant: StoneVariant = STONE_VARIANT_DEFAULT
export const getStoneVariant = () => stoneVariant
export function setStoneVariant(v: StoneVariant) {
  stoneVariant = v
  STONE_DISC_R = v === 'alt' ? STONE_ALT.disc : 0.008
}
/**
 * THE abduction exception of the go grip (designer, agents.md 2.10) and only of it: the index may swing −12 … 20° and the middle ±12° (degrees,
 * the total angle, not scaled by the MCP), against the general limits of hand-poses.md 1. stoneGrip fits with these, and the stone's drive tells the rig
 * (HandDrive.abdLimits) to clamp with the same, so what is fitted is what is shown.
 */
export const STONE_ABD: { index: Range; middle: Range } = { index: { min: -12, max: 20 }, middle: { min: -12, max: 12 } }
/** how much the go grip prefers the designer's natural posture (index about 45 / 60, middle about 10 / 20) over a millimetre: the bottom finger's weight in m per full range, and the top finger's in the fit's squared terms */
const STONE_POSTURE_W = 0.006
const STONE_POSTURE_W_TOP = 3e-5
/** a hand that cannot hold the stone within this (m) falls back to the tripod pinch */
export const STONE_FALLBACK_M = 0.005

export interface StoneGrip {
  /** the stone's frame (x along the fingers, y out of its faces toward the index finger, z across) in the hand's frame */
  m: Matrix4
  /** the joints of the index and the middle finger, degrees: [MCP, PIP, total abduction] (the finger under the stone, and the one on top of it) */
  index: { j: number[] }
  middle: { j: number[] }
  /** which finger presses from above */
  top: 'index' | 'middle'
  /** tip-to-contact distances (m) and how far each stands off its face (≥ 0: not through it) */
  err: { index: number; middle: number }
  off: { index: number; middle: number }
}

/** the hand's pitch over the board while it carries a stone: its fingers point forward and this far down; sliding in, 30° (designer: 30–40°) */
export const STONE_PITCH = (35 * Math.PI) / 180
export const STONE_PITCH_FLAT = (30 * Math.PI) / 180
/** palm down with the little-finger side raised by this much (pronation) */
export const STONE_ROLL = (30 * Math.PI) / 180 // the pronation is a wrist twist about the finger axis (grips.md 1.1: within ±90)
/**
 * The go grip (agents.md 2.10, redesigned): the palm down, turned (pronated, a wrist twist about the finger axis) by `roll`, the fingers pointing
 * forward and down by `pitch`, the stone flat, resting on the nail of the BOTTOM finger with the TOP finger's pad on its top face. The
 * top finger lies above the bottom one by a difference in bend plus that pronation, not by a sideways spread. The stone's contacts are
 * discs of STONE_DISC_R, so the tips need only land on them; the abduction ranges are the grip's own (STONE_ABD). Which finger is on top comes from the
 * model's stone contacts (`top`: the finger whose contact faces up). In the hand's frame the stone's normal is the direction of "up" for such a
 * hand; the bottom finger starts at its table value, and it and the top finger are bent as little as it takes until the top tip is on the top disc,
 * one stone's thickness above the bottom tip along that normal. Both fingers are fitted in 3 DOF (MCP, PIP, abduction).
 */
export function stoneGrip(models: { index: FingerModel; middle: FingerModel }, top: 'index' | 'middle', hold: { index: number; middle: number }, pitch = STONE_PITCH, roll = STONE_ROLL): StoneGrip {
  const bottom = top === 'index' ? 'middle' : 'index'
  // the grip's own abduction ranges (one place: STONE_ABD)
  const fm = { index: { ...models.index, abdLimits: STONE_ABD.index }, middle: { ...models.middle, abdLimits: STONE_ABD.middle } }
  const sx = models.index.sx
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sr = Math.sin(roll) * sx
  const cr = Math.cos(roll)
  const n = new Vector3(-cp * sr, -sp, -cp * cr)
  const f = new Vector3(-sp * sr, cp, -sp * cr) // the forward direction along the board, in the hand's frame
  const tableB = tableJoints(fm[bottom], hold[bottom], 0)
  // the posture preference start: the table's, or the alternative's MCP / PIP (the table's abduction stays)
  const alt = stoneVariant === 'alt'
  const startOf = (finger: 'index' | 'middle', tj: number[]) => (alt ? [...STONE_ALT[finger], tj[2]] : tj)
  const prefB = startOf(bottom, tableB)
  const prefT = alt ? startOf(top, tableJoints(fm[top], hold[top], 0)) : undefined
  const costOf = (v: number[], fit: Fit) => fit.err + STONE_POSTURE_W * (Math.abs(v[0] - prefB[0]) / 85 + Math.abs(v[1] - prefB[1]) / 100 + Math.abs(v[2] - prefB[2]) / 57.3)
  const eval2 = (v: number[]) => {
    const w = clampJoints(fm[bottom], v)
    const B = tipAtJoints(fm[bottom], w)
    const fit = fitContact(fm[top], B.clone().addScaledVector(n, STONE_H), n, hold[top], 0, 8, STONE_DISC_R, STONE_POSTURE_W_TOP, prefT)
    return { v: w, fit, cost: costOf(w, fit) }
  }
  // a coarse walk over the bottom finger's bend (its table abduction), then a coordinate search in its three joints
  let cur = eval2(prefB)
  for (let cb = 0.05; cb <= 0.8; cb += 0.05) {
    const r = eval2(tableJoints(fm[bottom], cb, 0))
    if (r.cost < cur.cost) cur = r
  }
  let step = [6, 6, 4]
  for (let it = 0; it < 60 && step[0] > 0.05; it++) {
    let moved = false
    for (let k = 0; k < 3; k++)
      for (const sg of [1, -1]) {
        const v = cur.v.slice()
        v[k] += sg * step[k]
        const r = eval2(v)
        if (r.cost < cur.cost - 1e-9) {
          cur = r
          moved = true
        }
      }
    if (!moved) step = step.map((x) => x * 0.5)
  }
  const { fit } = cur
  const B = tipAtJoints(fm[bottom], cur.v)
  const z = new Vector3().crossVectors(f, n)
  const m = new Matrix4().makeBasis(f, n, z).setPosition(B.clone().addScaledVector(n, STONE_H / 2))
  const res = { [top]: { j: fit.joints }, [bottom]: { j: cur.v } } as { index: { j: number[] }; middle: { j: number[] } }
  return { m, ...res, top, err: { ...{ index: 0, middle: 0 }, [top]: fit.err }, off: { ...{ index: 0, middle: 0 }, [top]: fit.off } }
}

/** the palm's normal never points up more than this far below horizontal: y ≤ −0.61 (designer: palm down, bound −0.6) */
export const PALM_DOWN_Y = -0.61

/**
 * The pronation of the go grip: a fixed wrist twist of STONE_ROLL (30°, within the wrist's ±90°, grips.md 1.1), so the palm stays down (normal y = −cos pitch ·
 * cos roll ≤ ${PALM_DOWN_Y}). It used to grow with a hand that could not reach; the fingers now take the difference in bend and the discs the rest.
 */
export function stoneRoll(_models: { index: FingerModel; middle: FingerModel }, _top: 'index' | 'middle', _hold: { index: number; middle: number }, _pitch: number): number {
  return STONE_ROLL
}
