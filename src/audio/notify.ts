// #240 the approval box's "new item" chime (docs/design/docs-ui.md 1.6): one call from wherever the waiting count is
// refreshed (Realtime or polling).
// - one chime however many arrive within 5 s (the cue's own gap is 5 s; a burst in one refresh is one call anyway)
// - only when the count went up; never on the first load of the page
// - not while the tab is hidden, and nothing saved up for when it comes back (the dot shows it instead)
// - by default only the owner hears it (designer + sound, #240); the sound setting (mute / volume) applies as for any cue

import { cue } from './cues'

/** who hears it: 'owner' (default, #240) or 'everyone' */
export const APPROVAL_CHIME_FOR: 'owner' | 'everyone' = 'owner'

/** whether a refresh from `prev` to `next` waiting approvals should chime (pure, tested); `prev` null = first load */
export function shouldChime(prev: number | null, next: number, isOwner: boolean, hidden = false, forWhom: 'owner' | 'everyone' = APPROVAL_CHIME_FOR): boolean {
  if (prev === null) return false // the first count of the visit is not news
  if (next <= prev) return false
  if (hidden) return false // and the count is taken as seen, so coming back doesn't chime either
  return forWhom === 'everyone' || isOwner
}

let last: number | null = null

/**
 * Call with the waiting count after each refresh. Chimes once when it went up (several new ones = one chime).
 * Returns whether it chimed.
 */
export function approvalsRefreshed(waiting: number, isOwner: boolean): boolean {
  const go = shouldChime(last, waiting, isOwner, typeof document !== 'undefined' && document.hidden)
  last = waiting
  return go ? cue('approval.new') : false
}

/** tests / sign-out: forget the last count (the next refresh is a first load again) */
export function resetApprovalChime() {
  last = null
}
