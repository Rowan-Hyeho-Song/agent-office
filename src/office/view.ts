// The free camera (#111): the cutaway walls, the view limits, WASD and the camera clearance, as pure decisions.
// three.js side: cutaway.tsx (walls), cameraRig.tsx (limits, keys, reset), clearance.ts (keepClear).
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
  distance: [2.5, 21] as const, // 18 for the 9 x 7 m room; the 9.6 x 8.2 m one is 1.17 times as wide across (#280)
  targetInset: 0.5,
  targetY: [0.4, 1.5] as const,
  resetMs: 600,

  // --- WASD / arrows ---
  keys: { speedPerDist: 0.35, speedMin: 1.2, speedMax: 4, shift: 2, easeMs: 120 },

  // --- nothing fades: not by distance, not by occlusion, not by a lowered wall (#253); the camera is kept clear instead, and app-chosen cameras avoid occlusion (tour.ts) ---
  near: { /** the camera->target sight segment of an app-chosen camera stops this far short of the target */ targetSkip: 0.4 },

  // --- camera clearance (#208): the camera never gets nearer than `margin` to furniture, robots or walls; the near plane stays well inside it ---
  cameraNear: 0.1,
  clear: { margin: 0.3 },

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

// ---- sight segment (the tour's line-of-sight check) ----------------------------------------------------------------------------------------------

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

/** the camera -> target segment for the line-of-sight check (tour.ts sightClear): stops `targetSkip` short of the target, so what the target sits in stays opaque */
export function occlusionSegment(cam: V3, target: V3): [V3, V3] {
  const d = [target[0] - cam[0], target[1] - cam[1], target[2] - cam[2]]
  const len = Math.hypot(d[0], d[1], d[2]) || 1
  const k = Math.max(0, len - VIEW.near.targetSkip) / len
  return [cam, [cam[0] + d[0] * k, cam[1] + d[1] * k, cam[2] + d[2] * k]]
}

// ---- camera clearance (#208) ---------------------------------------------------------------------------------------

/** an obstacle box; `slide` pushes out by the nearest face (walls) instead of back along the view ray */
export interface ClearBox extends Box {
  slide?: boolean
}

const grown = (b: Box, m: number): Box => ({ min: [b.min[0] - m, b.min[1] - m, b.min[2] - m], max: [b.max[0] + m, b.max[1] + m, b.max[2] + m] })
const inside = (p: V3, b: Box) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2]

/** the nearest face of an (already grown) box to p: p moved out through it */
function faceOut(p: V3, b: Box): V3 {
  let best = 0
  let bestD = Infinity
  let val = 0
  for (let i = 0; i < 3; i++) {
    for (const v of [b.min[i], b.max[i]]) {
      const d = Math.abs(p[i] - v)
      if (d < bestD) [best, bestD, val] = [i, d, v + (v === b.min[i] ? -1e-4 : 1e-4)]
    }
  }
  const o: [number, number, number] = [p[0], p[1], p[2]]
  o[best] = val
  return o
}

/**
 * Keeps the camera `margin` away from every box (furniture, robots, walls). A camera inside a box grown by the margin is
 * moved back along the view ray (target -> camera), so a zoom just stops at the surface and WASD slides the camera
 * along it; when that would go past the max distance, or for `slide` boxes, by the nearest face. Unchanged when
 * clear; the result is the same pose for the same inputs (no jitter). Used by the free camera and meant for any
 * scripted camera path (the tour).
 */
export function keepClear(cam: V3, target: V3, boxes: readonly ClearBox[], margin: number = VIEW.clear.margin): [number, number, number] {
  let p: V3 = cam
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const b of boxes) {
      const g = grown(b, margin)
      if (!inside(p, g)) continue
      moved = true
      const d = [p[0] - target[0], p[1] - target[1], p[2] - target[2]]
      const len = Math.hypot(d[0], d[1], d[2])
      let out: V3 | null = null
      if (!b.slide && len > 1e-6) {
        let t = Infinity
        for (let i = 0; i < 3; i++) {
          if (Math.abs(d[i]) < 1e-9) continue
          t = Math.min(t, ((d[i] > 0 ? g.max[i] : g.min[i]) - p[i]) / d[i])
        }
        if (t < Infinity) {
          const q: V3 = [p[0] + d[0] * (t + 1e-4), p[1] + d[1] * (t + 1e-4), p[2] + d[2] * (t + 1e-4)]
          if (len + t * len <= VIEW.distance[1]) out = q
        }
      }
      p = out ?? faceOut(p, g)
    }
    if (!moved) break
  }
  return [p[0], p[1], p[2]]
}
