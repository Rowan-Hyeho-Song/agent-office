// Day-at-a-time viewing of the timelapse (#362, docs/design/timelapse.md 10): which days have points, which day opens,
// the neighbours of a day, the date picker's grid and the bar's hour ticks. Pure (no DOM, no store). Every day is a day
// of the office's clock, Seoul time (the same `kst` as engine.ts), written `YYYY-MM-DD`.

import type { Point } from '../timeline/types'
import { atMs, kst } from './engine'

const p2 = (n: number) => String(n).padStart(2, '0')
const DOW_LONG = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']
const DOW_SHORT = ['일', '월', '화', '수', '목', '금', '토']

/** `2026-11-08`: the Seoul day of a moment (ms since the epoch) */
export function dayId(ms: number): string {
  const k = kst(ms)
  return `${k.y}-${p2(k.m)}-${p2(k.d)}`
}
const parts = (id: string) => {
  const [y, m, d] = id.split('-').map(Number)
  return { y, m, d }
}
const utc = (id: string) => {
  const { y, m, d } = parts(id)
  return Date.UTC(y, m - 1, d)
}
const fromUtc = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}
/** 0 = Sunday */
export const weekdayOf = (id: string) => new Date(utc(id)).getUTCDay()
/** `11.08 일` */
export const dayText = (id: string) => `${id.slice(5, 7)}.${id.slice(8, 10)} ${DOW_SHORT[weekdayOf(id)]}`
export const addDays = (id: string, n: number) => fromUtc(utc(id) + n * 86_400_000)
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export interface DayInfo {
  id: string
  /** the day's points are `points[lo..hi]` of the list the days were made from */
  lo: number
  hi: number
  count: number
  /** the first point's time, ms */
  at: number
}

/** the days that have points, oldest first (`points` sorted by time, as `prepare` gives them) */
export function daysOf(points: readonly Point[]): DayInfo[] {
  const out: DayInfo[] = []
  points.forEach((p, k) => {
    const id = dayId(atMs(p))
    const last = out[out.length - 1]
    if (last && last.id === id) {
      last.hi = k
      last.count++
    } else out.push({ id, lo: k, hi: k, count: 1, at: atMs(p) })
  })
  return out
}

/** the day to show for a wanted day: itself, else the nearest earlier day with points, else the nearest later (null when there are none) */
export function pickDay(days: readonly DayInfo[], want: string): DayInfo | null {
  let before: DayInfo | null = null
  for (const d of days) {
    if (d.id === want) return d
    if (d.id < want) before = d
    else return before ?? d
  }
  return before
}

/** the opening day: the latest day that has points (timelapse.md 10.5) */
export const openingDay = (days: readonly DayInfo[]): DayInfo | null => days[days.length - 1] ?? null

/** the previous / next day that has points (days without any are skipped); null at the first / last */
export function adjacentDay(days: readonly DayInfo[], id: string, dir: 1 | -1): DayInfo | null {
  if (dir > 0) return days.find((d) => d.id > id) ?? null
  for (let k = days.length - 1; k >= 0; k--) if (days[k].id < id) return days[k]
  return null
}

/** `이전 날: 11.06 금 · 점 29개` */
export const navLabel = (dir: 1 | -1, to: DayInfo) => `${dir < 0 ? '이전' : '다음'} 날: ${dayText(to.id)} · 점 ${to.count}개`
/** `11.08 일, 점 210개` (the announcement after the day changed) */
export const announceText = (d: Pick<DayInfo, 'id' | 'count'>) => `${dayText(d.id)}, 점 ${d.count}개`
/** the card at the end of a day: `11.07 토 끝 · 점 18개` */
export const endText = (d: Pick<DayInfo, 'id' | 'count'>) => `${dayText(d.id)} 끝 · 점 ${d.count}개`

// ---- the calendar --------------------------------------------------------------------------------------------------

export interface YearMonth {
  y: number
  m: number
}
export const monthOf = (id: string): YearMonth => ({ y: parts(id).y, m: parts(id).m })
const monthIndex = (ym: YearMonth) => ym.y * 12 + ym.m - 1
const fromIndex = (n: number): YearMonth => ({ y: Math.floor(n / 12), m: (n % 12) + 1 })

/** the first and last month that has points */
export function monthRange(days: readonly DayInfo[]): { first: YearMonth; last: YearMonth } | null {
  return days.length ? { first: monthOf(days[0].id), last: monthOf(days[days.length - 1].id) } : null
}

/** the next month in a direction that has points (the calendar's ‹ › skip months without any); null at the ends */
export function shiftMonth(days: readonly DayInfo[], from: YearMonth, dir: 1 | -1): YearMonth | null {
  const at = monthIndex(from)
  const ms = [...new Set(days.map((d) => monthIndex(monthOf(d.id))))].sort((a, b) => a - b)
  const next = dir > 0 ? ms.find((m) => m > at) : [...ms].reverse().find((m) => m < at)
  return next === undefined ? null : fromIndex(next)
}

/** a bar under a day's number: 2, 4 or 6 px by how much was done that day against the busiest day shown */
export function barHeight(count: number, max: number): 0 | 2 | 4 | 6 {
  if (count <= 0 || max <= 0) return 0
  const r = count / max
  return r <= 1 / 3 ? 2 : r <= 2 / 3 ? 4 : 6
}

export interface Cell {
  id: string
  day: number
  count: number
  /** has points: can be picked */
  enabled: boolean
  bar: 0 | 2 | 4 | 6
  /** `11월 8일 일요일, 점 210개` or `11월 9일 월요일, 일 없음` */
  name: string
}

export const cellName = (id: string, count: number) => {
  const { m, d } = parts(id)
  return `${m}월 ${d}일 ${DOW_LONG[weekdayOf(id)]}, ${count > 0 ? `점 ${count}개` : '일 없음'}`
}

/** a month as weeks of seven (Sunday first); `null` pads the days of the neighbouring months */
export function monthWeeks(ym: YearMonth, days: readonly DayInfo[]): (Cell | null)[][] {
  const counts = new Map(days.map((d) => [d.id, d.count]))
  const max = Math.max(0, ...days.filter((d) => d.id.startsWith(`${ym.y}-${p2(ym.m)}`)).map((d) => d.count))
  const lead = weekdayOf(`${ym.y}-${p2(ym.m)}-01`)
  const cells: (Cell | null)[] = Array(lead).fill(null)
  for (let d = 1; d <= daysInMonth(ym.y, ym.m); d++) {
    const id = `${ym.y}-${p2(ym.m)}-${p2(d)}`
    const count = counts.get(id) ?? 0
    cells.push({ id, day: d, count, enabled: count > 0, bar: barHeight(count, max), name: cellName(id, count) })
  }
  while (cells.length % 7) cells.push(null)
  const weeks: (Cell | null)[][] = []
  for (let k = 0; k < cells.length; k += 7) weeks.push(cells.slice(k, k + 7))
  return weeks
}

/** the title: `2026년 11월` */
export const monthTitle = (ym: YearMonth) => `${ym.y}년 ${ym.m}월`

/** where the arrow keys in the calendar move the focus (APG date picker): day, week, month, start / end of the week; kept inside the months that have points */
export function moveFocus(id: string, key: string, days: readonly DayInfo[]): string {
  const range = monthRange(days)
  let next = id
  const { y, m, d } = parts(id)
  const month = (n: number) => {
    const t = fromIndex(monthIndex({ y, m }) + n)
    return `${t.y}-${p2(t.m)}-${p2(Math.min(d, daysInMonth(t.y, t.m)))}`
  }
  switch (key) {
    case 'ArrowLeft': next = addDays(id, -1); break
    case 'ArrowRight': next = addDays(id, 1); break
    case 'ArrowUp': next = addDays(id, -7); break
    case 'ArrowDown': next = addDays(id, 7); break
    case 'PageUp': next = month(-1); break
    case 'PageDown': next = month(1); break
    case 'Home': next = addDays(id, -weekdayOf(id)); break
    case 'End': next = addDays(id, 6 - weekdayOf(id)); break
    default: return id
  }
  if (!range) return id
  const lo = `${range.first.y}-${p2(range.first.m)}-01`
  const hi = `${range.last.y}-${p2(range.last.m)}-${p2(daysInMonth(range.last.y, range.last.m))}`
  return next < lo ? lo : next > hi ? hi : next
}

// ---- the bar's hour ticks ------------------------------------------------------------------------------------------

export interface HourTick {
  /** the point the tick stands before */
  k: number
  /** `14시`, or null when the previous label is nearer than `minGap` px (only the tick is drawn) */
  label: string | null
}

/** a tick before every point whose Seoul hour differs from the point before it; the first point carries the first label */
export function hourTicks(points: readonly Point[], xs: readonly number[], minGap = 48): HourTick[] {
  const out: HourTick[] = []
  let lastLabelX = -Infinity
  points.forEach((p, k) => {
    const h = kst(atMs(p)).h
    if (k > 0 && kst(atMs(points[k - 1])).h === h) return
    const x = xs[k]
    const label = x - lastLabelX >= minGap ? `${h}시` : null
    if (label) lastLabelX = x
    out.push({ k, label })
  })
  return out
}
