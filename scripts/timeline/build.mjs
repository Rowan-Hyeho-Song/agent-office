// GitHub data → timelapse points (#81, plan.md 6.7). Pure: no network, no clock; shared by the backfill
// (backfill.mjs) and the push Action (event.mjs). The same input always gives the same output.
//
//   issue opened (form era)            → plan      agent 0 (the planner opens issues)
//   commit that landed on dev           → work      agent = the issue's "누가 하나" seat
//   commit that reached main only       → deploy    agent null (the whole office, not one seat)
//   comment "### 🗂 협의 기록"           → minutes   agent = who speaks first in the table
//     its **결정** part                  → decision  agent 0
//   decision table row in docs          → decision  agent 0
//   comment "### 🖊 결재 요청" / "✅ 결재" → approval  agent = the requester
// Rules and exceptions: docs/timeline.md. Never collects code, diffs or file paths, only counts.

import { createHash } from 'node:crypto'
import { APPROVERS, TRUSTED, commentKind, ownerApprovals, requestAnswered, trusted } from '../docs/build.mjs'
import { redact } from './filter.mjs'

/** @typedef {import('../../src/timeline/types').Point} Point */
/** @typedef {import('../../src/timeline/types').PointInput} PointInput */

export const POINT_KINDS = ['plan', 'work', 'minutes', 'approval', 'decision', 'deploy']

// role words -> seat; same list as src/docs/parse.ts (a test compares them)
export const SEAT_WORDS = [
  [0, ['기획', '메모', 'MEMO']],
  [1, ['Blender', '3D', '메시', 'MESH']],
  [2, ['디자이너', '디자인', '휴', 'HUE']],
  [3, ['코더', '루프', 'LOOP']],
]
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SEAT_RES = SEAT_WORDS.map(([seat, words]) => [
  seat,
  new RegExp(words.map((w) => (/^[\x00-\x7f]+$/.test(w) ? `(?<![A-Za-z0-9])${escapeRe(w)}(?![A-Za-z0-9])` : escapeRe(w))).join('|'), 'i'),
])

/** the seat whose role word appears first in the text, or null */
export function seatIn(text) {
  let best = null
  for (const [seat, re] of SEAT_RES) {
    const m = re.exec(text ?? '')
    if (m && (best === null || m.index < best.index)) best = { seat, index: m.index }
  }
  return best ? best.seat : null
}

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n')
/** the text under a `## heading` (to the next `## `), or null */
export function section(markdown, heading) {
  const lines = norm(markdown).split('\n')
  const start = lines.findIndex((l) => /^## (?!#)/.test(l) && l.replace(/^##\s+/, '').trim() === heading)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## (?!#)/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}

// ---- tiers and the filter ------------------------------------------------------------------------------------------

/** plan.md 6.3: the public allow list, else review; `private` repos are never collected */
export function tierFor(repo, { publicRepos = [], privateRepos = [] } = {}) {
  const is = (list) => list.some((r) => r.toLowerCase() === repo.toLowerCase())
  if (is(privateRepos)) return 'private'
  return is(publicRepos) ? 'public' : 'review'
}

const TITLE_MAX = 200
const count = (n) => (Number.isInteger(n) && n >= 0 ? n : null)
const num = (n) => (Number.isInteger(n) && n > 0 ? n : null)
const stamp = (iso) => new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * One collected point → the point to keep, or null: private repos produce nothing, strangers' items are dropped
 * (#38: approvals need the owner), the title goes through the server filter, and a review point has no title.
 * Only the listed fields are copied, so nothing else can ride along.
 * @param {PointInput} p
 * @param {{ publicRepos?: string[], privateRepos?: string[], banned?: string[] }} [cfg]
 * @returns {Point | null}
 */
export function finalize(p, cfg = {}) {
  const tier = tierFor(p.project, cfg)
  if (tier === 'private') return null
  const assoc = String(p.author?.association ?? '').toUpperCase()
  if (!(p.kind === 'approval' ? APPROVERS : TRUSTED).includes(assoc)) return null
  const t = redact(String(p.title ?? '').slice(0, TITLE_MAX), cfg.banned)
  // a hit hides the title and lowers a public point to review, like documents (plan.md 6.3)
  const secret = tier === 'review' || t.hits.length > 0
  // review (SECRET) points are opaque: no source address, no issue / PR number (they go in a public repo)
  return {
    key: secret ? `review:${p.project}:${createHash('sha256').update(p.key).digest('hex').slice(0, 16)}` : p.key,
    project: p.project,
    at: stamp(p.at),
    kind: p.kind,
    agent: p.agent === 0 || p.agent === 1 || p.agent === 2 || p.agent === 3 ? p.agent : null,
    title: secret ? '' : t.text,
    secret,
    additions: count(p.additions),
    deletions: count(p.deletions),
    files: count(p.files),
    issue: secret ? null : num(p.issue),
    pr: secret ? null : num(p.pr),
    ...(p.kind === 'approval' && p.result === true ? { result: true } : {}),
    tier: secret ? 'review' : 'public',
  }
}

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

/** points by key: a later one replaces the earlier one with the same key; sorted by time, then key */
export function mergePoints(...lists) {
  const map = new Map()
  for (const list of lists) for (const p of list) map.set(p.key, p)
  return [...map.values()].sort(byTime)
}

// ---- collecting ----------------------------------------------------------------------------------------------------

const firstLine = (s) => String(s ?? '').split('\n')[0].trim()
const issueNumber = (c) => Number(String(c.issue_url).split('/').pop())
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|related(?: to)?|part of)\s*:?\s*#(\d+)/i
const MERGE_PR = /^Merge pull request #(\d+)\b/

/**
 * Who an issue belongs to, in order: the form's "누가 하나" field, the `asset` label (Blender), the title's
 * leading [tag] ("[디자인] …"). `known` = roles existed for it (the planner opened it); seat null = unknown.
 */
export function issueSeat(issue) {
  const who = section(issue?.body, '누가 하나')
  const labels = (issue?.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
  const tag = /^\s*\[([^\]]+)\]/.exec(issue?.title ?? '')
  const seat = (who === null ? null : seatIn(who)) ?? (labels.includes('asset') ? 1 : null) ?? (tag ? seatIn(tag[1]) : null)
  return { known: who !== null || seat !== null, seat }
}

/** **결정** part(s) of a minutes comment: one text per block */
export function minutesDecisions(body) {
  const out = []
  let cur = null
  for (const line of norm(body).split('\n')) {
    const t = line.trim()
    if (/^#{1,3}\s/.test(t)) {
      cur = null
      continue
    }
    const d = /^\*\*결정(?:\s*\([^)]*\))?\*\*\s*[:：]?\s*(.*)$/.exec(t)
    if (d) {
      cur = [d[1]]
      out.push(cur)
    } else if (/^\*\*후속/.test(t)) cur = null
    else if (cur) cur.push(t)
  }
  return out.map((l) => l.join('\n').trim()).filter(Boolean)
}

/** a decision's first line without list / bold marks */
const gist = (text) => firstLine(text.replace(/^[\s>*-]+(?:\d+[.)]\s+)?/, '').replace(/\*\*/g, '')).slice(0, 120)

/** the first-speaking seat of a minutes comment's 순서 table, or null */
export function minutesSeat(body) {
  for (const line of norm(body).split('\n')) {
    const m = /^\s*\|\s*\d+\s*\|([^|]*)\|/.exec(line)
    const seat = m ? seatIn(m[1].split(/→|->/)[0].replace(/[`*_]/g, '')) : null
    if (seat !== null) return seat // the owner (사용자) speaking first doesn't count
  }
  return null
}

/** rows of the 결정 기록 table: [{ date, decision }] */
export function decisionRows(markdown) {
  const lines = norm(markdown).split('\n')
  const at = lines.findIndex((l) => /^#{1,3}\s*결정 기록\s*$/.test(l.trim()))
  if (at < 0) return []
  const rows = []
  for (let i = at + 1; i < lines.length; i++) {
    const t = lines[i].trim()
    if (/^#{1,3}\s/.test(t)) break
    if (!t.startsWith('|')) continue
    const cells = t
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, '|').trim())
    if (/^\d{4}-\d{2}-\d{2}$/.test(cells[0]) && cells[1]) rows.push({ date: cells[0], decision: cells[1] })
  }
  return rows
}

/**
 * @param {{
 *   repo: string, owner?: string,
 *   issues: any[], comments: any[], pulls: any[],
 *   devCommits: any[], mainCommits: any[],
 *   docs?: string[],
 *   logins?: Record<string, string>,
 * }} data
 *   commits are `GET /commits/{sha}` objects (stats, files); `logins` maps trusted commit authors to their
 *   association (owner → OWNER, collaborators → COLLABORATOR); docs are the markdown texts under docs/
 * @returns {PointInput[]}
 */
export function collect(data) {
  const { repo, issues, comments, pulls, devCommits, mainCommits, docs = [] } = data
  const ownerLogin = data.owner ?? repo.split('/')[0]
  const logins = Object.fromEntries(Object.entries(data.logins ?? { [ownerLogin]: 'OWNER' }).map(([k, v]) => [k.toLowerCase(), v]))
  const real = issues.filter((i) => !i.pull_request)
  const issueBy = new Map(real.map((i) => [i.number, i]))
  const prBy = new Map(pulls.map((p) => [p.number, p]))
  const prBySha = new Map(pulls.filter((p) => p.merged_at && p.merge_commit_sha).map((p) => [p.merge_commit_sha, p]))
  const point = (x) => ({ project: repo, additions: null, deletions: null, files: null, issue: null, pr: null, agent: null, ...x })
  const own = (item) => ({ login: String(item?.user?.login ?? ''), association: String(item?.author_association ?? 'NONE').toUpperCase() })
  /** @type {PointInput[]} */
  const out = []

  // plan: a trusted issue; the planner opened it once roles existed for it
  for (const i of real) {
    if (!trusted(i)) continue
    out.push(point({ key: i.html_url, at: i.created_at, kind: 'plan', agent: issueSeat(i).known ? 0 : null, title: i.title ?? '', issue: i.number, author: own(i) }))
  }

  // minutes (+ their decision lines) and approvals
  const commentsOf = new Map()
  for (const c of comments) {
    const n = issueNumber(c)
    if (!commentsOf.has(n)) commentsOf.set(n, [])
    commentsOf.get(n).push(c)
  }
  for (const c of comments) {
    const issue = issueBy.get(issueNumber(c))
    if (!issue) continue // a comment on a pull request
    const kind = commentKind(c.body)
    if (kind === 'minutes' && trusted(c)) {
      const base = { at: c.created_at, issue: issue.number, author: own(c) }
      out.push(point({ ...base, key: c.html_url, kind: 'minutes', agent: minutesSeat(c.body), title: `회의록: ${issue.title}` }))
      minutesDecisions(c.body).forEach((text, n) =>
        out.push(point({ ...base, key: `${c.html_url}#decision${n ? `-${n + 1}` : ''}`, kind: 'decision', agent: 0, title: gist(text) })),
      )
    } else if ((kind === 'request' || kind === 'result') && trusted(c, APPROVERS)) {
      const mine = ownerApprovals(commentsOf.get(issue.number) ?? [])
      const asked = kind === 'request' ? c : requestAnswered(c, mine)
      const who = /^\s*\*\*요청\*\*\s*[:：]?\s*(.+)$/m.exec(norm(asked?.body))
      out.push(
        point({
          key: c.html_url,
          at: c.created_at,
          kind: 'approval',
          agent: who ? seatIn(who[1].split('(')[0]) : null,
          title: `${kind === 'request' ? '결재 요청' : '결재'}: ${issue.title}`,
          ...(kind === 'result' ? { result: true } : {}),
          issue: issue.number,
          author: own(c),
        }),
      )
    }
  }

  // decision rows of the docs: dated, no time of day (the day's start in Korea; the project's dates are KST).
  // Keyed by the row's text, so an edited row is a new point; no file path in the key.
  const doc = { login: ownerLogin, association: 'OWNER' } // only trusted people can push to dev
  for (const text of docs) {
    for (const r of decisionRows(text)) {
      const hash = createHash('sha1').update(r.decision).digest('hex').slice(0, 8)
      out.push(point({ key: `https://github.com/${repo}/#decision-${r.date}-${hash}`, at: `${r.date}T00:00:00+09:00`, kind: 'decision', agent: 0, title: r.decision.replace(/\*\*/g, ''), author: doc }))
    }
  }

  // commits: landed on dev = work; reached main without being on dev (merge commits) = deploy
  const devShas = new Set(devCommits.map((c) => c.sha))
  const commitPoint = (c, kind) => {
    const title = firstLine(c.commit?.message)
    const refs = [...title.matchAll(/\(#(\d+)\)/g)].map((m) => Number(m[1]))
    const merge = MERGE_PR.exec(title)
    if (merge) refs.push(Number(merge[1]))
    const prNo = [...refs].reverse().find((n) => prBy.has(n))
    const pr = prBySha.get(c.sha) ?? (prNo === undefined ? null : prBy.get(prNo))
    let issue = refs.find((n) => issueBy.has(n)) ?? null
    if (issue === null && pr) {
      const m = CLOSES.exec(pr.body ?? '')
      if (m && issueBy.has(Number(m[1]))) issue = Number(m[1])
    }
    const login = String(c.author?.login ?? '')
    return point({
      key: c.html_url,
      at: c.commit?.committer?.date ?? c.commit?.author?.date,
      kind,
      agent: kind === 'work' && issue !== null ? issueSeat(issueBy.get(issue)).seat : null,
      title,
      additions: c.stats?.additions ?? null,
      deletions: c.stats?.deletions ?? null,
      files: Array.isArray(c.files) ? c.files.length : null,
      issue,
      pr: pr?.number ?? null,
      author: { login, association: logins[login.toLowerCase()] ?? 'NONE' },
    })
  }
  for (const c of devCommits) if ((c.parents?.length ?? 0) <= 1) out.push(commitPoint(c, 'work'))
  for (const c of mainCommits) if (!devShas.has(c.sha)) out.push(commitPoint(c, 'deploy'))
  return out
}

/** collected points → the sorted, filtered, unique list a copy / the server keeps */
export function build(data, cfg) {
  return mergePoints(collect(data).map((p) => finalize(p, cfg)).filter(Boolean))
}

/** the JSON copy: one point per line, so a rerun changes only what changed; no run time in it */
export function serialize(project, tier, points) {
  const head = `{\n  "version": 1,\n  "project": ${JSON.stringify(project)},\n  "tier": ${JSON.stringify(tier)},\n  "points": [`
  return `${head}${points.map((p) => `\n    ${JSON.stringify(p)}`).join(',')}${points.length ? '\n  ' : ''}]\n}\n`
}
