// #240 the approval box's "new item" chime (docs/design/docs-ui.md 1.6): one call from wherever the waiting count is
// refreshed (Realtime or polling).
// - one chime however many arrive within 5 s (the cue's own gap is 5 s; a burst in one refresh is one call anyway)
// - only when something new arrived: the count went up, or the newest request is newer than before (one decided and
//   one new in the same refresh leaves the count as it was; coder's suggestion on #245)
// - never on the first load of the page
// - not while the tab is hidden, and nothing saved up for when it comes back (the dot shows it instead)
// - by default only the owner hears it (designer + sound, #240); the sound setting (mute / volume) applies as for any cue

import { cue } from './cues'

/** who hears it: 'owner' (default, #240) or 'everyone' */
export const APPROVAL_CHIME_FOR: 'owner' | 'everyone' = 'owner'

/** what a refresh saw: the waiting count and the newest waiting request's created_at (ISO or ms), if known */
export type Seen = { count: number; newestAt?: string | number | null }

const time = (v: string | number | null | undefined) => (v === null || v === undefined ? null : typeof v === 'number' ? v : Date.parse(v))

/** whether a refresh from `prev` to `next` should chime (pure, tested); `prev` null = first load */
export function shouldChime(prev: Seen | null, next: Seen, isOwner: boolean, hidden = false, forWhom: 'owner' | 'everyone' = APPROVAL_CHIME_FOR): boolean {
  if (prev === null) return false // the first look of the visit is not news
  const a = time(prev.newestAt)
  const b = time(next.newestAt)
  const arrived = next.count > prev.count || (a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) && b > a)
  if (!arrived) return false
  if (hidden) return false // and it is taken as seen, so coming back doesn't chime either
  return forWhom === 'everyone' || isOwner
}

let last: Seen | null = null

/**
 * Call after each refresh with the waiting count (and the newest waiting request's created_at when you have it).
 * Chimes once when something new arrived (several new ones = one chime). Returns whether it chimed.
 */
export function approvalsRefreshed(waiting: number, isOwner: boolean, newestAt?: string | number | null): boolean {
  const next: Seen = { count: waiting, newestAt }
  const go = shouldChime(last, next, isOwner, typeof document !== 'undefined' && document.hidden)
  last = next
  return go ? cue('approval.new') : false
}

/** sign-out or a role change: forget what was seen (the next refresh is a first load again) */
export function resetApprovalChime() {
  last = null
}
