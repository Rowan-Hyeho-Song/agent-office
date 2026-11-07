// The GitHub Action step (.github/workflows/docs.yml): this event → documents → /api/docs.
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN (set by Actions),
//      OFFICE_DOCS_URL, OFFICE_DOCS_TOKEN (repository secrets). Without the secrets it does nothing and succeeds,
//      so the workflow is harmless before the office is deployed.

import { readFileSync } from 'node:fs'
import { docForComment, docForIssue, docForPull, github, send } from './build.mjs'

const { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: ghToken } = process.env
const { OFFICE_DOCS_URL: url, OFFICE_DOCS_TOKEN: token } = process.env

if (!url || !token) {
  console.log('office docs: OFFICE_DOCS_URL / OFFICE_DOCS_TOKEN not set, skipping')
  process.exit(0)
}

const event = JSON.parse(readFileSync(path, 'utf8'))
const gh = github(ghToken)
let docs = []
let project

if (name === 'issues') {
  docs = [docForIssue(event.issue, repo)]
  project = { repo, open_issues: await gh.openIssues(repo) }
} else if (name === 'issue_comment') {
  const earlier = /✅/.test(event.comment.body ?? '') ? await gh.all(`/repos/${repo}/issues/${event.issue.number}/comments`) : []
  docs = [docForComment(event.comment, event.issue, repo, earlier)]
} else if (name === 'pull_request') {
  docs = [docForPull(event.pull_request, repo)]
}

docs = docs.filter(Boolean)
if (!docs.length && !project) {
  console.log(`office docs: ${name} is not a document, nothing to send`)
  process.exit(0)
}
const [result] = await send(url, token, docs, project)
console.log(`office docs: ${docs.map((d) => `${d.kind} #${d.folder}`).join(', ') || 'no documents'} → ${JSON.stringify(result)}`)
