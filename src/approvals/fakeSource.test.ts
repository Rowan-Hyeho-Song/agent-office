import { describe, expect, it } from 'vitest'
import { FakeApprovalSource } from './fakeSource'

describe('FakeApprovalSource (debug only)', () => {
  it('has sample approvals of every kind, a decided one, and starts as a visitor', async () => {
    const f = new FakeApprovalSource()
    expect(f.role()).toBe('visitor')
    const kinds = (await f.pending()).map((a) => a.kind).sort()
    expect(kinds).toEqual(['결정 요청', '문서 공개', '산출물 확인'])
    expect(await f.count()).toBe(3)
    expect(await f.decided()).toHaveLength(1)
  })
  it('covers carry nothing but kind, seat and date', async () => {
    const f = new FakeApprovalSource()
    for (const c of await f.covers()) expect(Object.keys(c).sort()).toEqual(['created_at', 'id', 'kind', 'requester_seat'])
  })
  it('decided covers carry only who, which result and when (#222)', async () => {
    const f = new FakeApprovalSource()
    const covers = await f.decidedCovers()
    expect(covers).toHaveLength(1)
    for (const c of covers) expect(Object.keys(c).sort()).toEqual(['decided_at', 'id', 'kind', 'requester_seat', 'result'])
  })
  it('only the owner decides, with the server rules, and failNext fails once', async () => {
    const f = new FakeApprovalSource()
    expect(await f.decide(1, '선택지 1', '')).toEqual({ ok: false, status: 403 })
    f.as('owner')
    expect(await f.decide(3, '계속 SECRET', ' ')).toEqual({ ok: false, status: 400 })
    f.failNext()
    expect(await f.decide(1, '선택지 1', '')).toEqual({ ok: false, status: 500 })
    expect(await f.decide(1, '선택지 1', '')).toEqual({ ok: true })
    expect(await f.count()).toBe(2)
    expect(await f.decide(1, '선택지 1', '')).toEqual({ ok: false, status: 409 })
    f.reset()
    expect(await f.count()).toBe(3)
  })
  it('notifies role changes', () => {
    const f = new FakeApprovalSource()
    let n = 0
    const off = f.subscribe(() => n++)
    f.as('owner')
    off()
    f.as('visitor')
    expect(n).toBe(1)
  })
})
