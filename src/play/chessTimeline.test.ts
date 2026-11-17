// #604 (hologram.md 11.4 · 11.6) the agents' chess timeline: deterministic, computed a few half-moves per call without changing the result.
import { beforeEach, describe, expect, it } from 'vitest'
import { CHESS_HAND, CHESS_LIMIT_PLIES, CHESS_PLIES_PER_CALL, chessAt, resetChessCache, type ChessView } from './chessTimeline'
import { KING } from './chess'

const P: [string, string] = ['agent_1', 'agent_2']
/** the view at t, computed with no budget limit from a fresh cache */
const full = (seed: number, t: number) => {
  resetChessCache()
  return chessAt(seed, P, t, Number.POSITIVE_INFINITY)
}
const same = (a: ChessView, b: ChessView) => {
  expect(Array.from(a.board)).toEqual(Array.from(b.board))
  expect({ ...a, board: null }).toEqual({ ...b, board: null })
}

beforeEach(() => resetChessCache())

describe('the agents chess timeline (#604)', () => {
  it('a seek into the middle catches up over calls, never more than the budget each, to the same position as one long computation', () => {
    const t = 90_000
    const want = full(7, t)
    resetChessCache()
    let v = chessAt(7, P, t)
    expect(v.phase).toBe('catching')
    let calls = 1
    while (v.phase === 'catching' && calls < 500) {
      v = chessAt(7, P, t)
      calls++
    }
    expect(v.phase).not.toBe('catching')
    // each call computed at most CHESS_PLIES_PER_CALL half-moves: as many calls as half-moves over the budget
    expect(calls).toBeGreaterThanOrEqual(Math.ceil(want.moveIndex / CHESS_PLIES_PER_CALL))
    same(v, want)
  })
  it('the same seed and time give the same game; another seed another', () => {
    const a = full(11, 60_000)
    const b = full(11, 60_000)
    same(a, b)
    const c = full(12, 60_000)
    expect(Array.from(c.board)).not.toEqual(Array.from(a.board))
  })
  it('a half-move: thinking, the pick at 0.37 s after it, the landing at 0.92 s, the board changes at the landing', () => {
    const v0 = full(3, 0)
    expect(v0.phase).toBe('thinking')
    const m = v0.move!
    expect(m.side).toBe(0)
    const pick = m.thinkMs + CHESS_HAND.pick
    const land = m.thinkMs + CHESS_HAND.land
    expect(full(3, pick - 1).phase).toBe('thinking')
    expect(full(3, pick).phase).toBe('pick')
    const before = full(3, land - 1)
    const after = full(3, land)
    expect(before.moveIndex).toBe(0)
    expect(after.moveIndex).toBe(1)
    expect(after.phase).toBe('place')
    expect(after.lastMove).toEqual({ from: m.from, to: m.to })
    expect(after.board[m.to]).toBe(before.board[m.from])
    expect(after.board[m.from]).toBe(0)
    // thinking 0.6–1.6 s
    expect(m.thinkMs).toBeGreaterThanOrEqual(600)
    expect(m.thinkMs).toBeLessThanOrEqual(1600)
  })
  it('captures are counted by side; check names the king in check', () => {
    let seen = false
    for (let t = 0; t < 400_000 && !seen; t += 7_000) {
      const v = full(5, t)
      expect(v.takenByWhite.length + v.takenByBlack.length).toBeLessThanOrEqual(30)
      if (v.check !== null) {
        expect(Math.abs(v.board[v.check])).toBe(KING)
        seen = true
      }
    }
  })
  it('a game ends (by the rules or at our 120-move limit), shows its result, and the next game swaps the colours', () => {
    resetChessCache()
    let v = chessAt(21, P, 0, Number.POSITIVE_INFINITY)
    let t = 0
    while (!v.end && t < 2_000_000) {
      t += 20_000
      v = chessAt(21, P, t, Number.POSITIVE_INFINITY)
    }
    expect(v.end).not.toBeNull()
    expect(v.end!.plies).toBeLessThanOrEqual(CHESS_LIMIT_PLIES)
    if (v.end!.kind === 'draw' && v.end!.plies === CHESS_LIMIT_PLIES) expect(v.end!.reason).toBe('limit')
    let next = v
    while (next.game === v.game && t < 2_100_000) {
      t += 2_000
      next = chessAt(21, P, t, Number.POSITIVE_INFINITY)
    }
    expect(next.game).toBe(v.game + 1)
    expect(next.white).toBe(1 - v.white)
  }, 120_000)
})
