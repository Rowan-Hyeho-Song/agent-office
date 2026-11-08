import { describe, expect, it } from 'vitest'
import { BLOCK_MS, SETTLE_MS, sessionTime, sessionsAt } from './session'

const agents = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const T = Date.UTC(2026, 10, 8, 3, 0, 0)

describe('sessions', () => {
  it('same time gives the same sessions; the whole block shares the seed', () => {
    expect(sessionsAt(T, agents)).toEqual(sessionsAt(T, agents))
    for (const s of sessionsAt(T, agents)) {
      const again = sessionsAt(s.startMs + BLOCK_MS - 1, agents).find((x) => x.spot === s.spot)
      expect(again?.seed).toBe(s.seed)
      expect(again?.startMs).toBe(s.startMs)
    }
  })
  it('seeds differ across blocks, and local time is offset by the settle time', () => {
    const seeds = new Set<number>()
    let found: ReturnType<typeof sessionsAt>[number] | undefined
    for (let i = 0; i < 30; i++) {
      for (const s of sessionsAt(T + i * BLOCK_MS, agents)) {
        seeds.add(s.seed)
        found ??= s
      }
    }
    expect(seeds.size).toBeGreaterThan(5)
    expect(sessionTime(found!, found!.startMs + SETTLE_MS + 1234)).toBe(1234)
  })
  it('a busy player removes the pair', () => {
    let all: ReturnType<typeof sessionsAt> = []
    let t = T
    while (!all.length && t < T + 50 * BLOCK_MS) {
      all = sessionsAt(t, agents)
      t += BLOCK_MS
    }
    expect(all.length).toBeGreaterThan(0)
    const busy = new Set([all[0].players[0]])
    expect(sessionsAt(t - BLOCK_MS, agents, busy).find((x) => x.spot === all[0].spot)).toBeUndefined()
  })
})
