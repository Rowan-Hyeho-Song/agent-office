// How a hand takes hold of things (#164, docs/design/grips.md). Pure: three.js math only, no scene.
//
//  - GRIPS: the designer's per-object table (finger values for "pre-grip" / "closed" / "after", which fingers touch where).
//  - GripClock: the three stages (approach 0.3 s with the last 0.15 s opening to pre-grip, close 0.12 s, release: "after" in
//    0.15 s, rest within 0.3 s) as weights, scaled by the replay speed (a stage lasts at least `gestureMin`) and instant under
//    reduced motion.
//  - fitContact: bend one finger (and swing it sideways, or open / oppose the thumb) so its tip lands on a contact point and
//    stays on the outside of the surface (the contact node's +y, the exported form of Blender's +z).

import { Euler as EulerCtor, Matrix4, Quaternion, Vector3 } from 'three'

const DEG = Math.PI / 180
/** degrees per unit of c at the root, middle and tip knuckle (agents.md 2.7) */
export const KNUCKLE_DEG = [75, 90, 60] as const
/** the thumb: root bend, root opposition (about local z), tip bend, degrees per unit */
export const THUMB_DEG = { bend1: 55, oppose: 60, bend2: 70 } as const

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
    l: { pre: all(0.15, [0.1, 0]), hold: curlOf([0.35, 0.4, 0.45, 0.5], [0.2, -0.3]), after: REST, contacts: ['thumb'] },
    r: { pre: all(0.15, [0.1, 0]), hold: all(0.3, [0.15, 0.4]), after: REST, contacts: ['index'] },
  },
  paddle: { r: { pre: curlOf([0.15, 0.4, 0.45, 0.5], [0.1, 0.3]), hold: curlOf([0.15, 0.8, 0.85, 0.9], [0.25, 0.7]), after: REST, contacts: ['index', 'thumb'] } },
  // the pen family: a tripod grip, ring and little folded
  tablet_pen: { r: { pre: curlOf([0.3, 0.35, 0.6, 0.65], [0.2, 0.5]), hold: curlOf([0.45, 0.55, 0.8, 0.85], [0.35, 0.8]), after: REST, contacts: ['thumb', 'index', 'middle'] } },
  marker: { r: { pre: curlOf([0.3, 0.35, 0.6, 0.65], [0.2, 0.5]), hold: curlOf([0.4, 0.5, 0.75, 0.8], [0.3, 0.75]), after: REST, contacts: ['thumb', 'index', 'middle'] } },
  stamp: { r: { pre: all(0.3, [0.1, 0.3]), hold: curlOf([0.75, 0.8, 0.82, 0.85], [0.4, 0.9]), after: REST, contacts: ['palm'] } },
  // a hand resting on a mouse: the palm over the body, the index on its button
  mouse: { r: { pre: all(0.2, [0.1, 0.3]), hold: curlOf([0.35, 0.35, 0.45, 0.5], [0.25, 0.6]), after: REST, contacts: ['index'] } },
  // a finger pressing a button
  button: { r: { pre: curlOf([0, 0.9, 0.92, 0.95], [0.6, 0.6]), hold: curlOf([0.05, 0.9, 0.92, 0.95], [0.6, 0.6]), after: REST, contacts: ['index'] } },
  // the go stone, the Nihon Ki-in grip (agents.md 2.10, #192): the stone on the index nail, the middle fingertip pressing it from above
  piece: { r: { pre: all(0.15, [0.1, 0.3]), hold: curlOf([0.35, 0.1, 0.8, 0.85], [0.4, 0.6]), after: REST, contacts: ['index', 'middle'] } },
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
  /** segment origin in its parent's frame (the hand for the first), and the rest rotation */
  p: Vector3[]
  rest: Quaternion[]
  /** the tip in the last segment's frame */
  tip: Vector3
  thumb: boolean
  /** +1 right hand, −1 left (the sideways swing and the thumb's opposition mirror) */
  sx: 1 | -1
}

const AX = new Vector3(1, 0, 0)
const AZ = new Vector3(0, 0, 1)
const q1 = new Quaternion()
const q2 = new Quaternion()
const m1 = new Matrix4()
const m2 = new Matrix4()
const one = new Vector3(1, 1, 1)

/**
 * The tip in the hand's frame. A finger: `a` = c (0 straight … 1 fully bent), `b` = the sideways swing, radians about the
 * hand's palm normal. The thumb: `a` = bend, `b` = opposition.
 */
export function tipAt(m: FingerModel, a: number, b: number, out = new Vector3()): Vector3 {
  const acc = new Matrix4()
  if (m.thumb) {
    q1.copy(m.rest[0]).multiply(q2.setFromAxisAngle(AZ, m.sx * THUMB_DEG.oppose * DEG * b))
    q1.multiply(new Quaternion().setFromAxisAngle(AX, THUMB_DEG.bend1 * DEG * a))
    acc.compose(m.p[0], q1, one)
    q1.copy(m.rest[1]).multiply(q2.setFromAxisAngle(AX, THUMB_DEG.bend2 * DEG * a))
    acc.multiply(m2.compose(m.p[1], q1, one))
  } else {
    q1.setFromAxisAngle(AZ, m.sx * b).multiply(m.rest[0]).multiply(q2.setFromAxisAngle(AX, KNUCKLE_DEG[0] * DEG * a))
    acc.compose(m.p[0], q1, one)
    for (let k = 1; k < 3; k++) {
      q1.copy(m.rest[k]).multiply(q2.setFromAxisAngle(AX, KNUCKLE_DEG[k] * DEG * a))
      acc.multiply(m1.compose(m.p[k], q1, one))
    }
  }
  return out.copy(m.tip).applyMatrix4(acc)
}

export interface Fit {
  /** the finger's c (the thumb's bend) and its swing (the thumb's opposition) */
  a: number
  b: number
  /** distance from the tip to the contact point, m */
  err: number
  /** how far the tip stands off the surface along its normal, m (≥ 0: not through it) */
  off: number
}

/** how far out of the surface the target is kept, so that a tip that "touches" is never a hair inside */
const SKIN = 0.0003

/**
 * Find the bend (and swing) that puts the tip on `target` without going through the surface (`normal` points out of it, both in the
 * hand's frame). Starts from the table's value `a0` and prefers the least change from it; a tip that would go through is
 * bent less. Deterministic.
 */
export function fitContact(m: FingerModel, target: Vector3, normal: Vector3, a0: number, b0 = 0, G = 14): Fit {
  const n = normal.clone().normalize()
  const goal = target.clone().addScaledVector(n, SKIN)
  const lo: [number, number] = m.thumb ? [0, -0.6] : [0, -0.6]
  const hi: [number, number] = m.thumb ? [1.3, 1.6] : [1, 0.6]
  const tip = new Vector3()
  const cost = (a: number, b: number) => {
    tipAt(m, a, b, tip)
    const off = tip.clone().sub(target).dot(n)
    const e = tip.distanceToSquared(goal)
    return e + (off < 0 ? 4000 * off * off : 0) + 1e-6 * ((a - a0) ** 2 + (b - b0) ** 2)
  }
  let best = { a: a0, b: b0, c: Infinity }
  for (let i = 0; i <= G; i++)
    for (let j = 0; j <= G; j++) {
      const a = lo[0] + ((hi[0] - lo[0]) * i) / G
      const b = lo[1] + ((hi[1] - lo[1]) * j) / G
      const c = cost(a, b)
      if (c < best.c) best = { a, b, c }
    }
  let sa = (hi[0] - lo[0]) / G
  let sb = (hi[1] - lo[1]) / G
  for (let it = 0; it < 80; it++) {
    let moved = false
    for (const [da, db] of [[sa, 0], [-sa, 0], [0, sb], [0, -sb], [sa, sb], [-sa, -sb], [sa, -sb], [-sa, sb]] as const) {
      const a = Math.min(hi[0], Math.max(lo[0], best.a + da))
      const b = Math.min(hi[1], Math.max(lo[1], best.b + db))
      const c = cost(a, b)
      if (c < best.c - 1e-18) {
        best = { a, b, c }
        moved = true
      }
    }
    if (!moved) {
      sa *= 0.5
      sb *= 0.5
      if (sa < 1e-6) break
    }
  }
  tipAt(m, best.a, best.b, tip)
  return { a: best.a, b: best.b, err: tip.distanceTo(target), off: tip.clone().sub(target).dot(n) }
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
}
export interface Solved {
  /** how the hand sits relative to "grip frame on grip frame": hand_world = grip_aligned_world · offset (offset in the hand's frame) */
  offset: Matrix4
  fits: { finger: ContactIn['finger']; a: number; b: number; err: number; off: number }[]
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
 */
export function solveContacts(contacts: ContactIn[], keepNear = 0.02): Solved {
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
      const f = fitContact(c.model, p, n, c.a0, c.b0, full ? 14 : 6)
      cost += f.err * f.err + (f.off < 0 ? 4000 * f.off * f.off : 0)
      worst = Math.max(worst, f.err)
      fits.push({ finger: c.finger, a: f.a, b: f.b, err: f.err, off: f.off })
    }
    const moved = Math.hypot(v[0], v[1], v[2])
    // a little pull toward the designer's grip frame, so a hand that already reaches stays where it is
    return { cost: cost + (keepNear > 0 ? (moved / keepNear) ** 2 * 1e-6 : 0) + 4e-6 * (v[3] ** 2 + v[4] ** 2 + v[5] ** 2), worst, fits, moved }
  }
  let best: { v: number[]; r: ReturnType<typeof trial> } | null = null
  const starts: number[][] = [[0, 0, 0, 0, 0, 0]]
  for (const d of [0.02, 0.04, 0.06, 0.08]) for (const ax of [1, 2]) for (const sg of [1, -1]) {
    const v = [0, 0, 0, 0, 0, 0]
    v[ax] = sg * d
    starts.push(v)
  }
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

export interface StoneGrip {
  /** the stone's frame (x along the fingers, y out of its faces toward the index finger, z across) in the hand's frame */
  m: Matrix4
  /** the bend and swing of the middle finger (under the stone) and of the index finger (on top of it) */
  index: { a: number; b: number }
  middle: { a: number; b: number }
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
export const STONE_ROLL = (30 * Math.PI) / 180
/**
 * The go grip (agents.md 2.10): the palm down with its little-finger side raised by `roll`, the fingers pointing forward and down by
 * `pitch`, the stone flat (horizontal), resting on the fingertip of the BOTTOM finger with the TOP finger's tip pressing it from above.
 * Which finger is on top comes from the model's stone contacts (`top`: the finger whose contact faces up), not from here. In the hand's
 * frame the stone's normal is the direction of "up" for such a hand; the bottom finger starts at its table value, and it and the top
 * finger are bent and swung, as little as it takes, until the top tip stands one stone's thickness above the bottom tip along that normal.
 */
export function stoneGrip(models: { index: FingerModel; middle: FingerModel }, top: 'index' | 'middle', hold: { index: number; middle: number }, pitch = STONE_PITCH, roll = STONE_ROLL): StoneGrip {
  const bottom = top === 'index' ? 'middle' : 'index'
  const sx = models.index.sx
  const sp = Math.sin(pitch)
  const cp = Math.cos(pitch)
  const sr = Math.sin(roll) * sx
  const cr = Math.cos(roll)
  const n = new Vector3(-cp * sr, -sp, -cp * cr)
  const f = new Vector3(-sp * sr, cp, -sp * cr) // the forward direction along the board, in the hand's frame
  let best: { cb: number; bb: number; fit: Fit; cost: number } | null = null
  for (let cb = 0.05; cb <= 0.8; cb += 0.05)
    for (let bb = -0.6; bb <= 0.601; bb += 0.075) {
      const B = tipAt(models[bottom], cb, bb)
      const fit = fitContact(models[top], B.clone().addScaledVector(n, STONE_H), n, hold[top], 0, 8)
      const cost = fit.err + 0.0004 * Math.abs(cb - hold[bottom]) + 0.0004 * Math.abs(bb)
      if (!best || cost < best.cost) best = { cb, bb, fit, cost }
    }
  // a local search around the coarse winner
  const eval2 = (cb: number, bb: number) => {
    const B = tipAt(models[bottom], cb, bb)
    const fit = fitContact(models[top], B.clone().addScaledVector(n, STONE_H), n, hold[top], 0, 8)
    return { cb, bb, fit, cost: fit.err + 0.0004 * Math.abs(cb - hold[bottom]) + 0.0004 * Math.abs(bb) }
  }
  let step = 0.04
  for (let it = 0; it < 40 && step > 1e-3; it++) {
    let moved = false
    for (const [dc, db] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]] as const) {
      const r = eval2(Math.min(1, Math.max(0, best!.cb + dc)), Math.min(0.6, Math.max(-0.6, best!.bb + db)))
      if (r.cost < best!.cost - 1e-9) {
        best = r
        moved = true
      }
    }
    if (!moved) step *= 0.5
  }
  const { cb, bb, fit } = best!
  const B = tipAt(models[bottom], cb, bb)
  const z = new Vector3().crossVectors(f, n)
  const m = new Matrix4().makeBasis(f, n, z).setPosition(B.clone().addScaledVector(n, STONE_H / 2))
  const res = { [top]: { a: fit.a, b: fit.b }, [bottom]: { a: cb, b: bb } } as { index: { a: number; b: number }; middle: { a: number; b: number } }
  const zero = { err: 0, off: 0 }
  return { m, ...res, top, err: { ...{ index: 0, middle: 0 }, [top]: fit.err }, off: { ...{ index: zero.off, middle: zero.off }, [top]: fit.off } }
}

/** the palm's normal never points up more than this far below horizontal: y ≤ −0.61 (designer: palm down, bound −0.6) */
export const PALM_DOWN_Y = -0.61

/**
 * The least pronation (from the designer's 30°) at which this hand's go grip fits within 2.5 mm at this pitch while the palm stays down
 * (palm normal y = −cos pitch · cos roll ≤ ${PALM_DOWN_Y}). The hands differ by a few mm and the finger on top needs more roll on some of them; where
 * no roll does both, the most roll the palm bound allows.
 */
export function stoneRoll(models: { index: FingerModel; middle: FingerModel }, top: 'index' | 'middle', hold: { index: number; middle: number }, pitch: number): number {
  const max = Math.acos(Math.min(1, -PALM_DOWN_Y / Math.cos(pitch)))
  for (let deg = 30; deg <= 60; deg += 2.5) {
    const roll = Math.min((deg * Math.PI) / 180, max)
    if (stoneGrip(models, top, hold, pitch, roll).err[top] <= 0.0025 || roll >= max) return roll
  }
  return max
}
