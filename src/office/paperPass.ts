// Which way a paper goes from one agent to another (#262, docs/design/paper-pass.md 1, 2): handing it over, sliding it across the desk,
// a toss or the paper plane. Pure: three.js math and plain data only. The running of it (hands, paper, faces) is paperRun.ts.
import { Box3, Vector3, type Mesh, type Object3D } from 'three'
import { ROOM } from './room'

export type Method = 'hand' | 'slide' | 'toss' | 'plane'

/** paper-pass.md 1: the distances (between the two bodies' centres), the body radius and the tallest thing a toss goes over */
export const LIMITS = { hand: 1.5, slide: 1.8, toss: 3.0, tall: 1.3, body: 0.3, deskLo: 0.7, deskHi: 0.8 } as const

export interface Pt {
  x: number
  z: number
}

// ------------------------------------------------------------------ the furniture as the planner's footprint, with heights

const CELL = 0.05
/** shell, wall decor and floor pads are not furniture to pass over (floorMask.ts) */
const SKIP = /^(room|wall.*|pad_.*|boards|door)$/

const tri = new Vector3()

/** every triangle of a node's meshes in world space: fn(a, b, c) */
function eachTriangle(node: Object3D, fn: (a: Vector3, b: Vector3, c: Vector3) => void) {
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  node.traverse((o) => {
    const m = o as Mesh
    const geo = m.geometry
    if (!geo) return
    m.updateWorldMatrix(true, false)
    const pos = geo.getAttribute('position')
    const index = geo.getIndex()
    const n = index ? index.count : pos.count
    for (let t = 0; t < n; t += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(t) : t).applyMatrix4(m.matrixWorld)
      b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1).applyMatrix4(m.matrixWorld)
      c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2).applyMatrix4(m.matrixWorld)
      fn(a, b, c)
    }
  })
}
void tri

/**
 * The baked furniture's plan outline on a 0.05 m grid, with the top of each cell (m), and which cells are a desk (desk_N and what stands on it).
 * Built once from the scene's baked nodes; plain numbers afterwards.
 */
export class Furniture {
  readonly w = Math.ceil((2 * ROOM.hx) / CELL)
  readonly h = Math.ceil((2 * ROOM.hz) / CELL)
  readonly top = new Float32Array(this.w * this.h)
  readonly desk = new Uint8Array(this.w * this.h)

  private idx(x: number, z: number) {
    const i = Math.floor((x + ROOM.hx) / CELL)
    const j = Math.floor((z + ROOM.hz) / CELL)
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i
  }
  topAt(x: number, z: number) {
    const k = this.idx(x, z)
    return k < 0 ? 0 : this.top[k]
  }
  isDesk(x: number, z: number) {
    const k = this.idx(x, z)
    return k >= 0 && this.desk[k] === 1
  }

  static from(nodes: Record<string, Object3D>): Furniture {
    const f = new Furniture()
    const put = (x0: number, x1: number, z0: number, z1: number, top: number) => {
      const i0 = Math.max(0, Math.floor((x0 + ROOM.hx) / CELL))
      const i1 = Math.min(f.w - 1, Math.floor((x1 + ROOM.hx) / CELL))
      const j0 = Math.max(0, Math.floor((z0 + ROOM.hz) / CELL))
      const j1 = Math.min(f.h - 1, Math.floor((z1 + ROOM.hz) / CELL))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) f.top[j * f.w + i] = Math.max(f.top[j * f.w + i], top)
    }
    for (const [name, node] of Object.entries(nodes)) {
      if (!node.userData.atlas || SKIP.test(name) || /^(prop_|agent_)/.test(name)) continue
      eachTriangle(node, (a, b, c) => {
        const y1 = Math.max(a.y, b.y, c.y)
        if (y1 < 0.12 || Math.min(a.y, b.y, c.y) > 1.9) return
        put(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z), y1)
      })
    }
    // the desks: each desk_N's own box (its props stand inside it)
    for (let n = 0; n < 5; n++) {
      const d = nodes[`desk_${n}`]
      if (!d) continue
      // a little grown: what hangs over the desk's edge (a tray, a cable) and the cells the line samples on its rim are the desk too
      const box = new Box3().setFromObject(d).expandByScalar(0.06)
      for (let z = box.min.z + CELL / 2; z < box.max.z; z += CELL)
        for (let x = box.min.x + CELL / 2; x < box.max.x; x += CELL) {
          const k = f.idx(x, z)
          if (k >= 0) f.desk[k] = 1
        }
    }
    return f
  }
}

export interface Between {
  /** any furniture that is not a desk, any desk, and the tallest top over the line (m) */
  other: boolean
  desk: boolean
  maxTop: number
}

/** the furniture the line between two bodies passes (the ends, one body radius each, left out), at 2.5 cm steps */
export function between(f: Furniture | null, a: Pt, b: Pt): Between {
  const out: Between = { other: false, desk: false, maxTop: 0 }
  if (!f) return out
  const d = Math.hypot(b.x - a.x, b.z - a.z)
  if (d <= 2 * LIMITS.body) return out
  const ux = (b.x - a.x) / d
  const uz = (b.z - a.z) / d
  for (let s = LIMITS.body; s <= d - LIMITS.body + 1e-9; s += 0.025) {
    const x = a.x + ux * s
    const z = a.z + uz * s
    const top = f.topAt(x, z)
    if (top <= 0) continue
    out.maxTop = Math.max(out.maxTop, top)
    if (f.isDesk(x, z)) out.desk = true
    else out.other = true
  }
  return out
}

/** another agent's body (radius 0.3) on the line between two bodies, away from both ends */
export function bodyBetween(a: Pt, b: Pt, others: readonly Pt[]): boolean {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const d2 = dx * dx + dz * dz
  const d = Math.sqrt(d2)
  if (d < 1e-6) return false
  return others.some((o) => {
    const s = ((o.x - a.x) * dx + (o.z - a.z) * dz) / d2
    if (s * d <= LIMITS.body || s * d >= d - LIMITS.body) return false
    return Math.hypot(a.x + dx * s - o.x, a.z + dz * s - o.z) < LIMITS.body
  })
}

// ------------------------------------------------------------------ the lane a slid paper takes over the desks

/** a thing on the desk stops a slid paper from this height (m); lower ones (keyboards, mice) are not in its way */
export const TALL = 0.8
/** ... and from this height (monitor stands, lamps, speakers) nothing may touch it: mugs and ducks (TALL..STAND) are given way when no lane is free of them */
export const STAND = 0.9
const DC = 0.01
const DX0 = -3.4
const DZ0 = -3.0
const DW = 240
const DH = 600

/** what stands on the desks (keyboards, mugs, monitor stands, ...) in the paper's way, on a 2 cm grid; the screens above the paper are not in it */
export class DeskStuff {
  private bits = new Uint8Array(DW * DH)
  static from(nodes: Record<string, Object3D>): DeskStuff {
    const s = new DeskStuff()
    for (const [name, node] of Object.entries(nodes)) {
      if (!/^(desk_[0-4]_|kb_[0-4])/.test(name) || !node.userData.name) continue
      eachTriangle(node, (a, b, c) => {
        // things taller than TALL above the desk top (keyboards, mice, trays lie lower: the sheet rides over them) and below the screens lower edge
        const top = Math.max(a.y, b.y, c.y)
        if (top < TALL || Math.min(a.y, b.y, c.y) > 0.9) return
        s.fill(a, b, c, top >= STAND ? 2 : 1)
      })
    }
    return s
  }
  /** the cells a triangle covers in plan: the centres inside it (a little grown) and its corners' cells */
  private fill(a: Vector3, b: Vector3, c: Vector3, level: 1 | 2) {
    const mark = (x: number, z: number) => {
      const i = Math.floor((x - DX0) / DC)
      const j = Math.floor((z - DZ0) / DC)
      if (i >= 0 && j >= 0 && i < DW && j < DH) this.bits[j * DW + i] = Math.max(this.bits[j * DW + i], level)
    }
    mark(a.x, a.z)
    mark(b.x, b.z)
    mark(c.x, c.z)
    const x0 = Math.min(a.x, b.x, c.x)
    const x1 = Math.max(a.x, b.x, c.x)
    const z0 = Math.min(a.z, b.z, c.z)
    const z1 = Math.max(a.z, b.z, c.z)
    const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
    if (Math.abs(det) < 1e-12) {
      // a sliver seen from above (a wall of the box): its box
      for (let z = z0; z <= z1 + 1e-9; z += DC / 2) for (let x = x0; x <= x1 + 1e-9; x += DC / 2) mark(x, z)
      return
    }
    const tol = 0.004
    for (let j = Math.max(0, Math.floor((z0 - DZ0) / DC)); j <= Math.min(DH - 1, Math.floor((z1 - DZ0) / DC)); j++)
      for (let i = Math.max(0, Math.floor((x0 - DX0) / DC)); i <= Math.min(DW - 1, Math.floor((x1 - DX0) / DC)); i++) {
        const x = DX0 + (i + 0.5) * DC
        const z = DZ0 + (j + 0.5) * DC
        const l1 = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det
        const l2 = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det
        const l3 = 1 - l1 - l2
        const e = tol / Math.sqrt(Math.abs(det))
        if (l1 >= -e && l2 >= -e && l3 >= -e) this.bits[j * DW + i] = Math.max(this.bits[j * DW + i], level)
      }
  }
  /** is there something at least `level` tall (1: mugs and up, 2: stands and up) */
  at(x: number, z: number, level: 1 | 2 = 1) {
    const i = Math.floor((x - DX0) / DC)
    const j = Math.floor((z - DZ0) / DC)
    return i >= 0 && j >= 0 && i < DW && j < DH && this.bits[j * DW + i] >= level
  }
  /** anything in a rectangle (centre, long axis direction (ux, uz), half length, half width) */
  hits(cx: number, cz: number, ux: number, uz: number, halfL: number, halfW: number, level: 1 | 2 = 1): boolean {
    for (let l = -halfL; l <= halfL + 1e-9; l += 0.01) for (let w = -halfW; w <= halfW + 1e-9; w += 0.01) if (this.at(cx + ux * l - uz * w, cz + uz * l + ux * w, level)) return true
    return false
  }
  /** debug / tests: how many cells are taken */
  get count() {
    let n = 0
    for (const b of this.bits) n += b
    return n
  }
}

/** paper-pass.md 2.2: where a slid paper is put down (0.3 in front of the sender), pushed to (0.45) and stops (0.30 in front of the receiver) */
export const SLIDE = { put: 0.3, reach: 0.45, stop: 0.3, gap: 0.03, halfW: 0.105, halfL: 0.1485 } as const

export interface Seatish extends Pt {
  /** the way it faces (nav ry) */
  ry: number
}
const front = (p: Seatish, m: number) => new Vector3(p.x - Math.sin(p.ry) * m, 0, p.z - Math.cos(p.ry) * m)

export interface Lane {
  /** the sideways shift of the whole line from the straight one (m, + = to the left of the way) */
  offset: number
  /** where the paper is put down, pushed to, and stops (x, z) */
  put: Vector3
  reach: Vector3
  stop: Vector3
  /** the way the paper goes (unit) and its length put to stop */
  dir: Vector3
  length: number
}

/**
 * The line a slid paper takes: straight from in front of the sender to in front of the receiver, moved sideways until the paper (with `gap`
 * to everything) clears what stands on the desks, the monitor stands first of all. The least shift wins. null: no lane, no slide.
 */
export function findLane(stuff: DeskStuff | null, from: Seatish, to: Seatish): Lane | null {
  const put0 = front(from, SLIDE.put)
  const stop0 = front(to, SLIDE.stop)
  const dir = stop0.clone().sub(put0)
  const length = Math.hypot(dir.x, dir.z)
  if (length < 0.2) return null
  dir.multiplyScalar(1 / length)
  const left = new Vector3(-dir.z, 0, dir.x)
  const offsets = [0]
  for (let o = 0.01; o <= 0.46; o += 0.01) offsets.push(o, -o)
  // the line nearest the straight one that clears everything on the desk; failing that, one that clears the stands, lamps and speakers
  for (const level of [1, 2] as const)
    for (const o of offsets) {
      const put = put0.clone().addScaledVector(left, o)
      const stop = stop0.clone().addScaledVector(left, o)
      const mid = put.clone().add(stop).multiplyScalar(0.5)
      if (stuff && stuff.hits(mid.x, mid.z, dir.x, dir.z, length / 2 + SLIDE.halfL + SLIDE.gap, SLIDE.halfW + SLIDE.gap, level)) continue
      return { offset: o, put, reach: put.clone().addScaledVector(dir, SLIDE.reach - SLIDE.put), stop, dir, length }
    }
  return null
}

// ------------------------------------------------------------------ the choice

export interface Env {
  furniture: Furniture | null
  desks: DeskStuff | null
  /** the other agents' bodies (not the two) */
  others: readonly Pt[]
}

export interface Choice {
  method: Method
  /** the distance between the bodies */
  d: number
  between: Between
  lane: Lane | null
  /** the rule of paper-pass.md 1 that decided (1..5) */
  rule: 1 | 2 | 3 | 4 | 5
}

/** paper-pass.md 1: the first rule that fits */
export function chooseMethod(from: Seatish, to: Seatish, env: Env): Choice {
  const d = Math.hypot(to.x - from.x, to.z - from.z)
  const btw = between(env.furniture, from, to)
  const base = { d, between: btw, lane: null as Lane | null }
  if (bodyBetween(from, to, env.others)) return { ...base, method: 'plane', rule: 1 }
  const furn = btw.other || btw.desk
  if (d <= LIMITS.hand && !furn) return { ...base, method: 'hand', rule: 2 }
  if (d <= LIMITS.slide && btw.desk && !btw.other) {
    const lane = findLane(env.desks, from, to)
    if (lane) return { ...base, lane, method: 'slide', rule: 3 }
  }
  if (d <= LIMITS.toss && btw.maxTop < LIMITS.tall) return { ...base, method: 'toss', rule: 4 }
  return { ...base, method: 'plane', rule: 5 }
}

// ------------------------------------------------------------------ time

/** seconds per stage (paper-pass.md 2; the pickup from the desk before the signal is ours) */
export interface Times {
  pick: number
  /** the signal: the paper is lifted and turned to the receiver */
  signal: number
  reach: number
  /** the receiver's late start behind the sender (hand over) */
  late: number
  /** both hold it */
  shared: number
  back: number
  push: number
  slide: number
  block: number
  /** the receiver lifts it to the reading place */
  lift: number
  fold: number
  throw: number
  fly: number
  /** a toss: the hands unfold it */
  unfold: number
  look: number
  fade: number
  /** reduced motion: the paper fades in the receiver's hand */
  appear: number
}

/** distance-proportional slide time, 0.5-0.8 s (paper-pass.md 2.2) */
export const slideTime = (length: number) => Math.min(0.8, Math.max(0.5, 0.5 + (length - 0.6) * 0.3))
/** the toss's flight: 0.45 + 0.1 (d - 1.5) (paper-pass.md 2.3) */
export const flyTime = (d: number) => Math.max(0.3, 0.45 + 0.1 * (d - 1.5))

/**
 * The stages of one pass. `fast` (the timelapse at x16, #158): the same stages, the time compressed to a third, nothing shorter than
 * `min` (gestureMin) except the shared hold, which stays what the designer set.
 */
export function timesFor(distance: number, length: number, o: { fast?: boolean; min?: number; look?: number } = {}): Times {
  const k = o.fast ? 0.33 : 1
  const m = (x: number) => (o.fast ? Math.max(x * k, o.min ?? 0) : x)
  return {
    pick: m(0.35),
    signal: m(0.4),
    reach: m(0.5),
    late: m(0.2),
    shared: 0.15,
    back: m(0.5),
    push: m(0.4),
    slide: m(slideTime(length)),
    block: m(0.3),
    lift: m(0.3),
    fold: m(0.6),
    throw: m(0.35),
    fly: m(flyTime(distance)),
    unfold: m(0.4),
    look: o.fast ? 0.5 : (o.look ?? 1.5),
    fade: 0.3,
    appear: 0.12,
  }
}

/** a toss's apex: the higher of the release and catch heights + 0.25, and 0.2 above the tallest thing under the arc (paper-pass.md 2.3) */
export const tossApex = (y0: number, y1: number, maxTop: number) => Math.max(Math.max(y0, y1) + 0.25, maxTop > 0 ? maxTop + 0.2 : 0)

/** the height of a parabola from y0 to y1 whose highest point is `apex` (above both ends), at k in 0..1 */
export function arcY(y0: number, y1: number, apex: number, k: number): number {
  // y(k) = y0 + s k + 4 h k (1 - k); its peak is y0 + (4h + s)^2 / 16h, so 16 h^2 + (8 s - 16 q) h + s^2 = 0 with s = y1 - y0, q = apex - y0
  const s = y1 - y0
  const q = apex - y0
  const B = 8 * s - 16 * q
  const disc = Math.max(0, B * B - 64 * s * s)
  const h = (-B + Math.sqrt(disc)) / 32
  return y0 + s * k + 4 * h * k * (1 - k)
}
