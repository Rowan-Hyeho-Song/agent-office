// The faces of the replayed office (#428, timelapse.md 12.4): decided by the playing point and the replay's own state alone, never by the live office.
// The sustained faces come from the replay status through the rig's state expression (work: focused, think: thinking, rest: neutral, night: asleep /
// sleepy); the events below start when the playhead lands on a point. Pure: no three.js.

import type { Expression } from '../office/faceModel'
import type { Point } from '../timeline/types'

/** the expressions the live office has that the replay never shows (12.4: real hours, live visitors, live talk and road yielding; a late-hour yawn is not an expression of its own) */
export const NOT_IN_REPLAY: readonly Expression[] = ['bored', 'greeting', 'question', 'yielding']

export interface FaceCue {
  /** the agent's seat */
  seat: number
  expr: Expression
  /** seconds on the replay's scene clock */
  dur: number
}

const SEATS = [0, 1, 2, 3, 4]

/**
 * What the landing on \`p\` makes the faces do: a decision gladdens the one who decided (2.5 s), an approved request makes its requester proud (3 s),
 * a deploy gladdens everyone in the office (2.5 s). A work point's test / build result is not in the record, so nothing of it is shown.
 */
export function landingFaces(p: Point): FaceCue[] {
  if (p.kind === 'decision' && p.agent !== null) return [{ seat: p.agent, expr: 'joy', dur: 2.5 }]
  if (p.kind === 'approval' && p.result && p.agent !== null) return [{ seat: p.agent, expr: 'proud', dur: 3 }]
  if (p.kind === 'deploy') return SEATS.map((seat) => ({ seat, expr: 'joy' as Expression, dur: 2.5 }))
  return []
}
