import { describe, expect, it } from 'vitest'
import { SIDE, bezier, clampWidth, defaultWidth, easeOut, isPhone, leftArea, maxWidth, panelWidth, snapSheet, stepWidth, viewOffset, widthAt } from './model'

describe('side panel width', () => {
  it('starts at 480 on a desktop screen', () => {
    expect(defaultWidth(1280)).toBe(480)
    expect(defaultWidth(1920)).toBe(480)
  })
  it('starts at min(420, 50%) on 641 to 1024px screens, never under the minimum', () => {
    expect(defaultWidth(1024)).toBe(420)
    expect(defaultWidth(800)).toBe(400)
    expect(defaultWidth(760)).toBe(380)
    expect(defaultWidth(641)).toBe(380)
  })
  it('clamps to 380 and min(760, 55% of the screen)', () => {
    expect(clampWidth(100, 1280)).toBe(380)
    expect(clampWidth(900, 1280)).toBe(704)
    expect(clampWidth(900, 1920)).toBe(760)
    expect(maxWidth(1024)).toBe(563)
    expect(maxWidth(600)).toBe(380)
  })
  it('uses a remembered width, clamped to the current screen', () => {
    expect(panelWidth(null, 1280)).toBe(480)
    expect(panelWidth(600, 1280)).toBe(600)
    expect(panelWidth(700, 1024)).toBe(563)
    expect(panelWidth(NaN, 1280)).toBe(480)
  })
  it('keyboard: left widens, right narrows, 16px each, inside the limits', () => {
    expect(stepWidth(480, 'left', 1280)).toBe(496)
    expect(stepWidth(480, 'right', 1280)).toBe(464)
    expect(stepWidth(380, 'right', 1280)).toBe(380)
    expect(stepWidth(704, 'left', 1280)).toBe(704)
    expect(SIDE.key).toBe(16)
  })
  it('pointer: the panel edge follows the pointer', () => {
    expect(widthAt(800, 1280)).toBe(480)
    expect(widthAt(1270, 1280)).toBe(380)
    expect(widthAt(10, 1280)).toBe(704)
  })
})

describe('view offset and left area', () => {
  const desk = { w: 1280, h: 800 }
  it('is zero while closed', () => {
    expect(viewOffset(desk, { open: false, width: 480, sheet: 'half' })).toEqual({ x: 0, y: 0 })
    expect(leftArea(desk, { open: false, width: 480, sheet: 'half' })).toEqual(desk)
  })
  it('desktop: moves left by half the panel width; the left area is what the panel leaves', () => {
    expect(viewOffset(desk, { open: true, width: 480, sheet: 'half' })).toEqual({ x: 240, y: 0 })
    expect(viewOffset(desk, { open: true, width: 381, sheet: 'half' })).toEqual({ x: 190.5, y: 0 })
    expect(leftArea(desk, { open: true, width: 480, sheet: 'half' })).toEqual({ w: 800, h: 800 })
  })
  it('phone: moves up into the top 45%, for both sheet heights', () => {
    const ph = { w: 390, h: 844 }
    expect(isPhone(390)).toBe(true)
    expect(isPhone(641)).toBe(false)
    for (const sheet of ['half', 'full'] as const) {
      expect(viewOffset(ph, { open: true, width: 480, sheet })).toEqual({ x: 0, y: Math.round(844 * 0.275) })
      expect(leftArea(ph, { open: true, width: 480, sheet })).toEqual({ w: 390, h: Math.round(844 * 0.45) })
    }
  })
})

describe('sheet snap and curve', () => {
  it('closes under 40%, halves in the middle, fulls near the top', () => {
    expect(snapSheet(200, 800)).toBe('close')
    expect(snapSheet(440, 800)).toBe('half')
    expect(snapSheet(700, 800)).toBe('full')
  })
  it('--ease-out runs from 0 to 1 and leads a linear ramp', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
    expect(bezier(0, 0, 1, 1, 0.3)).toBeCloseTo(0.3, 2)
  })
})
