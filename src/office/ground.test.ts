/// <reference types="node" />
// #316: the hover light on the floor follows the floor's top under the agent (a rug's top over a rug), smoothly across an edge.
import { describe, expect, it } from 'vitest'
import { EDGE_BAND, groundAt, readRugs, type Rug } from './ground'
import { loadOffice, stubCanvas } from './glbLoad'

stubCanvas()

describe('the floor height under an agent (#316)', () => {
  const rug: Rug = { x: 0, z: 0, hx: 1, hz: 0.5, top: 0.012 }
  it('the bare floor is 0, a rug is its top', () => {
    expect(groundAt([rug], 3, 3)).toBe(0)
    expect(groundAt([rug], 0, 0)).toBeCloseTo(0.012, 6)
    expect(groundAt([rug], 0.9, 0.4)).toBeCloseTo(0.012, 6)
  })
  it('across an edge it eases over the band, never jumps', () => {
    let last = groundAt([rug], 1 + EDGE_BAND, 0)
    expect(last).toBe(0)
    for (let x = 1 + EDGE_BAND; x >= 1 - EDGE_BAND; x -= 0.001) {
      const y = groundAt([rug], x, 0)
      expect(y).toBeGreaterThanOrEqual(last - 1e-12)
      expect(y - last).toBeLessThan(0.0006) // ≤ 0.6 mm per mm walked
      last = y
    }
    expect(last).toBeCloseTo(0.012, 6)
  })
  it('the corners are round, the same ease', () => {
    expect(groundAt([rug], 1 + EDGE_BAND / 2 + 0.001, 0.5 + 0.001)).toBe(0)
    expect(groundAt([rug], 1 - EDGE_BAND, 0.5 - EDGE_BAND)).toBeCloseTo(0.012, 6)
  })
})

describe('the rugs of the baked model', () => {
  it('three rugs, each top above the light’s own height (5 mm) and below 3 cm', async () => {
    const { scene } = await loadOffice()
    const rugs = readRugs(scene)
    expect(rugs.length).toBe(3)
    for (const r of rugs) {
      expect(r.top).toBeGreaterThan(0.005)
      expect(r.top).toBeLessThan(0.03)
    }
  })
})
