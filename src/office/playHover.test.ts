// #670 (play.md 2.1.1) the visitor's play tags with a mouse: the spot's box on the screen + 12 px, the tag's own rectangle, only over the canvas or
// the tag, the answer held through a camera drag, always after a touch press; shown 120 ms after the pointer comes, put away 400 ms after it goes
import { PerspectiveCamera, Vector3 } from 'three'
import { afterEach, describe, expect, it } from 'vitest'
import { inRect, overSpot, screenRect, setPointerForTest, setTagEl, spotBox, tagWait, TAG_HOVER } from './playHover'

const W = 1280
const H = 800
const camera = () => {
  const c = new PerspectiveCamera(50, W / H, 0.05, 100)
  c.position.set(0, 3, 4)
  c.lookAt(0, 0.5, 0)
  c.updateMatrixWorld(true)
  return c
}
const table = () => ({ x: 0, z: 0, hx: 0.4, hz: 0.4 })
const chair = (z: number) => ({ x: 0, z, hx: 0.25, hz: 0.25 })
const centre = (r: [number, number, number, number]) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2] as const

afterEach(() => {
  setPointerForTest(null)
  setTagEl('omok', null)
})

describe('the play spot box', () => {
  it('holds the table top and both chairs, from the floor up to the tag', () => {
    const b = spotBox([table(), chair(0.6), chair(-0.6)], 0.9)!
    expect(b.min.toArray().map((v) => +v.toFixed(3))).toEqual([-0.4, 0, -0.85])
    expect(b.max.toArray().map((v) => +v.toFixed(3))).toEqual([0.4, 0.9, 0.85])
  })
  it('is nothing without its parts', () => {
    expect(spotBox([null, undefined], 1)).toBeNull()
    expect(spotBox([], 1)).toBeNull()
  })
  it('on the screen: the outer rectangle of its corners, none while behind the camera', () => {
    const b = spotBox([table()], 0.9)!
    const r = screenRect(b, camera(), W, H)!
    expect(r[0]).toBeLessThan(r[2])
    expect(r[1]).toBeLessThan(r[3])
    const [cx, cy] = centre(r)
    expect(Math.abs(cx - W / 2)).toBeLessThan(1)
    expect(cy).toBeGreaterThan(0)
    const back = camera()
    back.lookAt(new Vector3(0, 3, 10))
    back.updateMatrixWorld(true)
    expect(screenRect(b, back, W, H)).toBeNull()
  })
  it('the 12 px margin', () => {
    const r: [number, number, number, number] = [100, 100, 200, 200]
    expect(inRect(r, 88, 150, TAG_HOVER.padPx)).toBe(true)
    expect(inRect(r, 87, 150, TAG_HOVER.padPx)).toBe(false)
    expect(inRect(r, 150, 212, TAG_HOVER.padPx)).toBe(true)
    expect(inRect(r, 150, 213, TAG_HOVER.padPx)).toBe(false)
  })
})

describe('the mouse over the spot', () => {
  const box = () => spotBox([table()], 0.9)!
  it('counts over the canvas, inside the rectangle + 12 px', () => {
    const r = screenRect(box(), camera(), W, H)!
    const [cx, cy] = centre(r)
    setPointerForTest({ x: cx, y: cy, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(true)
    setPointerForTest({ x: r[2] + 12, y: cy, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(true)
    setPointerForTest({ x: r[2] + 14, y: cy, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(false)
  })
  it('not over another UI (a dock, the agent list, a bubble), nor off the window or for a pen', () => {
    const [cx, cy] = centre(screenRect(box(), camera(), W, H)!)
    setPointerForTest({ x: cx, y: cy, on: 'other' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(false)
    setPointerForTest(null)
    expect(overSpot('omok', box(), camera(), W, H)).toBe(false)
  })
  it("the tag's own rectangle counts, even pushed to the screen's edge", () => {
    const tag = { getBoundingClientRect: () => ({ left: 1180, top: 20, right: 1270, bottom: 48 }), contains: () => false } as unknown as HTMLElement
    setTagEl('omok', tag)
    setPointerForTest({ x: 1200, y: 30, on: 'tag' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(true)
    // put away (not pressable), the pointer over it is over the canvas: still counts
    setPointerForTest({ x: 1200, y: 30, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(true)
    setPointerForTest({ x: 1200, y: 60, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(false)
  })
  it('a camera drag holds the last answer', () => {
    const [cx, cy] = centre(screenRect(box(), camera(), W, H)!)
    setPointerForTest({ x: cx, y: cy, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(true)
    setPointerForTest({ x: 5, y: 5, on: 'canvas' }, { dragging: true })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(true)
    setPointerForTest({ x: 5, y: 5, on: 'canvas' })
    expect(overSpot('omok', box(), camera(), W, H)).toBe(false)
  })
  it('after a touch press (a two-way device): always', () => {
    setPointerForTest(null, { touched: true })
    expect(overSpot('pingpong', null, camera(), W, H)).toBe(true)
  })
})

describe('the wait and the linger', () => {
  it('shows 120 ms after the pointer comes, puts away 400 ms after it goes, nothing when it already follows', () => {
    expect(tagWait(true, false)).toBe(120)
    expect(tagWait(false, true)).toBe(400)
    expect(tagWait(true, true)).toBeNull()
    expect(tagWait(false, false)).toBeNull()
  })
})
