import { describe, expect, it } from 'vitest'
import { CLOSE, closePose, easeInOut, focusXOf, lerp3, rectFromNdc, sameRect, type BoardFrame } from './pose'

const frame: BoardFrame = { center: [1.1, 1.5, -3.46], normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0], w: 1.5, h: 1 }
const FOV = 32

describe('closePose', () => {
  it('stands on the board normal, looking at its centre', () => {
    const p = closePose(frame, FOV, 16 / 9)
    expect(p.target).toEqual([1.1, 1.5, -3.46])
    expect(p.position[0]).toBeCloseTo(1.1)
    expect(p.position[1]).toBeCloseTo(1.5)
    expect(p.position[2]).toBeCloseTo(-3.46 + p.distance)
  })
  it('makes the board 88% of a tall-enough window, and fits the height when the window is wide', () => {
    const half = Math.tan((FOV * Math.PI) / 360)
    // 4:3: width-bound -> the board is exactly fillW of the width
    const a = closePose(frame, FOV, 4 / 3)
    expect(frame.w / (2 * a.distance * half * (4 / 3))).toBeCloseTo(CLOSE.fillW)
    // 21:9: height-bound -> the board is fillH of the height, narrower than 88% of the width
    const b = closePose(frame, FOV, 21 / 9)
    expect(frame.h / (2 * b.distance * half)).toBeCloseTo(CLOSE.fillH)
    expect(frame.w / (2 * b.distance * half * (21 / 9))).toBeLessThan(CLOSE.fillW)
  })
  it('leans toward the pressed column by 10% of the board width at the outer columns, none for Enter', () => {
    expect(closePose(frame, FOV, 1.6, 0).target[0]).toBeCloseTo(1.1)
    expect(closePose(frame, FOV, 1.6, 1).target[0]).toBeCloseTo(1.1 + 0.1 * 1.5)
    expect(closePose(frame, FOV, 1.6, -1).target[0]).toBeCloseTo(1.1 - 0.1 * 1.5)
    expect(closePose(frame, FOV, 1.6, 1).position[0]).toBeCloseTo(1.1 + 0.15)
    expect(closePose(frame, FOV, 1.6, 9).target[0]).toBeCloseTo(1.1 + 0.15) // clamped
  })
  it('follows a turned board: the camera is along the board normal, not along z', () => {
    const turned: BoardFrame = { ...frame, normal: [1, 0, 0], right: [0, 0, -1] }
    const p = closePose(turned, FOV, 1.6)
    expect(p.position[0]).toBeCloseTo(1.1 + p.distance)
    expect(p.position[2]).toBeCloseTo(-3.46)
  })
  it('column -> focusX', () => {
    expect([null, 0, 1, 2].map(focusXOf)).toEqual([0, -1, 0, 1])
  })
})

describe('screen rect', () => {
  it('maps NDC corners to px', () => {
    const r = rectFromNdc([[-0.5, 0.5], [0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]], 1000, 800)
    expect(r).toEqual({ left: 250, top: 200, width: 500, height: 400 })
  })
  it('sameRect tolerates sub-pixel noise', () => {
    const a = { left: 10, top: 10, width: 100, height: 50 }
    expect(sameRect(a, { ...a, left: 10.3 })).toBe(true)
    expect(sameRect(a, { ...a, width: 101 })).toBe(false)
    expect(sameRect(a, null)).toBe(false)
    expect(sameRect(null, null)).toBe(true)
  })
})

describe('flight curve', () => {
  it('eases in and out, and interpolates points', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBe(0.5)
    expect(easeInOut(0.25)).toBeLessThan(0.25)
    expect(lerp3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3])
  })
})
