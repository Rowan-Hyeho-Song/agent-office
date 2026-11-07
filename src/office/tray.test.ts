import { BoxGeometry, BufferGeometry, Float32BufferAttribute } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { describe, expect, it } from 'vitest'
import { SHEET_H, pileLayout, sortSheets } from './tray'

const H = 0.003
/** five 2.8 mm boxes with 0.2 mm gaps, like the model, joined in the given order (bottom sheet = 0) */
function stack(order: number[]) {
  const parts = order.map((k) => new BoxGeometry(0.2, H - 0.0002, 0.25).translate(0, k * H + H / 2, 0))
  return mergeGeometries(parts)!
}
/** which sheet each drawn triangle of the first `count` indices belongs to */
function bands(geo: BufferGeometry, count: number) {
  const pos = geo.getAttribute('position')
  const out: number[] = []
  for (let t = 0; t < count; t += 3) {
    const cy = [0, 1, 2].reduce((s, j) => s + pos.getY(geo.index!.getX(t + j)), 0) / 3
    out.push(Math.floor(cy / H))
  }
  return out
}

describe('sortSheets (#59)', () => {
  it('model order: each sheet ends 36 indices after the last', () => {
    const geo = stack([0, 1, 2, 3, 4])
    expect(sortSheets(geo, H, 5)).toEqual([36, 72, 108, 144, 180])
  })

  it('shuffled export: draws the bottom k sheets first', () => {
    const geo = stack([3, 0, 4, 1, 2])
    const ends = sortSheets(geo, H, 5)
    expect(ends).toEqual([36, 72, 108, 144, 180])
    for (let k = 1; k <= 5; k++) {
      const drawn = bands(geo, ends[k - 1])
      expect(new Set(drawn)).toEqual(new Set(Array.from({ length: k }, (_, i) => i)))
    }
  })

  it('keeps every triangle (same index multiset)', () => {
    const geo = stack([4, 2, 0, 3, 1])
    const before = [...geo.index!.array].sort((a, b) => a - b)
    sortSheets(geo, H, 5)
    expect([...geo.index!.array].sort((a, b) => a - b)).toEqual(before)
  })

  it('non-indexed geometry gets an index', () => {
    const geo = stack([1, 0, 2, 3, 4]).toNonIndexed()
    expect(geo.index).toBeNull()
    expect(sortSheets(geo, H, 5)).toEqual([36, 72, 108, 144, 180])
    expect(geo.index!.count).toBe(180)
  })

  it('a missing sheet ends where the one below it does', () => {
    const geo = stack([0, 1, 3, 4])
    expect(sortSheets(geo, H, 5)).toEqual([36, 72, 72, 108, 144])
  })

  it('triangles above the last sheet count as the top one', () => {
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([0, 0.001, 0, 1, 0.001, 0, 0, 0.001, 1, 0, 0.5, 0, 1, 0.5, 0, 0, 0.5, 1], 3))
    expect(sortSheets(geo, H, 5)).toEqual([3, 3, 3, 3, 6])
  })
})

describe('pileLayout (#59)', () => {
  it('0.8 cm a sheet: 5 sheets = 4 cm', () => {
    expect(SHEET_H).toBe(0.008)
    expect(pileLayout(5, 5, false).height).toBeCloseTo(0.04)
  })

  it('empty: hidden, no tab even if asked', () => {
    expect(pileLayout(0, 5, true)).toEqual({ visible: false, under: 0, topAt: 0, height: 0, tab: false })
  })

  it('n sheets = n − 1 straight + 1 askew on top', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const l = pileLayout(n, 5, false)
      expect(l.visible).toBe(true)
      expect(l.under).toBe(n - 1)
      expect(l.topAt).toBeCloseTo((n - 1) * SHEET_H)
      expect(l.height).toBeCloseTo(n * SHEET_H)
    }
  })

  it('clamps to the modeled sheets and to whole sheets', () => {
    expect(pileLayout(9, 5, true)).toMatchObject({ under: 4, tab: true })
    expect(pileLayout(2.7, 5, false).under).toBe(1)
    expect(pileLayout(NaN, 5, false).visible).toBe(false)
    expect(pileLayout(-2, 5, false).visible).toBe(false)
  })

  it('the tab only with sheets showing', () => {
    expect(pileLayout(5, 5, true).tab).toBe(true)
    expect(pileLayout(5, 5, false).tab).toBe(false)
  })
})
