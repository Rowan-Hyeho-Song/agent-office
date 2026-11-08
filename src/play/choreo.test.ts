import { describe, expect, it } from 'vitest'
import { HAND_MS, PLACE_AT } from './omok'
import { SEQ, followWeight, habitOf, moveLengthMs, placeSequence, swingTilt, swingTravel } from './choreo'

describe('omok place sequence (agents.md 2.10)', () => {
  const T = 1000
  it('lasts thinking + the 1.4 s hand window and lands at PLACE_AT of it', () => {
    expect(moveLengthMs(T)).toBe(T + HAND_MS)
    const land = T + HAND_MS * PLACE_AT
    expect(placeSequence(land - 1, T, 'circle').landed).toBe(false)
    expect(placeSequence(land, T, 'circle').landed).toBe(true)
    expect(placeSequence(land - 1, T, 'circle').attached).toBe(true)
    expect(placeSequence(land, T, 'circle').attached).toBe(false)
    expect(placeSequence(T + HAND_MS, T, 'circle').stage).toBe('rest')
  })
  it('the stone is the hand\'s from the end of the pick (0.35 s) until it lands', () => {
    expect(placeSequence(SEQ.pick - 1, T, 'tap').attached).toBe(false)
    expect(placeSequence(SEQ.pick, T, 'tap').attached).toBe(true)
    expect(placeSequence(SEQ.pick, T, 'tap').close).toBe(1)
  })
  it('pick at the bowl, 8 cm arc to the intersection by 0.8 s, a pause 1.5 cm above for 50 ms, then the drop', () => {
    expect(placeSequence(0, T, 'circle').u).toBe(0)
    expect(placeSequence(SEQ.carry - 1, T, 'circle').u).toBeGreaterThan(0.99)
    let peak = 0
    for (let s = SEQ.pick; s < SEQ.carry; s += 5) peak = Math.max(peak, placeSequence(s, T, 'roll').h)
    expect(peak).toBeGreaterThan(SEQ.arc * 0.9)
    const P = T + SEQ.carry
    expect(placeSequence(P + 10, T, 'circle')).toMatchObject({ stage: 'pause', h: SEQ.pauseH })
    expect(placeSequence(P + SEQ.pause + SEQ.drop - 1, T, 'circle').h).toBeLessThan(0.0005)
    expect(placeSequence(P + SEQ.pause + SEQ.drop, T, 'circle').h).toBe(0)
  })
  it('the hand springs 0.4 cm up after the landing and the index finger leaves first', () => {
    const land = T + 900
    let lift = 0
    for (let s = land; s < land + 80; s += 2) lift = Math.max(lift, placeSequence(s, T, 'circle').lift)
    expect(lift).toBeCloseTo(0.004, 3)
    const p = placeSequence(land + 100, T, 'circle')
    expect(p.freeIndex).toBeGreaterThan(p.freeMiddle)
    expect(p.freeMiddle).toBeGreaterThanOrEqual(p.freeRest)
    expect(placeSequence(land + 499, T, 'circle').w).toBeLessThan(0.02)
  })
  it('habits: 메모 circles 2 cm 10 cm up, 휴 rolls ±10°, 루프 taps 1 cm twice, 메시 puts a hand to the chin', () => {
    expect(habitOf('agent_0')).toBe('circle')
    let r = 0
    let hmax = 0
    for (let s = 900; s < T + 600; s += 10) {
      const p = placeSequence(s, T, 'circle')
      r = Math.max(r, Math.hypot(p.dx, p.dz))
      hmax = Math.max(hmax, p.h)
    }
    expect(r).toBeCloseTo(0.02, 2)
    expect(hmax).toBeCloseTo(0.1, 2)
    let roll = 0
    for (let s = 900; s < T + 600; s += 10) roll = Math.max(roll, Math.abs(placeSequence(s, T, 'roll').roll))
    expect(roll).toBeCloseTo((10 * Math.PI) / 180, 1)
    // two taps: the height crosses its mid value (pauseH + 0.5 cm) 4 times in the last 450 ms before the place time
    const P = T + SEQ.carry
    let cross = 0
    let prev = placeSequence(P - 450, T, 'tap').h - (SEQ.pauseH + 0.005)
    for (let s = P - 445; s < P - SEQ.settle; s += 5) {
      const h = placeSequence(s, T, 'tap').h - (SEQ.pauseH + 0.005)
      if (h * prev < 0) cross++
      prev = h
    }
    expect(cross).toBeGreaterThanOrEqual(3)
    expect(placeSequence(1500, 1000, 'chin').chin).toBe(true)
    expect(placeSequence(1500, 1000, 'circle').chin).toBe(false)
  })
  it('is a pure function of its inputs', () => {
    for (const s of [0, 120, 400, 900, 1500, 1900, 2300]) expect(placeSequence(s, T, 'roll')).toEqual(placeSequence(s, T, 'roll'))
  })
})

describe('ping-pong swing', () => {
  it('passes through the ball at contact (t01 0.5), pulled back before and followed through after, level at both ends', () => {
    expect(swingTravel(0)).toBeCloseTo(0)
    expect(swingTravel(0.5)).toBeCloseTo(0)
    expect(swingTravel(1)).toBeCloseTo(0)
    expect(swingTravel(0.25)).toBeLessThan(-0.1)
    expect(swingTravel(0.75)).toBeGreaterThan(0.1)
    expect(swingTilt(0.5)).toBeCloseTo(0)
  })
  it('follows the ball only as it comes close', () => {
    expect(followWeight(2)).toBe(0)
    expect(followWeight(0)).toBe(1)
    expect(followWeight(0.45)).toBeGreaterThan(0.4)
  })
})
