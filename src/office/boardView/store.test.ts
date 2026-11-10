import { describe, expect, it } from 'vitest'
import { CLOSED, reduceBoard, type BoardViewState } from './store'

const open = { type: 'open', mode: 'stage', column: 1, focusKey: 'a/b#7' } as const

describe('board view transitions', () => {
  it('opens from closed: stage flies, sheet opens at once', () => {
    expect(reduceBoard(CLOSED, open)).toMatchObject({ phase: 'flying', mode: 'stage', column: 1, focusKey: 'a/b#7' })
    expect(reduceBoard(CLOSED, { ...open, mode: 'sheet' })).toMatchObject({ phase: 'open', mode: 'sheet' })
  })
  it('ignores a second open while it is up or flying back', () => {
    const flying = reduceBoard(CLOSED, open)
    expect(reduceBoard(flying, { ...open, column: 2 })).toBe(flying)
    const leaving: BoardViewState = { ...flying, phase: 'leaving' }
    expect(reduceBoard(leaving, open)).toBe(leaving)
  })
  it('arrives only from flying', () => {
    expect(reduceBoard(CLOSED, { type: 'arrived' })).toBe(CLOSED)
    expect(reduceBoard(reduceBoard(CLOSED, open), { type: 'arrived' }).phase).toBe('open')
  })
  it('a close turns back even in mid-flight; on the sheet it is closed at once', () => {
    const flying = reduceBoard(CLOSED, open)
    expect(reduceBoard(flying, { type: 'close' }).phase).toBe('leaving')
    expect(reduceBoard(reduceBoard(flying, { type: 'arrived' }), { type: 'close' }).phase).toBe('leaving')
    expect(reduceBoard(reduceBoard(CLOSED, { ...open, mode: 'sheet' }), { type: 'close' }).phase).toBe('closed')
  })
  it('a close while closed or leaving does nothing', () => {
    expect(reduceBoard(CLOSED, { type: 'close' })).toBe(CLOSED)
    const leaving: BoardViewState = { ...CLOSED, phase: 'leaving' }
    expect(reduceBoard(leaving, { type: 'close' })).toBe(leaving)
  })
  it('lands closed after the flight back; a reset (the timelapse) closes at once', () => {
    const leaving = reduceBoard(reduceBoard(CLOSED, open), { type: 'close' })
    expect(reduceBoard(leaving, { type: 'left' })).toMatchObject({ phase: 'closed', column: null, focusKey: null })
    expect(reduceBoard(reduceBoard(CLOSED, open), { type: 'reset' }).phase).toBe('closed')
    expect(reduceBoard(CLOSED, { type: 'left' })).toBe(CLOSED)
  })
  it('keeps the hover flag across a close', () => {
    const s = { ...reduceBoard(CLOSED, { ...open, mode: 'sheet' }), hover: true }
    expect(reduceBoard(s, { type: 'close' }).hover).toBe(true)
  })
})
