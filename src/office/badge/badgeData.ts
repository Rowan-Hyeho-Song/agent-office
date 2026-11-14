// What the agent's badge (사원증, office-ui.md 12.1a, #4) says, from the timeline's points: the day it joined, what it did today and
// the barcode with its machine number. Pure (no DOM, no store) so the tests can drive it. Days are the office's clock, Seoul time.

import { dayId } from '../../replay/days'
import type { Point, PointKind } from '../../timeline/types'

/** the badge's label for a private or SECRET point's title (12.1: never its words) */
export const PRIVATE_LABEL = '비공개 작업'

/** the agent's machine number (agents.md: RB-10..14, the last digit is the seat) */
export const machineNo = (seat: number) => `RB-1${seat}`

/** `SEAT 02` */
export const seatLabel = (seat: number) => `SEAT ${String(seat).padStart(2, '0')}`

/** `2026.11.08`: the Seoul day of the agent's first point on the timeline; null before it has any */
export function joinedDate(points: readonly Point[], seat: number): string | null {
  let first = Infinity
  for (const p of points) {
    if (p.agent !== seat) continue
    const t = Date.parse(p.at)
    if (t < first) first = t
  }
  return Number.isFinite(first) ? dayId(first).replaceAll('-', '.') : null
}

const todayOf = (points: readonly Point[], seat: number, now: number) => {
  const today = dayId(now)
  return points.filter((p) => p.agent === seat && Date.parse(p.at) <= now && dayId(Date.parse(p.at)) === today)
}

/** 12.1: 작업 · 회의록 · 결정 (the kinds a visitor would call "done today"; plans, approvals and deploys are not counted) */
const COUNTED: { kind: PointKind; label: string }[] = [
  { kind: 'work', label: '작업' },
  { kind: 'minutes', label: '회의록' },
  { kind: 'decision', label: '결정' },
]

/** `오늘 작업 5 · 회의록 2`: the kinds with at least one point today; `오늘 아직 기록 없음` without any */
export function todayLine(points: readonly Point[], seat: number, now: number): string {
  const mine = todayOf(points, seat, now)
  const parts = COUNTED.map(({ kind, label }) => ({ label, n: mine.filter((p) => p.kind === kind).length }))
    .filter((c) => c.n > 0)
    .map((c) => `${c.label} ${c.n}`)
  return parts.length ? `오늘 ${parts.join(' · ')}` : '오늘 아직 기록 없음'
}

/** the newest `n` points of today, newest first: the first line of the title, or PRIVATE_LABEL for a SECRET one */
export function recentToday(points: readonly Point[], seat: number, now: number, n = 3): { key: string; text: string; at: string }[] {
  return todayOf(points, seat, now)
    .filter((p) => COUNTED.some((c) => c.kind === p.kind))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, n)
    .map((p) => ({ key: p.key, at: p.at, text: p.secret || !p.title.trim() ? PRIVATE_LABEL : p.title.split('\n')[0].trim() }))
}

/**
 * The pixel barcode (decoration, aria-hidden): bar widths 1..3 from the machine number, the same for a seat every time.
 * Not a real symbology; it only has to look like one.
 */
export function barcode(seat: number, bars = 18): number[] {
  let x = 0x9e3779b1 ^ (seat + 10) * 2654435761
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    out.push(1 + ((x >>> 0) % 3))
  }
  return out
}
