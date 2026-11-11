// Sending timelapse points to /api/timeline (#413): the push Action (event.mjs) and the backfill (backfill.mjs --send).
// The points are `collect` output (PointInput): the server checks the author, the tier and the words again, like /api/docs.

/** at most this many points per request (src/timeline/ingest.ts MAX_POINTS) */
export const BATCH = 100

/**
 * Where to send: OFFICE_TIMELINE_URL when it is set, else the docs endpoint's sibling (…/api/docs → …/api/timeline), so the
 * repository needs no secret of its own; null when neither gives an address.
 */
export function timelineUrl(env) {
  if (env.OFFICE_TIMELINE_URL) return env.OFFICE_TIMELINE_URL
  const docs = env.OFFICE_DOCS_URL
  if (!docs) return null
  const u = /\/api\/docs\/?$/.test(docs) ? docs.replace(/\/api\/docs\/?$/, '/api/timeline') : null
  return u
}

const REPO = /^[\w.-]+\/[\w.-]+$/
const KINDS = ['plan', 'work', 'minutes', 'approval', 'decision', 'deploy']
const nullable = (v) => v === null || v === undefined || (Number.isInteger(v) && v >= 0)
/**
 * The server's own shape check (src/timeline/points.ts parsePointInput): it refuses a whole batch for one bad point, so a
 * point it would refuse is left out here and counted instead of taking 99 good ones down with it.
 */
export function whyNot(p) {
  if (!p || typeof p !== 'object' || typeof p.project !== 'string' || !REPO.test(p.project)) return 'project'
  if (typeof p.key !== 'string' || p.key.length > 300 || !p.key.toLowerCase().startsWith(`https://github.com/${p.project.toLowerCase()}/`)) return 'key'
  if (typeof p.at !== 'string' || Number.isNaN(Date.parse(p.at))) return 'at'
  if (!KINDS.includes(p.kind)) return 'kind'
  if (![null, 0, 1, 2, 3, 4].includes(p.agent)) return `agent ${p.agent}`
  if (typeof p.title !== 'string' || p.title.length > 400) return 'title'
  if (![p.additions, p.deletions, p.files, p.issue, p.pr].every(nullable)) return 'numbers'
  if (p.result !== undefined && p.result !== true) return 'result'
  return p.author && typeof p.author.login === 'string' && typeof p.author.association === 'string' ? null : 'author'
}
export const acceptable = (p) => whyNot(p) === null

/** the points in request-sized pieces, in order */
export function batches(points, size = BATCH) {
  const out = []
  for (let i = 0; i < points.length; i += size) out.push(points.slice(i, i + size))
  return out
}

/** POST every batch of the acceptable points; throws on the first refused one (the token), returns the server's answers (+ `dropped`) */
export async function sendPoints(url, token, points, post = fetch) {
  const ok = points.filter(acceptable)
  const results = []
  if (ok.length < points.length) results.push({ dropped: points.length - ok.length, stored: 0, skipped: 0 })
  for (const b of batches(ok)) {
    const res = await post(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ points: b }),
    })
    if (!res.ok) throw new Error(`timeline ${res.status}: ${(await res.text()).slice(0, 200)}`)
    results.push(await res.json())
  }
  return results
}
