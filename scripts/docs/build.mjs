// GitHub item → office document input (#24, plan.md 6.1–6.2). Pure; shared by the Action (event.mjs) and the
// one-off backfill (backfill.mjs). No dependencies: the Action runs it with plain `node`.
//
//   issue (opened / edited / closed …)            → plan      (file = the issue)
//   comment "### 🗂 에이전트 간 협의 기록"        → minutes
//   comment "### ✅ 결재" answering a 결정 요청     → decision  (the 🖊 request body rides along in meta.request)
//   merged pull request                           → report    (file = the issue it closes, else the PR)
// Comments on pull requests and every other comment are not documents.
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
 * @returns {DocInput | null}
 */
export function docForIssue(issue, repo) {
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
    },
  }
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
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' },
    })
    if (!res.ok) throw new Error(`GitHub ${res.status} ${path}`)
    return res.json()
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
