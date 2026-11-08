import { describe, expect, it } from 'vitest'
import { clockAngles } from './clock'

const TAU = Math.PI * 2
const seoul = (s: string) => new Date(`${s}+09:00`)

describe('clockAngles', () => {
  it('10:10', () => {
    const a = clockAngles(seoul('2026-05-01T10:10:00'))
    expect(a.hour).toBeCloseTo(-((10 + 10 / 60) / 12) * TAU)
    expect(a.minute).toBeCloseTo(-(10 / 60) * TAU)
  })
  it('00:00 is straight up', () => {
    const a = clockAngles(seoul('2026-05-01T00:00:00'))
    expect(a.hour).toBeCloseTo(0)
    expect(a.minute).toBeCloseTo(0)
  })
  it('23:59:30', () => {
    const a = clockAngles(seoul('2026-05-01T23:59:30'))
    expect(a.minute).toBeCloseTo(-(59.5 / 60) * TAU)
    expect(a.hour).toBeCloseTo(-((11 + 59.5 / 60) / 12) * TAU)
  })
  it('a UTC instant is read in Seoul time', () => {
    const a = clockAngles(new Date('2026-05-01T01:30:00Z')) // 10:30 in Seoul
    expect(a.hour).toBeCloseTo(-((10.5) / 12) * TAU)
    expect(a.minute).toBeCloseTo(-0.5 * TAU)
  })
})
