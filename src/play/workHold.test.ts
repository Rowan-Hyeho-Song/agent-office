// #601 (play.md 10): the hold's phases, the chip's and the HUD's words, the cap's result line.
import { describe, expect, it } from 'vitest'
import { capResult, chipShown, chipText, clock, holdPhase, hudBit, momentSaid, WORK_HOLD } from './workHold'

describe('the hold', () => {
  const h = { since: 1000, told: true }
  it('holds, then counts its last 30 s, then is over at 4 min', () => {
    expect(holdPhase(h, 1000)).toEqual({ phase: 'hold', leftMs: WORK_HOLD.capMs })
    expect(holdPhase(h, 1000 + WORK_HOLD.capMs - WORK_HOLD.lastMs - 1).phase).toBe('hold')
    expect(holdPhase(h, 1000 + WORK_HOLD.capMs - WORK_HOLD.lastMs)).toEqual({ phase: 'last', leftMs: WORK_HOLD.lastMs })
    expect(holdPhase(h, 1000 + WORK_HOLD.capMs)).toEqual({ phase: 'over', leftMs: 0 })
    expect(WORK_HOLD.capMs).toBe(240_000)
  })
  it('the chip and the HUD: the game kind, then the seconds left', () => {
    expect(chipText('omok', h, 1000)).toBe('일 들어옴 · 이 판까지')
    expect(chipText('pingpong', h, 1000)).toBe('일 들어옴 · 이 경기까지')
    expect(hudBit('omok', h, 1000)).toBe('이 판까지')
    expect(hudBit('pingpong', h, 1000)).toBe('이 경기까지')
    const last = 1000 + WORK_HOLD.capMs - 30_000
    expect(chipText('omok', h, last)).toBe('일하러 가요 · 0:30')
    expect(chipText('pingpong', h, last + 29_500)).toBe('일하러 가요 · 0:01')
    expect(hudBit('omok', h, last + 12_000)).toBe('0:18 뒤 일하러')
  })
  it('the chip follows the moment line (not over it)', () => {
    expect(chipShown({ since: 0, told: false }, 10_000)).toBe(false)
    expect(chipShown({ since: 0, told: true, toldAt: 500 }, 500 + WORK_HOLD.momentMs - 1)).toBe(false)
    expect(chipShown({ since: 0, told: true, toldAt: 500 }, 500 + WORK_HOLD.momentMs)).toBe(true)
    expect(chipShown(null, 0)).toBe(false)
  })
  it('words', () => {
    expect(clock(90_000)).toBe('1:30')
    expect(capResult('메모')).toBe('중단 · 메모가 일하러 감')
    expect(momentSaid('루프')).toBe('루프에게 일이 들어왔어요. 이 판이 끝나면 책상으로 가요.')
  })
})
