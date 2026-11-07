import { describe, expect, it, vi } from 'vitest'
import { ingestApprovals, parseApprovalInput, requestRow, resultDecision, type ApprovalStore } from './ingest'
import type { ApprovalInput, ApprovalRow, Decision } from './types'

const raw = import.meta.glob('../docs/fixtures/approval-*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (id: string) => raw[`../docs/fixtures/approval-${id}.md`]

const REPO = 'Rowan-Hyeho-Song/agent-office'
const url = (n: number | string, folder = 26) => `https://github.com/${REPO}/issues/${folder}#issuecomment-${n}`
const OWNER = { login: 'Rowan-Hyeho-Song', association: 'OWNER' }
const APPROVERS = ['OWNER']
const cfg = { banned: [] as string[], approvers: APPROVERS }

const request = (id: string, over: Partial<ApprovalInput> = {}): ApprovalInput => ({
  type: 'request',
  repo: REPO,
  folder: 26,
  url: url(id),
  body: fixture(id),
  author: OWNER,
  created_at: '2026-11-08T02:00:00Z',
  updated_at: '2026-11-08T02:00:00Z',
  ...over,
})
const result = (id: string, answers: string | null, over: Partial<ApprovalInput> = {}): ApprovalInput => ({
  type: 'result',
  repo: REPO,
  folder: 26,
  url: url(id),
  body: fixture(id),
  author: OWNER,
  created_at: '2026-11-08T03:00:00Z',
  updated_at: '2026-11-08T03:00:00Z',
  answers,
  ...over,
})

describe('parseApprovalInput', () => {
  it('accepts the owner’s request and result', () => {
    const req = request('6709822206')
    const res = result('6709870843', req.url)
    expect(parseApprovalInput(req, APPROVERS)).toEqual(req)
    expect(parseApprovalInput(res, APPROVERS)).toEqual(res)
  })

  it('accepts a result with answers null', () => {
    expect(parseApprovalInput(result('6709870843', null), APPROVERS)).not.toBeNull()
  })

  it('matches the association case-insensitively', () => {
    expect(parseApprovalInput(request('6709822206', { author: { login: 'x', association: 'owner' } }), APPROVERS)).not.toBeNull()
  })

  it.each(['COLLABORATOR', 'CONTRIBUTOR', 'NONE', 'MEMBER'])('rejects a %s', (association) => {
    expect(parseApprovalInput(request('6709822206', { author: { login: 'x', association } }), APPROVERS)).toBeNull()
    expect(parseApprovalInput(result('6709870843', null, { author: { login: 'x', association } }), APPROVERS)).toBeNull()
  })

  it('rejects a missing or malformed author', () => {
    const { author: _a, ...noAuthor } = request('6709822206')
    expect(parseApprovalInput(noAuthor, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...request('6709822206'), author: { login: 'x' } }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...request('6709822206'), author: { association: 'OWNER' } }, APPROVERS)).toBeNull()
  })

  it('rejects a url or answers outside the repo', () => {
    expect(parseApprovalInput(request('6709822206', { url: 'https://github.com/evil/repo/issues/1#issuecomment-1' }), APPROVERS)).toBeNull()
    expect(parseApprovalInput(request('6709822206', { url: 'https://example.com/x' }), APPROVERS)).toBeNull()
    expect(parseApprovalInput(request('6709822206', { url: undefined as unknown as string }), APPROVERS)).toBeNull()
    expect(parseApprovalInput(result('6709870843', 'https://github.com/evil/repo/issues/1#issuecomment-1'), APPROVERS)).toBeNull()
    expect(parseApprovalInput(result('6709870843', `https://github.com/${REPO}-evil/issues/1`), APPROVERS)).toBeNull()
  })

  it('rejects a bad repo, folder or dates', () => {
    const r = request('6709822206')
    expect(parseApprovalInput({ ...r, repo: 'no-slash' }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...r, repo: 'a/b/c' }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...r, folder: 0 }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...r, folder: 1.5 }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...r, folder: '26' }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...r, created_at: 'yesterday' }, APPROVERS)).toBeNull()
    expect(parseApprovalInput({ ...r, updated_at: undefined }, APPROVERS)).toBeNull()
  })

  it('rejects a bad type, non-object or oversized body', () => {
    expect(parseApprovalInput({ ...request('6709822206'), type: 'other' }, APPROVERS)).toBeNull()
    expect(parseApprovalInput(null, APPROVERS)).toBeNull()
    expect(parseApprovalInput('x', APPROVERS)).toBeNull()
    expect(parseApprovalInput(request('6709822206', { body: 'x'.repeat(20_001) }), APPROVERS)).toBeNull()
    expect(parseApprovalInput(request('6709822206', { body: 'x'.repeat(20_000) }), APPROVERS)).not.toBeNull()
    expect(parseApprovalInput({ ...request('6709822206'), body: 5 }, APPROVERS)).toBeNull()
  })
})

describe('requestRow', () => {
  it('reads the 결정 요청 with three options and a recommendation', () => {
    const row = requestRow(request('6709822206'), [])!
    expect(row).toMatchObject({ repo: REPO, folder: 26, source_url: url('6709822206'), kind: '결정 요청', requester: '디자인', requester_seat: 2, recommended: 1 })
    expect(row.options).toHaveLength(3)
    expect(row.options[0]).toContain('A 사물 이름')
    expect(row.options[0]).not.toContain('(추천)')
    expect(row.created_at).toBe('2026-11-08T02:00:00Z')
  })

  it('reads the second 결정 요청 (two options)', () => {
    const row = requestRow(request('6709822480'), [])!
    expect(row.kind).toBe('결정 요청')
    expect(row.options).toHaveLength(2)
    expect(row.recommended).toBe(1)
  })

  it('reads the 산출물 확인', () => {
    const row = requestRow(request('6709822762'), [])!
    expect(row.kind).toBe('산출물 확인')
    expect(row.requester_seat).toBe(2)
    expect(row.options).toHaveLength(2)
    expect(row.recommended).toBe(1)
  })

  it('reads the coder’s request on #1', () => {
    const row = requestRow(request('6710165774', { folder: 1, url: url('6710165774', 1) }), [])!
    expect(row.kind).toBe('결정 요청')
    expect(row.requester).toBe('코더(루프)')
    expect(row.requester_seat).toBe(3)
    expect(row.options).toHaveLength(3)
    expect(row.recommended).toBe(1)
    expect(row.folder).toBe(1)
  })

  it('is null for a body that is not a request', () => {
    expect(requestRow(request('6709822206', { body: '그냥 댓글입니다' }), [])).toBeNull()
    expect(requestRow(request('6709822206', { body: fixture('6709870843') }), [])).toBeNull()
  })
})

describe('resultDecision', () => {
  it('reads 선택지 N with its opinion', () => {
    const req = url('6709822206')
    const d = resultDecision(result('6709870843', req), [])!
    expect(d.requestUrl).toBe(req)
    expect(d.decision).toMatchObject({ result: '선택지 1', option: 1, result_url: url('6709870843'), decided_at: '2026-11-08T03:00:00Z' })
    expect(d.decision.opinion).toContain('이름 안 A')
  })

  it('reads 승인 with no option', () => {
    const d = resultDecision(result('6709871446', url('6709822762')), [])!
    expect(d.decision.result).toBe('승인')
    expect(d.decision.option).toBeNull()
    expect(d.decision.opinion).toContain('승인')
  })

  it('reads 선택지 3 on #1', () => {
    const d = resultDecision(result('6710239720', url('6710165774', 1), { folder: 1 }), [])!
    expect(d.decision.result).toBe('선택지 3')
    expect(d.decision.option).toBe(3)
  })

  it('is null when answers is missing or the body is not a result', () => {
    expect(resultDecision(result('6709870843', null), [])).toBeNull()
    expect(resultDecision(result('6709870843', undefined as unknown as null), [])).toBeNull()
    expect(resultDecision(result('6709870843', url('1'), { body: '수고하셨습니다' }), [])).toBeNull()
  })
})

function memoryStore() {
  const rows = new Map<string, ApprovalRow>()
  const decided = new Map<string, Decision>()
  const order: string[] = []
  const store: ApprovalStore = {
    async upsertApprovals(rs) {
      order.push('upsert')
      for (const r of rs) rows.set(r.source_url, r)
    },
    decide: vi.fn(async (u: string, d: Decision) => {
      order.push('decide')
      if (rows.has(u)) decided.set(u, d)
    }),
  }
  return { store, rows, decided, order }
}

describe('ingestApprovals', () => {
  it('stores requests, then applies results', async () => {
    const m = memoryStore()
    const out = await ingestApprovals([request('6709822206'), result('6709870843', url('6709822206'))], m.store, cfg)
    expect(out).toEqual({ requests: 1, results: 1, skipped: 0 })
    expect(m.rows.size).toBe(1)
    expect(m.decided.get(url('6709822206'))?.result).toBe('선택지 1')
  })

  it('applies a result even if it comes before its request in the array', async () => {
    const m = memoryStore()
    const out = await ingestApprovals(
      [result('6709870843', url('6709822206')), result('6709871153', url('6709822480')), request('6709822206'), request('6709822480')],
      m.store,
      cfg,
    )
    expect(out).toEqual({ requests: 2, results: 2, skipped: 0 })
    expect(m.order).toEqual(['upsert', 'decide', 'decide'])
    expect(m.decided.size).toBe(2)
  })

  it('skips strangers and counts them', async () => {
    const m = memoryStore()
    const stranger = { login: 'someone', association: 'NONE' }
    const out = await ingestApprovals(
      [request('6709822206'), request('6709822480', { author: stranger }), 'junk', { type: 'request' }],
      m.store,
      cfg,
    )
    expect(out).toEqual({ requests: 1, results: 0, skipped: 3 })
    expect(m.rows.has(url('6709822480'))).toBe(false)
  })

  it('never calls decide for a stranger’s ✅', async () => {
    const m = memoryStore()
    const out = await ingestApprovals(
      [request('6709822206'), result('6709870843', url('6709822206'), { author: { login: 'evil', association: 'CONTRIBUTOR' } })],
      m.store,
      cfg,
    )
    expect(out).toEqual({ requests: 1, results: 0, skipped: 1 })
    expect(m.store.decide).not.toHaveBeenCalled()
    expect(m.decided.size).toBe(0)
  })

  it('counts an unparseable owner item as skipped and does not call the store', async () => {
    const m = memoryStore()
    const upsert = vi.spyOn(m.store, 'upsertApprovals')
    const out = await ingestApprovals([request('6709822206', { body: 'not a request' })], m.store, cfg)
    expect(out).toEqual({ requests: 0, results: 0, skipped: 1 })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('resultDecision: the office writes 없음 for no opinion', () => {
  it('reads 없음 back as no opinion, keeps a real one', () => {
    const base = {
      type: 'result' as const,
      repo: 'Rowan-Hyeho-Song/agent-office',
      folder: 1,
      url: 'https://github.com/Rowan-Hyeho-Song/agent-office/issues/1#issuecomment-2',
      answers: 'https://github.com/Rowan-Hyeho-Song/agent-office/issues/1#issuecomment-1',
      author: { login: 'o', association: 'OWNER' },
      created_at: '2026-11-08T00:00:00Z',
      updated_at: '2026-11-08T00:00:00Z',
    }
    const none = resultDecision({ ...base, body: '### ✅ 결재 (2026-11-08)\n**결과**: 승인\n**의견**: 없음' }, [])
    expect(none?.decision.opinion).toBeNull()
    const some = resultDecision({ ...base, body: '### ✅ 결재 (2026-11-08)\n**결과**: 반려\n**의견**: 다시 봐 주세요' }, [])
    expect(some?.decision.opinion).toBe('다시 봐 주세요')
  })
})
