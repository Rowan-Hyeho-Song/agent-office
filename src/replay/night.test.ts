// #599 (timelapse.md 13.2 · 13.3, #641 night runs) the empty night: a step at night (KST 23–09) where nobody works in the replay status. A night run
// goes from an empty step to the first step where someone works (or past 09:00); the meetings and deploys in it walk at the chosen speed without
// breaking it. A run with 4 or more empty steps passes them at x16 when x1 / x4 is chosen, the chip on for the whole run. A day opens past its
// leading empty night steps, at the one just before the first that is not.

import { describe, expect, it } from 'vitest'
import type { Point } from '../timeline/types'
import { emptyNightAt, nightKinds, nightRuns, NIGHT_RUN_MIN, openingIndex, remainingMs, stepMs } from './engine'
import { ReplayStore } from './store'

let n = 0
const pt = (ms: number, over: Partial<Point> = {}): Point => ({
  key: `k${n++}`, project: 'o/r', at: new Date(ms).toISOString(), kind: 'work', agent: null, title: 't', secret: false, additions: 1, deletions: 0, files: 1, issue: 1, pr: null, tier: 'public', ...over,
})
/** a KST time of day on 2026-11-12 as epoch ms */
const kst = (h: number, m = 0) => Date.parse(`2026-11-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)

// a night of points nobody's body works on (agent null, the '역할 분담 이전' lane), broken by bodies at work, with a meeting and a deploy in it
const NIGHT = [
  pt(kst(0, 10)), // 0 empty ┐ run 0
  pt(kst(0, 20)), // 1 empty │
  pt(kst(0, 30)), // 2 empty │
  pt(kst(0, 40)), // 3 empty │
  pt(kst(0, 50), { kind: 'minutes' }), // 4 a meeting: walks, the run goes on
  pt(kst(1, 0)), // 5 empty ┘
  pt(kst(1, 10), { agent: 3 }), // 6 루프 works: the run ends
  pt(kst(1, 15)), // 7 루프's point is 5 minutes old: still at work
  pt(kst(1, 30)), // 8 empty ┐ only three: not passed
  pt(kst(1, 40)), // 9 empty │
  pt(kst(1, 50)), // 10 empty ┘
  pt(kst(2, 0), { agent: 1 }), // 11 메시 works
  pt(kst(3, 0)), // 12 empty ┐ run 1
  pt(kst(3, 10), { kind: 'deploy' }), // 13 a deploy: walks
  pt(kst(3, 20)), // 14 empty │
  pt(kst(3, 30)), // 15 empty │
  pt(kst(3, 40)), // 16 empty ┘
  pt(kst(9, 10)), // 17 morning: past 09:00
]
const KINDS = ['empty', 'empty', 'empty', 'empty', 'event', 'empty', 'day', 'day', 'empty', 'empty', 'empty', 'day', 'empty', 'event', 'empty', 'empty', 'empty', 'day']
const RUNS = [0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, -1]

async function opened() {
  const s = new ReplayStore()
  s.source = async () => NIGHT
  s.reduced = () => true
  await s.open({ mode: 'office', project: 'o/r', day: '2026-11-12' })
  return s
}
/** play on to the next point */
const next = (s: ReplayStore) => s.advance(stepMs(s.point!) + 1)
const at = (s: ReplayStore) => {
  const { i, speed, rate, night } = s.getSnapshot()
  return { i, speed, rate, night }
}

describe('the night steps and runs (13.2, #641)', () => {
  it('empty: at night with nobody at work; a meeting or a deploy is an event; someone at work or 09:00 is day', () => {
    expect(nightKinds(NIGHT, 0, NIGHT.length)).toEqual(KINDS)
    expect(emptyNightAt([pt(kst(8, 59))], 0)).toBe(true)
    expect(emptyNightAt([pt(kst(22, 59))], 0)).toBe(false)
    expect(emptyNightAt([pt(kst(23, 0))], 0)).toBe(true)
  })
  it('a run goes from an empty step to the next day step, events inside; under 4 empty steps is none', () => {
    expect(NIGHT_RUN_MIN).toBe(4)
    expect(nightRuns(KINDS as never)).toEqual(RUNS)
    // a leading event is not in the run (it starts at its first empty step); a trailing one is
    expect(nightRuns(['event', 'empty', 'empty', 'empty', 'empty', 'event', 'day'])).toEqual([-1, 0, 0, 0, 0, 0, -1])
    expect(nightRuns(['empty', 'event', 'empty', 'event', 'empty', 'day'])).toEqual([-1, -1, -1, -1, -1, -1])
  })
  it('a day opens past its leading empty night, at the step just before the first that is not (13.3)', () => {
    expect(openingIndex(KINDS.map((k) => k === 'empty'))).toBe(3)
    expect(openingIndex([false, true])).toBe(0)
    expect(openingIndex([true, false])).toBe(0)
    expect(openingIndex([true, true])).toBe(0)
    expect(openingIndex([])).toBe(0)
  })
})

describe('the store over a night run', () => {
  it('opens at the step before the first that is not empty, at the chosen speed with no chip', async () => {
    const s = await opened()
    expect(s.getSnapshot()).toMatchObject({ i: 3, speed: 1, rate: 1, night: null, playing: true })
  })
  it('the chip stays on through the whole run: a meeting walks at the chosen speed, the empty steps go at x16', async () => {
    const s = await opened()
    s.seek(0)
    expect(at(s)).toEqual({ i: 0, speed: 1, rate: 16, night: 'fast' })
    next(s)
    next(s)
    next(s)
    next(s)
    expect(at(s)).toEqual({ i: 4, speed: 1, rate: 1, night: 'fast' })
    next(s)
    expect(at(s)).toEqual({ i: 5, speed: 1, rate: 16, night: 'fast' })
    next(s)
    expect(at(s)).toEqual({ i: 6, speed: 1, rate: 1, night: null })
  })
  it('a short run is not passed: no x16, no chip', async () => {
    const s = await opened()
    for (const k of [8, 9, 10]) {
      s.seek(k)
      expect(at(s)).toEqual({ i: k, speed: 1, rate: 1, night: null })
    }
  })
  it('x4 chosen: the run at x16, the buttons stay at x4; x16 chosen: no chip', async () => {
    const s = await opened()
    s.setSpeed(4)
    s.seek(12)
    expect(at(s)).toEqual({ i: 12, speed: 4, rate: 16, night: 'fast' })
    next(s)
    expect(at(s)).toEqual({ i: 13, speed: 4, rate: 4, night: 'fast' })
    s.setSpeed(16)
    expect(at(s)).toEqual({ i: 13, speed: 16, rate: 16, night: null })
  })
  it('the chip pressed: this run at the chosen speed to its end, the deploy in it too; the next run is fast again', async () => {
    const s = await opened()
    s.seek(1)
    s.slowNight()
    expect(at(s)).toEqual({ i: 1, speed: 1, rate: 1, night: 'slow' })
    for (const k of [2, 3, 4, 5]) {
      next(s)
      expect(at(s)).toEqual({ i: k, speed: 1, rate: 1, night: 'slow' })
    }
    next(s)
    expect(at(s).night).toBeNull()
    s.seek(12)
    expect(at(s)).toEqual({ i: 12, speed: 1, rate: 16, night: 'fast' })
    // pressing it in the slow state does nothing more
    s.slowNight()
    s.slowNight()
    expect(at(s).night).toBe('slow')
  })
  it('paused in a run: the chip shows; playing goes at x16 at once', async () => {
    const s = await opened()
    s.pause()
    s.seek(14)
    expect(s.getSnapshot()).toMatchObject({ playing: false, night: 'fast', rate: 16 })
  })
  it('the time left counts the empty steps of the runs at x16 (the opened step, the events and short runs at the chosen speed)', async () => {
    const s = await opened()
    const rates = NIGHT.map((_, k) => s.rateAt(k))
    expect(rates).toEqual([16, 16, 16, 1, 1, 16, 1, 1, 1, 1, 1, 1, 16, 1, 16, 16, 16, 1])
    const fast = [5, 12, 14, 15, 16]
    const left = remainingMs(s.points, 3, (k) => s.rateAt(k))
    expect(left).toBeCloseTo(remainingMs(s.points, 3, 1) - fast.reduce((a, k) => a + stepMs(NIGHT[k]), 0) * (1 - 1 / 16))
    s.seek(0)
    s.slowNight()
    expect(NIGHT.map((_, k) => s.rateAt(k))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 16, 1, 16, 16, 16, 1])
  })
})
