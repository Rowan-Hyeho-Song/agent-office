// GitHub item → office document input (#24, plan.md 6.1–6.2). Pure; shared by the Action (event.mjs) and the
// one-off backfill (backfill.mjs). No dependencies: the Action runs it with plain `node`.
//
//   issue (opened / edited / closed …)            → plan      (file = the issue)
//   comment "### 🗂 에이전트 간 협의 기록"        → minutes
//   comment "### ✅ 결재" answering a 결정 요청     → decision  (the 🖊 request body rides along in meta.request)
//   merged pull request                           → report    (file = the issue it closes, else the PR)
// Comments on pull requests and every other comment are not documents.
// A plan carries meta.progress (#241): stage (waiting / doing / review / done), 완료 기준 checkbox count, pending 🖊 count.
//
// Who may file (#38): this is a public repo, so anyone with a GitHub account can open issues and comment.
// Only the owner's and collaborators' items become documents; approvals (🖊 requests, ✅ results) only the
// owner's. Everything else is skipped here, and /api/docs checks the same again.

/** @typedef {import('../../src/docs/types').DocInput} DocInput */

/** author_association values whose issues, comments and PRs become documents */
export const TRUSTED = ['OWNER', 'COLLABORATOR']
/** author_association values whose 🖊 / ✅ count: the owner's account (the sessions write as the owner) */
export const APPROVERS = ['OWNER']

const association = (item) => String(item?.author_association ?? 'NONE').toUpperCase()
/** @param {any} item  issue, comment or PR @param {string[]} [allowed] */
export const trusted = (item, allowed = TRUSTED) => allowed.includes(association(item))
const author = (item) => ({ login: String(item?.user?.login ?? ''), association: association(item) })

const MINUTES = /^\s*###\s*🗂\s*에이전트 간 협의 기록/m
const RESULT = /^\s*###\s*✅\s*결재/m
const REQUEST = /^\s*###\s*🖊\s*결재 요청/m
/** a closing keyword in a PR body: "Closes #12" (the PR template's first line) */
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/i
const REFS = /\b(?:refs?|related(?: to)?|part of)\s*:?\s*#(\d+)/i

/** @param {string} body */
export function commentKind(body) {
  const text = String(body ?? '')
  if (MINUTES.test(text)) return 'minutes'
  if (RESULT.test(text)) return 'result'
  if (REQUEST.test(text)) return 'request'
  return null
}

/** @param {string} body */
const isDecisionRequest = (body) => /\*\*종류\*\*\s*:?\s*결정 요청/.test(body)

/**
 * @param {any} issue  GitHub issue object (REST or event payload)
 * @param {string} repo  "owner/name"
 * @param {Progress} [progress]  progressFor(...) of this issue; a plan without it shows no status in the library
 * @returns {DocInput | null}
 */
export function docForIssue(issue, repo, progress) {
  if (!issue || issue.pull_request || !trusted(issue)) return null
  return {
    kind: 'plan',
    repo,
    folder: issue.number,
    title: issue.title ?? '',
    body: issue.body ?? '',
    author: author(issue),
    source: { kind: 'issue', url: issue.html_url },
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    meta: {
      state: issue.state,
      closed_at: issue.closed_at ?? null,
      labels: (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)),
      ...(progress ? { progress } : {}),
    },
  }
}

// ---- progress (#241, docs/design/docs-ui.md 2.5) -------------------------------------------------------------------

/** @typedef {{ stage: 'waiting' | 'doing' | 'review' | 'done', checks: { done: number, total: number } | null, pending: number }} Progress */

/** the 완료 기준 task-list items of an issue body: `- [ ]` / `- [x]` (also `*`, `+`, `1.`), nested too; not those in code fences or HTML comments */
export function countChecks(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '')
  let done = 0
  let total = 0
  let fence = null
  for (const line of text.split('\n')) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence) continue
    const m = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+\S/.exec(line)
    if (!m) continue
    total++
    if (m[1] !== ' ') done++
  }
  return total ? { done, total } : null
}

/** how many 🖊 requests of the owner have no ✅ yet (the pairing of requestAnswered: a result takes the oldest request still waiting) */
export function pendingApprovals(comments) {
  const timeline = ownerApprovals(comments).filter((c) => ['request', 'result'].includes(commentKind(c.body)))
  timeline.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
  let waiting = 0
  for (const c of timeline) {
    if (commentKind(c.body) === 'request') waiting++
    else if (waiting) waiting--
  }
  return waiting
}

const globalRe = (re) => new RegExp(re.source, 'gi')
/** every issue number a PR body names with a closing keyword / with Refs */
export function mentions(body) {
  const text = String(body ?? '')
  const nums = (re) => [...text.matchAll(globalRe(re))].map((m) => Number(m[1]))
  return { closes: nums(CLOSES), refs: nums(REFS) }
}
/** the issue number in a branch name like `feature/241-library-progress` */
export const branchIssue = (name) => {
  const m = /^[\w.-]+\/(\d+)-/.exec(String(name ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Which of the repo's pull requests belong to issue n: the body has a closing keyword or Refs for it, or the head
 * branch is `<type>/<n>-…`. Only the owner's and collaborators' PRs count: a stranger's "Closes #n" cannot move the stage.
 * @returns {{ pr: any, closes: boolean }[]}
 */
export function linkedPulls(n, prs) {
  const out = []
  for (const pr of prs ?? []) {
    if (!pr || !trusted(pr)) continue
    const m = mentions(pr.body)
    const byBranch = branchIssue(pr.head?.ref) === n
    if (m.closes.includes(n) || m.refs.includes(n) || byBranch) out.push({ pr, closes: m.closes.includes(n) || byBranch })
  }
  return out
}

/**
 * The stage of an issue and how far along it is. Pure.
 *   done    the issue is closed (only then: a merged PR does not finish an issue that is still open, #462)
 *   review  an open linked PR that is not a draft. A draft is still being worked on, so it counts as doing
 *   doing   a branch `<type>/<n>-…` exists, or an open draft PR, or a merged PR (closing it or only refs)
 *   waiting otherwise
 * A done one also says when (`doneAt`, #462): the issue's closed_at.
 * A work-issue declaration (#182) is a file on the session's PC, invisible to GitHub, so it is not read here.
 * An open review PR beats an earlier merged one (the issue got a second PR); a closed issue beats everything.
 * @param {any} issue
 * @param {{ prs?: any[], branches?: (string | { name: string })[], comments?: any[] }} [ctx]  every PR of the repo (any state), the branch names, the issue's comments
 * @returns {Progress}
 */
export function progressFor(issue, { prs = [], branches = [], comments = [] } = {}) {
  const n = issue.number
  const linked = linkedPulls(n, prs)
  const open = linked.filter((l) => l.pr.state === 'open' && !l.pr.merged_at)
  const merged = linked.filter((l) => l.pr.merged_at)
  const hasBranch = branches.some((b) => branchIssue(typeof b === 'string' ? b : b?.name) === n)
  // done only when the issue is closed (#462 designer: a merged PR that closes it, while the issue stays open, is still work in hand)
  let stage = 'waiting'
  if (issue.state === 'closed') stage = 'done'
  else if (open.some((l) => !l.pr.draft)) stage = 'review'
  else if (hasBranch || open.length || merged.length) stage = 'doing'
  // #462: when it was done (the library groups done files by the first deploy after this)
  const doneAt = stage === 'done' ? (issue.closed_at ?? null) : null
  return { stage, checks: countChecks(issue.body), pending: pendingApprovals(comments), ...(doneAt ? { doneAt } : {}) }
}

/** what progressFor needs for one issue, from GitHub (three list calls) */
export async function progressOf(gh, repo, issue, comments) {
  const [prs, branches, all] = await Promise.all([
    gh.all(`/repos/${repo}/pulls?state=all`),
    gh.all(`/repos/${repo}/branches`),
    comments ?? gh.all(`/repos/${repo}/issues/${issue.number}/comments`),
  ])
  return progressFor(issue, { prs, branches, comments: all })
}

/**
 * Which 🖊 request a ✅ result answers. Requests are answered in order: walking the issue's comments by time,
 * each result takes the oldest request still waiting (three requests then three results pair up 1-1, 2-2, 3-3).
 * @param {{ body: string, created_at: string, html_url?: string }} result
 * @param {{ body: string, created_at: string, html_url?: string }[]} comments  the issue's comments (any order)
 */
export function requestAnswered(result, comments) {
  const timeline = [...comments]
  if (!timeline.some((c) => c.html_url && c.html_url === result.html_url)) timeline.push(result)
  timeline.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
  const waiting = []
  for (const c of timeline) {
    const kind = commentKind(c.body)
    if (kind === 'request') waiting.push(c)
    else if (kind === 'result') {
      const answered = waiting.shift() ?? null
      if (c === result || (c.html_url && c.html_url === result.html_url)) return answered
    }
  }
  return null
}

/**
 * @param {any} comment  GitHub issue comment
 * @param {any} issue  the issue it belongs to
 * @param {string} repo
 * @param {{ body: string, created_at: string }[]} [earlier]  the issue's other comments (for a ✅ result: which request it answers)
 * @returns {DocInput | null}
 */
export function docForComment(comment, issue, repo, earlier = []) {
  if (!comment || !issue || issue.pull_request) return null
  const kind = commentKind(comment.body)
  const base = {
    repo,
    folder: issue.number,
    body: comment.body ?? '',
    author: author(comment),
    source: { kind: 'comment', url: comment.html_url },
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  }
  if (kind === 'minutes') return trusted(comment) ? { ...base, kind: 'minutes', title: `회의록: ${issue.title}` } : null
  if (kind === 'result') {
    if (!trusted(comment, APPROVERS)) return null
    // pair with the owner's requests and results only: someone else's 🖊 / ✅ can't shift the order
    const request = requestAnswered(comment, ownerApprovals(earlier))
    // only a 결정 요청 makes a decision document
    if (!request || !isDecisionRequest(request.body)) return null
    return { ...base, kind: 'decision', title: `결정: ${issue.title}`, meta: { request: request.body, requestAuthor: author(request) } }
  }
  return null
}

/** the issue's comments that count for approvals (the owner's) */
export const ownerApprovals = (comments) => comments.filter((c) => trusted(c, APPROVERS))

/**
 * @param {any} pr  GitHub pull request
 * @param {string} repo
 * @returns {DocInput | null}
 */
export function docForPull(pr, repo) {
  if (!pr?.merged_at || !trusted(pr)) return null
  // the file is the issue it closes, else the one it refers to ("Refs #28"), else the PR itself
  const linked = CLOSES.exec(pr.body ?? '') ?? REFS.exec(pr.body ?? '')
  return {
    kind: 'report',
    repo,
    folder: linked ? Number(linked[1]) : pr.number,
    title: pr.title ?? '',
    body: pr.body ?? '',
    author: author(pr),
    source: { kind: 'pr', url: pr.html_url },
    created_at: pr.created_at,
    updated_at: pr.merged_at,
    meta: { pr: pr.number, merged_at: pr.merged_at },
  }
}

/**
 * 🖊 requests and ✅ results for the approval box (#25). A request becomes a pending approval; a result closes
 * the request it answers (written by the office's /api/approve or by the owner directly on GitHub; both are the
 * owner's account). Only the owner's 🖊 / ✅ count (#38), and a result only pairs with the owner's requests.
 * @param {any} comment
 * @param {any} issue
 * @param {string} repo
 * @param {{ body: string, created_at: string, html_url?: string }[]} [comments]  the issue's comments (for a result)
 */
export function approvalForComment(comment, issue, repo, comments = []) {
  if (!comment || !issue || issue.pull_request || !trusted(comment, APPROVERS)) return null
  const kind = commentKind(comment.body)
  if (kind !== 'request' && kind !== 'result') return null
  const base = {
    repo,
    folder: issue.number,
    url: comment.html_url,
    title: issue.title ?? '',
    body: comment.body ?? '',
    author: author(comment),
    created_at: comment.created_at,
    updated_at: comment.updated_at,
  }
  if (kind === 'request') return { type: 'request', ...base }
  return { type: 'result', ...base, answers: requestAnswered(comment, ownerApprovals(comments))?.html_url ?? null }
}

/**
 * POST documents (and approvals) to /api/docs in batches.
 * @param {string} url
 * @param {string} token
 * @param {DocInput[]} docs
 * @param {{ repo: string, open_issues: number }} [project]
 * @param {any[]} [approvals]  approvalForComment results, in batches of their own
 */
export async function send(url, token, docs, project, approvals = []) {
  const batches = []
  for (let i = 0; i < docs.length; i += 50) batches.push({ docs: docs.slice(i, i + 50) })
  for (let i = 0; i < approvals.length; i += 50) batches.push({ docs: [], approvals: approvals.slice(i, i + 50) })
  if (!batches.length) batches.push({ docs: [] }) // nothing to file, but the project count may still change
  const results = []
  for (const [n, batch] of batches.entries()) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...batch, ...(n === 0 && project ? { project } : {}) }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`/api/docs ${res.status}: ${text}`)
    results.push(JSON.parse(text))
  }
  return results
}

/**
 * Minimal GitHub REST client (token from the Action or `gh auth token`).
 * @param {string} token
 */
export function github(token) {
  const get = async (path) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://api.github.com${path}`, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
      })
      if (res.ok) return res.json()
      // rate limited (429, or 403 with nothing left): wait as GitHub says, at most a minute, then retry a few times
      const limited = res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
      if (!limited || attempt >= 3) throw new Error(`GitHub ${res.status} ${path}`)
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now()
      const wait = Number(res.headers.get('retry-after')) * 1000 || reset || 5000
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1000), 60_000)))
    }
  }
  return {
    get,
    /** every page of a list endpoint */
    async all(path) {
      const out = []
      for (let page = 1; ; page++) {
        const sep = path.includes('?') ? '&' : '?'
        const items = await get(`${path}${sep}per_page=100&page=${page}`)
        out.push(...items)
        if (items.length < 100) return out
      }
    },
    /** open issues only (the repo's open_issues_count also counts pull requests) */
    async openIssues(repo) {
      const r = await get(`/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue is:open`)}&per_page=1`)
      return r.total_count
    },
  }
}
