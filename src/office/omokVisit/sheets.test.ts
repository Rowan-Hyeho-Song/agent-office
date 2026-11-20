// #604 (hologram.md 11.5) the promotion sheet stands over the square the pawn reached, 16 px inside the screen's edges
import { describe, expect, it } from 'vitest'
import { overSquare } from './OmokVisitUi'

describe('the promotion sheet over its square (#604)', () => {
  it('centred over the square, above it', () => {
    expect(overSquare({ x: 640, y: 300 }, 1280)).toMatchObject({ left: 490, top: 300, bottom: 'auto' })
  })
  it('kept 16 px inside either edge', () => {
    expect(overSquare({ x: 20, y: 300 }, 1280)?.left).toBe(16)
    expect(overSquare({ x: 1270, y: 300 }, 1280)?.left).toBe(1280 - 16 - 300)
    // a phone narrower than the sheet with its margins: from the left margin (the sheet's max width keeps the right one)
    expect(overSquare({ x: 300, y: 300 }, 320)?.left).toBe(16)
  })
  it('none before the rig has placed it: over the HUD as before', () => {
    expect(overSquare(null, 1280)).toBeUndefined()
  })
})
