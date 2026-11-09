// #240 the approval box's "new item" chime: one call from wherever the waiting count is refreshed (Realtime or polling).
// One chime however many arrive at once, only when the count went up, never on the first load of the page, and by
// default only for the owner (designer + sound decision, #240). The sound setting (mute / volume) applies as for any cue.

import { cue } from './cues'

/** who hears it: 'owner' (default, #240) or 'everyone' */
export const APPROVAL_CHIME_FOR: 'owner' | 'everyone' = 'owner'

/** whether a refresh from `prev` to `next` waiting approvals should chime (pure, tested); `prev` null = first load */
export function shouldChime(prev: number | null, next: number, isOwner: boolean, forWhom: 'owner' | 'everyone' = APPROVAL_CHIME_FOR): boolean {
  if (prev === null) return false // the first count of the visit is not news
  if (next <= prev) return false
  return forWhom === 'everyone' || isOwner
}

let last: number | null = null

/**
 * Call with the waiting count after each refresh. Chimes once when it went up (several new ones = one chime).
 * Returns whether it chimed.
 */
export function approvalsRefreshed(waiting: number, isOwner: boolean): boolean {
  const go = shouldChime(last, waiting, isOwner)
  last = waiting
  return go ? cue('approval.new') : false
}

/** tests / sign-out: forget the last count (the next refresh is a first load again) */
export function resetApprovalChime() {
  last = null
}
