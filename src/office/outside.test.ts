import { describe, expect, it } from 'vitest'
import { outsideAt, silhouette } from './outside'

const at = (h: number, m = 0) => outsideAt(h * 60 + m)

describe('outside sky by KST time', () => {
  it('uses the designer values per period', () => {
    expect(at(12)).toMatchObject({ top: '#7f93ab', bottom: '#a9b8c9', lights: 0 })
    expect(at(18)).toMatchObject({ top: '#3b3f6b', bottom: '#c98a6b', lights: 0.3 })
    expect(at(2)).toMatchObject({ top: '#0d1430', bottom: '#1d2650', lights: 0.45 })
    expect(at(6)).toMatchObject({ top: '#2a3358', bottom: '#8a8fb0', lights: 0.15 })
  })
  it('night wraps midnight', () => {
    expect(at(23, 30).key).toBe(at(4, 59).key)
  })
  it('blends from the previous period over 10 minutes, then holds one key', () => {
    expect(at(7, 0).lights).toBeCloseTo(0.15)
    expect(at(7, 5).lights).toBeCloseTo(0.075)
    expect(at(7, 10)).toMatchObject({ lights: 0, top: '#7f93ab' })
    expect(at(7, 10).key).toBe(at(16, 59).key)
  })
  it('silhouettes are darker than the horizon', () => {
    const l = at(12)
    expect(silhouette(l, 'near') < silhouette(l, 'far')).toBe(true)
  })
})
