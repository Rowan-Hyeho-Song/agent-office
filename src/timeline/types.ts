// The timelapse's unit: one point per commit / issue / minutes / approval / decision / deploy (plan.md 6.7, #81).
// Shared by the backfill + Action (scripts/timeline/*.mjs, plain JS), /api/timeline and the replay screen.
// Never carries code, diffs or file paths: only counts.

export const POINT_KINDS = ['plan', 'work', 'minutes', 'approval', 'decision', 'deploy'] as const
export type PointKind = (typeof POINT_KINDS)[number]

/** seats as in agent identity (0 기획 · 1 3D · 2 디자인 · 3 코더 · 4 사운드); null = before roles existed */
export type Seat = 0 | 1 | 2 | 3 | 4

/** plan.md 6.3. `private` is never collected, so a stored point is public or review */
export type PointTier = 'public' | 'review'

export interface Point {
  /** the source's own address: commit URL, issue URL, comment URL (+ #decision), docs row anchor. Unique. */
  key: string
  /** "owner/name" */
  project: string
  /** ISO 8601 UTC */
  at: string
  kind: PointKind
  agent: Seat | null
  /** '' on a review point */
  title: string
  /** review point: shown as a SECRET point (title is a black bar) */
  secret: boolean
  /** lines changed and files touched (commit points); null otherwise */
  additions: number | null
  deletions: number | null
  files: number | null
  issue: number | null
  pr: number | null
  /** approval point only: the owner's ✅ result (drawn on the owner's lane); absent on everything else */
  result?: true
  tier: PointTier
}

/** what the Action / backfill sends: the point as collected, plus who wrote it (#38; dropped before storing) */
export interface PointInput extends Omit<Point, 'tier' | 'secret'> {
  author: { login: string; association: string }
}

/** the JSON copy a backfill writes (src/timeline/fixtures/*.json) */
export interface TimelineFile {
  version: 1
  project: string
  tier: PointTier
  points: Point[]
}
