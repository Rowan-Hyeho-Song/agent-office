// What one GitHub event adds to the timelapse (#413, plan.md 6.7): the same `collect` as the backfill, fed with just this
// event's part of the history. Pure apart from `gh` (the docs pipeline's client: get / all), so it is unit tested with a fake.
//   push to dev   its non-merge commits → work points (+ the decision rows of the docs/**.md it touched)
//   push to main  its commits that are not on dev → deploy points
//   issues        opened / edited → the plan point
//   issue_comment created / edited on an issue → minutes (+ decisions) or an approval point
// Keys are the same as the backfill's, so a point sent twice (or by both) stays one.

import { collect } from './build.mjs'

const ZERO = /^0+$/
const REFS = /#(\d+)\b/g
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi

/** the owner and the collaborators (commits carry no author_association); only the owner when the list is not readable */
async function trustedLogins(repo, gh) {
  const [owner] = repo.split('/')
  const logins = { [owner]: 'OWNER' }
  try {
    for (const c of await gh.all(`/repos/${repo}/collaborators`)) if (c.login.toLowerCase() !== owner.toLowerCase()) logins[c.login] = 'COLLABORATOR'
  } catch {
    // the Action's token may not list collaborators: the owner's commits still count
  }
  return logins
}

/** the issues and PRs a set of commit titles point at, plus the issues those PRs close (for the work point's issue and seat) */
async function linked(repo, gh, titles) {
  const issues = new Map()
  const pulls = new Map()
  const want = new Set(titles.flatMap((t) => [...t.matchAll(REFS)].map((m) => Number(m[1]))))
  const fetchIssue = async (n) => {
    if (issues.has(n) || pulls.has(n)) return
    let it
    try {
      it = await gh.get(`/repos/${repo}/issues/${n}`)
    } catch {
      return
    }
    if (!it.pull_request) return void issues.set(n, it)
    const pr = await gh.get(`/repos/${repo}/pulls/${n}`)
    pulls.set(n, pr)
    for (const m of (pr.body ?? '').matchAll(CLOSES)) await fetchIssue(Number(m[1]))
  }
  for (const n of want) await fetchIssue(n)
  return { issues: [...issues.values()], pulls: [...pulls.values()] }
}

/** every commit a push brought: the compare range when there is a `before`, else the payload's list (a new branch) */
async function pushedShas(repo, gh, event) {
  if (event.before && !ZERO.test(event.before) && event.after && !ZERO.test(event.after)) {
    const cmp = await gh.get(`/repos/${repo}/compare/${event.before}...${event.after}`)
    return cmp.commits.map((c) => c.sha)
  }
  return (event.commits ?? []).map((c) => c.id)
}

/** is this commit on dev (dev contains it) */
async function onDev(repo, gh, sha) {
  const cmp = await gh.get(`/repos/${repo}/compare/dev...${sha}`)
  return cmp.status === 'behind' || cmp.status === 'identical'
}

/**
 * The collect input for one event, or null when the event adds nothing.
 * @param {string} name GITHUB_EVENT_NAME
 * @param {any} event the payload
 * @param {string} repo owner/name
 * @param {{ get: (p: string) => Promise<any>, all: (p: string) => Promise<any[]> }} gh
 */
export async function dataForEvent(name, event, repo, gh) {
  const [owner] = repo.split('/')
  const base = { repo, owner, issues: [], comments: [], pulls: [], devCommits: [], mainCommits: [], docs: [] }

  if (name === 'push') {
    const branch = /^refs\/heads\/(dev|main)$/.exec(event.ref ?? '')?.[1]
    if (!branch || event.deleted) return null
    const shas = await pushedShas(repo, gh, event)
    if (!shas.length) return null
    const details = []
    for (const sha of shas) {
      const c = await gh.get(`/repos/${repo}/commits/${sha}`)
      if (branch === 'dev' ? (c.parents?.length ?? 0) <= 1 : !(await onDev(repo, gh, sha))) details.push(c)
    }
    if (!details.length) return null
    const { issues, pulls } = await linked(repo, gh, details.map((c) => (c.commit?.message ?? '').split('\n')[0]))
    const data = { ...base, issues, pulls, logins: await trustedLogins(repo, gh) }
    if (branch === 'main') return { ...data, mainCommits: details }
    // the decision tables of the docs this push touched, as they are at its head (a row's key is its text: re-sending is harmless)
    const paths = [...new Set(details.flatMap((c) => (c.files ?? []).map((f) => f.filename)).filter((p) => /^docs\/.+\.md$/.test(p)))].sort()
    const docs = []
    for (const p of paths) {
      try {
        const f = await gh.get(`/repos/${repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${event.after}`)
        docs.push(Buffer.from(f.content ?? '', 'base64').toString('utf8'))
      } catch {
        // removed by this push: no rows
      }
    }
    return { ...data, devCommits: details, docs }
  }

  if (name === 'issues') {
    if (!event.issue || event.issue.pull_request) return null
    return { ...base, issues: [event.issue] }
  }

  if (name === 'issue_comment') {
    if (!event.issue || event.issue.pull_request || !event.comment) return null
    // an approval result is matched to its request among the issue's comments
    const comments = await gh.all(`/repos/${repo}/issues/${event.issue.number}/comments`)
    const others = comments.filter((c) => c.id !== event.comment.id)
    const data = { ...base, issues: [event.issue], comments: [...others, event.comment] }
    // only this comment's points (the others are context): same keys as the backfill's
    return { ...data, only: event.comment.html_url }
  }

  return null
}

/** the points one event adds (PointInput, unfiltered: the server filters) */
export async function pointsForEvent(name, event, repo, gh) {
  const data = await dataForEvent(name, event, repo, gh)
  if (!data) return []
  const points = collect(data)
  // a comment event sends only its own points (minutes + its decision lines, or the approval), not its neighbours'
  if (data.only) return points.filter((p) => p.key === data.only || p.key.startsWith(`${data.only}#`))
  // a push sends its commits (and the decision rows of the docs it touched); the issues it fetched are only for linking
  if (name === 'push') return points.filter((p) => p.kind === 'work' || p.kind === 'deploy' || p.kind === 'decision')
  // an issue event: the plan point (collect makes nothing else from an issue alone)
  return points
}
