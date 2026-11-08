// The free camera (#111): the cutaway walls, the view limits, WASD and the near-object fade, as pure decisions.
// three.js side: cutaway.tsx (walls), cameraRig.tsx (limits, keys, reset), occluders.tsx (near-object fade).
// ONE constants object: the designer's values live here and nowhere else.

import { ROOM, WALL_THICKNESS, floorRect, type WallId } from './room'

export type Wall = WallId
export const WALLS: readonly Wall[] = ['n', 'e', 's', 'w']

export const VIEW = {
  // --- cutaway walls: a hidden wall is lowered to a floor strip (the room outline stays) ---
  get wallH() {
    return ROOM.wallH
  },
  stripH: 0.15,
  lowerMs: 240,
  raiseMs: 320,
  /** lower when c > this, raise when c < -this, else keep (sin 10 degrees); c = dot(room centre -> camera, wall outward normal) */
  switchSin: 0.17,
  /** the cap on the cut top (hides the hollow inside the wall) */
  capThickness: WALL_THICKNESS,
  capColor: '#2a2e36',
  /** the room: floor rectangle (inner faces of the four walls, room.ts) and its centre */
  get floor() {
    return floorRect()
  },
  center: { x: 0, z: 0 },

  // --- view limits ---
  polar: [0.15, 1.35] as const,
  distance: [2.5, 18] as const,
  targetInset: 0.5,
  targetY: [0.4, 1.5] as const,
  resetMs: 600,

  // --- WASD / arrows ---
  keys: { speedPerDist: 0.35, speedMin: 1.2, speedMax: 4, shift: 2, easeMs: 120 },

  // --- near-object fade ---
  near: { start: 1.4, end: 0.6, minOpacity: 0.25, outMs: 160, inMs: 240, /** the camera->target segment stops this far short of the target */ targetSkip: 0.4 },

  // --- first-time hint ---
  hintMs: 4000,
} as const

/** the wall's outward unit normal on the ground plane */
export const WALL_NORMAL: Record<Wall, { x: number; z: number }> = {
  n: { x: 0, z: -1 },
  s: { x: 0, z: 1 },
  e: { x: 1, z: 0 },
  w: { x: -1, z: 0 },
}

export type Hidden = Record<Wall, boolean>
export const NONE_HIDDEN: Hidden = { n: false, e: false, s: false, w: false }

/** the camera is within the floor rectangle (the room-mode door pose): every wall stays up */
export const insideRoom = (x: number, z: number) => {
  const f = VIEW.floor
  return x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ
}

/**
 * Which walls are lowered for a camera at (x, z). With v = unit vector from the room centre to the camera and
 * c = dot(v, outward normal): c > switchSin lowers, c < -switchSin raises, in between the wall keeps `prev`
 * (hysteresis: no flicker at the boundary). From a corner two walls are down, head-on one (the side walls keep
 * their state). Inside the room nothing is lowered.
 */
export function nextHidden(prev: Hidden, x: number, z: number): Hidden {
  if (insideRoom(x, z)) return { ...NONE_HIDDEN }
  const dx = x - VIEW.center.x
  const dz = z - VIEW.center.z
  const len = Math.hypot(dx, dz) || 1
  const out = { ...prev }
  for (const w of WALLS) {
    const n = WALL_NORMAL[w]
    const c = (dx * n.x + dz * n.z) / len
    if (c > VIEW.switchSin) out[w] = true
    else if (c < -VIEW.switchSin) out[w] = false
  }
  return out
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const easeOut = (k: number) => 1 - (1 - k) * (1 - k)

/** the wall's top height `elapsed` ms into a lowering (to < from) or raising move; 0 ms = instant */
export function cutAt(from: number, to: number, elapsed: number): number {
  const ms = to < from ? VIEW.lowerMs : VIEW.raiseMs
  return elapsed >= ms ? to : from + (to - from) * easeOut(clamp(elapsed / ms, 0, 1))
}

/** the wall's resting top height */
export const wallTop = (hidden: boolean) => (hidden ? VIEW.stripH : VIEW.wallH)

// ---- view limits -------------------------------------------------------------------------------------------------

/** the target kept inside the floor rectangle (inset) and the height range, per axis (so it slides along an edge) */
export function clampTarget<T extends { x: number; y: number; z: number }>(t: T): { x: number; y: number; z: number } {
  const f = VIEW.floor
  const i = VIEW.targetInset
  return {
    x: clamp(t.x, f.minX + i, f.maxX - i),
    y: clamp(t.y, VIEW.targetY[0], VIEW.targetY[1]),
    z: clamp(t.z, f.minZ + i, f.maxZ - i),
  }
}
export const clampPolar = (p: number) => clamp(p, VIEW.polar[0], VIEW.polar[1])
export const clampDistance = (d: number) => clamp(d, VIEW.distance[0], VIEW.distance[1])

// ---- WASD (no arrow keys) ---------------------------------------------------------------------------------------------------------

export interface Keys {
  fwd: boolean
  back: boolean
  left: boolean
  right: boolean
  shift: boolean
}
export const NO_KEYS: Keys = { fwd: false, back: false, left: false, right: false, shift: false }

/** key (KeyboardEvent.code) -> direction */
export const KEY_DIR: Record<string, 'fwd' | 'back' | 'left' | 'right'> = {
  KeyW: 'fwd',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
}

/** the wanted ground direction (unit or zero) for the keys, given the camera's forward (camera -> target) on the ground */
export function wantDir(k: Keys, fwd: { x: number; z: number }): { x: number; z: number } {
  const len = Math.hypot(fwd.x, fwd.z) || 1
  const f = { x: fwd.x / len, z: fwd.z / len }
  const r = { x: -f.z, z: f.x } // right of forward on the ground (y up)
  const a = (k.fwd ? 1 : 0) - (k.back ? 1 : 0)
  const b = (k.right ? 1 : 0) - (k.left ? 1 : 0)
  const x = f.x * a + r.x * b
  const z = f.z * a + r.z * b
  const m = Math.hypot(x, z)
  return m ? { x: x / m, z: z / m } : { x: 0, z: 0 }
}

/** m/s: clamp(0.35 x distance, 1.2, 4), Shift doubles it */
export const keySpeed = (distance: number, shift: boolean) => clamp(VIEW.keys.speedPerDist * distance, VIEW.keys.speedMin, VIEW.keys.speedMax) * (shift ? VIEW.keys.shift : 1)

/** velocity eased towards the wanted one (about easeMs to settle); `reduced` = no inertia */
export function easeVelocity(cur: { x: number; z: number }, want: { x: number; z: number }, dt: number, reduced: boolean) {
  if (reduced) return { ...want }
  const k = 1 - Math.exp((-dt * 1000 * 3) / VIEW.keys.easeMs)
  return { x: cur.x + (want.x - cur.x) * k, z: cur.z + (want.z - cur.z) * k }
}

/** Camera keys act only when focus is on the 3D view (the page body or the canvas): any control owns its own keys. */
export function focusAllowsCameraKeys(active: { tagName?: string } | null, body: unknown, root: unknown = null): boolean {
  if (!active || active === body || active === root) return true
  return active.tagName === 'CANVAS'
}

// ---- near-object fade ----------------------------------------------------------------------------------------------

export interface Box {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}
type V3 = readonly [number, number, number]

/** distance from a point to the box surface (0 inside) */
export function boxDistance(p: V3, b: Box): number {
  let s = 0
  for (let i = 0; i < 3; i++) {
    const d = Math.max(b.min[i] - p[i], 0, p[i] - b.max[i])
    s += d * d
  }
  return Math.sqrt(s)
}

/** does the segment a -> b cross the box (slab test) */
export function segmentHitsBox(a: V3, b: V3, box: Box): boolean {
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i]
    if (Math.abs(d) < 1e-9) {
      if (a[i] < box.min[i] || a[i] > box.max[i]) return false
      continue
    }
    let u = (box.min[i] - a[i]) / d
    let v = (box.max[i] - a[i]) / d
    if (u > v) [u, v] = [v, u]
    t0 = Math.max(t0, u)
    t1 = Math.min(t1, v)
    if (t0 > t1) return false
  }
  return true
}

/** the opacity an object wants: linear from 1 at near.start to minOpacity at near.end; occluders are at the minimum */
export function wantOpacity(dist: number, occluding: boolean): number {
  const n = VIEW.near
  if (occluding) return n.minOpacity
  const k = clamp((n.start - dist) / (n.start - n.end), 0, 1)
  return 1 - (1 - n.minOpacity) * k
}

/** `backTo` furniture (tall, back to a wall) is at the minimum while that wall is lowered, else whatever the near-fade wants */
export const backToOpacity = (want: number, backTo: Wall | undefined, hidden: Hidden): number => (backTo && hidden[backTo] ? Math.min(want, VIEW.near.minOpacity) : want)

/** opacity moved towards `want` at the fade rates (out fast, back slower); instant when reduced */
export function stepOpacity(cur: number, want: number, dt: number, reduced: boolean): number {
  if (reduced) return want
  const span = 1 - VIEW.near.minOpacity
  if (want < cur) return Math.max(want, cur - (span * dt * 1000) / VIEW.near.outMs)
  return Math.min(want, cur + (span * dt * 1000) / VIEW.near.inMs)
}

/** the camera -> target segment for occlusion: stops `targetSkip` short of the target, so what the target sits in stays opaque */
export function occlusionSegment(cam: V3, target: V3): [V3, V3] {
  const d = [target[0] - cam[0], target[1] - cam[1], target[2] - cam[2]]
  const len = Math.hypot(d[0], d[1], d[2]) || 1
  const k = Math.max(0, len - VIEW.near.targetSkip) / len
  return [cam, [cam[0] + d[0] * k, cam[1] + d[1] * k, cam[2] + d[2] * k]]
}
