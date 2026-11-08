// Where the approval box gets its data. One interface, two implementations: Supabase (supabaseSource.ts) and a
// fake that exists only under ?debug=1 (fakeSource.ts), so the box can be developed and screenshotted without a
// backend. The page only hides things; the lock is the server's owner check and the table's RLS (#25).

import type { StoredApproval } from './types'

/** visitor = not signed in; other = signed in with an account that isn't the owner's */
export type Role = 'visitor' | 'owner' | 'other'

/** what a visitor sees of a waiting approval (supabase/approvals.sql approvals_cover): no title, content or options */
export interface Cover {
  id: number
  kind: string
  requester_seat: number | null
  created_at: string
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
  /** owner only: waiting (pending, deciding), oldest first */
  pending(): Promise<StoredApproval[]>
  /** owner only: decided, newest first */
  decided(): Promise<StoredApproval[]>
  decide(id: number, result: string, opinion: string): Promise<DecideResult>
}
