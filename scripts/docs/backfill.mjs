// One-off: file every existing issue, minutes / decision comment and merged PR of a repo into the office (#24).
//
//   node scripts/docs/backfill.mjs <owner/name> [--dry-run]
//   env GITHUB_TOKEN (or the gh CLI's login), OFFICE_DOCS_URL, OFFICE_DOCS_TOKEN (not needed for --dry-run)
//
// Same builders as the Action, so a backfilled document is the same row the Action would have made (it is
// keyed by its GitHub URL: running this twice updates, never duplicates). Prints the folder check the issue
// asks for: files = issues.

import { execFileSync } from 'node:child_process'
import { docForComment, docForIssue, docForPull, github, send } from './build.mjs'

const repo = process.argv[2]
const dry = process.argv.includes('--dry-run')
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('usage: node scripts/docs/backfill.mjs <owner/name> [--dry-run]')
  process.exit(2)
}
const ghToken = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const gh = github(ghToken)

const issues = (await gh.all(`/repos/${repo}/issues?state=all`)).filter((i) => !i.pull_request)
const comments = await gh.all(`/repos/${repo}/issues/comments`)
const pulls = await gh.all(`/repos/${repo}/pulls?state=closed`)

const byIssue = new Map(issues.map((i) => [i.number, i]))
const commentsOf = new Map()
for (const c of comments) {
  const n = Number(c.issue_url.split('/').pop())
  if (!commentsOf.has(n)) commentsOf.set(n, [])
  commentsOf.get(n).push(c)
}

const docs = [
  ...issues.map((i) => docForIssue(i, repo)),
  ...comments.map((c) => {
    const n = Number(c.issue_url.split('/').pop())
    return docForComment(c, byIssue.get(n), repo, commentsOf.get(n))
  }),
  ...pulls.map((p) => docForPull(p, repo)),
].filter(Boolean)

const count = (k) => docs.filter((d) => d.kind === k).length
const folders = new Set(docs.filter((d) => d.kind === 'plan').map((d) => d.folder))
console.log(`${repo}: ${issues.length} issues, ${comments.length} comments, ${pulls.length} closed PRs`)
console.log(`documents: plan ${count('plan')}, minutes ${count('minutes')}, decision ${count('decision')}, report ${count('report')}`)
console.log(`files (folders with a plan) ${folders.size} = issues ${issues.length}: ${folders.size === issues.length ? 'ok' : 'MISMATCH'}`)
const strays = docs.filter((d) => d.kind !== 'plan' && !folders.has(d.folder))
if (strays.length) console.log(`filed outside an issue (PRs without "Closes #n"): ${strays.map((d) => `${d.kind} #${d.folder}`).join(', ')}`)

if (dry) process.exit(0)
const { OFFICE_DOCS_URL: url, OFFICE_DOCS_TOKEN: token } = process.env
if (!url || !token) {
  console.error('OFFICE_DOCS_URL and OFFICE_DOCS_TOKEN are needed (or use --dry-run)')
  process.exit(2)
}
const project = { repo, open_issues: issues.filter((i) => i.state === 'open').length }
const results = await send(url, token, docs, project)
console.log(`sent ${results.reduce((n, r) => n + r.stored, 0)} documents in ${results.length} batches`)
