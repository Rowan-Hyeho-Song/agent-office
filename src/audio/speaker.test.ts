import { describe, expect, it } from 'vitest'
import { duckDb } from './engine'
import {
  DEFAULT_VIEW_M,
  HOLD_S,
  coneFromLow,
  distParams,
  faderTargets,
  glowFromRms,
  holdState,
  hoverLabel,
  meterStep,
  rawCells,
  wantedState,
  deckState,
  DECK_IDLE,
} from './speaker'

describe('the turntable (#280, sound.md 4.4)', () => {
  it('nobody at it: break at once, as before', () => expect(deckState('break', DECK_IDLE)).toBe('break'))
  it('someone on the way: the break music waits (work) until the needle is down', () => {
    expect(deckState('break', { ...DECK_IDLE, coming: true })).toBe('work')
    expect(deckState('break', { ...DECK_IDLE, down: true })).toBe('break')
  })
  it('arm lifted during the break: back to work music', () => expect(deckState('break', { ...DECK_IDLE, lifted: true })).toBe('work'))
  it('outside a break the agents rule (work, night off) whatever the record does', () => {
    expect(deckState('work', { ...DECK_IDLE, down: true })).toBe('work')
    expect(deckState('off', { ...DECK_IDLE, down: true })).toBe('off')
  })
})

// ③ ECHO's speakers (sound.md 5, #194): the rules that turn the agents and the music into values echoLive draws

describe('music state from the agents', () => {
  it('two or more on a break = break, fewer = work, night = off', () => {
    expect(wantedState(0, false)).toBe('work')
    expect(wantedState(1, false)).toBe('work')
    expect(wantedState(2, false)).toBe('break')
    expect(wantedState(5, true)).toBe('off')
  })

  it('a new state is followed only after it held 8 s (a quick coffee does not flip the music)', () => {
    let h = holdState(null, 'work', 0)
    expect(h.state).toBe('work')
    h = holdState(h, 'break', 10)
    h = holdState(h, 'break', 10 + HOLD_S - 0.1)
    expect(h.state).toBe('work')
    h = holdState(h, 'work', 19) // back before it held: the wait is over, nothing changed
    h = holdState(h, 'break', 20)
    expect(holdState(h, 'break', 20 + HOLD_S).state).toBe('break')
  })

  it('a jump back in time (a replay scrub) starts the wait again', () => {
    let h = holdState(null, 'work', 100)
    h = holdState(h, 'break', 101)
    h = holdState(h, 'break', 50)
    expect(h.state).toBe('work')
    expect(holdState(h, 'break', 50 + HOLD_S).state).toBe('break')
  })
})

describe('the mixer meter', () => {
  it('RMS −48 → −12 dBFS over 8 cells', () => {
    expect(rawCells(-120)).toBe(0)
    expect(rawCells(-48)).toBe(0)
    expect(rawCells(-47)).toBe(1)
    expect(rawCells(-25)).toBe(6) // break music at the speakers
    expect(rawCells(-37)).toBe(3) // work music (−12 dB)
    expect(rawCells(0)).toBe(8)
  })

  it('jumps up, holds 0.3 s, then falls a cell every 0.08 s', () => {
    let m = meterStep({ cells: 0, next: 0 }, 6, 1)
    expect(m.cells).toBe(6)
    m = meterStep(m, 2, 1.2)
    expect(m.cells).toBe(6)
    m = meterStep(m, 2, 1.31)
    expect(m.cells).toBe(5)
    m = meterStep(m, 2, 1.31 + 0.08)
    expect(m.cells).toBe(4)
    m = meterStep(m, 2, 5)
    expect(m.cells).toBe(2)
  })
})

describe('cones, glow and faders', () => {
  it('the cone follows the bass, the glow the RMS (0 … 0.3)', () => {
    expect(coneFromLow(-60)).toBe(0)
    expect(coneFromLow(-25)).toBeCloseTo(0.5)
    expect(coneFromLow(0)).toBe(1)
    expect(glowFromRms(-120)).toBe(0)
    expect(glowFromRms(-12)).toBeCloseTo(0.3)
  })

  it('break: every channel up; work: the hook down, drums only the shaker; off or off for me: all down', () => {
    const all = ['hook', 'keys', 'pad', 'bass', 'kick', 'shaker', 'rim'] as const
    expect(faderTargets('break', all, true)).toEqual([0.8, 0.8, 0.8, 0.8])
    const work = faderTargets('work', ['keys', 'pad', 'bass', 'shaker'], true)
    expect(work[0]).toBe(0)
    expect(work[1]).toBeCloseTo(0.5)
    expect(work[2]).toBeCloseTo(0.5)
    expect(work[3]).toBeCloseTo(0.5 * 0.35)
    expect(faderTargets('off', [], true)).toEqual([0, 0, 0, 0])
    expect(faderTargets('break', all, false)).toEqual([0, 0, 0, 0])
  })
})

describe('distance and ducking', () => {
  it("'room' keeps the shared law (23 m, #280 bigger room); 'near' is the same at the default view and at most +4 dB closer", () => {
    expect(distParams('room')).toEqual({ ref: 23, trim: 1 })
    const { ref, trim } = distParams('near')
    expect((ref / DEFAULT_VIEW_M) * trim).toBeCloseTo(1)
    expect(20 * Math.log10(trim)).toBeCloseTo(4)
  })

  it('speech over a rally: the deeper duck wins, they do not add', () => {
    expect(duckDb(-6, -4)).toBe(-6)
    expect(duckDb(0, -4)).toBe(-4)
    expect(duckDb(0, 0)).toBe(0)
  })

  it('hover label', () => {
    expect(hoverLabel(true, false)).toBe('음악 끄기 (나에게만)')
    expect(hoverLabel(false, false)).toBe('음악 켜기')
    expect(hoverLabel(true, true)).toBe('밤에는 음악을 쉬어요')
  })
})
