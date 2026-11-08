// Pure helpers for timelapse points (#81): tiers, the keep-or-drop filter, merging by key. scripts/timeline/build.mjs
// is the plain-JS twin the backfill and the Action run (node can't import TypeScript); build.test.ts compares them.

import { redact } from '../docs/filter'
import { sha256Hex } from './sha256'
import { POINT_KINDS, type Point, type PointInput } from './types'

export const TRUSTED = ['OWNER', 'COLLABORATOR']
export const APPROVERS = ['OWNER']
const TITLE_MAX = 200

export interface PointConfig {
  /** repos whose points are public (plan.md 6.3); every other repo is review */
  publicRepos: string[]
  /** repos that are never collected (company work …) */
  privateRepos?: string[]
  /** words to hide, from server config */
  banned?: string[]
}

export function tierFor(repo: string, cfg: Pick<PointConfig, 'publicRepos' | 'privateRepos'>): 'public' | 'review' | 'private' {
  const is = (list: string[] = []) => list.some((r) => r.toLowerCase() === repo.toLowerCase())
  if (is(cfg.privateRepos)) return 'private'
  return is(cfg.publicRepos) ? 'public' : 'review'
}

const count = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null)
const num = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null)

/**
 * The point to keep, or null: private repos are not collected, strangers' points are dropped (#38: approvals
 * need the owner), the title goes through the docs filter, and a review point has no title. Only the point's own
 * fields are copied, so nothing else can ride along into the table.
 */
export function toPoint(p: PointInput, cfg: PointConfig): Point | null {
  const tier = tierFor(p.project, cfg)
  if (tier === 'private') return null
  const assoc = String(p.author?.association ?? '').toUpperCase()
  if (!(p.kind === 'approval' ? APPROVERS : TRUSTED).includes(assoc)) return null
  const t = redact(String(p.title ?? '').slice(0, TITLE_MAX), cfg.banned)
  // a filter hit hides the title and lowers a public point to review, like documents
  const secret = tier === 'review' || t.hits.length > 0
  // review (SECRET) points are opaque: no source address, no issue / PR number (the DB is readable by visitors)
  return {
    key: secret ? `review:${p.project}:${sha256Hex(p.key).slice(0, 16)}` : p.key,
    project: p.project,
    at: new Date(p.at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    kind: p.kind,
    agent: p.agent === 0 || p.agent === 1 || p.agent === 2 || p.agent === 3 ? p.agent : null,
    title: secret ? '' : t.text,
    secret,
    additions: count(p.additions),
    deletions: count(p.deletions),
    files: count(p.files),
    issue: secret ? null : num(p.issue),
    pr: secret ? null : num(p.pr),
    tier: secret ? 'review' : 'public',
  }
}

/** points by key (a later one replaces an earlier one), sorted by time then key */
export function mergePoints(...lists: Point[][]): Point[] {
  const map = new Map<string, Point>()
  for (const list of lists) for (const p of list) map.set(p.key, p)
  return [...map.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

const REPO = /^[\w.-]+\/[\w.-]+$/
const isDate = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s))
const nullable = (n: unknown) => n === null || (typeof n === 'number' && Number.isInteger(n) && n >= 0)

export function parsePointInput(x: unknown): PointInput | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Record<string, unknown>
  if (typeof p.project !== 'string' || !REPO.test(p.project)) return null
  // a point must point at its own repo on GitHub: a leaked token still can't file arbitrary pages
  if (typeof p.key !== 'string' || p.key.length > 300 || !p.key.toLowerCase().startsWith(`https://github.com/${p.project.toLowerCase()}/`)) return null
  if (!isDate(p.at)) return null
  if (!(POINT_KINDS as readonly unknown[]).includes(p.kind)) return null
  if (!(p.agent === null || p.agent === 0 || p.agent === 1 || p.agent === 2 || p.agent === 3)) return null
  if (typeof p.title !== 'string' || p.title.length > 400) return null
  if (![p.additions, p.deletions, p.files, p.issue, p.pr].every(nullable)) return null
  const author = p.author as Record<string, unknown> | undefined
  if (!author || typeof author.login !== 'string' || typeof author.association !== 'string') return null
  return p as unknown as PointInput
}
