import { describe, expect, it } from 'vitest'
import { viewersText } from './viewers'

describe('the viewer count (#4 12.4)', () => {
  it('alone, several, and the short phone form', () => {
    expect(viewersText(1)).toBe('· 지금 혼자 보고 있어요')
    expect(viewersText(3)).toBe('· 지금 3명이 보고 있어요')
    expect(viewersText(0)).toBe('· 지금 혼자 보고 있어요') // this tab is always one
    expect(viewersText(12, true)).toBe('👁 12')
  })
})
