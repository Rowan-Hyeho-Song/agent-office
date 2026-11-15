import { describe, expect, it } from 'vitest'
import { playAt } from '../office/play'
import { SETTLE_MS, sessionTime, sessionsAt } from './session'

const agents = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const T = Date.UTC(2026, 10, 8, 3, 0, 0)
const STEP = 47_000

describe('sessions', () => {
  it('same time gives the same sessions; a game keeps its seed and start while it lasts (one stay of the day plan, #490)', () => {
    expect(sessionsAt(T, agents)).toEqual(sessionsAt(T, agents))
    let checked = 0
    for (let t = T; t < T + 3 * 3_600_000; t += STEP)
      for (const s of sessionsAt(t, agents).filter((x) => !x.solo)) {
        // a pair: from when both are there to the end of their stay (the first one's wait at the board is its own session)
        const until = playAt(t, agents)[s.players[0]].until
        const again = sessionsAt(until - 1, agents).find((x) => !x.solo && x.spot === s.spot && x.players[0] === s.players[0])
        expect(again?.seed).toBe(s.seed)
        expect(again?.startMs).toBe(s.startMs)
        checked++
      }
    expect(checked).toBeGreaterThan(10)
  })
  it('seeds differ from game to game, and local time is offset by the settle time', () => {
    const seeds = new Set<number>()
    let found: ReturnType<typeof sessionsAt>[number] | undefined
    for (let t = T; t < T + 3 * 3_600_000; t += STEP)
      for (const s of sessionsAt(t, agents)) {
        seeds.add(s.seed)
        found ??= s
      }
    expect(seeds.size).toBeGreaterThan(5)
    expect(sessionTime(found!, found!.startMs + SETTLE_MS + 1234)).toBe(1234)
  })
  it('a pair game starts when both players are there (the first one waited at the table, play.md 9.2)', () => {
    let pairs = 0
    for (let t = T; t < T + 6 * 3_600_000; t += STEP)
      for (const s of sessionsAt(t, agents).filter((x) => !x.solo)) {
        const a = playAt(t, agents)[s.players[0]]
        expect(s.startMs).toBe(a.pairAt)
        expect(t).toBeGreaterThanOrEqual(s.startMs)
        pairs++
      }
    expect(pairs).toBeGreaterThan(0)
  })
  it('a busy player removes the pair', () => {
    let all: ReturnType<typeof sessionsAt> = []
    let t = T
    // a pair session (a game record placed alone, #137, has one player)
    while (!all.length && t < T + 6 * 3_600_000) {
      all = sessionsAt(t, agents).filter((s) => !s.solo)
      t += STEP
    }
    expect(all.length).toBeGreaterThan(0)
    const busy = new Set([all[0].players[0]])
    // the busy player is out of every game; its partner may now place a record alone at the board (#137), but not with it
    expect(sessionsAt(t - STEP, agents, busy).find((x) => x.spot === all[0].spot && x.players.includes(all[0].players[0]))).toBeUndefined()
  })
})
