import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshEvents, give, onTreat, resetTreatsForTest, waitLeft, type Treat } from './treats'

afterEach(() => {
  resetTreatsForTest()
  vi.useRealTimers()
})

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('giving a snack or a cheer (#4 12.2)', () => {
  it('shows at once on this screen, then the minute per robot holds the same group back', async () => {
    const seen: Treat[] = []
    onTreat((t) => seen.push(t))
    const f = answer(200, { shared: true, event: { id: 7, agent: 'agent_1', kind: 'coffee', created_at: new Date().toISOString() } })
    expect(await give('agent_1', 'coffee', f)).toEqual({ shared: true })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ agent: 'agent_1', kind: 'coffee', mine: true })
    expect(waitLeft('agent_1', 'apple')).toBe(60)
    expect(waitLeft('agent_1', 'cheer')).toBe(0)
    expect(waitLeft('agent_2', 'apple')).toBe(0)
    expect(await give('agent_1', 'cookie', f)).toEqual({ wait: 60 })
    expect(seen).toHaveLength(1)
    // the signal brings the same event back: not shown twice
    expect(freshEvents([{ id: 7, agent: 'agent_1', kind: 'coffee', created_at: new Date().toISOString() }], Date.now())).toEqual([])
  })

  it("the server's minute wins (another tab of the same visitor gave one)", async () => {
    const f = answer(429, { retryS: 42 })
    expect(await give('agent_3', 'cheer', f)).toEqual({ wait: 42 })
    expect(waitLeft('agent_3', 'cheer')).toBe(42)
  })

  it("the others' events: fresh ones only, oldest first, each once", () => {
    const now = Date.parse('2026-11-14T03:00:20Z')
    const rows = [
      { id: 3, agent: 'agent_0', kind: 'cheer' as const, created_at: '2026-11-14T03:00:19Z' },
      { id: 2, agent: 'agent_4', kind: 'apple' as const, created_at: '2026-11-14T03:00:10Z' },
      { id: 1, agent: 'agent_2', kind: 'coffee' as const, created_at: '2026-11-14T02:59:00Z' }, // old news
    ]
    expect(freshEvents(rows, now, new Set()).map((t) => t.id)).toEqual(['visit:2', 'visit:3'])
    expect(freshEvents(rows, now, new Set(['visit:2'])).map((t) => t.id)).toEqual(['visit:3'])
  })
})

describe('the signal topic', () => {
  it('the page listens where the server sends (src/server/signal.ts)', async () => {
    const server = await import('../../server/signal')
    const page = await import('./treats')
    expect(page.VISIT_TOPIC).toBe(server.VISIT_TOPIC)
  })
})
