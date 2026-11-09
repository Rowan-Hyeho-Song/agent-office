// Where the approval box gets its data. One interface, two implementations: Supabase (supabaseSource.ts) and a
// fake that exists only under ?debug=1 (fakeSource.ts), so the box can be developed and screenshotted without a
// backend. The page only hides things; the lock is the server's owner check and the table's RLS (#25).

import type { StoredApproval } from './types.js'

/** visitor = not signed in; other = signed in with an account that isn't the owner's */
export type Role = 'visitor' | 'owner' | 'other'

/** what a visitor sees of a waiting approval (supabase/approvals.sql approvals_cover): no title, content or options */
export interface Cover {
  id: number
  kind: string
  requester_seat: number | null
  created_at: string
}

/**
 * What a visitor could see of a DECIDED approval (#222): who asked, which result, when. Still no title, content, options,
 * opinion or links. No query returns this yet: supabase/approvals.sql has only the pending cover view, so a source leaves
 * `decidedCovers` out until a cover view for decided rows exists (then a visitor's 처리된 결재 section appears by itself).
 */
export interface DecidedCover {
  id: number
  kind: string
  requester_seat: number | null
  result: string
  decided_at: string
}

export type DecideResult = { ok: true } | { ok: false; status: number }

export interface ApprovalSource {
  role(): Role
  /** role changes; returns the unsubscribe */
  subscribe(cb: () => void): () => void
  signIn(): void
  signOut(): void
  /** the number everyone sees */
  count(): Promise<number>
  covers(): Promise<Cover[]>
  /** visitors: decided approvals as covers (optional: see DecidedCover) */
  decidedCovers?(): Promise<DecidedCover[]>
  /** owner only: waiting (pending, deciding), oldest first */
  pending(): Promise<StoredApproval[]>
  /** owner only: decided, newest first */
  decided(): Promise<StoredApproval[]>
  decide(id: number, result: string, opinion: string): Promise<DecideResult>
}
