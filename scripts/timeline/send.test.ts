// #413: the push Action's and the backfill's way to /api/timeline (send.mjs), and what one event adds (event-points.mjs),
// with a fake GitHub client.
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { BATCH, acceptable, batches, sendPoints, timelineUrl, whyNot } from './send.mjs'
// @ts-expect-error plain JS module
import { pointsForEvent } from './event-points.mjs'

const REPO = 'Rowan-Hyeho-Song/agent-office'
const GH = `https://github.com/${REPO}`
const owner = { login: 'Rowan-Hyeho-Song', type: 'User' }

describe('where and how the points are sent', () => {
  it('the docs secret gives the address: …/api/docs → …/api/timeline; an explicit OFFICE_TIMELINE_URL wins; none → null', () => {
    expect(timelineUrl({ OFFICE_DOCS_URL: 'https://office.example/api/docs' })).toBe('https://office.example/api/timeline')
    expect(timelineUrl({ OFFICE_DOCS_URL: 'https://office.example/rooms/office/app/api/docs/' })).toBe('https://office.example/rooms/office/app/api/timeline')
    expect(timelineUrl({ OFFICE_TIMELINE_URL: 'https://t.example/x', OFFICE_DOCS_URL: 'https://office.example/api/docs' })).toBe('https://t.example/x')
    expect(timelineUrl({ OFFICE_DOCS_URL: 'https://office.example/elsewhere' })).toBeNull()
    expect(timelineUrl({})).toBeNull()
  })

  it('posts in batches of at most 100 with the token, and leaves out a point the server would refuse (it would refuse the whole batch)', async () => {
    const point = (n: number, extra = {}) => ({ key: `${GH}/commit/${n}`, project: REPO, at: '2026-11-11T00:00:00Z', kind: 'work', agent: 4, title: 't', additions: 1, deletions: 0, files: 1, issue: null, pr: null, author: { login: 'a', association: 'OWNER' }, ...extra })
    const pts = [...Array.from({ length: 205 }, (_, i) => point(i)), point(999, { agent: 5 }), point(998, { key: 'https://evil.example/x' })]
    expect(acceptable(point(1))).toBe(true)
    expect(whyNot(point(1, { agent: 5 }))).toBe('agent 5')
    expect(batches(pts.slice(0, 205)).map((b: unknown[]) => b.length)).toEqual([BATCH, BATCH, 5])
    const calls: { url: string; auth: string; n: number }[] = []
    const post = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      const n = JSON.parse(init.body).points.length
      calls.push({ url, auth: init.headers.authorization, n })
      return new Response(JSON.stringify({ ok: true, stored: n, skipped: 0 }), { status: 200 })
    }
    const res = await sendPoints('https://office.example/api/timeline', 'tok', pts, post)
    expect(calls.map((c) => c.n)).toEqual([100, 100, 5])
    expect(calls.every((c) => c.auth === 'Bearer tok' && c.url.endsWith('/api/timeline'))).toBe(true)
    expect(res.reduce((n: number, r: { dropped?: number }) => n + (r.dropped ?? 0), 0)).toBe(2)
  })

  it('a refused batch (a wrong token) stops the run with the status', async () => {
    const post = async () => new Response('unauthorized', { status: 401 })
    await expect(sendPoints('u', 't', [{ key: `${GH}/commit/1`, project: REPO, at: '2026-11-11T00:00:00Z', kind: 'work', agent: null, title: '', author: { login: 'a', association: 'OWNER' } }], post)).rejects.toThrow(/401/)
  })
})

/** a fake GitHub client over a few fixed answers */
function fakeGh(answers: Record<string, unknown>) {
  const seen: string[] = []
  const get = async (path: string) => {
    seen.push(path)
    if (!(path in answers)) throw new Error(`GitHub 404 ${path}`)
    return answers[path]
  }
  return { gh: { get, all: get }, seen }
}
const commit = (sha: string, title: string, parents = 1, files: string[] = []) => ({
  sha,
  html_url: `${GH}/commit/${sha}`,
  parents: Array.from({ length: parents }, (_, i) => ({ sha: `p${i}` })),
  commit: { message: `${title}\n\nbody`, committer: { date: '2026-11-11T01:00:00Z' } },
  author: owner,
  stats: { additions: 10, deletions: 2 },
  files: files.map((filename) => ({ filename })),
})
const issue = (n: number, extra = {}) => ({ number: n, html_url: `${GH}/issues/${n}`, title: `이슈 ${n}`, created_at: '2026-11-10T00:00:00Z', user: owner, author_association: 'OWNER', labels: [], body: '', ...extra })

describe('what one event adds (event-points.mjs)', () => {
  it('a push to dev: its non-merge commits become work points linked to their issue (through the PR that closes it); the merge commit is not one', async () => {
    const { gh } = fakeGh({
      [`/repos/${REPO}/compare/aaa...bbb`]: { commits: [{ sha: 'c1' }, { sha: 'm1' }] },
      [`/repos/${REPO}/commits/c1`]: commit('c1', 'fix: 도크 두 줄 (#406)'),
      [`/repos/${REPO}/commits/m1`]: commit('m1', "Merge branch 'x' into dev", 2),
      [`/repos/${REPO}/issues/406`]: { ...issue(406), pull_request: {} },
      [`/repos/${REPO}/pulls/406`]: { number: 406, body: 'Fixes #403', merged_at: '2026-11-11T01:00:00Z', merge_commit_sha: 'c1' },
      [`/repos/${REPO}/issues/403`]: issue(403),
      [`/repos/${REPO}/collaborators`]: [],
    })
    const pts = await pointsForEvent('push', { ref: 'refs/heads/dev', before: 'aaa', after: 'bbb' }, REPO, gh)
    expect(pts.map((p: { kind: string; key: string; issue: number; pr: number }) => [p.kind, p.key, p.issue, p.pr])).toEqual([['work', `${GH}/commit/c1`, 403, 406]])
    expect(pts.every(acceptable)).toBe(true)
  })

  it('a push to main: only the commits that are not on dev become deploy points', async () => {
    const { gh } = fakeGh({
      [`/repos/${REPO}/compare/aaa...bbb`]: { commits: [{ sha: 'd1' }, { sha: 'x1' }] },
      [`/repos/${REPO}/commits/d1`]: commit('d1', 'feat: on dev (#1)'),
      [`/repos/${REPO}/commits/x1`]: commit('x1', 'Merge pull request #2 from dev', 2),
      [`/repos/${REPO}/compare/dev...d1`]: { status: 'behind' },
      [`/repos/${REPO}/compare/dev...x1`]: { status: 'ahead' },
      [`/repos/${REPO}/collaborators`]: [],
    })
    const pts = await pointsForEvent('push', { ref: 'refs/heads/main', before: 'aaa', after: 'bbb' }, REPO, gh)
    expect(pts.map((p: { kind: string; key: string }) => [p.kind, p.key])).toEqual([['deploy', `${GH}/commit/x1`]])
  })

  it('a push to another branch, a deleted branch, or a comment on a pull request adds nothing', async () => {
    const { gh, seen } = fakeGh({})
    expect(await pointsForEvent('push', { ref: 'refs/heads/feature/1-x', before: 'a', after: 'b' }, REPO, gh)).toEqual([])
    expect(await pointsForEvent('push', { ref: 'refs/heads/dev', deleted: true }, REPO, gh)).toEqual([])
    expect(await pointsForEvent('issue_comment', { issue: { ...issue(5), pull_request: {} }, comment: { id: 1 } }, REPO, gh)).toEqual([])
    expect(seen).toEqual([])
  })

  it('an issue opened by the owner is a plan point (the same key as the backfill: the issue page)', async () => {
    const { gh } = fakeGh({})
    const pts = await pointsForEvent('issues', { action: 'opened', issue: issue(413) }, REPO, gh)
    expect(pts.map((p: { kind: string; key: string; issue: number }) => [p.kind, p.key, p.issue])).toEqual([['plan', `${GH}/issues/413`, 413]])
  })
})
