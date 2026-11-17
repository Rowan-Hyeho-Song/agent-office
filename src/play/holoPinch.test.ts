// #538 (hologram.md 4.3) the pinch timeline of the hologram board's hand.
import { describe, expect, it } from 'vitest'
import { HAND_MS, PLACE_AT } from './omok'
import { ALK_FLICK, CHESS_PINCH, PINCH, chessPinch, flickHand, pinchSequence, pinchTimes } from './holoPinch'

describe('the pinch timeline (hologram.md 4.3)', () => {
  const think = 1200
  const { land, pick, end } = pinchTimes(think)
  it('lands where gameAt puts the stone on the board (thinking + PLACE_AT of HAND_MS)', () => {
    expect(land).toBeCloseTo(think + PLACE_AT * HAND_MS, 6)
    expect(pinchSequence(land - 1, think).landed).toBe(false)
    expect(pinchSequence(land, think).landed).toBe(true)
  })
  it('reaches in 0.25 s and hovers 4 cm over the fount while thinking, open just before the pinch', () => {
    expect(pinchSequence(-1, think).stage).toBe('rest')
    expect(pinchSequence(100, think).stage).toBe('reach')
    const h = pinchSequence(400, think)
    expect(h).toMatchObject({ stage: 'hover', w: 1, h: PINCH.hoverH, u: 0, held: false, open: 0 })
    expect(pinchSequence(land - PINCH.pinchFrom - 1, think).open).toBeGreaterThan(0.99)
  })
  it('the pinch closes at the fount; the stone is held from the pick to the landing, along an arc no higher than 6 cm', () => {
    const p = pinchSequence(pick, think)
    expect(p).toMatchObject({ stage: 'arc', close: 1, held: true, u: 0 })
    expect(p.h).toBeCloseTo(0, 6)
    expect(pinchSequence(pick - 1, think).held).toBe(false)
    let top = 0
    for (let s = pick; s < land; s += 5) top = Math.max(top, pinchSequence(s, think).h)
    expect(top).toBeLessThanOrEqual(PINCH.arcTop + 1e-9)
    expect(top).toBeGreaterThan(0.05)
    const pre = pinchSequence(land - PINCH.arcEnd, think)
    expect(pre).toMatchObject({ stage: 'descend', u: 1 })
    expect(pre.h).toBeCloseTo(PINCH.overCell, 6)
    expect(pinchSequence(land - 1, think).h).toBeLessThan(0.001)
  })
  it('lets go and goes back to rest by 1.33 s after the landing began (the release, then up and toward the body)', () => {
    const r = pinchSequence(land + 50, think)
    expect(r).toMatchObject({ stage: 'release', held: false })
    expect(r.close).toBeLessThan(1)
    expect(pinchSequence(end - 1, think).w).toBeLessThan(0.01)
    expect(pinchSequence(end, think)).toMatchObject({ stage: 'rest', w: 0, landed: true })
    expect(end - land).toBe(PINCH.release + PINCH.back)
  })
  it('moves continuously (no jump between frames of 10 ms)', () => {
    let prev = pinchSequence(0, think)
    for (let s = 10; s <= end; s += 10) {
      const p = pinchSequence(s, think)
      // the path only shows while the hand is on it
      if (p.w > 0.05 && prev.w > 0.05) {
        expect(Math.abs(p.h - prev.h), `h at ${s}`).toBeLessThan(0.006)
        expect(Math.abs(p.u - prev.u), `u at ${s}`).toBeLessThan(0.06)
      }
      expect(Math.abs(p.w - prev.w), `w at ${s}`).toBeLessThan(0.1)
      prev = p
    }
  })
})

describe('the chess hand (hologram.md 11.4)', () => {
  const think = 900
  it('waits over its edge while thinking, reaches the piece, takes it at 0.37 s and puts it down at 0.92 s after the thinking', () => {
    expect(chessPinch(400, think)).toMatchObject({ stage: 'hover', a: 0, held: false })
    expect(chessPinch(think + 100, think).stage).toBe('reach')
    expect(chessPinch(think + CHESS_PINCH.pick - 1, think).held).toBe(false)
    expect(chessPinch(think + CHESS_PINCH.pick, think)).toMatchObject({ stage: 'arc', held: true, a: 1, close: 1 })
    expect(chessPinch(think + CHESS_PINCH.land - 1, think)).toMatchObject({ held: true, u: 1 })
    expect(chessPinch(think + CHESS_PINCH.land, think)).toMatchObject({ landed: true, held: false })
    expect(chessPinch(think + CHESS_PINCH.end, think)).toMatchObject({ stage: 'rest', w: 0 })
  })
  it('the arc rises no higher than 8 cm and moves without jumps while the hand is on its path', () => {
    let top = 0
    let prev = chessPinch(0, think)
    for (let s = 5; s <= think + CHESS_PINCH.end; s += 5) {
      const p = chessPinch(s, think)
      top = Math.max(top, p.h)
      if (p.w > 0.05 && prev.w > 0.05) {
        expect(Math.abs(p.h - prev.h), `h at ${s}`).toBeLessThan(0.005)
        expect(Math.abs(p.u - prev.u) + Math.abs(p.a - prev.a), `path at ${s}`).toBeLessThan(0.08)
      }
      prev = p
    }
    expect(top).toBeLessThanOrEqual(CHESS_PINCH.arcTop + 1e-9)
    expect(top).toBeGreaterThan(0.07)
  })
})

describe('the alkkagi flick hand (hologram.md 12.4)', () => {
  const think = 800
  it('hovers over the stone while thinking, comes behind it, aims, cocks, and its nail meets the stone at 0.81 s; back by 1.4 s', () => {
    expect(flickHand(300, think)).toMatchObject({ stage: 'hover', aim: null, flicked: false })
    expect(flickHand(think + 400, think)).toMatchObject({ stage: 'aim', back: ALK_FLICK.aimBack })
    expect(flickHand(think + 400, think).aim).toBeGreaterThan(0)
    const cocked = flickHand(think + ALK_FLICK.cock - 1, think)
    expect(cocked.back).toBeCloseTo(ALK_FLICK.cockBack, 3)
    expect(cocked.cock).toBe(1)
    const hit = flickHand(think + ALK_FLICK.flick, think)
    expect(hit).toMatchObject({ stage: 'hold', flicked: true })
    expect(hit.back).toBeCloseTo(0, 6)
    expect(flickHand(think + ALK_FLICK.flick - 1, think).flicked).toBe(false)
    expect(flickHand(think + ALK_FLICK.end, think)).toMatchObject({ stage: 'rest', w: 0 })
  })
  it('the finger weights always sum to 1 and the hand moves without jumps while on its path', () => {
    let prev = flickHand(0, think)
    for (let s = 5; s <= think + ALK_FLICK.end; s += 5) {
      const p = flickHand(s, think)
      expect(p.cock + p.strike + p.extend, `weights at ${s}`).toBeCloseTo(1, 6)
      if (p.w > 0.05 && prev.w > 0.05) expect(Math.abs(p.back - prev.back) + Math.abs(p.h - prev.h), `path at ${s}`).toBeLessThan(0.012)
      prev = p
    }
  })
})
