import { describe, expect, it } from 'vitest'
import { CUES } from './cues'
import { PRESS_AT, pressesBetween } from './wrapSound'

// #229 the wrap-up card sound (wrapup.md 5): a paper "톡" each time a card meets the board
describe('card.press', () => {
  it('is a small repeat cue in the room', () => {
    expect(CUES['card.press'].spatial).toBe(true)
    expect(CUES['card.press'].kind).toBe('repeat')
    expect(CUES['card.press'].bus).toBe('sfx')
  })
  it('posting: once as the press beat starts', () => {
    expect(pressesBetween({ kind: 'place', u: 0.9, k: 0 }, { kind: 'press', u: 0.1, k: 0 })).toEqual([0])
    expect(pressesBetween({ kind: 'press', u: 0.1, k: 0 }, { kind: 'press', u: 0.6, k: 0 })).toEqual([])
    expect(pressesBetween(null, { kind: 'press', u: 0, k: 2 })).toEqual([0])
  })
  it('moving presses at 0.85, swapping at 0.62 and 0.95', () => {
    expect(PRESS_AT.move).toEqual([0.85])
    expect(pressesBetween({ kind: 'move', u: 0.8, k: 1 }, { kind: 'move', u: 0.9, k: 1 })).toEqual([0])
    expect(pressesBetween({ kind: 'swap', u: 0.5, k: 1 }, { kind: 'swap', u: 1, k: 1 })).toEqual([0, 1])
  })
  it('nothing for other beats, no beat, or a jump back', () => {
    expect(pressesBetween(null, { kind: 'line', u: 0.5, k: 0 })).toEqual([])
    expect(pressesBetween({ kind: 'press', u: 0.5, k: 0 }, undefined)).toEqual([])
    expect(pressesBetween({ kind: 'move', u: 0.95, k: 1 }, { kind: 'move', u: 0.5, k: 1 })).toEqual([])
  })
})
