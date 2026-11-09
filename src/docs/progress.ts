// How far an issue is (#241, docs/design/docs-ui.md 2.5). The docs pipeline (scripts/docs/build.mjs progressFor) works it out
// from the issue, its pull requests, its branches and its comments and stores it in the plan's `data.progress`; the server
// and the client both read it back through sanitizeProgress, so nothing odd in the database can reach the screen.

export const STAGES = ['waiting', 'doing', 'review', 'done'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_NAME: Record<Stage, string> = { waiting: '대기', doing: '진행 중', review: '검토', done: '완료' }

export interface Progress {
  stage: Stage
  /** the 완료 기준 checkboxes of the issue body; null = it has none (no bar) */
  checks: { done: number; total: number } | null
  /** 🖊 requests of this issue nobody answered yet */
  pending: number
  /**
   * The pipeline never sent one for this file (no plan document, or filed before #241): the library still shows a status
   * (designer, #301: every file has one), read from the documents: a merged PR's report = 완료, else 대기. The whiteboard
   * keeps its own guess for these.
   */
  guessed?: true
}

/** what a viewer of a `private` project gets: the stage only */
export type StageOnly = Pick<Progress, 'stage'>

const MAX = 1000
const count = (v: unknown, max = MAX): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

/**
 * Anything → a Progress or null. Unknown stages, fractions, negatives, a done above the total or absurd sizes are refused
 * (the whole value: a half-believed one would show a wrong bar). `private` rows come with only `stage`: checks null, pending 0.
 */
export function sanitizeProgress(v: unknown): Progress | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const x = v as Record<string, unknown>
  if (!(STAGES as readonly unknown[]).includes(x.stage)) return null
  let checks: Progress['checks'] = null
  if (x.checks !== undefined && x.checks !== null) {
    const c = x.checks as Record<string, unknown>
    if (typeof x.checks !== 'object' || Array.isArray(x.checks) || !count(c.done) || !count(c.total) || c.total < 1 || c.done > c.total) return null
    checks = { done: c.done, total: c.total }
  }
  if (x.pending !== undefined && !count(x.pending)) return null
  return { stage: x.stage as Stage, checks, pending: (x.pending as number | undefined) ?? 0 }
}
