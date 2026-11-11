import { describe, expect, it } from 'vitest'
import agentOffice from '../timeline/fixtures/agent-office.json'
import hub from '../timeline/fixtures/test/rowansong.dev.2026-11-08.json'
import type { Point } from '../timeline/types'
import { adjacentDay, announceText, barHeight, cellName, dayId, dayText, daysOf, endText, hourTicks, monthRange, monthWeeks, moveFocus, navLabel, openingDay, pickDay, shiftMonth } from './days'
import { atMs, prepare } from './engine'

const pt = (at: string, key = at): Point => ({ key, project: 'o/a', at, kind: 'work', agent: 0, title: key, secret: false, additions: 1, deletions: 0, files: 1, issue: null, pr: null, tier: 'public' })
const ALL_POINTS = [...(agentOffice.points as unknown as Point[]), ...(hub.points as unknown as Point[])]

describe('a day is a day of the office clock (Seoul time)', () => {
  it('the day changes at 15:00 UTC', () => {
    expect(dayId(Date.parse('2026-11-07T14:59:59Z'))).toBe('2026-11-07')
    expect(dayId(Date.parse('2026-11-07T15:00:00Z'))).toBe('2026-11-08')
    expect(dayId(Date.parse('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
  })
  it('groups sorted points into days with their index range', () => {
    const pts = [pt('2026-11-07T01:00:00Z'), pt('2026-11-07T14:59:59Z'), pt('2026-11-07T15:00:00Z'), pt('2026-11-09T03:00:00Z')]
    const days = daysOf(pts)
    expect(days.map((d) => [d.id, d.lo, d.hi, d.count])).toEqual([['2026-11-07', 0, 1, 2], ['2026-11-08', 2, 2, 1], ['2026-11-09', 3, 3, 1]])
    expect(days[0].at).toBe(Date.parse('2026-11-07T01:00:00Z'))
  })
  it('the fixtures: the days that have data', () => {
    const days = daysOf(prepare(ALL_POINTS))
    expect(days.map((d) => d.id)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'])
    expect(days.reduce((a, d) => a + d.count, 0)).toBe(ALL_POINTS.length)
    // 11.08 is the busy day and 11.09 has nothing
    expect(days.find((d) => d.id === '2026-11-08')!.count).toBe(210)
  })
  it('weekday text', () => {
    expect(dayText('2026-11-07')).toBe('11.07 토')
    expect(dayText('2026-11-08')).toBe('11.08 일')
  })
})

describe('which day, and the neighbours', () => {
  const days = daysOf([pt('2026-11-05T03:00:00Z'), pt('2026-11-07T03:00:00Z'), pt('2026-11-07T04:00:00Z'), pt('2026-11-10T03:00:00Z')])
  it('opens on the latest day that has points', () => {
    expect(openingDay(days)!.id).toBe('2026-11-10')
    expect(openingDay([])).toBeNull()
  })
  it('previous / next skip days without points and end at the first / last', () => {
    expect(adjacentDay(days, '2026-11-07', -1)!.id).toBe('2026-11-05')
    expect(adjacentDay(days, '2026-11-07', 1)!.id).toBe('2026-11-10')
    expect(adjacentDay(days, '2026-11-05', -1)).toBeNull()
    expect(adjacentDay(days, '2026-11-10', 1)).toBeNull()
    // from a day that has none: the nearest on that side
    expect(adjacentDay(days, '2026-11-08', -1)!.id).toBe('2026-11-07')
    expect(adjacentDay(days, '2026-11-08', 1)!.id).toBe('2026-11-10')
  })
  it('a day without points falls back to the nearest earlier, else the first later', () => {
    expect(pickDay(days, '2026-11-07')!.id).toBe('2026-11-07')
    expect(pickDay(days, '2026-11-09')!.id).toBe('2026-11-07')
    expect(pickDay(days, '2026-11-01')!.id).toBe('2026-11-05')
    expect(pickDay(days, '2027-01-01')!.id).toBe('2026-11-10')
    expect(pickDay([], '2026-11-07')).toBeNull()
  })
  it('words: the arrow names the day it goes to, the end card and the announcement', () => {
    const d = { id: '2026-11-06', count: 29, lo: 0, hi: 0, at: 0 }
    expect(navLabel(-1, d)).toBe('이전 날: 11.06 금 · 점 29개')
    expect(navLabel(1, d)).toBe('다음 날: 11.06 금 · 점 29개')
    expect(announceText({ id: '2026-11-08', count: 210 })).toBe('11.08 일, 점 210개')
    expect(endText({ id: '2026-11-07', count: 18 })).toBe('11.07 토 끝 · 점 18개')
  })
})

describe('the calendar', () => {
  const days = daysOf(prepare(ALL_POINTS))
  it('enables exactly the days that have data, with their counts, in a Sunday-first grid', () => {
    const weeks = monthWeeks({ y: 2026, m: 11 }, days)
    const cells = weeks.flat().filter((c) => c !== null)
    expect(cells).toHaveLength(30)
    expect(cells.filter((c) => c.enabled).map((c) => [c.id, c.count])).toEqual([['2026-11-05', 5], ['2026-11-06', 29], ['2026-11-07', 18], ['2026-11-08', 210]])
    // Nov 1 2026 is a Sunday: the first week has no padding; every week has seven cells
    expect(weeks[0][0]!.day).toBe(1)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(cells.find((c) => c.id === '2026-11-09')!.name).toBe('11월 9일 월요일, 일 없음')
    expect(cells.find((c) => c.id === '2026-11-08')!.name).toBe('11월 8일 일요일, 점 210개')
  })
  it('the bar under a day has three heights against the busiest day', () => {
    expect(barHeight(0, 210)).toBe(0)
    expect(barHeight(5, 210)).toBe(2)
    expect(barHeight(29, 210)).toBe(2)
    expect(barHeight(100, 210)).toBe(4)
    expect(barHeight(210, 210)).toBe(6)
    const cells = monthWeeks({ y: 2026, m: 11 }, days).flat().filter((c) => c)
    expect(cells.find((c) => c!.id === '2026-11-08')!.bar).toBe(6)
    expect(cells.find((c) => c!.id === '2026-11-09')!.bar).toBe(0)
  })
  it('months move only between months that have data', () => {
    const two = daysOf([pt('2026-09-05T03:00:00Z'), pt('2026-11-05T03:00:00Z')])
    expect(monthRange(two)).toEqual({ first: { y: 2026, m: 9 }, last: { y: 2026, m: 11 } })
    expect(shiftMonth(two, { y: 2026, m: 11 }, -1)).toEqual({ y: 2026, m: 9 })
    expect(shiftMonth(two, { y: 2026, m: 9 }, 1)).toEqual({ y: 2026, m: 11 })
    expect(shiftMonth(two, { y: 2026, m: 11 }, 1)).toBeNull()
    expect(shiftMonth(two, { y: 2026, m: 9 }, -1)).toBeNull()
  })
  it('the arrow keys: a day, a week, a month, the week ends; kept inside the months with data', () => {
    expect(moveFocus('2026-11-08', 'ArrowLeft', days)).toBe('2026-11-07')
    expect(moveFocus('2026-11-08', 'ArrowRight', days)).toBe('2026-11-09')
    expect(moveFocus('2026-11-08', 'ArrowUp', days)).toBe('2026-11-01')
    expect(moveFocus('2026-11-08', 'ArrowDown', days)).toBe('2026-11-15')
    expect(moveFocus('2026-11-11', 'Home', days)).toBe('2026-11-08')
    expect(moveFocus('2026-11-11', 'End', days)).toBe('2026-11-14')
    // only November has data: Page keys and the edges stop at its ends
    expect(moveFocus('2026-11-08', 'PageDown', days)).toBe('2026-11-30')
    expect(moveFocus('2026-11-08', 'PageUp', days)).toBe('2026-11-01')
    expect(moveFocus('2026-11-01', 'ArrowLeft', days)).toBe('2026-11-01')
    expect(moveFocus('2026-11-08', 'a', days)).toBe('2026-11-08')
  })
  it('cell names', () => {
    expect(cellName('2026-11-07', 18)).toBe('11월 7일 토요일, 점 18개')
  })
})

describe('the bar of a day has hour ticks', () => {
  const pts = [pt('2026-11-07T01:00:00Z', 'a'), pt('2026-11-07T01:30:00Z', 'b'), pt('2026-11-07T02:05:00Z', 'c'), pt('2026-11-07T02:20:00Z', 'd'), pt('2026-11-07T05:00:00Z', 'e')]
  it('one tick where the Seoul hour changes, the first point carries the first label', () => {
    const ticks = hourTicks(pts, [8, 16, 24, 32, 40], 48)
    // hours (KST): 10, 10, 11, 11, 14
    expect(ticks.map((t) => t.k)).toEqual([0, 2, 4])
    expect(ticks[0].label).toBe('10시')
  })
  it('a label closer than 48 px to the last label is left out, the tick stays', () => {
    expect(hourTicks(pts, [8, 16, 24, 32, 40], 48).map((t) => t.label)).toEqual(['10시', null, null])
    expect(hourTicks(pts, [8, 16, 100, 108, 200], 48).map((t) => t.label)).toEqual(['10시', '11시', '14시'])
  })
})

it('the points are read by the same clock as the engine', () => {
  expect(dayId(atMs(ALL_POINTS[0]))).toMatch(/^2026-11-0\d$/)
})
