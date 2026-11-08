import { describe, expect, it } from 'vitest'
import { BUBBLE, cardRect, firstSentence, holdMs, maskText, pairSide, placeBubbles, statusTag, typeMs, typedCount, type PlaceInput } from './bubbles'

describe('firstSentence', () => {
  it('takes the first sentence of a cell, plain', () => {
    expect(firstSentence('**셋 다** 그 방향으로 진행. 얼굴은 `screen` 슬롯')).toBe('셋 다 그 방향으로 진행.')
  })
  it('keeps dots inside words', () => {
    expect(firstSentence('v1.2 로 올림')).toBe('v1.2 로 올림')
  })
  it('cuts at 36 characters (--bubble-max-chars) with an ellipsis', () => {
    const out = firstSentence('가'.repeat(60))
    expect([...out]).toHaveLength(36)
    expect(out.endsWith('…')).toBe(true)
  })
  it('keeps a short line as it is', () => {
    expect(firstSentence('네, 볼게요')).toBe('네, 볼게요')
  })
})

describe('timing', () => {
  it('types 28 ms a character, never more than a second', () => {
    expect(typeMs(10)).toBe(280)
    expect(typeMs(36)).toBeCloseTo(1000)
    expect(typedCount(10, 56)).toBe(2)
    expect(typedCount(10, 99999)).toBe(10)
  })
  it('shows everything at once with reduced motion', () => {
    expect(typeMs(30, true)).toBe(0)
    expect(typedCount(30, 0, true)).toBe(30)
  })
  it('holds 1.6 s + 70 ms a character, at most 6 s', () => {
    expect(holdMs(18)).toBe(2860)
    expect(holdMs(500)).toBe(6000)
  })
  it('masks every character but spaces', () => {
    expect(maskText('가나 다')).toBe('██ █')
  })
})

describe('placement', () => {
  const view = { w: 1000, h: 700, narrow: false }
  const item = (over: Partial<PlaceInput>): PlaceInput => ({ id: 'a', order: 1, x: 500, y: 400, w: 200, h: 60, prefSide: 'right', pair: false, dim: false, ...over })

  it('faces outward from the other speaker', () => {
    expect(pairSide(400, 600)).toBe('left')
    expect(pairSide(600, 400)).toBe('right')
  })
  it('opens down when it would pass the safe line', () => {
    const p = placeBubbles([item({ y: 80 })], view).a
    expect(p.dir).toBe('down')
    expect(cardRect(item({ y: 80 }), p).top).toBeGreaterThan(80)
  })
  it('flips a lone bubble at the right edge, but only slides a facing one', () => {
    expect(placeBubbles([item({ x: 900 })], view).a.side).toBe('left')
    const facing = placeBubbles([item({ x: 900, pair: true })], view).a
    expect(facing.side).toBe('right')
    expect(cardRect(item({ x: 900 }), facing).right).toBeLessThanOrEqual(view.w - BUBBLE.safeSide)
  })
  it('stacks the later of two overlapping bubbles upward', () => {
    const out = placeBubbles([item({ id: 'a', order: 1 }), item({ id: 'b', order: 2, x: 520, y: 410 })], view)
    expect(out.a.stack).toBe(0)
    expect(out.b.stack).toBeGreaterThan(0)
  })
  it('a stacked bubble that would pass the safe line by more than the gap opens down instead (#107)', () => {
    // the first sits just under the safe line; stacking the second above it would put it far past the line
    const first = item({ id: 'a', order: 1, y: 220 })
    const second = item({ id: 'b', order: 2, x: 520, y: 225, h: 120 })
    const out = placeBubbles([first, second], view)
    expect(out.a.dir).toBe('up')
    expect(out.b.dir).toBe('down')
    expect(out.b.stack).toBe(0)
    // a small overshoot (within the gap) is allowed and stays up
    expect(cardRect(first, out.a).top).toBeGreaterThanOrEqual(BUBBLE.safeTop - BUBBLE.gap)
  })
  it('stacks three close speakers in steps, 8px apart, so no card covers another', () => {
    // the replay case: three agents side by side, same height, cards 220-250px wide
    const three = [
      item({ id: 'a', order: 1, x: 405, y: 288, w: 221, h: 76, prefSide: 'left', pair: true }),
      item({ id: 'b', order: 2, x: 767, y: 276, w: 248, h: 94, prefSide: 'right', pair: true }),
      item({ id: 'c', order: 3, x: 696, y: 316, w: 222, h: 76, prefSide: 'right', pair: true }),
    ]
    const out = placeBubbles(three, view)
    const rect = (i: PlaceInput) => cardRect(i, out[i.id])
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) {
        const a = rect(three[i])
        const b = rect(three[j])
        const sideBySide = Math.min(a.right, b.right) <= Math.max(a.left, b.left)
        const gap = Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)
        expect(sideBySide || gap >= BUBBLE.gap).toBe(true)
      }
    // the speaking (latest) one is raised above the one it overlapped, with the gap
    expect(rect(three[2]).bottom).toBeLessThanOrEqual(rect(three[1]).top - BUBBLE.gap)
  })
  it('hides an off-screen anchor and, on a narrow screen, the dim line', () => {
    expect(placeBubbles([item({ x: -50 })], view).a.visible).toBe(false)
    expect(placeBubbles([item({ dim: true })], { ...view, narrow: true }).a.visible).toBe(false)
    expect(placeBubbles([item({ dim: true })], view).a.visible).toBe(true)
  })
})

describe('statusTag', () => {
  it('shows a chip for work and the lock for a private session', () => {
    expect(statusTag({ state: 'working', activity: 'edit', since: 0 })).toEqual({ icon: 'edit', label: '파일 편집 중', private: false })
    expect(statusTag({ state: 'working', activity: 'private', since: 0 })?.private).toBe(true)
    expect(statusTag({ state: 'idle', since: 0 })).toBeNull()
  })
})

describe('night tags (#110)', () => {
  it('sleepers and the night-duty agent get a tag', () => {
    expect(statusTag({ state: 'off', since: 0, night: 'sleep' })).toEqual({ icon: 'sleep', label: '조는 중', private: false })
    expect(statusTag({ state: 'idle', since: 0, night: 'duty' })).toEqual({ icon: 'coffee', label: '야간 당번', private: false })
    expect(statusTag({ state: 'off', since: 0 })).toBeNull()
  })
})

describe('bubbles that hang below the head (a meeting before the whiteboard)', () => {
  it('open downward even when there is room above, and stack downward without overlapping', () => {
    const base = { w: 200, h: 60, prefSide: 'right' as const, pair: false, dim: false, down: true }
    const out = placeBubbles([{ ...base, id: 'a', order: 0, x: 400, y: 400 }, { ...base, id: 'b', order: 1, x: 420, y: 400 }], { w: 1280, h: 800, narrow: false })
    expect(out.a.dir).toBe('down')
    expect(out.b.dir).toBe('down')
    expect(out.b.stack).toBeGreaterThan(0)
  })
})
