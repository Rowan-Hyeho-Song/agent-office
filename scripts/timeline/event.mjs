// The GitHub Action step (.github/workflows/timeline.yml, #413): this event → timelapse points → /api/timeline.
// Env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_TOKEN (set by Actions, read-only),
//      OFFICE_DOCS_URL, OFFICE_DOCS_TOKEN (the docs pipeline's repository secrets; the address is the docs one's sibling,
//      or OFFICE_TIMELINE_URL when set). Without them it does nothing and succeeds. What each event adds: event-points.mjs.

import { readFileSync } from 'node:fs'
import { github } from '../docs/build.mjs'
import { pointsForEvent } from './event-points.mjs'
import { sendPoints, timelineUrl } from './send.mjs'

const { GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: ghToken, OFFICE_DOCS_TOKEN: token } = process.env
const url = timelineUrl(process.env)

if (!url || !token) {
  console.log('office timeline: no timeline address (OFFICE_DOCS_URL) or OFFICE_DOCS_TOKEN, skipping')
  process.exit(0)
}

const event = JSON.parse(readFileSync(path, 'utf8'))
const points = await pointsForEvent(name, event, repo, github(ghToken))
if (!points.length) {
  console.log(`office timeline: ${name} adds no points`)
  process.exit(0)
}
const results = await sendPoints(url, token, points)
const kinds = Object.entries(points.reduce((m, p) => ((m[p.kind] = (m[p.kind] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`)
console.log(`office timeline: ${kinds.join(', ')} → stored ${results.reduce((n, r) => n + (r.stored ?? 0), 0)}, skipped ${results.reduce((n, r) => n + (r.skipped ?? 0), 0)}, left out (shape) ${results.reduce((n, r) => n + (r.dropped ?? 0), 0)}`)
