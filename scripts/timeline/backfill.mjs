// One-off: collect a repo's whole history into timelapse points (#81, plan.md 6.7) as a JSON copy.
//
//   GITHUB_TOKEN=$(gh auth token) node scripts/timeline/backfill.mjs <owner/name> [--dry-run] [--out file | --send]
//   env  GITHUB_TOKEN (or the gh CLI's login; never printed or written)
//        OFFICE_PUBLIC_REPOS   comma separated public repos (default: this one); everything else is review
//        OFFICE_PRIVATE_REPOS  comma separated private repos: nothing is collected
//        OFFICE_BANNED_WORDS   words to hide, same as /api/docs
//   --dry-run  only the summary (points per kind, attribution), no file
//   --out      where to write the JSON (default: stdout when not --dry-run)
//   --send     POST the collected points to /api/timeline instead (#413, the Actions backfill): needs OFFICE_DOCS_URL (its
//              sibling …/api/timeline is used, or OFFICE_TIMELINE_URL) and OFFICE_DOCS_TOKEN. The server filters them again;
//              keys are stable, so a second run only rewrites the same rows
//
// Same input, same output: sorted, no run time, one point per line. Reuses the docs pipeline's GitHub client and
// author rule (scripts/docs/build.mjs).

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { github } from '../docs/build.mjs'
import { POINT_KINDS, build, collect, serialize, tierFor } from './build.mjs'
import { acceptable, sendPoints, timelineUrl, whyNot } from './send.mjs'

const args = process.argv.slice(2)
const repo = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out')
const dry = args.includes('--dry-run')
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
const sending = args.includes('--send')
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || (args.includes('--out') && !out) || (sending && out)) {
  console.error('usage: node scripts/timeline/backfill.mjs <owner/name> [--dry-run] [--out file | --send]')
  process.exit(2)
}
const list = (v) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const cfg = {
  publicRepos: list(process.env.OFFICE_PUBLIC_REPOS ?? 'Rowan-Hyeho-Song/agent-office'),
  privateRepos: list(process.env.OFFICE_PRIVATE_REPOS),
  banned: list(process.env.OFFICE_BANNED_WORDS),
}
const tier = tierFor(repo, cfg)
// a private repo is not even read
if (tier === 'private') {
  console.error(`${repo}: private, nothing collected`)
  if (out && !dry) writeFileSync(out, serialize(repo, 'review', []))
  process.exit(0)
}

const ghToken = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
const gh = github(ghToken)
const log = (s) => console.error(s)

const [owner] = repo.split('/')
const issues = await gh.all(`/repos/${repo}/issues?state=all`)
const comments = await gh.all(`/repos/${repo}/issues/comments`)
const pulls = await gh.all(`/repos/${repo}/pulls?state=all`)

// who may file (#38): the owner and the collaborators; commits carry no author_association, so match by login
const logins = { [owner]: 'OWNER' }
try {
  for (const c of await gh.all(`/repos/${repo}/collaborators`)) if (c.login.toLowerCase() !== owner.toLowerCase()) logins[c.login] = 'COLLABORATOR'
} catch {
  log('collaborators not readable: only the owner counts')
}

const branch = async (name) => {
  try {
    return await gh.all(`/repos/${repo}/commits?sha=${name}`)
  } catch {
    return []
  }
}
const devList = await branch('dev')
const mainList = await branch('main')
const devShas = new Set(devList.map((c) => c.sha))
// per-commit details (line and file counts), only for the commits that become points: not merges on dev, main-only on main
const detail = async (c) => gh.get(`/repos/${repo}/commits/${c.sha}`)
const devCommits = []
for (const c of devList) devCommits.push((c.parents?.length ?? 0) <= 1 ? await detail(c) : c)
const mainCommits = []
for (const c of mainList) mainCommits.push(devShas.has(c.sha) ? c : await detail(c))

// decision tables in docs/**.md on dev (read as text here, only the table rows leave this script)
const docs = []
try {
  const tree = await gh.get(`/repos/${repo}/git/trees/dev?recursive=1`)
  for (const f of tree.tree.filter((t) => t.type === 'blob' && /^docs\/.+\.md$/.test(t.path)).sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const blob = await gh.get(`/repos/${repo}/git/blobs/${f.sha}`)
    docs.push(Buffer.from(blob.content, 'base64').toString('utf8'))
  }
} catch {
  log('no docs read from dev')
}

const data = { repo, owner, issues, comments, pulls, devCommits, mainCommits, docs, logins }
const points = build(data, cfg)
const json = serialize(repo, tier, points)

const per = Object.fromEntries(POINT_KINDS.map((k) => [k, points.filter((p) => p.kind === k)]))
const nulls = (ps) => ps.filter((p) => p.agent === null).length
log(`${repo} (${tier}): ${points.length} points, ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB`)
for (const k of POINT_KINDS) log(`  ${k.padEnd(8)} ${String(per[k].length).padStart(3)}   agent null ${nulls(per[k])}`)
log(`  attributed ${points.length - nulls(points)} / ${points.length}; secret (no title) ${points.filter((p) => p.secret).length}`)
log(`  seats: ${[0, 1, 2, 3, 4].map((s) => `${s}=${points.filter((p) => p.agent === s).length}`).join(' ')}`)

// what --send would post: every collected point the server's shape check takes (it filters authors / tiers / words itself)
const raw = collect(data)
const out_ = raw.filter((p) => !acceptable(p))
log(`  to send: ${raw.length} collected, ${out_.length} left out by the shape check`)
// the key and the reason only (no titles: the Actions log is public)
for (const p of out_) log(`    left out: ${p.kind} ${whyNot(p)} ${p.key}`)
if (dry) process.exit(0)
if (sending) {
  const url = timelineUrl(process.env)
  const token = process.env.OFFICE_DOCS_TOKEN
  if (!url || !token) {
    console.error('--send needs OFFICE_DOCS_URL (…/api/docs) or OFFICE_TIMELINE_URL, and OFFICE_DOCS_TOKEN')
    process.exit(2)
  }
  // the unfiltered points: the server makes the same cut as `build` above (author, tier, words)
  const results = await sendPoints(url, token, raw)
  log(`sent ${raw.length} points in ${results.length} batches: stored ${results.reduce((n, r) => n + (r.stored ?? 0), 0)}, skipped ${results.reduce((n, r) => n + (r.skipped ?? 0), 0)}, left out (shape) ${results.reduce((n, r) => n + (r.dropped ?? 0), 0)}`)
  process.exit(0)
}
if (out) writeFileSync(out, json)
else process.stdout.write(json)
