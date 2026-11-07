// Approvals (#25, plan.md 6.5): 🖊 requests the agents post on GitHub, ✅ results the owner gives in the
// office (or on GitHub). Shared by /api/docs (filing), /api/approve (deciding) and /api/approvals (the hook).

/** what the Action sends for one 🖊 / ✅ comment (scripts/docs/build.mjs approvalForComment) */
export interface ApprovalInput {
  type: 'request' | 'result'
  repo: string
  folder: number
  /** the comment's URL: a request's id; a result points at the request it answers in `answers` */
  url: string
  /** the issue's title, for the approval card */
  title?: string
  body: string
  author: { login: string; association: string }
  created_at: string
  updated_at: string
  answers?: string | null
}

/** supabase/approvals.sql */
export interface ApprovalRow {
  repo: string
  folder: number
  /** the issue's title (owner only, like the rest of the row) */
  title: string
  source_url: string
  kind: string
  requester: string
  requester_seat: number | null
  content: string
  options: string[]
  recommended: number | null
  reason: string | null
  created_at: string
  updated_at: string
}

export interface Decision {
  /** 승인 | 반려 | 선택지 N */
  result: string
  option: number | null
  opinion: string | null
  result_url: string
  decided_at: string
}

/** a stored approval as /api/approve and the owner's box read it */
export interface StoredApproval extends ApprovalRow {
  id: number
  status: 'pending' | 'deciding' | 'decided'
  result: string | null
  option: number | null
  opinion: string | null
  result_url: string | null
  decided_at: string | null
}
