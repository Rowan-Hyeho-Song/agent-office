import { describe, expect, it } from 'vitest'
import { litWindows } from './outside'
import { LIGHT_LAYERS } from './OutsideView'

describe('window light layers (#123)', () => {
  it('both cards are driven; the 25 m skyline lights half the share of the 12 m buildings', () => {
    const near = LIGHT_LAYERS.find((l) => l.node === 'window_lights')!
    const far = LIGHT_LAYERS.find((l) => l.node === 'window_lights_far')!
    expect(near.share).toBe(1)
    expect(far.share).toBe(0.5)
  })
  it('with the same hour the two layers get different patterns', () => {
    const [near, far] = LIGHT_LAYERS
    const a = litWindows(200, 0.2, 22 + near.seed).lit
    const b = litWindows(200, 0.2, 22 + far.seed).lit
    expect(a.join()).not.toBe(b.join())
  })
})
