// Walking in the timelapse (#117, #158) is presentation only: the scene at index i never depends on it. Agents walk to
// their scene spots at every speed, because the walk is planned and played on the replay clock (see stage.ts): x16 is x1
// played faster. A seek is a jump and snaps everyone to the point; reduced motion keeps everyone at their desk.

import type { Point } from '../timeline/types'

/** agents walk this much faster while replaying (the rig's pace scale) */
export const REPLAY_PACE = 1.4
/** a conservative live average (the rig cruises at 0.75 m/s but speeds up and slows down) */
export const LIVE_WALK_MPS = 0.65
/** the same at the replay pace */
export const WALK_MPS = LIVE_WALK_MPS * REPLAY_PACE
/** the next point waits for walkers to arrive (like a meeting scene, design 3) at most this long (replay ms) */
export const WALK_HOLD_MS = 4000
/** route length desk -> whiteboard by seat, m; filled by the office once the nav graph is built (the "남은 시간" estimate reads it) */
export const boardDistance: Record<number, number> = {}

/** the spot the scene puts an agent on: a plan point's agent posts its card on the whiteboard, everyone else is at their desk */
export function stageSpot(p: Point, seat: number): string {
  return p.kind === 'plan' && p.agent === seat ? 'whiteboard' : `work_${seat}`
}

/** how long a walk of `distanceM` holds the next point beyond the point's own time, replay ms (0 when it fits or there is no route) */
export function walkWaitMs(distanceM: number | undefined, stepMs: number): number {
  if (distanceM === undefined || !Number.isFinite(distanceM)) return 0
  return Math.min(WALK_HOLD_MS, Math.max(0, (distanceM / WALK_MPS) * 1000 - stepMs))
}

/** the expected wait at point `k`: the planner's trip to the whiteboard, and the walk back from the previous plan point */
export function pointWaitMs(points: readonly Point[], k: number, stepMs: (p: Point) => number, dist: Record<number, number>, first = false): number {
  const p = points[k]
  const prev = first ? undefined : points[k - 1]
  let ms = 0
  const stays = prev?.kind === 'plan' && p.kind === 'plan' && prev.agent === p.agent
  if (p.kind === 'plan' && p.agent !== null && !stays) ms += walkWaitMs(dist[p.agent], stepMs(p))
  if (prev && prev.kind === 'plan' && prev.agent !== null && !(p.kind === 'plan' && p.agent === prev.agent)) ms += walkWaitMs(dist[prev.agent], stepMs(p))
  return ms
}
