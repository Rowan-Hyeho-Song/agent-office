import { describe, expect, it } from 'vitest'
import { eunNeun } from './OmokVisitUi'

describe('은/는 after a point name (#603)', () => {
  it('by how the number reads', () => {
    expect(['H8', 'H9', 'A1', 'B2', 'C10', 'D12', 'E15', 'F13', 'G6'].map(eunNeun)).toEqual(['H8은', 'H9는', 'A1은', 'B2는', 'C10은', 'D12는', 'E15는', 'F13은', 'G6은'])
  })
})

describe('the rule chooser beside the board (#603, designer #617)', () => {
  it('32 px past the board on a wide screen when it fits with 16 px; over the HUD otherwise, and on a phone', async () => {
    const { besideBoard } = await import('./OmokVisitUi')
    expect(besideBoard({ right: 800, middle: 400 }, 1280)).toEqual({ left: 832, top: 400, bottom: 'auto', translate: '0 -50%' })
    expect(besideBoard({ right: 900, middle: 400 }, 1280)).toBeUndefined() // 1280 - 932 < 356
    expect(besideBoard({ right: 200, middle: 400 }, 390)).toBeUndefined()
    expect(besideBoard(null, 1280)).toBeUndefined()
  })
})
