// Where the timelapse's points come from (#413): the timeline table (Supabase, read through RLS with the page's publishable key:
// public points in full, review points without a title, supabase/timeline.sql) on top of the bundled copies
// (src/timeline/fixtures/*.json: the 8 November backfill, and the other repo the Action does not collect). One point per key,
// the table's row winning. The table not set up, slow or failing: the copies alone, as before.

import type { SupabaseClient } from '@supabase/supabase-js'
import { mergePoints } from '../timeline/points'
import { POINT_KINDS, type Point, type PointKind, type Seat } from '../timeline/types'

/** rows per request (PostgREST's default cap) */
export const PAGE = 1000
/** give the table this long, then play the copies */
export const LIVE_TIMEOUT_MS = 6000

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** a table row as a Point (the same shape the server stored; `at` back to the copies' ISO "…Z" form, `result` only when true) */
export function rowToPoint(r: Record<string, unknown>): Point | null {
  if (typeof r.key !== 'string' || typeof r.project !== 'string' || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null
  if (!(POINT_KINDS as readonly unknown[]).includes(r.kind)) return null
  if (r.tier !== 'public' && r.tier !== 'review') return null
  const agent = [0, 1, 2, 3, 4].includes(r.agent as number) ? (r.agent as Seat) : null
  return {
    key: r.key,
    project: r.project,
    at: new Date(r.at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    kind: r.kind as PointKind,
    agent,
    title: typeof r.title === 'string' ? r.title : '',
    secret: r.secret === true,
    additions: count(r.additions),
    deletions: count(r.deletions),
    files: count(r.files),
    issue: count(r.issue),
    pr: count(r.pr),
    ...(r.result === true ? { result: true as const } : {}),
    tier: r.tier,
  }
}

/** every row of the table, page by page, oldest first */
export async function loadLive(client: SupabaseClient, page = PAGE): Promise<Point[]> {
  const out: Point[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await client
      .from('timeline')
      .select('key, project, at, kind, agent, title, secret, additions, deletions, files, issue, pr, result, tier')
      .order('at')
      .order('key')
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const p = rowToPoint(r as Record<string, unknown>)
      if (p) out.push(p)
    }
    if (!data || data.length < page) return out
  }
}

/** the copies, with the table's points over them; the copies alone when there is no table to read or it fails / is slow */
export async function loadPoints(copies: () => Promise<Point[]>, client: SupabaseClient | null, timeoutMs = LIVE_TIMEOUT_MS): Promise<Point[]> {
  const base = await copies()
  if (!client) return base
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const live = await Promise.race([
      loadLive(client),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeline: timed out')), timeoutMs))),
    ])
    return mergePoints(base, live)
  } catch (e) {
    console.warn('timeline: the table could not be read, playing the bundled copy', e)
    return base
  } finally {
    clearTimeout(timer)
  }
}
