// Walking in the timelapse (#117) is presentation only: the scene at index i never depends on it. Agents walk to their
// scene spots only while the replay plays between consecutive points at x1; a seek, x4/x16 and reduced motion snap
// (or stay put), and so does a walk that cannot finish inside the point's time.

import type { Point } from '../timeline/types'
import type { PointVia } from './store'

/** agents walk this much faster while replaying (the rig's pace scale) */
export const REPLAY_PACE = 1.4
/** a conservative live average (the rig cruises at 0.75 m/s but speeds up and slows down) */
export const LIVE_WALK_MPS = 0.65
/** the same at the replay pace */
export const WALK_MPS = LIVE_WALK_MPS * REPLAY_PACE
/** at x1 the next point waits for walkers to arrive (like a meeting scene, design 3); a walk may borrow up to this much extra */
export const WALK_HOLD_MS = 4000
/** set by the office each frame: someone is still walking to a scene spot (the replay holds the next point at x1) */
export const walkHold = { busy: false }
/** route length desk -> whiteboard by seat, m; filled by the office once the nav graph is built (the "남은 시간" estimate reads it) */
export const boardDistance: Record<number, number> = {}
/** a walk may use this much of the point's time (the rest is for standing there) */
export const WALK_BUDGET = 0.85

export interface WalkInput {
  speed: number
  /** how the playhead got to this point: `play` = the replay advanced, `seek` = the viewer moved it */
  via: PointVia
  reduced: boolean
  /** the route length to the spot, m (Infinity when there is none) */
  distanceM: number
  /** the time the walk may take: the point's own time (the caller adds WALK_HOLD_MS at x1), ms */
  budgetMs: number
}

/** walk there (true), or snap / stay put (false) */
export function shouldWalk(w: WalkInput): boolean {
  if (w.speed !== 1 || w.via !== 'play' || w.reduced) return false
  if (!Number.isFinite(w.distanceM)) return false
  return (w.distanceM / WALK_MPS) * 1000 <= w.budgetMs * WALK_BUDGET
}

/** the spot the scene puts an agent on at x1: a plan point's agent posts its card on the whiteboard, everyone else is at their desk */
export function stageSpot(p: Point, seat: number): string {
  return p.kind === 'plan' && p.agent === seat ? 'whiteboard' : `work_${seat}`
}

/** how long a walk of `distanceM` holds the next point beyond the point's own time, ms (0 when it fits or is skipped) */
export function walkWaitMs(distanceM: number | undefined, stepMs: number): number {
  if (distanceM === undefined || !shouldWalk({ speed: 1, via: 'play', reduced: false, distanceM, budgetMs: stepMs + WALK_HOLD_MS })) return 0
  return Math.min(WALK_HOLD_MS, Math.max(0, (distanceM / WALK_MPS) * 1000 - stepMs))
}

/** the expected wait at point `k` at x1: the planner's trip to the whiteboard, and the walk back from the previous plan point */
export function pointWaitMs(points: readonly Point[], k: number, stepMs: (p: Point) => number, dist: Record<number, number>, first = false): number {
  const p = points[k]
  const prev = first ? undefined : points[k - 1]
  let ms = 0
  const stays = prev?.kind === 'plan' && p.kind === 'plan' && prev.agent === p.agent
  if (p.kind === 'plan' && p.agent !== null && !stays) ms += walkWaitMs(dist[p.agent], stepMs(p))
  if (prev && prev.kind === 'plan' && prev.agent !== null && !(p.kind === 'plan' && p.agent === prev.agent)) ms += walkWaitMs(dist[prev.agent], stepMs(p))
  return ms
}
