import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANNOUNCE_GROUP_MS, announceText, approvalName, arrivals, groupAnnouncements, loadSeenAt, saveSeenAt, seenNow, showDot, unseenOf, type Waiting } from './unseen'

const w = (id: number, at: string, label: string | null = null): Waiting => ({ id, at, label })
const T = (s: string) => Date.parse(s)

describe('the dot rules', () => {
  const items = [w(1, '2026-11-10T01:00:00Z'), w(2, '2026-11-10T03:00:00Z')]

  it('a new item after the last opening is unseen', () => {
    expect(unseenOf(items, T('2026-11-10T02:00:00Z')).map((x) => x.id)).toEqual([2])
  })
  it('nothing newer than the last opening: no dot', () => {
    expect(unseenOf(items, T('2026-11-10T04:00:00Z'))).toEqual([])
  })
  it('a first visit (nothing stored) has nothing new', () => {
    expect(unseenOf(items, null)).toEqual([])
  })
  it('a count of 0 never shows a dot, whatever was new', () => {
    expect(showDot(0, 3)).toBe(false)
    expect(showDot(null, 3)).toBe(false)
    expect(showDot(2, 0)).toBe(false)
    expect(showDot(2, 1)).toBe(true)
  })
  it('opening clears: the stored time moves past every item', () => {
    const at = seenNow(items, T('2026-11-10T02:00:00Z'))
    expect(at).toBe(T('2026-11-10T03:00:00Z')) // the server clock may be ahead of the browser
    expect(unseenOf(items, at)).toEqual([])
  })
  it('the count chip and the dot are separate: 3 waiting, 1 new', () => {
    expect(showDot(3, 1)).toBe(true)
    expect(approvalName(3, 1)).toBe('결재함, 대기 3건, 새 결재 1건')
  })
})

describe('words for the screen reader', () => {
  it('the button name: the phrase for new ones only when the dot shows', () => {
    expect(approvalName(3, 1)).toBe('결재함, 대기 3건, 새 결재 1건')
    expect(approvalName(3, 0)).toBe('결재함, 대기 3건')
    expect(approvalName(0, 2)).toBe('결재함, 대기 0건')
    expect(approvalName(null, 0)).toBe('결재함')
  })
  it('one new item names itself (the owner: who and what; a visitor: 결재 서류)', () => {
    expect(announceText([w(1, 'x', '메모: 5인 책상 배치')])).toBe('새 결재 1건 · 메모: 5인 책상 배치')
    expect(announceText([w(1, 'x', null)])).toBe('새 결재 1건 · 결재 서류')
  })
  it('several are counted, not listed', () => {
    expect(announceText([w(1, 'x', 'a'), w(2, 'x', 'b'), w(3, 'x', 'c')])).toBe('새 결재 3건')
  })
})

describe('what counts as arriving', () => {
  it('the first look of a visit is not news', () => {
    expect(arrivals(null, [w(1, 'x')])).toEqual([])
  })
  it('ids not seen last time are', () => {
    expect(arrivals(new Set([1]), [w(1, 'x'), w(2, 'y')]).map((x) => x.id)).toEqual([2])
  })
})

describe('the 5 s grouping', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('says nothing while nothing arrives', () => {
    const say = vi.fn()
    groupAnnouncements(say)
    vi.advanceTimersByTime(60_000)
    expect(say).not.toHaveBeenCalled()
  })
  it('three arrivals inside 5 s are said once, together', () => {
    const say = vi.fn()
    const g = groupAnnouncements(say)
    g.add([w(1, 'x')])
    vi.advanceTimersByTime(2000)
    g.add([w(2, 'x')])
    vi.advanceTimersByTime(2000)
    g.add([w(3, 'x')])
    expect(say).not.toHaveBeenCalled()
    vi.advanceTimersByTime(ANNOUNCE_GROUP_MS)
    expect(say).toHaveBeenCalledTimes(1)
    expect(say.mock.calls[0][0].map((x: Waiting) => x.id)).toEqual([1, 2, 3])
  })
  it('the same item twice counts once', () => {
    const say = vi.fn()
    const g = groupAnnouncements(say)
    g.add([w(1, 'x')])
    g.add([w(1, 'x')])
    vi.advanceTimersByTime(ANNOUNCE_GROUP_MS)
    expect(say.mock.calls[0][0]).toHaveLength(1)
  })
  it('a later arrival starts a new group', () => {
    const say = vi.fn()
    const g = groupAnnouncements(say)
    g.add([w(1, 'x')])
    vi.advanceTimersByTime(ANNOUNCE_GROUP_MS)
    g.add([w(2, 'x')])
    vi.advanceTimersByTime(ANNOUNCE_GROUP_MS)
    expect(say).toHaveBeenCalledTimes(2)
  })
  it('cancel (sign-out) drops what was held', () => {
    const say = vi.fn()
    const g = groupAnnouncements(say)
    g.add([w(1, 'x')])
    g.cancel()
    vi.advanceTimersByTime(ANNOUNCE_GROUP_MS * 2)
    expect(say).not.toHaveBeenCalled()
  })
})

describe('the stored time (localStorage, wrapped in try/catch)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('round-trips', () => {
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) })
    expect(loadSeenAt()).toBeNull()
    saveSeenAt(1234)
    expect(loadSeenAt()).toBe(1234)
  })
  it('blocked storage does not throw', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    expect(loadSeenAt()).toBeNull()
    expect(() => saveSeenAt(1)).not.toThrow()
  })
})
