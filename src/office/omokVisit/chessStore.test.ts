import { afterEach, describe, expect, it } from 'vitest'
import { fromFen, squareAt as sqOf } from '../../play/chess'
import { CHESS_HAND } from '../../play/chessTimeline'
import { startVisitorChess, visitorChessTurn } from '../../play/visitorChess'
import {
  SWITCH_LINES, cancelPromotion, canSwitchGame, chessMoveTo, chessSelect, chessTargets, choosePromotion, closeOmok, drainOmokEvents, getOmokVisit, moveChessCursor, omokArrived, omokHoldsAgent,
  openGameSheet, openOmok, placeOmok, resetOmok, resignChess, restartOmok, seedChess, stepOmok, switchGame, undoOmok, visitorMayMove, workSignalOmok, CENTER,
} from './store'

const T = 1_000_000
const sq = (n: string) => sqOf(n)
const sitChess = () => {
  expect(openOmok('agent_0', T, 7, undefined, 'chess')).toBe(true)
  omokArrived()
}
/** the agent's answer lands: the clock past its think and its hand */
const answer = (from: number) => stepOmok(from + 4000 + CHESS_HAND.land)

afterEach(() => resetOmok())

describe('the visitor at the chess board (#604)', () => {
  it('opens chess when the agent played chess: the visitor is white, the cursor starts at e2', () => {
    sitChess()
    const v = getOmokVisit()
    expect(v).toMatchObject({ kind: 'chess', game: null, phase: 'open', chessCursor: sq('e2'), sel: null, promo: null })
    expect(v.chess?.color).toBe(0)
    expect(visitorMayMove()).toBe(true)
    // omok stays what it was
    resetOmok()
    openOmok('agent_0', T, 7)
    expect(getOmokVisit()).toMatchObject({ kind: 'omok', chess: null, cursor: CENTER })
    expect(getOmokVisit().game).not.toBeNull()
    expect(placeOmok(CENTER, T)).toBe(false) // flying
  })

  it('select a piece, see its targets, move it; the agent answers and the selection is gone', () => {
    sitChess()
    expect(chessSelect(sq('e2'), T)).toBe(true)
    expect(getOmokVisit().sel).toBe(sq('e2'))
    expect(chessTargets().map((t) => t.sq).sort()).toEqual([sq('e3'), sq('e4')])
    expect(chessSelect(sq('e2'), T)).toBe(true) // again: let go
    expect(getOmokVisit().sel).toBeNull()
    chessSelect(sq('e2'), T)
    expect(chessSelect(sq('e4'), T + 10)).toBe(true)
    const v = getOmokVisit()
    expect(v.sel).toBeNull()
    expect(v.chess?.plies).toHaveLength(1)
    expect(visitorMayMove()).toBe(false)
    expect(chessSelect(sq('d2'), T + 20)).toBe(false)
    answer(T + 10)
    expect(getOmokVisit().chess?.plies).toHaveLength(2)
    expect(visitorMayMove()).toBe(true)
    expect(drainOmokEvents().length).toBeGreaterThan(0)
  })

  it('an enemy or an empty square clears the selection; an illegal target does not move', () => {
    sitChess()
    chessSelect(sq('g1'), T)
    expect(chessSelect(sq('g3'), T)).toBe(false)
    expect(getOmokVisit().chess?.plies).toHaveLength(0)
    expect(getOmokVisit().sel).toBeNull()
    expect(chessMoveTo(sq('e5'), T, sq('e2'))).toBe(false)
  })

  it('the keyboard: the cursor moves with the arrows, Enter selects then moves', () => {
    sitChess()
    moveChessCursor(0, 1)
    expect(getOmokVisit().chessCursor).toBe(sq('e3'))
    moveChessCursor(0, -1)
    chessSelect(getOmokVisit().chessCursor, T)
    expect(getOmokVisit().sel).toBe(sq('e2'))
    moveChessCursor(0, 2)
    chessSelect(getOmokVisit().chessCursor, T)
    expect(getOmokVisit().chess?.plies[0].move).toBeDefined()
    for (let i = 0; i < 12; i++) moveChessCursor(-1, 0)
    expect(getOmokVisit().chessCursor & 7).toBe(0)
  })

  it('black visitor (the second game): cursor at e7, the arrows follow the visitor view', () => {
    sitChess()
    restartOmok(T + 5)
    const v = getOmokVisit()
    expect(v.chess?.color).toBe(1)
    expect(v.chessCursor).toBe(sq('e7'))
    moveChessCursor(1, 0) // to the visitor's right: the files run the other way
    expect(getOmokVisit().chessCursor).toBe(sq('d7'))
    moveChessCursor(0, 1) // away from the visitor: down the ranks
    expect(getOmokVisit().chessCursor).toBe(sq('d6'))
  })

  it('a pawn on the last rank asks for the piece; Esc cancels the move; the choice plays it', () => {
    sitChess()
    seedChess(startVisitorChess('agent_0', 7, T, 'normal', 0, fromFen('8/P7/7k/8/8/8/8/4K3 w - - 0 1')!))
    chessSelect(sq('a7'), T)
    expect(chessSelect(sq('a8'), T)).toBe(true)
    expect(getOmokVisit()).toMatchObject({ promo: { from: sq('a7'), to: sq('a8') } })
    expect(getOmokVisit().chess?.plies).toHaveLength(0)
    expect(cancelPromotion()).toBe(true)
    expect(getOmokVisit()).toMatchObject({ promo: null, sel: null })
    expect(getOmokVisit().chess?.plies).toHaveLength(0)
    chessSelect(sq('a7'), T)
    chessSelect(sq('a8'), T)
    expect(choosePromotion(5, T + 1)).toBe(true)
    const p = getOmokVisit().chess!.plies[0]
    expect(p.promo).toBe(5)
    expect(getOmokVisit().promo).toBeNull()
  })

  it('undo takes back the visitor move and the answer', () => {
    sitChess()
    chessSelect(sq('e2'), T)
    chessSelect(sq('e4'), T)
    answer(T)
    expect(undoOmok(T + 9000)).toBe(true)
    expect(getOmokVisit().chess?.plies).toHaveLength(0)
    expect(visitorChessTurn(getOmokVisit().chess!)).toBe(true)
    expect(undoOmok(T + 9100)).toBe(false)
  })

  it('quit ends the game as quit; resign gives the agent the win', () => {
    sitChess()
    closeOmok(T + 10)
    expect(getOmokVisit()).toMatchObject({ phase: 'leaving' })
    expect(getOmokVisit().chess?.end?.result).toBe('quit')
    resetOmok()
    sitChess()
    expect(resignChess(T + 20)).toBe(true)
    expect(getOmokVisit().chess?.end?.result).toBe('resign')
  })

  it('the agent stays in its chair for the chess game; called to work it plays on, then wound up', () => {
    sitChess()
    expect(omokHoldsAgent(T)).toBe(true)
    expect(workSignalOmok(true, T + 100)).toBe(true)
    expect(getOmokVisit().work).not.toBeNull()
    expect(workSignalOmok(false, T + 200)).toBe(false)
    expect(getOmokVisit().work).toBeNull()
  })
})

describe('switching the game at the board (#604, hologram.md 10.3)', () => {
  it('before the first move chess becomes omok and back, the agent says so', () => {
    sitChess()
    drainOmokEvents()
    expect(canSwitchGame()).toBe(true)
    expect(openGameSheet()).toBe(true)
    expect(switchGame('chess', T)).toBe(false) // the same game
    expect(switchGame('omok', T + 10)).toBe(true)
    expect(getOmokVisit()).toMatchObject({ kind: 'omok', chess: null, gameSheet: false, cursor: CENTER })
    expect(getOmokVisit().game).not.toBeNull()
    expect(drainOmokEvents()).toContainEqual({ kind: 'say', text: SWITCH_LINES.omok })
    expect(switchGame('chess', T + 20)).toBe(true)
    expect(getOmokVisit()).toMatchObject({ kind: 'chess', game: null })
    expect(drainOmokEvents()).toContainEqual({ kind: 'say', text: '좋아요, 체스로 해요' })
  })

  it('not once a move is made; the result line allows it again', () => {
    sitChess()
    chessSelect(sq('e2'), T)
    chessSelect(sq('e4'), T)
    expect(canSwitchGame()).toBe(false)
    expect(openGameSheet()).toBe(false)
    expect(switchGame('omok', T + 50)).toBe(false)
    expect(getOmokVisit().kind).toBe('chess')
    resignChess(T + 100)
    expect(canSwitchGame()).toBe(true)
    expect(switchGame('omok', T + 200)).toBe(true)
    expect(getOmokVisit().kind).toBe('omok')
  })

  it('an omok game with a stone cannot switch; a game ended for work cannot either', () => {
    openOmok('agent_0', T, 7)
    omokArrived()
    placeOmok(CENTER, T + 10)
    expect(switchGame('chess', T + 20)).toBe(false)
    resetOmok()
    sitChess()
    workSignalOmok(true, T)
    resignChess(T + 5)
    expect(canSwitchGame()).toBe(false)
  })
})
