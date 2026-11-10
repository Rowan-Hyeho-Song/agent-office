// The tour's own camera limits and the way back into the free-view limits (#405, office-ui.md 10.1 and 10.3), as pure decisions.
// The tour never loosens the orbit controls: its cuts are fitted here, and when it ends the camera eases into VIEW's limits.

type V3 = [number, number, number]
const DEG = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const CUT = {
  /** look-down angle of a cut (deg above the horizon, the camera looking at the subject) */
  pitchDeg: [25, 55] as const,
  /** distance to the subject (m); the portrait phone stands farther */
  minDist: 1.8,
  minDistPortrait: 2.6,
  /** the subject's head (or object) is at most this share of the picture height */
  maxSubjectFrac: 0.35,
  /** an over-the-shoulder cut stands at least this far (deg) to the side of straight behind */
  shoulderDeg: 35,
  /** a viewport narrower than this (width / height) is a portrait phone: distances scale by max(1, 1.6 / aspect) ** 0.5 */
  portraitAspect: 1,
  /** how long the camera takes to come back into the free-view limits when the tour ends (ms) */
  stopEaseMs: 400,
}

export interface CutLimits {
  /** width / height of the picture and its vertical field of view (rad) */
  aspect: number
  fovY: number
  /** the height of the subject's head (m); 0 = no subject size rule */
  subjectH: number
}

export const isPortrait = (aspect: number) => aspect < CUT.portraitAspect
export const distScale = (aspect: number) => (isPortrait(aspect) ? Math.max(1, 1.6 / aspect) ** 0.5 : 1)
/** the nearest the camera may stand to the subject */
export function minCutDistance(l: CutLimits): number {
  const base = isPortrait(l.aspect) ? CUT.minDistPortrait : CUT.minDist
  const sized = l.subjectH > 0 ? l.subjectH / (CUT.maxSubjectFrac * 2 * Math.tan(l.fovY / 2)) : 0
  return Math.max(base, sized)
}
const pitchOf = (pos: readonly number[], target: readonly number[]) => Math.atan2(pos[1] - target[1], Math.hypot(pos[0] - target[0], pos[2] - target[2]))

/** the camera spot of a cut moved (about the subject, keeping its bearing) into the tour's look-down range and distance */
export function fitCut(pos: V3, target: V3, l: CutLimits): V3 {
  const dx = pos[0] - target[0]
  const dz = pos[2] - target[2]
  const h = Math.hypot(dx, dz)
  const [bx, bz] = h > 1e-3 ? [dx / h, dz / h] : [1, 0]
  const d = Math.max(Math.hypot(h, pos[1] - target[1]) * distScale(l.aspect), minCutDistance(l))
  const p = clamp(pitchOf(pos, target), CUT.pitchDeg[0] * DEG, CUT.pitchDeg[1] * DEG)
  return [target[0] + bx * d * Math.cos(p), target[1] + Math.sin(p) * d, target[2] + bz * d * Math.cos(p)]
}

/** is the cut's camera inside the tour's limits (a small tolerance for float noise) */
export function cutInLimits(pos: V3, target: V3, l: CutLimits): boolean {
  const p = pitchOf(pos, target)
  const d = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2])
  return p >= CUT.pitchDeg[0] * DEG - 1e-3 && p <= CUT.pitchDeg[1] * DEG + 1e-3 && d >= minCutDistance(l) - 1e-3
}

/** over the shoulder: the angle (deg) of the camera from straight behind the seat */
export function angleFromBehind(seatXZ: readonly [number, number], forwardXZ: readonly [number, number], pos: readonly number[]): number {
  const x = pos[0] - seatXZ[0]
  const z = pos[2] - seatXZ[1]
  const len = Math.hypot(x, z) || 1
  const c = -(x * forwardXZ[0] + z * forwardXZ[1]) / len
  return Math.acos(clamp(c, -1, 1)) / DEG
}

// ---- the way back into the free view -----------------------------------------------------------------------------

export interface FreeLimits {
  /** the orbit's polar angle (from straight up) and distance ranges */
  polar: readonly [number, number]
  distance: readonly [number, number]
}

/** the camera spot nearest to `pos` that is inside the free-view limits around the target (the bearing is kept) */
export function freeSpot(pos: V3, target: V3, f: FreeLimits): V3 {
  const dx = pos[0] - target[0]
  const dz = pos[2] - target[2]
  const h = Math.hypot(dx, dz)
  const [bx, bz] = h > 1e-3 ? [dx / h, dz / h] : [1, 0]
  const d0 = Math.hypot(h, pos[1] - target[1])
  const d = clamp(d0, f.distance[0], f.distance[1])
  const polar = clamp(Math.atan2(h, pos[1] - target[1]), f.polar[0], f.polar[1])
  return [target[0] + bx * d * Math.sin(polar), target[1] + d * Math.cos(polar), target[2] + bz * d * Math.sin(polar)]
}

export function inFreeLimits(pos: V3, target: V3, f: FreeLimits): boolean {
  const s = freeSpot(pos, target, f)
  return Math.hypot(s[0] - pos[0], s[1] - pos[1], s[2] - pos[2]) < 1e-3
}

/** the easing back: the camera spot k (0..1 of CUT.stopEaseMs) of the way from `from` to `to`; the same smooth curve as the tour's cuts */
export function stopEaseAt(from: V3, to: V3, elapsedMs: number): V3 {
  const k = clamp(elapsedMs / CUT.stopEaseMs, 0, 1)
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
  return [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e]
}
export const stopEaseDone = (elapsedMs: number) => elapsedMs >= CUT.stopEaseMs
