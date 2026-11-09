// The hand's direction while it reaches (#255, docs/design/grips.md 1.1). Pure: three.js math only.
//
// The robots have no arms, so the shoulder is a point (±0.24, 0.98 + seat, 0) in the agent's frame and the reach direction `a` is the unit vector from it to the
// hand's target. The hand is turned so that
//   1. its fingers follow a (a target above the shoulder points the fingers up, below it down),
//   2. its palm faces what it takes (the caller gives that direction; none: perpendicular to a, outward and down 15°),
//   3. above the horizontal the wrist extends (backwards, palm toward a): 0 → 20° over the first 30° of elevation, 20 → 30° over the next 30°, 30° beyond.
//      The designer's table goes on to 45° and 60° (grips.md 1.1); the app's check (the fingers within 30° of `a`, #255) stops at 30°.
// Everything is clamped to the wrist's limits (WRIST_LIMITS; the hand node's `wrist` extras give the axes: flex about x, deviate about z, twist about y).
// Only a flexion / extension and a twist about `a` are made here, so radial / ulnar deviation stays 0.
import { Matrix4, Quaternion, Vector3 } from 'three'

const DEG = Math.PI / 180

/** grips.md 1.1: the values the wrist never passes, degrees */
export const WRIST_LIMITS = { extension: 70, flexion: 75, radial: 20, ulnar: 35, twist: 90 } as const
/** the extension the app shows at most (the fingers stay within this of the reach direction) */
export const EXTENSION_MAX = 30
/** the shoulder in the agent's frame: x is ±, y is 0.98 above the seat height */
export const SHOULDER = { x: 0.24, y: 0.98, z: 0 } as const

export interface Reach {
  /** the hand's rotation in the agent's frame (columns: x, the finger direction y, the palm z; the hand node's own axes) */
  quat: Quaternion
  /** the reach direction a */
  a: Vector3
  /** wrist extension (+) / flexion (−), degrees, and the twist about a, degrees (0 = the palm toward the body's centre line) */
  extension: number
  twist: number
}

/** the wrist extension that goes with a reach direction's elevation (rad above the horizontal): 0 below it, 20° at 30°, 30° from 60° */
export function extensionFor(elevation: number): number {
  const e = elevation / DEG
  if (e <= 0) return 0
  if (e <= 30) return (20 * e) / 30
  if (e <= 60) return 20 + ((EXTENSION_MAX - 20) * (e - 30)) / 30
  return EXTENSION_MAX
}

const N0 = new Vector3()
const P = new Vector3()
const X = new Vector3()
const Z = new Vector3()
const Y = new Vector3()
const M = new Matrix4()

/**
 * The hand's orientation for a hand at `pos` (the agent's frame). `seat` lifts the shoulder with the seat height. `palm`: the direction (agent frame) the palm
 * should face, or null for "no object".
 */
export function reachFrame(side: 'l' | 'r', pos: Vector3, seat: number, palm: Vector3 | null, out: Reach = { quat: new Quaternion(), a: new Vector3(), extension: 0, twist: 0 }): Reach {
  const sx = side === 'l' ? -1 : 1
  const a = out.a.set(pos.x - sx * SHOULDER.x, pos.y - (SHOULDER.y + seat), pos.z - SHOULDER.z)
  if (a.lengthSq() < 1e-8) a.set(0, 0, -1)
  a.normalize()
  // the palm's neutral side: toward the body's centre line, across a
  N0.set(-sx, 0, 0).addScaledVector(a, sx * a.x)
  if (N0.lengthSq() < 1e-6) N0.set(0, 0, 1) // a along the x axis: any perpendicular
  N0.normalize()
  // the wanted palm side, across a
  if (palm) P.copy(palm)
  else {
    // none: across a, outward (away from the body) and 15° down
    const outward = X.set(sx, 0, 0).addScaledVector(a, -sx * a.x)
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1)
    outward.normalize()
    const down = Y.set(0, -1, 0).addScaledVector(a, a.y).normalize()
    P.copy(outward).multiplyScalar(Math.cos(15 * DEG)).addScaledVector(down, Math.sin(15 * DEG))
  }
  P.addScaledVector(a, -P.dot(a))
  if (P.lengthSq() < 1e-6) P.copy(N0)
  P.normalize()
  // the twist about a, from the neutral side to the wanted one, kept within the wrist's limit
  const cross = Z.crossVectors(N0, P)
  let twist = Math.atan2(cross.dot(a), N0.dot(P)) / DEG
  twist = Math.max(-WRIST_LIMITS.twist, Math.min(WRIST_LIMITS.twist, twist))
  P.copy(N0).applyAxisAngle(a, twist * DEG)
  // the extension: backwards, away from the palm, toward the palm side of a
  const elevation = Math.asin(Math.max(-1, Math.min(1, a.y)))
  const ext = Math.min(extensionFor(elevation), WRIST_LIMITS.extension)
  const c = Math.cos(ext * DEG)
  const s = Math.sin(ext * DEG)
  Y.copy(a).multiplyScalar(c).addScaledVector(P, -s) // the fingers
  Z.copy(P).multiplyScalar(c).addScaledVector(a, s) // the palm
  X.crossVectors(Y, Z)
  M.makeBasis(X, Y, Z)
  out.quat.setFromRotationMatrix(M)
  out.extension = ext
  out.twist = twist
  return out
}

/** the `turn` of a hand pose (applied in the agent's frame before the hand's rest rotation): the reach rotation times the inverse rest rotation */
export function reachTurn(side: 'l' | 'r', pos: Vector3, seat: number, palm: Vector3 | null, restQuat: Quaternion, out = new Quaternion()): Quaternion {
  const r = reachFrame(side, pos, seat, palm)
  return out.copy(r.quat).multiply(RESTINV.copy(restQuat).invert())
}
const RESTINV = new Quaternion()
