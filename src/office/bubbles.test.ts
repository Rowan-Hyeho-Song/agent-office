import { describe, expect, it } from 'vitest'
import { BUBBLE, cardRect, firstSentence, holdMs, maskText, pairSide, placeBubbles, statusTag, typeMs, typedCount, type PlaceInput } from './bubbles'

describe('firstSentence', () => {
  it('takes the first sentence of a cell, plain', () => {
    expect(firstSentence('**셋 다** 그 방향으로 진행. 얼굴은 `screen` 슬롯')).toBe('셋 다 그 방향으로 진행.')
  })
  it('keeps dots inside words', () => {
    expect(firstSentence('v1.2 로 올림')).toBe('v1.2 로 올림')
  })
  it('cuts at 40 characters with an ellipsis', () => {
    const out = firstSentence('가'.repeat(60))
    expect([...out]).toHaveLength(40)
    expect(out.endsWith('…')).toBe(true)
  })
  it('keeps a short line as it is', () => {
    expect(firstSentence('네, 볼게요')).toBe('네, 볼게요')
  })
})

describe('timing', () => {
  it('types 28 ms a character, never more than a second', () => {
    expect(typeMs(10)).toBe(280)
    expect(typeMs(40)).toBeCloseTo(1000)
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
