import { describe, expect, it, vi } from 'vitest'
import { handle, type DocStore, type IngestConfig } from './ingest'
import type { ApprovalRow, Decision } from '../approvals/types'

const raw = import.meta.glob('./fixtures/approval-*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (id: string) => raw[`./fixtures/approval-${id}.md`]

const REPO = 'Rowan-Hyeho-Song/agent-office'
const cfg: IngestConfig = { token: 'secret-token', publicRepos: [REPO], banned: [] }
const OWNER = { login: 'Rowan-Hyeho-Song', association: 'OWNER' }
const url = (id: string) => `https://github.com/${REPO}/issues/26#issuecomment-${id}`

const req = (id: string, author = OWNER) => ({
  type: 'request', repo: REPO, folder: 26, url: url(id), body: fixture(id), author,
  created_at: '2026-11-08T02:00:00Z', updated_at: '2026-11-08T02:00:00Z',
})
const res = (id: string, answers: string | null, author = OWNER) => ({
  type: 'result', repo: REPO, folder: 26, url: url(id), body: fixture(id), author, answers,
  created_at: '2026-11-08T03:00:00Z', updated_at: '2026-11-08T03:00:00Z',
})

function store() {
  return {
    upsert: vi.fn(async () => {}),
    setOpenIssues: vi.fn(async () => {}),
    upsertApprovals: vi.fn(async (_rows: ApprovalRow[]) => {}),
    decide: vi.fn(async (_u: string, _d: Decision) => {}),
    addHandoffs: vi.fn(async () => {}),
  } satisfies DocStore
}

const post = (body: unknown) =>
  new Request('https://office.test/api/docs', { method: 'POST', headers: { authorization: 'Bearer secret-token' }, body: JSON.stringify(body) })

describe('handle with approvals', () => {
  it('reports what was filed, with docs empty', async () => {
    const s = store()
    const r = await handle(post({ docs: [], approvals: [req('6709822206'), res('6709870843', url('6709822206'))] }), s, cfg)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, stored: 0, approvals: { requests: 1, results: 1, skipped: 0 } })
    expect(s.upsert).not.toHaveBeenCalled()
    expect(s.upsertApprovals).toHaveBeenCalledTimes(1)
    expect(s.decide).toHaveBeenCalledWith(url('6709822206'), expect.objectContaining({ result: '선택지 1', option: 1 }))
  })

  it('skips strangers without calling decide', async () => {
    const s = store()
    const stranger = { login: 'x', association: 'NONE' }
    const r = await handle(post({ docs: [], approvals: [req('6709822206'), res('6709870843', url('6709822206'), stranger)] }), s, cfg)
    expect(await r.json()).toMatchObject({ approvals: { requests: 1, results: 0, skipped: 1 } })
    expect(s.decide).not.toHaveBeenCalled()
  })

  it('omits approvals from the response when none were sent', async () => {
    const r = await handle(post({ docs: [] }), store(), cfg)
    expect(r.status).toBe(200)
    expect(await r.json()).not.toHaveProperty('approvals')
  })

  it('400 when approvals is not an array', async () => {
    for (const approvals of ['x', {}, 5, null]) {
      const s = store()
      expect((await handle(post({ docs: [], approvals }), s, cfg)).status).toBe(400)
      expect(s.upsertApprovals).not.toHaveBeenCalled()
    }
  })

  it('400 with more than 100 approvals, 200 with exactly 100', async () => {
    const s = store()
    expect((await handle(post({ docs: [], approvals: Array.from({ length: 101 }, () => ({})) }), s, cfg)).status).toBe(400)
    const r = await handle(post({ docs: [], approvals: Array.from({ length: 100 }, () => ({})) }), s, cfg)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ approvals: { requests: 0, results: 0, skipped: 100 } })
  })
})
