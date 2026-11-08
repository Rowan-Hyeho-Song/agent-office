// ?debug=1 traffic demos (#138, for the designer): two agents swap ends where they must meet, so the yield and pass
// gestures show at once. window.__office.trafficDemo('narrow' | 'wide'), and trafficDemo('off') to let them go.
//   narrow: the lane between the ping-pong table and the east wall (about 0.6 m of free centre width: one body at a time);
//           agent_1 sets off half a second later, so agent_0 has the lane and agent_1 steps aside at its mouth and yields
//   wide:   the open rug, head on along one line (both keep right and pass)
// Pure: no three.js.

import { facing } from './nav'
import type { Request } from './traffic'

export type DemoKind = 'narrow' | 'wide'

interface Leg {
  id: string
  from: { x: number; z: number }
  to: { x: number; z: number }
  /** extra seconds before this one sets off */
  delay: number
}

const swap = (ids: [string, string], a: { x: number; z: number }, b: { x: number; z: number }, delay = 0): Leg[] => [
  { id: ids[0], from: a, to: b, delay: 0 },
  { id: ids[1], from: b, to: a, delay },
]

export const TRAFFIC_DEMOS: Record<DemoKind, Leg[]> = {
  // the ends sit off the lane mouths, so one standing there never corks the lane for the other
  narrow: swap(['agent_0', 'agent_1'], { x: 3.9, z: -1.15 }, { x: 4, z: 1.55 }, 0.5),
  wide: swap(['agent_0', 'agent_1'], { x: -3, z: -1 }, { x: 0, z: -1 }),
}

/** how long both stand at their start before they set off (seconds of the scene clock) */
export const DEMO_HOLD_S = 1

export interface DemoState {
  kind: DemoKind
  /** scene clock at the start; null until the scene picks it up */
  at: number | null
}

/** the request of one demo agent at scene time `t` (null when the agent is not in the demo) */
export function demoRequest(d: DemoState, id: string, t: number): { req: Request; start: boolean } | null {
  const leg = TRAFFIC_DEMOS[d.kind].find((l) => l.id === id)
  if (!leg || d.at === null) return null
  const start = t - d.at < DEMO_HOLD_S + leg.delay
  const p = start ? leg.from : leg.to
  const q = start ? leg.to : leg.from
  // at rest it faces the way it is about to walk (the start) or the way it walked (the end)
  return { req: { spot: `demo_${d.kind}_${id}_${start ? 'from' : 'to'}`, slot: { ...p, ry: facing(p, start ? q : { x: 2 * p.x - q.x, z: 2 * p.z - q.z }) }, pace: 1 }, start }
}
