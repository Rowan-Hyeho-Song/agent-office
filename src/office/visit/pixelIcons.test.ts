import { describe, expect, it } from 'vitest'
import { ICON_GRIDS, pixelSvg } from './pixelIcons'

describe('the pixel icons (#454)', () => {
  it('square grids: 12 × 12, the heart 7 × 7, only known colours', () => {
    for (const [name, g] of Object.entries(ICON_GRIDS)) {
      const n = name === 'heart' ? 7 : 12
      expect(g, name).toHaveLength(n)
      for (const row of g) expect(row, name).toHaveLength(n)
      expect(g.join('').replace(/[.kwWbAYTdRhGM]/g, ''), name).toBe('')
    }
  })
  it('drawn twice the size with crisp edges, a run of one colour as one rect', () => {
    const s = pixelSvg('coffee')
    expect(s).toContain('width="24" height="24"')
    expect(s).toContain('shape-rendering="crispEdges"')
    // row 3 '.kkkkkkk....': one ink run of 7
    expect(s).toContain('<rect x="1" y="3" width="7" height="1" fill="#0b0e13"/>')
    expect(pixelSvg('heart')).toContain('width="14" height="14"')
    expect(pixelSvg('heart')).toContain('#ffd1ec')
  })
})
