import { describe, expect, it } from 'vitest'
import { eunNeun } from './OmokVisitUi'

describe('은/는 after a point name (#603)', () => {
  it('by how the number reads', () => {
    expect(['H8', 'H9', 'A1', 'B2', 'C10', 'D12', 'E15', 'F13', 'G6'].map(eunNeun)).toEqual(['H8은', 'H9는', 'A1은', 'B2는', 'C10은', 'D12는', 'E15는', 'F13은', 'G6은'])
  })
})
