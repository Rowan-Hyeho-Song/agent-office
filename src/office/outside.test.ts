import { describe, expect, it } from 'vitest'
import { hexRgb, litWindows, outsideAt, silhouette } from './outside'

const at = (h: number, m = 0) => outsideAt(h * 60 + m)

describe('outside sky by KST time', () => {
  it('uses the designer values per period', () => {
    expect(at(12)).toMatchObject({ top: '#7f93ab', bottom: '#a9b8c9', lights: 0 })
    expect(at(18)).toMatchObject({ top: '#3b3f6b', bottom: '#c98a6b', lights: 0.14 })
    expect(at(2)).toMatchObject({ top: '#0d1430', bottom: '#1d2650', lights: 0.2 })
    expect(at(6)).toMatchObject({ top: '#2a3358', bottom: '#8a8fb0', lights: 0.06 })
  })
  it('night wraps midnight', () => {
    expect(at(23, 30).key.split(':')[0]).toBe(at(4, 59).key.split(':')[0])
    expect(at(23, 30).lights).toBe(at(4, 59).lights)
  })
  it('blends from the previous period over 10 minutes, then holds one key', () => {
    expect(at(7, 0).lights).toBeCloseTo(0.06)
    expect(at(7, 5).lights).toBeCloseTo(0.03)
    expect(at(7, 10)).toMatchObject({ lights: 0, top: '#7f93ab' })
    expect(at(7, 10).key).toBe(at(7, 59).key)
    expect(at(7, 10).key).not.toBe(at(8, 0).key) // a new hour: a new lit pattern
  })
  it('silhouettes: aerial perspective, nearer layers are further from the horizon colour', () => {
    const l = at(12)
    const d = (c: string) => Math.hypot(...hexRgb(c).map((v, i) => v - hexRgb(l.bottom)[i]))
    expect(d(silhouette(l, 'far'))).toBeLessThan(d(silhouette(l, 'mid')))
    expect(d(silhouette(l, 'mid'))).toBeLessThan(d(silhouette(l, 'near')))
    expect(silhouette({ ...l, bottom: '#151a24' }, 'near')).toBe('#151a24')
  })
})

describe('lit windows', () => {
  it('is deterministic for an hour and changes with the hour', () => {
    expect(litWindows(114, 0.2, 2)).toEqual(litWindows(114, 0.2, 2))
    expect(litWindows(114, 0.2, 2).lit).not.toEqual(litWindows(114, 0.2, 3).lit)
  })
  it('lit share follows the fraction; day has none; more light only adds windows', () => {
    const n = 2000
    const night = litWindows(n, 0.2, 2).lit
    expect(night.filter(Boolean).length / n).toBeCloseTo(0.2, 1)
    expect(litWindows(n, 0, 2).lit.some(Boolean)).toBe(false)
    const dawn = litWindows(n, 0.06, 2).lit
    dawn.forEach((v, i) => v && expect(night[i]).toBe(true))
  })
  it('about one in six lit windows is cool', () => {
    const { lit, cool } = litWindows(3000, 1, 5)
    expect(cool.filter(Boolean).length / lit.length).toBeCloseTo(1 / 6, 1)
  })
})
