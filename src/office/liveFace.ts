// The faces that live events cause (robots.md 4): a question when a talk is asked of someone at work, the greeting when the owner connects.
// While the timelapse plays (#428, timelapse.md 12.4) none of them may touch the replayed bodies: the replay's faces come from its own points.

import { ownerConnected } from './faceMind'
import type { OfficeMessage, StatusMap } from './status'

/** the sender of a talk asked of someone busy at work stands there puzzled (의문): the agent to show it, or null (also null while replaying) */
export function questionFaceFor(replaying: boolean, m: OfficeMessage, status: StatusMap): string | null {
  return !replaying && m.kind === 'talk' && status[m.to]?.state === 'working' ? m.from : null
}

/** every robot is glad to see the owner connect (반가움); not while replaying */
export const greetsOwner = (replaying: boolean, prev: string | null, next: string): boolean => !replaying && ownerConnected(prev, next)
