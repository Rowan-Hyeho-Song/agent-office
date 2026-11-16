import { describe, expect, it } from 'vitest'
import { leftArea } from './sidePanel/model'
import { BUBBLE, cardRect, firstSentence, holdMs, maskText, pairSide, placeBubbles, replayTag, statusTag, typeMs, typedCount, zRises, type PlaceInput } from './bubbles'

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
  it('#137 ② C over a face screen (the phone at the omok board): above its top, centred, 8 px inside the sides; below the face only when the top has no room', () => {
    const phone = { w: 390, h: 844, narrow: true }
    const face = { below: 180, avoid: [] }
    // the face's top at y 120 (above the safe line 64 a plain bubble keeps): still up, its lead pointing at the face
    const p = placeBubbles([item({ x: 195, y: 120, w: 130, h: 50, face })], phone).a
    expect(p).toMatchObject({ dir: 'up', visible: true })
    expect(p.y).toBeUndefined()
    const r = cardRect(item({ x: 195, y: 120, w: 130, h: 50 }), p)
    expect((r.left + r.right) / 2).toBeCloseTo(195, 0)
    expect(r.bottom).toBeLessThan(120)
    // near a side: kept 8 px inside
    const q = placeBubbles([item({ x: 360, y: 120, w: 130, h: 50, face })], phone).a
    expect(cardRect(item({ x: 360, y: 120, w: 130, h: 50 }), q).right).toBeCloseTo(390 - BUBBLE.faceEdge, 5)
    // the '← 책상으로' link where the card would be, or the screen top too close: below the face
    const link = { left: 150, top: 10, right: 260, bottom: 40 }
    expect(placeBubbles([item({ x: 195, y: 120, w: 130, h: 50, face: { below: 180, avoid: [link] } })], phone).a).toMatchObject({ dir: 'down', y: 180 - BUBBLE.anchorDown })
    expect(placeBubbles([item({ x: 195, y: 70, w: 130, h: 50, face })], phone).a.dir).toBe('down')
    // beside the face (a wide screen): from its lower right corner, up and right, even above the office's safe line
    const wide = placeBubbles([item({ x: 780, y: 140, w: 120, h: 54, face: { below: 140, avoid: [], beside: true } })], { w: 1280, h: 800, narrow: false }).a
    expect(wide).toMatchObject({ dir: 'up', side: 'right', shift: 0 })
    expect(cardRect(item({ x: 780, y: 140, w: 120, h: 54 }), wide).top).toBeLessThan(BUBBLE.safeTop)
    // the link off to the side does not matter
    expect(placeBubbles([item({ x: 195, y: 120, w: 130, h: 50, face: { below: 180, avoid: [{ left: 10, top: 10, right: 100, bottom: 40 }] } })], phone).a.dir).toBe('up')
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
  it('keeps cards out of the side panel: placed in the left area, a card is pushed back inside it (also a hanging one)', () => {
    const area = leftArea({ w: 1280, h: 800 }, { open: true, width: 480, sheet: 'half' })
    const v = { ...area, narrow: false }
    for (const down of [false, true]) {
      const lone = item({ x: 780, y: 400, down, pair: true })
      const p = placeBubbles([lone], v).a
      expect(p.visible).toBe(true)
      expect(cardRect(lone, p).right).toBeLessThanOrEqual(area.w - BUBBLE.safeSide)
    }
    expect(placeBubbles([item({ x: 900 })], v).a.visible).toBe(false) // the head is under the panel
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

describe('status tag with the issue (#182)', () => {
  const pub = { private: false, repo: 'agent-office', issue: 170, title: '제목' } as const
  it('shows the number (no title) while working or wrapping', () => {
    expect(statusTag({ state: 'working', activity: 'edit', since: 0, task: pub })?.label).toBe('#170 · 파일 편집 중')
    expect(statusTag({ state: 'working', activity: 'edit', since: 0, task: { ...pub, repo: 'rowansong.dev', issue: 12 } })?.label).toBe('rowansong.dev#12 · 파일 편집 중')
    expect(statusTag({ state: 'working', activity: 'edit', since: 0, task: { private: true, repo: null, issue: null, title: null } })?.label).toBe('🔒 · 파일 편집 중')
    expect(statusTag({ state: 'wrapping', since: 0, task: pub })?.label).toBe('#170 · 카드 정리 중')
  })
  it('nothing extra when idle or off', () => {
    expect(statusTag({ state: 'idle', since: 0, task: pub })).toBeNull()
  })
})

describe('night tags (#110)', () => {
  it('sleepers and the night-duty agent get a tag', () => {
    expect(statusTag({ state: 'off', since: 0, night: 'sleep' })).toEqual({ icon: 'sleep', label: '조는 중', private: false })
    expect(statusTag({ state: 'idle', since: 0, night: 'duty' })).toEqual({ icon: 'coffee', label: '야간 당번', private: false })
    expect(statusTag({ state: 'off', since: 0 })).toBeNull()
  })
})

describe('the timelapse chip (#599)', () => {
  it('shows the night chips from the replay status, and no working chip', () => {
    expect(replayTag({ state: 'off', since: 0, night: 'sleep' })).toEqual({ icon: 'sleep', label: '조는 중', private: false })
    expect(replayTag({ state: 'idle', since: 0, night: 'duty' })).toEqual({ icon: 'coffee', label: '야간 당번', private: false })
    expect(replayTag({ state: 'working', activity: 'edit', since: 0 })).toBeNull()
    expect(replayTag({ state: 'idle', since: 0 })).toBeNull()
    expect(replayTag(undefined)).toBeNull()
  })
  it('a body lying on the sofa dozes too; the night chip wins', () => {
    expect(replayTag({ state: 'idle', since: 0 }, true)).toEqual({ icon: 'sleep', label: '조는 중', private: false })
    expect(replayTag({ state: 'idle', since: 0, night: 'duty' }, true)?.label).toBe('야간 당번')
  })
  it('the z rises, except with reduced motion and in the timelapse at x16 (the still z z of the chip stays)', () => {
    expect(zRises(true, 1, false)).toBe(true)
    expect(zRises(true, 4, false)).toBe(true)
    expect(zRises(true, 16, false)).toBe(false)
    expect(zRises(true, 1, true)).toBe(false)
    expect(zRises(false, 1, false)).toBe(true)
    expect(zRises(false, 16, false)).toBe(true)
    expect(zRises(false, 1, true)).toBe(false)
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

describe('statusTag: another repository (#182 review)', () => {
  it('gives the parts so the chip can shrink the repo name and keep the activity', () => {
    const t = statusTag({ state: 'working', activity: 'edit', since: 0, task: { private: false, repo: 'rowansong.dev', issue: 12, title: null } })
    expect(t?.other).toEqual({ repo: 'rowansong.dev', num: '#12', activity: '파일 편집 중' })
    expect(t?.label).toBe('rowansong.dev#12 · 파일 편집 중')
  })
  it('none for this repo or a private task', () => {
    expect(statusTag({ state: 'working', activity: 'edit', since: 0, task: { private: false, repo: 'agent-office', issue: 170, title: 'x' } })?.other).toBeUndefined()
    expect(statusTag({ state: 'working', activity: 'edit', since: 0, task: { private: true, repo: null, issue: null, title: null } })?.other).toBeUndefined()
  })
})
