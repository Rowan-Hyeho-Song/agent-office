// #599 (timelapse.md 13.2 · 13.3) the empty night: a step at night (KST 23–09) where nobody works in the replay status plays at x16 when x1 / x4 is
// chosen; a day opens past its leading empty night steps, at the one just before the first that is not.

import { describe, expect, it } from 'vitest'
import type { Point } from '../timeline/types'
import { emptyNightAt, emptyNights, openingIndex, remainingMs, stepMs } from './engine'
import { ReplayStore } from './store'

let n = 0
const pt = (ms: number, over: Partial<Point> = {}): Point => ({
  key: `k${n++}`, project: 'o/r', at: new Date(ms).toISOString(), kind: 'work', agent: null, title: 't', secret: false, additions: 1, deletions: 0, files: 1, issue: 1, pr: null, tier: 'public', ...over,
})
/** a KST time of day on 2026-11-12 as epoch ms */
const kst = (h: number, m = 0) => Date.parse(`2026-11-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)

// a night: points nobody's body works on (agent null, the '역할 분담 이전' lane), one body at work at 03:00, a meeting, then the morning
const NIGHT = [
  pt(kst(1, 0)), // 0 empty
  pt(kst(1, 10)), // 1 empty
  pt(kst(2, 0)), // 2 empty
  pt(kst(3, 0), { agent: 3 }), // 3 메모… 루프 works
  pt(kst(3, 20)), // 4 empty: 루프's point is 20 minutes old
  pt(kst(3, 25), { kind: 'minutes' }), // 5 a meeting is never one
  pt(kst(4, 0)), // 6 empty
  pt(kst(9, 10)), // 7 morning: past 09:00
  pt(kst(23, 30)), // 8 empty again: 23:00 is night
]
const WANT = [true, true, true, false, true, false, true, false, true]

async function opened() {
  const s = new ReplayStore()
  s.source = async () => NIGHT
  s.reduced = () => true
  await s.open({ mode: 'office', project: 'o/r', day: '2026-11-12' })
  return s
}
/** play on to the next point */
const next = (s: ReplayStore) => s.advance(stepMs(s.point!) + 1)

describe('an empty night step (13.2)', () => {
  it('is at night with nobody at work; a working body, a meeting, a deploy or 09:00 ends it', () => {
    expect(emptyNights(NIGHT, 0, NIGHT.length)).toEqual(WANT)
    expect(emptyNightAt([pt(kst(2)), pt(kst(2, 5), { kind: 'deploy' })], 1)).toBe(false)
    expect(emptyNightAt([pt(kst(14))], 0)).toBe(false)
    expect(emptyNightAt([pt(kst(8, 59))], 0)).toBe(true)
    expect(emptyNightAt([pt(kst(22, 59))], 0)).toBe(false)
  })
  it('a day opens past its leading empty night, at the step just before the first that is not (13.3)', () => {
    expect(openingIndex(WANT)).toBe(2)
    expect(openingIndex([false, true])).toBe(0)
    expect(openingIndex([true, false])).toBe(0)
    expect(openingIndex([true, true])).toBe(0)
    expect(openingIndex([])).toBe(0)
  })
})

describe('the store over an empty night (13.2 · 13.3)', () => {
  it('opens at the step before the first working one, at the chosen speed with no chip', async () => {
    const s = await opened()
    expect(s.getSnapshot()).toMatchObject({ i: 2, speed: 1, rate: 1, night: null, playing: true })
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 3, rate: 1, night: null })
  })
  it('passes an empty night at x16 with the chip; the buttons stay at the chosen speed', async () => {
    const s = await opened()
    next(s)
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 4, speed: 1, rate: 16, night: 'fast' })
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 5, rate: 1, night: null })
    s.setSpeed(4)
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 6, speed: 4, rate: 16, night: 'fast' })
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 7, speed: 4, rate: 4, night: null })
  })
  it('the chip pressed: this night at the chosen speed, until a step that is not one; the next night is fast again', async () => {
    const s = await opened()
    s.seek(0)
    expect(s.getSnapshot()).toMatchObject({ i: 0, rate: 16, night: 'fast' })
    s.slowNight()
    expect(s.getSnapshot()).toMatchObject({ i: 0, rate: 1, night: 'slow' })
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 1, rate: 1, night: 'slow' })
    next(s)
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 3, night: null })
    next(s)
    expect(s.getSnapshot()).toMatchObject({ i: 4, rate: 16, night: 'fast' })
    // pressing it again does nothing more; a jump forgets it
    s.slowNight()
    s.slowNight()
    expect(s.getSnapshot().night).toBe('slow')
    s.seek(6)
    expect(s.getSnapshot()).toMatchObject({ i: 6, rate: 16, night: 'fast' })
  })
  it('x16 chosen: no chip, nothing changes', async () => {
    const s = await opened()
    s.setSpeed(16)
    s.seek(0)
    expect(s.getSnapshot()).toMatchObject({ rate: 16, night: null })
  })
  it('paused on an empty night step: the chip shows; playing goes at x16 at once', async () => {
    const s = await opened()
    s.pause()
    s.seek(4)
    expect(s.getSnapshot()).toMatchObject({ playing: false, night: 'fast', rate: 16 })
  })
  it('the time left counts the empty night steps at x16 (and the opened step at the chosen speed)', async () => {
    const s = await opened()
    const rates = NIGHT.map((_, k) => s.rateAt(k))
    expect(rates).toEqual([16, 16, 1, 1, 16, 1, 16, 1, 16])
    const left = remainingMs(s.points, 2, (k) => s.rateAt(k))
    expect(left).toBeCloseTo(remainingMs(s.points, 2, 1) - (stepMs(NIGHT[4]) + stepMs(NIGHT[6]) + stepMs(NIGHT[8])) * (1 - 1 / 16))
    s.seek(0)
    s.slowNight()
    expect(NIGHT.map((_, k) => s.rateAt(k))).toEqual([1, 1, 1, 1, 16, 1, 16, 1, 16])
  })
})
