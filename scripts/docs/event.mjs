// The GitHub Action step (.github/workflows/docs.yml): this event → documents → /api/docs.
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN (set by Actions, read-only),
//      OFFICE_DOCS_URL, OFFICE_DOCS_TOKEN (repository secrets). Without the secrets it does nothing and succeeds,
//      so the workflow is harmless before the office is deployed. What each event files: event-docs.mjs.

import { readFileSync } from 'node:fs'
import { github, send } from './build.mjs'
import { docsForEvent } from './event-docs.mjs'

const { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: ghToken } = process.env
const { OFFICE_DOCS_URL: url, OFFICE_DOCS_TOKEN: token } = process.env

if (!url || !token) {
  console.log('office docs: OFFICE_DOCS_URL / OFFICE_DOCS_TOKEN not set, skipping')
  process.exit(0)
}

const event = JSON.parse(readFileSync(path, 'utf8'))
const { docs, approvals, project } = await docsForEvent(name, event, repo, github(ghToken))
if (!docs.length && !approvals.length && !project) {
  console.log(`office docs: ${name} is not a document, nothing to send`)
  process.exit(0)
}
const results = await send(url, token, docs, project, approvals)
const what = [...docs.map((d) => `${d.kind} #${d.folder}`), ...approvals.map((a) => `approval ${a.type} #${a.folder}`)]
console.log(`office docs: ${what.join(', ') || 'no documents'} → ${JSON.stringify(results)}`)
