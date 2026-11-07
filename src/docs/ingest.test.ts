import { describe, expect, it } from 'vitest'
import { fromTrustedAuthor, handle, parseDoc, toRow, type DocStore, type IngestConfig } from './ingest'
import type { DocInput, DocRow } from './types'

const raw = import.meta.glob('./fixtures/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (name: string) => raw[`./fixtures/${name}`]

const REPO = 'Rowan-Hyeho-Song/agent-office'
const cfg: IngestConfig = { token: 'secret-token', publicRepos: [REPO], banned: ['Acme Corp'] }
const OWNER = { login: 'Rowan-Hyeho-Song', association: 'OWNER' }
const by = (association: string) => ({ login: 'someone', association })

const doc = (over: Partial<DocInput> = {}): DocInput => ({
  kind: 'minutes',
  repo: REPO,
  folder: 17,
  title: '회의록: 사무실 이동·놀이',
  body: fixture('minutes-6709681788.md'),
  author: OWNER,
  source: { kind: 'comment', url: `https://github.com/${REPO}/issues/17#issuecomment-6709681788` },
  created_at: '2026-11-08T01:00:00Z',
  updated_at: '2026-11-08T01:00:00Z',
  ...over,
})

function memoryStore() {
  const rows = new Map<string, DocRow>()
  const projects = new Map<string, number>()
  const store: DocStore = {
    async upsert(rs) {
      for (const r of rs) rows.set(r.source_url, r)
    },
    async setOpenIssues(repo, n) {
      projects.set(repo, n)
    },
    async upsertApprovals() {},
    async decide() {},
  }
  return { store, rows, projects }
}

const post = (body: unknown, token: string | null = 'secret-token') =>
  new Request('https://office.test/api/docs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('handle', () => {
  it('401 without the token or with a wrong one, and nothing is stored', async () => {
    const m = memoryStore()
    expect((await handle(post({ docs: [doc()] }, null), m.store, cfg)).status).toBe(401)
    expect((await handle(post({ docs: [doc()] }, 'nope'), m.store, cfg)).status).toBe(401)
    expect(m.rows.size).toBe(0)
  })

  it('405 for anything but POST, 400 for bad JSON / payloads', async () => {
    const m = memoryStore()
    expect((await handle(new Request('https://office.test/api/docs'), m.store, cfg)).status).toBe(405)
    expect((await handle(post('{nope'), m.store, cfg)).status).toBe(400)
    expect((await handle(post({}), m.store, cfg)).status).toBe(400)
    expect((await handle(post({ docs: Array(101).fill(doc()) }), m.store, cfg)).status).toBe(400)
    expect((await handle(post({ docs: [doc({ kind: 'worklog' })] }), m.store, cfg)).status).toBe(400)
  })

  it('stores, and the same source URL again updates instead of adding', async () => {
    const m = memoryStore()
    const res = await handle(post({ docs: [doc()] }), m.store, cfg)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, stored: 1, skipped: 0, grades: ['public'] })
    await handle(post({ docs: [doc({ updated_at: '2026-11-08T02:00:00Z' })] }), m.store, cfg)
    expect(m.rows.size).toBe(1)
    expect([...m.rows.values()][0].updated_at).toBe('2026-11-08T02:00:00Z')
  })

  it('keeps the open issue count of a project', async () => {
    const m = memoryStore()
    await handle(post({ docs: [], project: { repo: REPO, open_issues: 7 } }), m.store, cfg)
    expect(m.projects.get(REPO)).toBe(7)
  })
})

describe('parseDoc', () => {
  it('a document must point at its own repo on GitHub', () => {
    expect(parseDoc(doc())).not.toBeNull()
    expect(parseDoc(doc({ source: { kind: 'comment', url: 'https://evil.example/x' } }))).toBeNull()
    expect(parseDoc(doc({ source: { kind: 'comment', url: 'https://github.com/someone/else/issues/1' } }))).toBeNull()
  })
  it('rejects malformed fields', () => {
    expect(parseDoc(doc({ repo: 'no-slash' }))).toBeNull()
    expect(parseDoc(doc({ folder: 0 }))).toBeNull()
    expect(parseDoc(doc({ folder: 1.5 }))).toBeNull()
    expect(parseDoc(doc({ title: 'x'.repeat(301) }))).toBeNull()
    expect(parseDoc(doc({ created_at: 'yesterday' }))).toBeNull()
    expect(parseDoc(doc({ meta: [] as unknown as Record<string, unknown> }))).toBeNull()
    expect(parseDoc(null)).toBeNull()
  })
})

describe('toRow', () => {
  it('minutes: rows parsed, agents from the speakers, public and approved', () => {
    const r = toRow(doc(), cfg)
    expect(r.grade).toBe('public')
    expect(r.approved).toBe(true)
    // #17 log: 기획 → 코더, 코더 → Blender, Blender → 코더 …
    expect(r.agents).toEqual([0, 1, 3])
    const minutes = r.data.minutes as { rows: unknown[]; decision: string | null }[]
    expect(minutes[0].rows).toHaveLength(5)
    expect(minutes[0].decision).toMatch(/^지점 좌표는/)
    expect(r.summary.length).toBeGreaterThan(0)
  })

  it('a path, an email, a key or a banned word is hidden and the document drops to review (SECRET)', () => {
    for (const leak of ['C:\\Users\\me\\work\\a.ts', 'me@example.com', 'sb_secret_abcdefghijklmnop', 'Acme Corp']) {
      const r = toRow(doc({ body: `내용 ${leak} 끝` }), cfg)
      expect(r.body, leak).not.toContain(leak)
      expect(r.grade, leak).toBe('review')
      expect(r.approved, leak).toBe(false)
    }
    const titled = toRow(doc({ title: 'Acme Corp 일정' }), cfg)
    expect(titled.title).not.toContain('Acme')
    expect(titled.grade).toBe('review')
  })

  it('a repo outside the public list is review even when clean', () => {
    const r = toRow(doc({ repo: 'Rowan-Hyeho-Song/rowansong.dev', source: { kind: 'comment', url: 'https://github.com/Rowan-Hyeho-Song/rowansong.dev/issues/1#c' } }), cfg)
    expect(r.grade).toBe('review')
  })

  it('decision: result plus the request it answers; the requester is the agent', () => {
    const r = toRow(
      doc({
        kind: 'decision',
        title: '결정: 신호 통로',
        body: fixture('approval-6710239720.md'),
        source: { kind: 'comment', url: `https://github.com/${REPO}/issues/1#issuecomment-6710239720` },
        meta: { request: fixture('approval-6710165774.md'), requestAuthor: OWNER },
      }),
      cfg,
    )
    expect(r.data.result).toMatchObject({ option: 3 })
    expect(r.data.request).toMatchObject({ kind: '결정 요청', requesterSeat: 3 })
    expect(r.agents).toEqual([3])
  })

  it('plan: agents from "누가 하나", meta kept', () => {
    const r = toRow(
      doc({
        kind: 'plan',
        title: '[기능] 신호 통로',
        body: '## 배경과 목표\n상태를 실시간으로.\n\n## 누가 하나\n코더 세션',
        source: { kind: 'issue', url: `https://github.com/${REPO}/issues/1` },
        meta: { state: 'open', labels: ['feature'] },
      }),
      cfg,
    )
    expect(r.agents).toEqual([3])
    expect(r.data).toEqual({ state: 'open', labels: ['feature'] })
    expect(r.summary).toBe('상태를 실시간으로.')
  })

  it('every real comment so far goes through clean (public, nothing hidden)', () => {
    for (const [name, body] of Object.entries(raw)) {
      const r = toRow(doc({ body }), cfg)
      expect(r.grade, name).toBe('public')
      expect(r.body, name).toBe(body)
    }
  })
})

describe('who may file, checked again on the server (#38)', () => {
  const decision = (author: { login: string; association: string }, requestAuthor?: unknown) =>
    doc({ kind: 'decision', body: fixture('approval-6710239720.md'), author, meta: { request: fixture('approval-6710165774.md'), requestAuthor } })

  it.each([
    ['OWNER', true, true],
    ['COLLABORATOR', true, false],
    ['MEMBER', false, false],
    ['CONTRIBUTOR', false, false],
    ['NONE', false, false],
    ['owner', true, true], // case doesn't matter
  ])('%s: documents %s, decisions %s', (association, docs, decisions) => {
    expect(fromTrustedAuthor(doc({ author: by(association) }))).toBe(docs)
    expect(fromTrustedAuthor(decision(by(association), OWNER))).toBe(decisions)
  })

  it("a decision needs the owner on the 🖊 request too", () => {
    expect(fromTrustedAuthor(decision(OWNER, by('NONE')))).toBe(false)
    expect(fromTrustedAuthor(decision(OWNER, undefined))).toBe(false)
  })

  it('a document without an author is refused as malformed', () => {
    const { author: _drop, ...rest } = doc()
    expect(parseDoc(rest)).toBeNull()
    expect(parseDoc(doc({ author: { login: 'x' } as unknown as DocInput['author'] }))).toBeNull()
  })

  it("strangers' items are skipped (not stored), the rest of the batch still goes in", async () => {
    const m = memoryStore()
    const strangers = doc({ author: by('NONE'), source: { kind: 'comment', url: `https://github.com/${REPO}/issues/17#issuecomment-1` } })
    const fake = decision(by('CONTRIBUTOR'), OWNER)
    const res = await handle(post({ docs: [doc(), strangers, fake] }), m.store, cfg)
    expect(await res.json()).toMatchObject({ ok: true, stored: 1, skipped: 2 })
    expect([...m.rows.keys()]).toEqual([doc().source.url])
  })

  it('the trusted lists can be configured', () => {
    expect(fromTrustedAuthor(doc({ author: by('MEMBER') }), { trusted: ['OWNER', 'MEMBER'] })).toBe(true)
  })
})
