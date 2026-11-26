import { describe, expect, it } from 'vitest'
import { Director } from './director'
import { BROKE_QUESTION_S, TIDY_MS, aloneChain, dayPlan, planDay, playAt } from './play'
import { SPINE_SWEEP, spineLook } from './shelfRun'
import type { StatusMap } from './status'

// #718 PR ②-a (play.md 9.7): the spines looked over row by row, a watcher puzzled for a second as its game breaks, and the ?debug=1 way to leave one
// alone at a forced ping-pong game (the busy rule runs as for the schedule's own games)
const FIVE = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
const D = Math.PI / 180

describe('the spines (#718, play.md 9.7 둘러보기)', () => {
  it('a row from its left end to its right end in rowS, then the next row down, top to bottom and round again', () => {
    const rows = SPINE_SWEEP.rowPitchDeg
    expect(spineLook(0, false)).toEqual({ pitch: rows[0] * D, yaw: SPINE_SWEEP.yawDeg * D, roll: 0 })
    const end = spineLook(SPINE_SWEEP.rowS - SPINE_SWEEP.backS - 1e-6, false)
    expect(end.pitch).toBeCloseTo(rows[0] * D, 6)
    expect(end.yaw).toBeCloseTo(-SPINE_SWEEP.yawDeg * D, 4)
    // the next row starts at its left end
    expect(spineLook(SPINE_SWEEP.rowS, false)).toEqual({ pitch: rows[1] * D, yaw: SPINE_SWEEP.yawDeg * D, roll: 0 })
    // round again after the last row
    expect(spineLook(rows.length * SPINE_SWEEP.rowS, false).pitch).toBeCloseTo(rows[0] * D, 6)
    // never a jump: frame to frame (60 fps) the head moves a little
    let last = spineLook(0, false)
    for (let u = 1 / 60; u < 3 * rows.length * SPINE_SWEEP.rowS; u += 1 / 60) {
      const h = spineLook(u, false)
      expect(Math.abs(h.yaw - last.yaw) + Math.abs(h.pitch - last.pitch)).toBeLessThan(3 * D)
      last = h
    }
  })

  it('reduced motion: still, looking at the shelf', () => {
    expect(spineLook(5, true)).toEqual(spineLook(17, true))
    expect(spineLook(5, true).yaw).toBe(0)
  })
})

describe('a watcher whose game broke (#718, play.md 9.7 ②)', () => {
  it('is puzzled (의문, 1 s) as the game breaks, once (the same key), and not for a visitor arriving later', () => {
    let seen = 0
    for (const d of [20_400, 20_401]) {
      const plan = dayPlan(d, FIVE)
      for (const [i, segs] of plan.entries())
        for (const w of segs) {
          if (w.kind !== 'watch' || w.end - w.start < 30_000) continue
          const game = plan.flat().find((x) => x.kind === w.watch && x.partner && x.pairAt! <= w.start && x.end > w.start)
          if (!game) continue
          const broke = w.start + 10_000
          const alone = { broken: new Map([[game.stay, broke]]) }
          const busy = new Set([game.partner!])
          const at = (t: number) => playAt(t, FIVE, busy, alone)[FIVE[i]]
          const first = at(broke + 500)
          expect(first.cue).toMatchObject({ expr: 'question', dur: BROKE_QUESTION_S })
          expect(at(broke + 3_000).cue?.key).toBe(first.cue!.key)
          expect(at(broke + 6_000).cue).toBeUndefined()
          seen++
        }
      if (seen > 5) break
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('the director hands the cue on as the goal face cue (rig.faceEvent once per key)', () => {
    const plan = dayPlan(20_400, FIVE)
    for (const [i, segs] of plan.entries())
      for (const w of segs) {
        if (w.kind !== 'watch' || w.end - w.start < 30_000) continue
        const game = plan.flat().find((x) => x.kind === w.watch && x.partner && x.pairAt! <= w.start && x.end > w.start)
        if (!game) continue
        const d = new Director(FIVE)
        const t = w.start + 10_000
        // the partner went to work half a second ago (the status's own time)
        const status: StatusMap = Object.fromEntries(FIVE.map((a) => [a, a === game.partner ? { state: 'working' as const, since: t - 500 } : { state: 'idle' as const, since: 0 }]))
        const g = d.goals(t, Math.floor(t / 60000), status, () => null)[FIVE[i]]
        expect(g.faceCue, JSON.stringify(g)).toMatchObject({ expr: 'question', dur: BROKE_QUESTION_S })
        return
      }
    throw new Error('no watcher in the plan')
  })
})

describe('?debug=1: one left at a forced ping-pong game (#718)', () => {
  const T = planDay(20_400 * 86_400_000).start + 10 * 3_600_000
  it('aloneChain: the tidy-up, the stroll for 30 s, then the fill chain (never the table)', () => {
    expect(aloneChain(T + 2_000, FIVE, 'agent_1', T, T + 6 * 60_000)).toMatchObject({ kind: 'gap', gap: 'tidy', label: '탁구 · 정리하는 중' })
    const s = aloneChain(T + TIDY_MS + 5_000, FIVE, 'agent_1', T, T + 6 * 60_000)
    expect(s).toMatchObject({ kind: 'gap', gap: 'wander' })
    const later = aloneChain(T + TIDY_MS + 40_000, FIVE, 'agent_1', T, T + 6 * 60_000)
    expect(later.since).toBe(T + TIDY_MS + 30_000)
    expect(['pingpong_a', 'pingpong_b']).not.toContain(later.spot)
  })

  it('Director.forceAlone: the agent follows it while it lasts, then the schedule again', () => {
    const d = new Director(FIVE)
    const idle: StatusMap = Object.fromEntries(FIVE.map((a) => [a, { state: 'idle' as const, since: 0 }]))
    d.forceAlone('agent_1', T, 2)
    const g = d.goals(T + 5_000, Math.floor(T / 60000), idle, () => null).agent_1
    expect(g).toMatchObject({ pose: 'idle', gap: 'tidy', spot: aloneChain(T + 5_000, FIVE, 'agent_1', T, T + 120_000).spot })
    // over: forgotten, the schedule again
    d.goals(T + 130_000, Math.floor(T / 60000) + 2, idle, () => null)
    expect((d as unknown as { forcedAlone: unknown }).forcedAlone).toBeNull()
  })
})
