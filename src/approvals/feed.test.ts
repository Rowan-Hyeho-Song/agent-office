import { describe, expect, it, vi } from 'vitest'
import { handle, toFeedItem, type FeedStore } from './feed'
import type { StoredApproval } from './types'

const TOKEN = 'hook-token'

const row = (over: Partial<StoredApproval> = {}): StoredApproval => ({
  id: 1,
  repo: 'Rowan-Hyeho-Song/agent-office',
  folder: 26,
  title: '에이전트 정체성',
  source_url: 'https://github.com/Rowan-Hyeho-Song/agent-office/issues/26#issuecomment-1',
  kind: '결정 요청',
  requester: '디자인',
  requester_seat: 2,
  content: '고르세요',
  options: ['A', 'B', 'C'],
  recommended: 1,
  reason: null,
  created_at: '2026-11-08T00:00:00Z',
  updated_at: '2026-11-08T00:00:00Z',
  status: 'decided',
  result: '선택지 2',
  option: 2,
  opinion: 'B',
  result_url: 'https://github.com/x/y/issues/26#issuecomment-2',
  decided_at: '2026-11-08T03:00:00Z',
  ...over,
})

const store = (rows: StoredApproval[] = [row()]) => ({ decidedFor: vi.fn(async (_seat: number, _since: string, _limit: number) => rows) }) satisfies FeedStore
const get = (qs: string, token: string | null = TOKEN, method = 'GET') =>
  new Request(`https://office.test/api/approvals?${qs}`, { method, headers: token === null ? {} : { authorization: `Bearer ${token}` } })

describe('toFeedItem', () => {
  it('chosen is the option text for 선택지 N', () => {
    const i = toFeedItem(row())
    expect(i.chosen).toBe('B')
    expect(i).toMatchObject({ repo: 'Rowan-Hyeho-Song/agent-office', folder: 26, kind: '결정 요청', content: '고르세요', result: '선택지 2', opinion: 'B', decided_at: '2026-11-08T03:00:00Z' })
  })
  it('chosen is null for 승인 / 반려 or an option out of range', () => {
    expect(toFeedItem(row({ result: '승인', option: null })).chosen).toBeNull()
    expect(toFeedItem(row({ result: '반려', option: null })).chosen).toBeNull()
    expect(toFeedItem(row({ option: 9 })).chosen).toBeNull()
  })
  it('falls back to empty strings for missing result / decided_at', () => {
    const i = toFeedItem(row({ result: null, decided_at: null }))
    expect(i.result).toBe('')
    expect(i.decided_at).toBe('')
  })
})

describe('handle', () => {
  it('405 on POST', async () => {
    const s = store()
    expect((await handle(get('seat=0&since=2026-11-08T00:00:00Z', TOKEN, 'POST'), s, TOKEN)).status).toBe(405)
    expect(s.decidedFor).not.toHaveBeenCalled()
  })

  it('401 with no or a wrong token', async () => {
    const s = store()
    expect((await handle(get('seat=0&since=2026-11-08T00:00:00Z', null), s, TOKEN)).status).toBe(401)
    expect((await handle(get('seat=0&since=2026-11-08T00:00:00Z', 'wrong'), s, TOKEN)).status).toBe(401)
    expect(s.decidedFor).not.toHaveBeenCalled()
  })

  it('401 when the server token is empty', async () => {
    const s = store()
    expect((await handle(get('seat=0&since=2026-11-08T00:00:00Z', ''), s, '')).status).toBe(401)
  })

  it.each(['-1', '5', 'x', '1.5'])('400 on bad seat %j', async (seat) => {
    const s = store()
    const res = await handle(get(`seat=${seat}&since=2026-11-08T00:00:00Z`), s, TOKEN)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad seat' })
  })

  it('400 on a bad or missing since', async () => {
    const s = store()
    expect((await handle(get('seat=1&since=nope'), s, TOKEN)).status).toBe(400)
    expect((await handle(get('seat=1'), s, TOKEN)).status).toBe(400)
    expect(s.decidedFor).not.toHaveBeenCalled()
  })

  it('returns the seat’s decided approvals as feed items', async () => {
    const rows = [row(), row({ id: 2, result: '승인', option: null })]
    const s = store(rows)
    const res = await handle(get('seat=2&since=2026-11-08T09:00:00%2B09:00'), s, TOKEN)
    expect(res.status).toBe(200)
    expect(s.decidedFor).toHaveBeenCalledWith(2, '2026-11-08T00:00:00.000Z', 10)
    expect(await res.json()).toEqual({ approvals: rows.map(toFeedItem) })
  })

  it('accepts seat 0 and 3', async () => {
    const s = store([])
    expect((await handle(get('seat=0&since=2026-11-08T00:00:00Z'), s, TOKEN)).status).toBe(200)
    expect((await handle(get('seat=3&since=2026-11-08T00:00:00Z'), s, TOKEN)).status).toBe(200)
  })
})
