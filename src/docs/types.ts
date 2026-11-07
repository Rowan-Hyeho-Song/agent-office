// The office's documents (plan.md 6): copies of what the agents write on GitHub, made by the Action
// (scripts/docs/*.mjs) and stored by /api/docs. Shared by the parser, the filter and the server.

export const DOC_KINDS = ['plan', 'minutes', 'decision', 'report', 'worklog'] as const
export type DocKind = (typeof DOC_KINDS)[number]

/** plan.md 6.3: public = this public repo; review = SECRET until approved; private = never has content */
export type Grade = 'public' | 'review' | 'private'

export type SourceKind = 'issue' | 'comment' | 'pr'

/** what the Action sends to /api/docs for one GitHub item (raw markdown; the server parses and filters) */
export interface DocInput {
  kind: DocKind
  /** "owner/name": the project folder */
  repo: string
  /** issue number: the file (a PR without a linked issue files under its own number) */
  folder: number
  title: string
  body: string
  source: { kind: SourceKind; url: string }
  created_at: string
  updated_at: string
  /** plan: the issue's state and labels; report: merged_at and the PR number */
  meta?: Record<string, unknown>
}

/** who speaks in a minutes row: one of the four agents, the owner (사용자), or an unknown name kept as written */
export type Speaker = { seat: 0 | 1 | 2 | 3 } | { owner: true } | { name: string }

export interface MinutesRow {
  /** the 순서 column as written (it may continue numbering from an earlier comment) */
  order: number
  from: Speaker
  to: Speaker[]
  /** the 내용 cell, markdown kept */
  text: string
}

/** one `### 🗂 에이전트 간 협의 기록 (date)` block */
export interface Minutes {
  /** YYYY-MM-DD from the heading, or null */
  date: string | null
  rows: MinutesRow[]
  /** the **결정** part (inline after the colon, or the lines below it up to **후속** / end), trimmed; null if absent */
  decision: string | null
  /** the **후속** part, same rules */
  followUp: string | null
}

/** `### 🖊 결재 요청 (date)` (plan.md 6.5) */
export interface ApprovalRequest {
  date: string | null
  /** 결정 요청 | 문서 공개 | 산출물 확인, as written */
  kind: string
  /** **요청** value, e.g. "코더(루프)" */
  requester: string
  requesterSeat: 0 | 1 | 2 | 3 | null
  content: string
  /** the numbered 선택지 lines, without the number and without "(추천)" */
  options: string[]
  /** 1-based index of the option marked (추천), or null */
  recommended: number | null
  reason: string | null
}

/** `### ✅ 결재 (date)` */
export interface ApprovalResult {
  date: string | null
  /** **결과** as written: 승인 | 반려 | 선택지 N */
  result: string
  /** N when the result is "선택지 N" */
  option: number | null
  opinion: string | null
}

/** the stored row (supabase/docs.sql) */
export interface DocRow {
  kind: DocKind
  repo: string
  folder: number
  title: string
  summary: string
  body: string
  agents: number[]
  source_kind: SourceKind
  source_url: string
  grade: Grade
  approved: boolean
  /** parsed structure: Minutes for minutes, ApprovalResult (+ request) for decisions, meta for plans and reports */
  data: Record<string, unknown>
  created_at: string
  updated_at: string
}
