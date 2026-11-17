// #605 (hologram.md 12.4 · 12.6) the agents' alkkagi timeline: deterministic, computed a flick per call without changing the result.
import { beforeEach, describe, expect, it } from 'vitest'
import { ALK } from './alkkagi'
import { ALK_FLICKS_PER_CALL, ALK_HAND, ALK_SETTLE_MS, alkkagiAt, resetAlkkagiCache, type AlkView } from './alkkagiTimeline'

const P: [string, string] = ['agent_1', 'agent_3']
const full = (seed: number, t: number) => {
  resetAlkkagiCache()
  return alkkagiAt(seed, P, t, Number.POSITIVE_INFINITY)
}
const same = (a: AlkView, b: AlkView) => expect(JSON.stringify(a)).toBe(JSON.stringify(b))

beforeEach(() => resetAlkkagiCache())

describe('the agents alkkagi timeline (#605)', () => {
  it('a seek into the middle catches up a flick per call to the same moment as one long computation', () => {
    const t = 60_000
    const want = full(9, t)
    resetAlkkagiCache()
    let v = alkkagiAt(9, P, t)
    let calls = 1
    while (v.phase === 'catching' && calls < 500) {
      v = alkkagiAt(9, P, t)
      calls++
    }
    expect(v.phase).not.toBe('catching')
    expect(calls).toBeGreaterThanOrEqual(Math.ceil(want.turn / ALK_FLICKS_PER_CALL))
    same(v, want)
  })
  it('a flick: thinking, aiming from 0.3 s after it, the nail on the stone at 0.81 s: the stones move from there and stop; the next 0.4 s after', () => {
    const v0 = full(4, 0)
    expect(v0.phase).toBe('thinking')
    const f = v0.flick!
    const nail = f.thinkMs + ALK_HAND.flick
    expect(full(4, f.thinkMs + ALK_HAND.reach).phase).toBe('aim')
    const before = full(4, nail - 1)
    expect(before.phase).toBe('aim')
    expect(before.events).toEqual([])
    const mid = full(4, nail + 200)
    expect(mid.phase).toBe('moving')
    // the flicked stone has left its place
    const s0 = before.stones[f.flick.stone]
    const s1 = mid.stones[f.flick.stone]
    expect(Math.hypot(s1.x - s0.x, s1.y - s0.y)).toBeGreaterThan(0.5)
    const stop = nail + f.motionTotalMs
    expect(full(4, stop).phase).toBe('settle')
    const next = full(4, stop + ALK_SETTLE_MS)
    expect(next.turn).toBe(1)
    expect(next.toMove).toBe(1)
    // the thinking 0.6–1.2 s
    expect(f.thinkMs).toBeGreaterThanOrEqual(600)
    expect(f.thinkMs).toBeLessThanOrEqual(1200)
  })
  it('the events of a flick come with their time from the nail, only those already past', () => {
    for (let t = 0; t < 120_000; t += 1_500) {
      const v = full(13, t)
      for (const e of v.events) expect(e.atMs).toBeLessThanOrEqual(v.flick!.motionMs + 1e-6)
      if (v.events.some((e) => e.kind === 'hit')) return
    }
    throw new Error('no hit seen in two minutes of play')
  })
  it('a game ends when a side is cleared or after 80 flicks, and the next game swaps who flicks first', () => {
    resetAlkkagiCache()
    let t = 0
    let v = alkkagiAt(21, P, t, Number.POSITIVE_INFINITY)
    while (!v.end && t < 2_000_000) {
      t += 10_000
      v = alkkagiAt(21, P, t, Number.POSITIVE_INFINITY)
    }
    expect(v.end).not.toBeNull()
    expect(v.turn).toBeLessThanOrEqual(ALK.maxTurns)
    let next = v
    while (next.game === v.game && t < 2_100_000) {
      t += 1_000
      next = alkkagiAt(21, P, t, Number.POSITIVE_INFINITY)
    }
    expect(next.game).toBe(v.game + 1)
    expect(next.first).toBe(1 - v.first)
  }, 120_000)
})
