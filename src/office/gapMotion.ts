// #490 B (docs/design/play.md 9.2 · 9.3): what the body does in a gap between two stays, while waiting at the ping-pong table for a
// partner, and while watching a game. Pure: `u` is the seconds since the agent reached its spot; the rig and the stage draw from these.

import type { GapKind } from './play'

const DEG = Math.PI / 180

export const GAP_MOTION = {
  /** 기지개: both hands up over the head and down again over this long (s), palms up, the head back this far (°) */
  stretchS: 1.2,
  stretchHeadDeg: 6,
  /** after arriving, before the hands go up (s) */
  stretchDelayS: 0.3,
  /** 창가: the head breathes up and down this far (°), once every this long (s) */
  windowDeg: 2,
  windowBreathS: 4,
  /** 서성이기: walking at this share of the usual pace; on arrival one look left and one right over this long (s), this far (rad) */
  wanderPace: 0.7,
  wanderLookS: 3,
  wanderLookRad: 0.5,
} as const

/** 공 튀기기 (9.2): one bounce every everyS, up heightM above the paddle's face */
export const BOUNCE = { everyS: 0.6, heightM: 0.25 } as const

/** 구경 (9.2): a cheer every everyS, the first firstS after arriving */
export const CHEER = { everyS: 30, firstS: 10 } as const

/**
 * How far the stretch's hands are up (0 down … 1 over the head) over stretchS: up in its first third, held at the top for a third (the hands get all the way
 * up: their place over the head is measured, stretch.data.ts), down in the last; 0 with reduced motion (only the label changes)
 */
export function stretchLift(u: number, reduced: boolean): number {
  if (reduced || u < GAP_MOTION.stretchDelayS) return 0
  const k = (u - GAP_MOTION.stretchDelayS) / GAP_MOTION.stretchS
  if (k >= 1) return 0
  const ease = (x: number) => x * x * (3 - 2 * x)
  return k < 1 / 3 ? ease(k * 3) : k < 2 / 3 ? 1 : ease((1 - k) * 3)
}

/** the head on top of the standing pose in a gap (rad): `yaw` null keeps the usual slow look round */
export function gapHead(gap: GapKind | undefined, u: number, reduced: boolean): { pitch: number; yaw: number | null } | null {
  if (!gap || u < 0 || reduced) return null
  if (gap === 'stretch') return { pitch: GAP_MOTION.stretchHeadDeg * DEG * stretchLift(u, false), yaw: null }
  if (gap === 'window') return { pitch: GAP_MOTION.windowDeg * DEG * Math.sin((u / GAP_MOTION.windowBreathS) * Math.PI * 2), yaw: 0 }
  // 서성이기: once left, once right, then the usual look round
  if (u >= GAP_MOTION.wanderLookS) return null
  return { pitch: 0, yaw: GAP_MOTION.wanderLookRad * Math.sin((u / GAP_MOTION.wanderLookS) * Math.PI * 2) }
}

/** the walking pace of a gap's walk (a share of the usual) */
export const gapPace = (gap: GapKind | undefined) => (gap === 'wander' ? GAP_MOTION.wanderPace : 1)

/** the ball over the paddle while waiting: its height above the face (m) and the bounce's number (a new number = a hit); held still with reduced motion */
export function bounceAt(u: number, reduced: boolean): { h: number; n: number } {
  if (reduced || u < 0) return { h: 0, n: -1 }
  const n = Math.floor(u / BOUNCE.everyS)
  const k = u / BOUNCE.everyS - n
  return { h: 4 * BOUNCE.heightM * k * (1 - k), n }
}

/** the watcher's cheer: its number since arriving (a new number starts one), -1 before the first */
export const cheerAt = (u: number) => (u < CHEER.firstS ? -1 : Math.floor((u - CHEER.firstS) / CHEER.everyS))
