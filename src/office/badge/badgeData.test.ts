import { describe, expect, it } from 'vitest'
import type { Point } from '../../timeline/types'
import { barcode, joinedDate, machineNo, PRIVATE_LABEL, recentToday, seatLabel, todayLine } from './badgeData'

let k = 0
const pt = (over: Partial<Point> & Pick<Point, 'at' | 'kind'>): Point => ({
  key: `k${++k}`, project: 'o/r', agent: 2, title: '제목', secret: false, additions: null, deletions: null, files: null, issue: null, pr: null, tier: 'public', ...over,
})
// 2026-11-14 12:00 KST
const NOW = Date.parse('2026-11-14T03:00:00Z')

describe('the badge', () => {
  it('machine number and seat (agents.md RB-10..14)', () => {
    expect(machineNo(2)).toBe('RB-12')
    expect(seatLabel(2)).toBe('SEAT 02')
  })
  it('JOINED is the Seoul day of the first point of that seat, whatever the order', () => {
    const points = [
      pt({ at: '2026-11-10T01:00:00Z', kind: 'work' }),
      // 2026-11-07 23:30 UTC = 11-08 08:30 KST
      pt({ at: '2026-11-07T23:30:00Z', kind: 'plan' }),
      pt({ at: '2026-11-01T00:00:00Z', kind: 'work', agent: 3 }),
      pt({ at: '2026-10-01T00:00:00Z', kind: 'work', agent: null }),
    ]
    expect(joinedDate(points, 2)).toBe('2026.11.08')
    expect(joinedDate(points, 4)).toBeNull()
  })
  it("today's line counts work · minutes · decisions of Seoul today, up to now", () => {
    const points = [
      pt({ at: '2026-11-14T01:00:00Z', kind: 'work' }),
      pt({ at: '2026-11-14T02:00:00Z', kind: 'work' }),
      pt({ at: '2026-11-14T02:30:00Z', kind: 'minutes' }),
      pt({ at: '2026-11-14T02:40:00Z', kind: 'approval' }), // not counted
      pt({ at: '2026-11-13T14:59:00Z', kind: 'work' }), // 23:59 KST yesterday
      pt({ at: '2026-11-13T15:00:00Z', kind: 'decision' }), // 00:00 KST today
      pt({ at: '2026-11-14T04:00:00Z', kind: 'work' }), // after now
      pt({ at: '2026-11-14T01:00:00Z', kind: 'work', agent: 1 }),
    ]
    expect(todayLine(points, 2, NOW)).toBe('오늘 작업 2 · 회의록 1 · 결정 1')
    expect(todayLine(points, 4, NOW)).toBe('오늘 아직 기록 없음')
  })
  it('the recent three: newest first, first line only, SECRET or empty titles never shown', () => {
    const points = [
      pt({ at: '2026-11-14T01:00:00Z', kind: 'work', title: 'fix: 첫째\n본문' }),
      pt({ at: '2026-11-14T02:00:00Z', kind: 'work', title: '비밀 제목', secret: true }),
      pt({ at: '2026-11-14T02:10:00Z', kind: 'minutes', title: '회의록: 소리' }),
      pt({ at: '2026-11-14T02:20:00Z', kind: 'decision', title: '  ' }),
      pt({ at: '2026-11-14T00:10:00Z', kind: 'work', title: '넷째(밀려남)' }),
    ]
    expect(recentToday(points, 2, NOW).map((r) => r.text)).toEqual([PRIVATE_LABEL, '회의록: 소리', PRIVATE_LABEL])
    expect(recentToday(points, 2, NOW, 5).map((r) => r.text)).toEqual([PRIVATE_LABEL, '회의록: 소리', PRIVATE_LABEL, 'fix: 첫째', '넷째(밀려남)'])
    expect(recentToday(points, 2, NOW).some((r) => r.text.includes('비밀'))).toBe(false)
  })
  it('the barcode is fixed per seat and differs between seats', () => {
    expect(barcode(2)).toEqual(barcode(2))
    expect(barcode(2)).not.toEqual(barcode(3))
    expect(barcode(0).every((w) => w >= 1 && w <= 3)).toBe(true)
    expect(barcode(0)).toHaveLength(18)
  })
})
