import { describe, expect, it } from 'vitest'
import { STEP, STROKE, stepAt, stepFor, type Contact } from './stroke'

// side 0 hits toward +x: its end is at x < 0, the shoulder of its right hand on +z
const SHOULDER: [number, number, number] = [-1.6, 0.24, 0.15]
const GAP = 0.04
const c = (t: number, z: number, from = t - 900, miss = false): Contact => ({ side: 0, t, at: [-1.62, 0.2, z], miss, from })

describe('the side step (#397, play.md 7)', () => {
  it('none for a ball within reach of the shoulder; toward it, at most 0.4 m, for one farther', () => {
    expect(stepFor(c(1000, 0.3), SHOULDER, 1, GAP)).toBe(0)
    const far = stepFor(c(1000, 1.1), SHOULDER, 1, GAP)
    expect(far).toBeGreaterThan(0)
    expect(far).toBeLessThanOrEqual(STEP.maxM)
    const left = stepFor(c(1000, -0.75), SHOULDER, 1, GAP)
    expect(left).toBeLessThan(0)
    expect(stepFor(c(1000, -3), SHOULDER, 1, GAP)).toBe(-STEP.maxM)
    // after the step the contact is in reach (or the step is at its limit)
    const p = -0.75 + 0 // the face's z equals the ball's for a hit
    expect(Math.hypot(-1.62 - GAP - SHOULDER[0], 0.2 - SHOULDER[1], p - (SHOULDER[2] + left))).toBeLessThanOrEqual(STEP.reachM + 1e-9)
  })
  it('still while it reacts, then at 1.2 m/s, there by the swing, held through the follow-through, back home after', () => {
    const k = c(2000, -3) // needs the full −0.4 m
    const cs = [k]
    expect(stepAt(cs, k.from + 100, SHOULDER, 1, GAP)).toBe(0) // reacting
    const start = k.from + STROKE.reactMs
    expect(stepAt(cs, start + 100, SHOULDER, 1, GAP)).toBeCloseTo(-0.12, 6) // 1.2 m/s × 0.1 s
    expect(stepAt(cs, k.t - STROKE.swingMs, SHOULDER, 1, GAP)).toBeCloseTo(-STEP.maxM, 6) // 0.4 m takes 0.33 s, the ball 0.9 s
    expect(stepAt(cs, k.t + STROKE.followMs, SHOULDER, 1, GAP)).toBeCloseTo(-STEP.maxM, 6)
    expect(stepAt(cs, k.t + STROKE.followMs + 200, SHOULDER, 1, GAP)).toBeCloseTo(-0.4 + 0.24, 6)
    expect(stepAt(cs, k.t + STROKE.followMs + 1000, SHOULDER, 1, GAP)).toBe(0)
  })
  it('never moves faster than 1.2 m/s, also from one far ball to the other side', () => {
    const cs = [c(1000, -3, 100), c(1900, 3, 1300)]
    let prev = stepAt(cs, 0, SHOULDER, 1, GAP)
    for (let t = 0; t <= 3000; t += 10) {
      const s = stepAt(cs, t, SHOULDER, 1, GAP)
      expect(Math.abs(s - prev)).toBeLessThanOrEqual(STEP.mps * 0.01 + 1e-9)
      expect(Math.abs(s)).toBeLessThanOrEqual(STEP.maxM + 1e-9)
      prev = s
    }
  })
})
