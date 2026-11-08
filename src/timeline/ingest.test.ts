import { describe, expect, it } from 'vitest'
import { handle, type TimelineStore } from './ingest'
import { mergePoints, parsePointInput } from './points'
import type { Point, PointInput, TimelineFile } from './types'

const PUB = 'Rowan-Hyeho-Song/agent-office'
const REV = 'Rowan-Hyeho-Song/rowansong.dev'
const cfg = { token: 'secret-token', publicRepos: [PUB], privateRepos: ['Rowan-Hyeho-Song/work'], banned: ['Acme'] }

const input = (over: Partial<PointInput> = {}): PointInput => ({
  key: `https://github.com/${PUB}/commit/abc`, project: PUB, at: '2026-11-08T05:00:00Z', kind: 'work', agent: 3, title: 'feat: 하나 (#1)',
  additions: 3, deletions: 1, files: 2, issue: 1, pr: 4, author: { login: 'Rowan-Hyeho-Song', association: 'OWNER' }, ...over,
})

function setup() {
  const rows: Point[] = []
  const store: TimelineStore = { upsert: async (r) => void rows.push(...r) }
  const post = (points: unknown[], token = cfg.token) =>
    handle(new Request('http://x/api/timeline', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ points }) }), store, cfg)
  return { rows, post }
}

describe('/api/timeline handler', () => {
  it('rejects a wrong token and a non-POST', async () => {
    const { post, rows } = setup()
    expect((await post([input()], 'nope')).status).toBe(401)
    expect(rows).toHaveLength(0)
    expect((await handle(new Request('http://x', { method: 'GET' }), { upsert: async () => {} }, cfg)).status).toBe(405)
  })
  it('stores a public point with its title, and never the author', async () => {
    const { post, rows } = setup()
    const res = await post([input()])
    expect(await res.json()).toMatchObject({ ok: true, stored: 1, skipped: 0 })
    expect(rows[0]).toMatchObject({ tier: 'public', secret: false, title: 'feat: 하나 (#1)', agent: 3 })
    expect(rows[0]).not.toHaveProperty('author')
  })
  it('review repo: no title, no address, no numbers, secret; sizes stay', async () => {
    const { post, rows } = setup()
    await post([input({ project: REV, key: `https://github.com/${REV}/commit/abc`, title: 'secret plan C:\\x\\y.ts' })])
    expect(rows[0]).toMatchObject({ tier: 'review', secret: true, title: '', additions: 3, issue: null, pr: null })
    expect(rows[0].key).toMatch(/^review:[\w./-]+:[0-9a-f]{16}$/)
    expect(JSON.stringify(rows[0])).not.toMatch(/github\.com|abc/)
  })
  it('a filter hit or banned word lowers a public point to review', async () => {
    const { post, rows } = setup()
    await post([input({ title: 'mail me@example.com' }), input({ key: `https://github.com/${PUB}/commit/b`, title: 'for Acme' })])
    expect(rows.map((r) => [r.tier, r.title])).toEqual([['review', ''], ['review', '']])
  })
  it("drops strangers' points and a collaborator's approval, keeps a collaborator's work", async () => {
    const { post, rows } = setup()
    const k = (n: string) => `https://github.com/${PUB}/commit/${n}`
    const res = await post([
      input({ key: k('a'), author: { login: 's', association: 'NONE' } }),
      input({ key: k('b'), author: { login: 'f', association: 'COLLABORATOR' } }),
      input({ key: k('c'), kind: 'approval', author: { login: 'f', association: 'COLLABORATOR' } }),
      input({ key: k('d'), kind: 'approval' }),
    ])
    expect(await res.json()).toMatchObject({ stored: 2, skipped: 2 })
    expect(rows.map((r) => r.key.split('/').pop())).toEqual(['b', 'd'])
  })
  it('private repos are not stored', async () => {
    const { post, rows } = setup()
    const res = await post([input({ project: 'Rowan-Hyeho-Song/work', key: 'https://github.com/Rowan-Hyeho-Song/work/commit/a' })])
    expect(await res.json()).toMatchObject({ stored: 0, skipped: 1 })
    expect(rows).toHaveLength(0)
  })
  it('one key twice in a batch is one row (the later wins)', async () => {
    const { post, rows } = setup()
    await post([input({ title: 'old' }), input({ title: 'new' })])
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('new')
  })
  it('refuses a point that does not point at its own repo, or has a bad shape', async () => {
    const { post } = setup()
    expect((await post([input({ key: 'https://evil.example/commit/a' })])).status).toBe(400)
    expect((await post([input({ kind: 'nope' as never })])).status).toBe(400)
    expect((await post([input({ agent: 9 as never })])).status).toBe(400)
    expect((await post([{ ...input(), additions: -1 }])).status).toBe(400)
    expect(parsePointInput(input())).not.toBeNull()
  })
})

describe('mergePoints', () => {
  it('unique by key, sorted by time', () => {
    const p = (key: string, at: string, title = ''): Point => ({ key, project: PUB, at, kind: 'plan', agent: null, title, secret: false, additions: null, deletions: null, files: null, issue: null, pr: null, tier: 'public' })
    const merged = mergePoints([p('b', '2026-01-02T00:00:00Z'), p('a', '2026-01-01T00:00:00Z', 'old')], [p('a', '2026-01-01T00:00:00Z', 'new')])
    expect(merged.map((x) => [x.key, x.title])).toEqual([['a', 'new'], ['b', '']])
  })
})

describe('committed copies (src/timeline/fixtures)', () => {
  const raw = import.meta.glob('./fixtures/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const files = Object.keys(raw).map((k) => k.replace('./fixtures/', ''))
  it('exist for both repos', () => {
    expect(files.sort()).toEqual(['agent-office.json', 'rowansong.dev.json'])
  })
  it.each(files)('%s is a clean public copy', (f) => {
    const text = raw[`./fixtures/${f}`]
    const file = JSON.parse(text) as TimelineFile
    expect(file.version).toBe(1)
    expect(new Set(file.points.map((p) => p.key)).size).toBe(file.points.length)
    expect(file.points).toEqual(mergePoints(file.points))
    for (const p of file.points) {
      expect(p.project).toBe(file.project)
      if (p.tier === 'review') expect(p).toMatchObject({ title: '', secret: true, issue: null, pr: null })
    }
    if (file.tier === 'review') {
      expect(file.points.every((p) => p.title === '' && p.secret)).toBe(true)
      expect(text).not.toMatch(/github\.com|\/commit\/|[0-9a-f]{40}|#\d/)
    }
    expect(text).not.toMatch(/@|[A-Za-z]:\\|\/Users\/|token|sk-|C:/i)
  })
})
