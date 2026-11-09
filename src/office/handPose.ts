// The hand posture engine (#282, docs/design/hand-poses.md). Pure: three.js math only, no scene.
//
//  - HandAngles: every joint in degrees (4 fingers: MCP, PIP, DIP, sideways abduction; the thumb: CMC flex / abduct, MCP, IP).
//  - LIMITS and clampAngles (hand-poses.md 1), POSES (the 14 named poses, 2) and the two variants, fromCurl (the old c values, 3).
//  - The joint math (quaternions from angles + the glb's axis / sign extras). The rig (rig.ts) and the contact fit (grip.ts) both use
//    exactly these functions, so a fitted fingertip is where the drawn one is.
//
// Joint math (each angle × that joint's extras sign, about the node-local axis, multiplied on the RIGHT of the node's rest rotation):
//   finger _1:   q = rest · R(abduct, abd − rest_abduct) · R(flex, MCP)       (the fan rest_abduct is baked into the mesh)
//   finger _2/_3: q = rest · R(flex, PIP) / R(flex, DIP)                       (DIP = k · PIP unless the pose gives one)
//   thumb _t_0:  q = rest · R(abduct, cmcAbd) · R(flex, cmcFlex) · R(twist, twist)   (the order is the node's extras joint.order when it has one;
//                the defaults above are for a glb without it; the finger root's is "abduct,flex")
//                twist = min(45, 0.6 · cmcAbd + 0.4 · max(cmcFlex, 0))         (derived, never an input)
//   thumb _t_1/_t_2: q = rest · R(flex, MCP) / R(flex, IP)
import { Quaternion, Vector3 } from 'three'
import type { Curl } from './grip'

export const DEG = Math.PI / 180

/** DIP = k · PIP, index … little (Mentzel et al. 2011) */
export const DIP_K = [0.77, 0.75, 0.75, 0.57] as const

export interface FingerAngles {
  mcp: number
  pip: number
  /** omitted: DIP_K[finger] · pip */
  dip?: number
  /** sideways, + = away from the middle finger (index toward the thumb, ring and little toward the little side); the TOTAL angle, the baked fan included */
  abd: number
}
export interface ThumbAngles {
  cmcFlex: number
  cmcAbd: number
  mcp: number
  ip: number
}
export interface HandAngles {
  f: readonly [FingerAngles, FingerAngles, FingerAngles, FingerAngles]
  thumb: ThumbAngles
}

/** the thumb root's twist that turns its pad toward the fingers: derived from the other two root angles */
export const thumbTwist = (cmcAbd: number, cmcFlex: number) => Math.min(45, Math.max(0, 0.6 * cmcAbd + 0.4 * Math.max(cmcFlex, 0)))

/** the DIP a finger shows (its own, or k · PIP) */
export const dipOf = (a: FingerAngles, finger: number) => a.dip ?? DIP_K[finger] * a.pip

// ----------------------------------------------------------------------------------------------------------- limits

export interface Range {
  min: number
  max: number
}
export const LIMITS = {
  mcp: { min: -15, max: 90 },
  pip: { min: 0, max: 100 },
  dip: { min: -5, max: 80 },
  /** index … little; scaled by (1 − 0.7 · MCP/90) so a fist does not fan */
  abd: [
    { min: -3, max: 20 },
    { min: -8, max: 8 },
    { min: -3, max: 15 },
    { min: -3, max: 25 },
  ] as readonly Range[],
  cmcFlex: { min: -15, max: 45 },
  cmcAbd: { min: 0, max: 60 },
  tmcp: { min: 0, max: 50 },
  tip: { min: -10, max: 80 },
} as const

/** the abduction range of a finger bent to `mcp` degrees at the root */
export function abdRange(finger: number, mcp: number): Range {
  const s = 1 - 0.7 * Math.min(1, Math.max(0, mcp) / 90)
  const r = LIMITS.abd[finger]
  return { min: r.min * s, max: r.max * s }
}

const clamp = (x: number, r: Range) => Math.min(r.max, Math.max(r.min, x))

/** clamp one finger; pushes the names of the joints it clipped onto `clipped` */
export function clampFinger(a: FingerAngles, finger: number, clipped: string[] = [], abdLimits?: Range): FingerAngles {
  const name = (j: string) => `${FINGER_NAMES[finger]}.${j}`
  const mcp = clamp(a.mcp, LIMITS.mcp)
  const pip = clamp(a.pip, LIMITS.pip)
  const dip = clamp(a.dip ?? DIP_K[finger] * pip, LIMITS.dip)
  // abdLimits: a grip's own exception (grip.ts STONE_ABD): used as they are, not scaled by the MCP
  const abd = clamp(a.abd, abdLimits ?? abdRange(finger, mcp))
  if (mcp !== a.mcp) clipped.push(name('mcp'))
  if (pip !== a.pip) clipped.push(name('pip'))
  if (a.dip !== undefined && dip !== a.dip) clipped.push(name('dip'))
  if (Math.abs(abd - a.abd) > 1e-9) clipped.push(name('abd'))
  return { mcp, pip, dip, abd }
}
export function clampThumb(t: ThumbAngles, clipped: string[] = []): ThumbAngles {
  const r = {
    cmcFlex: clamp(t.cmcFlex, LIMITS.cmcFlex),
    cmcAbd: clamp(t.cmcAbd, LIMITS.cmcAbd),
    mcp: clamp(t.mcp, LIMITS.tmcp),
    ip: clamp(t.ip, LIMITS.tip),
  }
  for (const k of Object.keys(r) as (keyof ThumbAngles)[]) if (r[k] !== t[k]) clipped.push(`thumb.${k}`)
  return r
}

export const FINGER_NAMES = ['index', 'middle', 'ring', 'little'] as const

/** every angle inside its limits (DIP filled in); `clipped` lists the joints that had to move, e.g. "little.abd", "thumb.mcp" */
export function clampAngles(a: HandAngles, abdLimits?: readonly (Range | undefined)[]): { angles: HandAngles; clipped: string[] } {
  const clipped: string[] = []
  const f = a.f.map((x, k) => clampFinger(x, k, clipped, abdLimits?.[k])) as unknown as HandAngles['f']
  return { angles: { f, thumb: clampThumb(a.thumb, clipped) }, clipped }
}

// ------------------------------------------------------------------------------------------------------------ poses

type F = readonly [mcp: number, pip: number, dip?: number]
type T = readonly [cmcFlex: number, cmcAbd: number, mcp: number, ip: number]
const pose = (f: readonly [F, F, F, F], abd: readonly [number, number, number, number], t: T): HandAngles => ({
  f: f.map((x, k) => ({ mcp: x[0], pip: x[1], dip: x[2], abd: abd[k] })) as unknown as HandAngles['f'],
  thumb: { cmcFlex: t[0], cmcAbd: t[1], mcp: t[2], ip: t[3] },
})
const all4 = (f: F): [F, F, F, F] => [f, f, f, f]

/** hand-poses.md 2: the 14 named poses, exactly as tabled (unclamped; clampAngles at the rig reports what the limits cut) */
export const POSES = {
  /** 1 쉼 */
  rest: pose([[20, 30], [25, 35], [30, 40], [35, 45]], [6, 0, 4, 9], [10, 5, 10, 10]),
  /** 2 펼침 */
  spread: pose(all4([0, 5]), [15, 0, 10, 20], [-15, 10, 0, 0]),
  /** 3 감아 쥐기 */
  wrap: pose([[70, 90], [75, 95], [80, 95], [85, 95]], [-2, 0, -2, -3], [30, 40, 35, 30]),
  /** 4 주먹 (DIP 70 on every finger) */
  fist: pose(all4([90, 100, 70]), [0, 0, 0, 0], [40, 15, 45, 40]),
  /** 5 끝 집기 (OK) */
  ok: pose([[55, 70, 54], [10, 15], [12, 18], [15, 20]], [-3, 0, 6, 12], [15, 10, 40, 20]),
  /** 6 세 손가락 집기 (펜) */
  tripod: pose([[55, 70, 54], [55, 70, 54], [55, 75], [60, 80]], [0, 0, 2, 4], [35, 10, 30, 20]),
  /** 7 옆 집기 (열쇠) */
  key: pose([[60, 70], [65, 75], [70, 80], [75, 85]], [0, 0, 0, 0], [40, 5, 0, 20]),
  /** 8 가리키기 */
  point: pose([[0, 5, 0], [85, 100], [90, 100], [90, 100]], [5, 0, 0, 0], [35, 15, 40, 30]),
  /** 9 누르기 (한 손가락) */
  press: pose([[30, 40, 10], [45, 60], [50, 65], [55, 70]], [0, 0, 3, 6], [20, 20, 15, 10]),
  /** 10 타자 */
  type: pose([[30, 50], [30, 52], [32, 52], [35, 50]], [0, 0, 2, 4], [5, 30, 10, 15]),
  /** 11 받치기 */
  support: pose(all4([5, 10]), [3, 0, 3, 5], [0, 5, 5, 5]),
  /** 12 펴서 받기 (바구니) */
  basket: pose([[20, 25], [20, 25], [22, 28], [25, 30]], [10, 0, 8, 15], [10, 50, 15, 15]),
  /** 13 엄지 척 */
  thumbsUp: pose(all4([90, 100]), [0, 0, 0, 0], [35, 0, 0, -10]),
  /** 14 쓸어 주기 */
  sweep: pose([[5, 8], [6, 10], [8, 12], [10, 14]], [4, 0, 4, 7], [5, 5, 8, 8]),
} as const satisfies Record<string, HandAngles>

export type PoseId = keyof typeof POSES

/** Korean names, same order as the table */
export const POSE_NAMES: Record<PoseId, string> = {
  rest: '쉼',
  spread: '펼침',
  wrap: '감아 쥐기',
  fist: '주먹',
  ok: '끝 집기',
  tripod: '세 손가락 집기',
  key: '옆 집기',
  point: '가리키기',
  press: '누르기',
  type: '타자',
  support: '받치기',
  basket: '펴서 받기',
  thumbsUp: '엄지 척',
  sweep: '쓸어 주기',
}

/** the two variants of hand-poses.md 2: the ㄱ자 frame (pointing, thumb −15 / 10 / 0 / 0, the same as spread's) and the palm stamp (support, placed palm down: the same angles) */
export const VARIANTS = {
  frame: { f: POSES.point.f, thumb: { cmcFlex: -15, cmcAbd: 10, mcp: 0, ip: 0 } },
  stamp: POSES.support,
} as const satisfies Record<string, HandAngles>

export const ALL_POSES = { ...POSES, ...VARIANTS } as const satisfies Record<string, HandAngles>
export type AnyPoseId = keyof typeof ALL_POSES

// ------------------------------------------------------------------------------------------------- the old c values

/** the fingers' bend value c (0–1) as angles: MCP 85c, PIP 100c, DIP k · PIP */
export function fingerFromC(finger: number, c: number, abd = 0): FingerAngles {
  const pip = 100 * c
  return { mcp: 85 * c, pip, dip: DIP_K[finger] * pip, abd }
}
/** the thumb's (bend b, opposition o) as angles (hand-poses.md 3) */
export function thumbFromCurl(b: number, o: number): ThumbAngles {
  return o >= 0
    ? { cmcFlex: 35 * o, cmcAbd: 20 + 30 * o, mcp: 50 * b, ip: 70 * b }
    : { cmcFlex: -15 * -o, cmcAbd: 10, mcp: 50 * b, ip: 70 * b }
}

/**
 * An old curl (four finger bends, thumb bend, opposition) as angles, then clamped (hand-poses.md 3). The spacing s (°): index +s, middle 0,
 * ring +s, little +2s; left out, each finger keeps `abd` (the fan baked into the mesh, a caller passes the nodes' rest_abduct).
 */
export function fromCurl(curl: Curl | readonly number[], spreadDeg?: number, abd: readonly number[] = DEFAULT_FAN): HandAngles {
  const s = spreadDeg
  const ab = s === undefined ? abd : [s, 0, s, 2 * s]
  const raw: HandAngles = { f: [0, 1, 2, 3].map((k) => fingerFromC(k, curl[k], ab[k])) as unknown as HandAngles['f'], thumb: thumbFromCurl(curl[4], curl[5]) }
  return clampAngles(raw).angles
}
/** the fan the glb bakes into the fingers (rest_abduct), for callers without a rig */
export const DEFAULT_FAN = [6, 2, 2, 6] as const

// ---------------------------------------------------------------------------------------------------------- blending

/** the 20 numbers of a pose (DIP filled in): per finger mcp, pip, dip, abd; then the thumb's four */
export function toVec(a: HandAngles): number[] {
  const v: number[] = []
  a.f.forEach((x, k) => v.push(x.mcp, x.pip, dipOf(x, k), x.abd))
  v.push(a.thumb.cmcFlex, a.thumb.cmcAbd, a.thumb.mcp, a.thumb.ip)
  return v
}
export function fromVec(v: readonly number[]): HandAngles {
  const f = [0, 1, 2, 3].map((k) => ({ mcp: v[k * 4], pip: v[k * 4 + 1], dip: v[k * 4 + 2], abd: v[k * 4 + 3] }))
  return { f: f as unknown as HandAngles['f'], thumb: { cmcFlex: v[16], cmcAbd: v[17], mcp: v[18], ip: v[19] } }
}
/** a → b by w (0 … 1), joint by joint in angle space */
export function blendAngles(a: HandAngles, b: HandAngles, w: number): HandAngles {
  const x = toVec(a)
  const y = toVec(b)
  return fromVec(x.map((p, i) => p + (y[i] - p) * w))
}

// -------------------------------------------------------------------------------------------------------- joint math

export interface AxisSign {
  axis: 'x' | 'y' | 'z'
  sign: number
}
/** a node's `joint` extras */
export interface JointSpec {
  flex?: AxisSign
  abduct?: AxisSign
  twist?: AxisSign
  /** the order the turns are multiplied on the right of rest (extras joint.order, e.g. "abduct,flex"); absent: the caller's default */
  order?: readonly ('flex' | 'abduct' | 'twist')[]
}
type Kind = 'flex' | 'abduct' | 'twist'
/** the defaults while the glb has no joint.order: a finger root abduct, flex; the thumb root abduct, flex, twist */
export const FINGER_ROOT_ORDER: readonly Kind[] = ['abduct', 'flex']
export const THUMB_ROOT_ORDER: readonly Kind[] = ['abduct', 'flex', 'twist']
const FLEX_X: AxisSign = { axis: 'x', sign: 1 }

const AXIS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }
const tmp = new Quaternion()
/** q ← q · R(axis, deg · sign) */
function turn(q: Quaternion, a: AxisSign | undefined, deg: number) {
  if (!a || deg === 0) return q
  return q.multiply(tmp.setFromAxisAngle(AXIS[a.axis], deg * DEG * a.sign))
}

/** read a node's `joint` extras (userData); anything else is ignored */
export function readJoint(ud: unknown): JointSpec | undefined {
  const j = (ud as { joint?: Record<string, { axis?: string; sign?: number } | undefined> } | undefined)?.joint
  if (!j) return undefined
  const one = (k: string): AxisSign | undefined => {
    const x = j[k]
    return x && (x.axis === 'x' || x.axis === 'y' || x.axis === 'z') && typeof x.sign === 'number' ? { axis: x.axis, sign: x.sign } : undefined
  }
  const raw = (j as { order?: unknown }).order
  const order = typeof raw === 'string' ? raw.split(',').map((x) => x.trim()).filter((x): x is Kind => x === 'flex' || x === 'abduct' || x === 'twist') : undefined
  return { flex: one('flex'), abduct: one('abduct'), twist: one('twist'), order: order?.length ? order : undefined }
}

/** rest · R(first) · R(second) …, in the node's own joint.order (or `fallback`); each angle × its sign */
function chainQuat(rest: Quaternion, j: JointSpec | undefined, deg: Record<Kind, number>, fallback: readonly Kind[], out: Quaternion) {
  out.copy(rest)
  for (const k of j?.order ?? fallback) turn(out, k === 'flex' ? (j?.flex ?? FLEX_X) : j?.[k], deg[k])
  return out
}

/** a finger root (_f{n}_1): rest · R(abduct, abd − rest_abduct) · R(flex, MCP) (or the node's joint.order) */
export function fingerRootQuat(rest: Quaternion, j: JointSpec | undefined, restAbd: number, abd: number, mcp: number, out = new Quaternion()) {
  return chainQuat(rest, j, { flex: mcp, abduct: abd - restAbd, twist: 0 }, FINGER_ROOT_ORDER, out)
}
/** any single-axis segment (_f{n}_2, _f{n}_3, _t_1, _t_2): rest · R(flex, angle) */
export function segmentQuat(rest: Quaternion, j: JointSpec | undefined, flex: number, out = new Quaternion()) {
  out.copy(rest)
  return turn(out, j?.flex ?? FLEX_X, flex)
}
/** the thumb root (_t_0): rest · R(abduct, cmcAbd) · R(flex, cmcFlex) · R(twist, derived) (or the node's joint.order) */
export function thumbRootQuat(rest: Quaternion, j: JointSpec | undefined, t: ThumbAngles, out = new Quaternion()) {
  return chainQuat(rest, j, { flex: t.cmcFlex, abduct: t.cmcAbd, twist: thumbTwist(t.cmcAbd, t.cmcFlex) }, THUMB_ROOT_ORDER, out)
}

// ----------------------------------------------------------------------------------------------------------- audit

export interface Clip {
  table: string
  joints: string[]
}
/** which curl tables the limits cut (hand-poses.md 3: "자른 자세는 코더가 목록으로 알려 준다"): every entry converted with fromCurl's formula, unclamped vs clamped */
export function auditCurls(tables: Record<string, Curl | readonly number[]>, spreadDeg?: number): Clip[] {
  const out: Clip[] = []
  for (const [table, curl] of Object.entries(tables)) {
    const ab = spreadDeg === undefined ? DEFAULT_FAN : [spreadDeg, 0, spreadDeg, 2 * spreadDeg]
    const raw: HandAngles = { f: [0, 1, 2, 3].map((k) => fingerFromC(k, curl[k], ab[k])) as unknown as HandAngles['f'], thumb: thumbFromCurl(curl[4], curl[5]) }
    const { clipped } = clampAngles(raw)
    // DIP is always derived here (k · PIP), so a clip on it only follows PIP; report what the limits cut
    if (clipped.length) out.push({ table, joints: clipped })
  }
  return out
}
