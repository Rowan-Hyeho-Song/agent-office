import { afterEach, describe, expect, it } from 'vitest'
import { N } from '../../play/omok'
import { VISITOR_OMOK } from '../../play/visitorOmok'
import {
  CENTER, closeOmok, drainOmokEvents, getOmokVisit, isOmokActive, moveCursor, omokArrived, omokLeft, openOmok, placeOmok, resetOmok, setOmokTag,
  omokHoldsAgent, omokWorkTold, seedOmok, stepOmok, viewName, visitorMayPlace, workOmok, workSignalOmok, type Orient,
} from './store'
import { chooseRule, closeRulePicker, forgetRuleChoice, lastRule, openRulePicker, selectRule } from './store'
import { FORBID_LINE, RULE_LINES } from '../../play/visitorOmok'
import { WORK_HOLD, WORK_LINES } from '../../play/workHold'

const T = 1_000_000
const sitDown = (orient?: Orient) => {
  expect(openOmok('agent_0', T, 7, orient)).toBe(true)
  omokArrived()
}

afterEach(() => resetOmok())

describe('the visitor at the board (#137 ②)', () => {
  it('flies in, opens, flies back and closes; a second sit-down waits until closed', () => {
    expect(isOmokActive()).toBe(false)
    expect(openOmok('agent_0', T, 7)).toBe(true)
    expect(getOmokVisit()).toMatchObject({ phase: 'flying', agent: 'agent_0', cursor: CENTER })
    expect(isOmokActive()).toBe(true)
    expect(openOmok('agent_1', T, 7)).toBe(false)
    omokArrived()
    expect(getOmokVisit().phase).toBe('open')
    closeOmok(T + 1000)
    expect(getOmokVisit().phase).toBe('leaving')
    expect(getOmokVisit().game?.end?.result).toBe('quit')
    omokLeft()
    expect(getOmokVisit()).toMatchObject({ phase: 'closed', agent: null, game: null })
  })
  it('the tag stays through a sitting (the rig moves it, not the game)', () => {
    const tag = { x: 10, y: 20, agent: 'agent_0', orient: { right: [1, 0], up: [0, -1] } as Orient }
    setOmokTag(tag)
    sitDown()
    closeOmok(T + 10)
    omokLeft()
    expect(getOmokVisit().tag).toBe(tag)
  })
  it('places only on the visitor turn; the agent answers within the think cap', () => {
    sitDown()
    expect(placeOmok(CENTER, T + 100)).toBe(true)
    expect(visitorMayPlace()).toBe(false)
    expect(placeOmok(CENTER + 1, T + 200)).toBe(false)
    stepOmok(T + 100 + VISITOR_OMOK.thinkCapMs + 50)
    const g = getOmokVisit().game!
    expect(g.moves).toHaveLength(2)
    expect(visitorMayPlace()).toBe(true)
    expect(placeOmok(g.moves[1], T + 4000)).toBe(false) // taken
    expect(drainOmokEvents().length).toBeGreaterThan(0)
    expect(drainOmokEvents()).toEqual([])
  })
  it('not before the camera has arrived', () => {
    openOmok('agent_0', T, 7)
    expect(placeOmok(CENTER, T + 100)).toBe(false)
  })
  it('called to work: the game ends as work and says so', () => {
    sitDown()
    drainOmokEvents()
    expect(workOmok(T + 500)).toBe(true)
    expect(getOmokVisit().game?.end?.result).toBe('work')
    expect(drainOmokEvents().some((e) => e.kind === 'say')).toBe(true)
    expect(workOmok(T + 600)).toBe(false)
  })
})

describe('the keyboard cursor as the visitor sees the board', () => {
  it('from the south side (columns +x to the right, rows -z up): the arrows step the grid directly, clamped at the edge', () => {
    sitDown({ right: [1, 0], up: [0, -1] })
    moveCursor(1, 0)
    expect(getOmokVisit().cursor).toBe(CENTER + 1)
    moveCursor(0, 1)
    expect(getOmokVisit().cursor).toBe(CENTER + 1 - N)
    for (let i = 0; i < 20; i++) moveCursor(-1, 0)
    expect(getOmokVisit().cursor % N).toBe(0)
  })
  it('from the west side: right is +z (down a row), up is +x', () => {
    sitDown({ right: [0, 1], up: [1, 0] })
    moveCursor(1, 0)
    expect(getOmokVisit().cursor).toBe(CENTER + N)
    moveCursor(0, 1)
    expect(getOmokVisit().cursor).toBe(CENTER + N + 1)
  })
  it('names the points as the visitor sees them: H8 the middle, A1 near left, O15 far right', () => {
    for (const o of [
      { right: [1, 0], up: [0, -1] },
      { right: [-1, 0], up: [0, 1] },
      { right: [0, 1], up: [1, 0] },
    ] as Orient[]) {
      expect(viewName(CENTER, o)).toBe('H8')
      // one corner is A1 and the opposite one O15, whichever way the visitor sits
      const corners = [0, N - 1, N * (N - 1), N * N - 1]
      const a1 = corners.find((c) => viewName(c, o) === 'A1')
      expect(a1).toBeDefined()
      expect(viewName(N * N - 1 - a1!, o)).toBe('O15')
    }
  })
})

// #603 (play.md 11.2 · 11.4) the rule chooser and the forbidden points
describe('the rules at the visitor board', () => {
  it('the first game in this tab opens the chooser by itself; a rule chosen there starts the game under it with the agent word; later games do not ask', () => {
    forgetRuleChoice()
    sitDown()
    expect(getOmokVisit()).toMatchObject({ picker: true, pickerRule: 'renju' })
    expect(getOmokVisit().game?.rule).toBe('renju')
    selectRule('exact')
    expect(getOmokVisit().game?.rule).toBe('renju') // only selected
    drainOmokEvents()
    expect(chooseRule(getOmokVisit().pickerRule, T + 100)).toBe(true)
    expect(getOmokVisit()).toMatchObject({ picker: false })
    expect(getOmokVisit().game?.rule).toBe('exact')
    expect(drainOmokEvents()).toContainEqual({ kind: 'say', text: RULE_LINES.exact })
    resetOmok()
    sitDown()
    expect(getOmokVisit().picker).toBe(false)
  })
  it('reopened from the chip before the first stone; Esc closes it keeping the rule; after the first stone it does not open', () => {
    forgetRuleChoice()
    sitDown()
    closeRulePicker()
    expect(getOmokVisit().picker).toBe(false)
    expect(openRulePicker()).toBe(true)
    expect(placeOmok(CENTER, T + 100)).toBe(true) // the first stone closes it and starts the game
    expect(getOmokVisit().picker).toBe(false)
    stepOmok(T + 10_000)
    expect(openRulePicker()).toBe(false)
  })
  it('the first stone with the chooser open starts under the rule selected there (빨리 시작)', () => {
    forgetRuleChoice()
    sitDown()
    selectRule('free')
    expect(placeOmok(CENTER, T + 100)).toBe(true)
    expect(getOmokVisit().game?.rule).toBe('free')
    expect(getOmokVisit().game?.moves).toEqual([CENTER])
  })
  it('a forbidden point: nothing placed, the guidance (where, why), the agent says so once a game', () => {
    forgetRuleChoice()
    sitDown()
    closeRulePicker()
    // black's 3-3 at H8 after the agent's answers far away: the visitor's stones put on the board as they stand
    const g = getOmokVisit().game!
    const board = g.s.board.slice()
    for (const c of [7 * N + 5, 7 * N + 6, 5 * N + 7, 6 * N + 7]) board[c] = 1
    for (const c of [0, 2, 4, 6]) board[c] = 2
    seedOmok({ ...g, s: { ...g.s, board, toMove: 1, moveIndex: 8 }, moves: [7 * N + 5, 0, 7 * N + 6, 2, 5 * N + 7, 4, 6 * N + 7, 6] })
    drainOmokEvents()
    expect(placeOmok(CENTER, T + 100)).toBe(false)
    expect(getOmokVisit().forbid).toEqual({ cell: CENTER, why: '33', at: T + 100 })
    expect(getOmokVisit().game?.s.board[CENTER]).toBe(0)
    expect(drainOmokEvents()).toEqual([{ kind: 'say', text: FORBID_LINE }])
    placeOmok(CENTER, T + 200)
    expect(drainOmokEvents()).toEqual([]) // once a game
  })
  it('the last rule is kept in this browser (renju without storage)', () => {
    expect(lastRule()).toBe('renju')
  })
})

// #601 (play.md 10): called to work during the visitor's game, the agent plays it out, then goes; up to 4 min; back to rest, the hold is dropped
describe('a call to work waits for the game', () => {
  const play = (cell: number, at: number) => {
    expect(placeOmok(cell, at)).toBe(true)
    stepOmok(at + 10_000) // the agent answers
  }
  it('held: the game goes on and holds the agent; the moment is shown once; the game over, the agent goes at once', () => {
    sitDown()
    expect(workSignalOmok(true, T + 100)).toBe(true) // the hold begins (the moment follows)
    expect(workSignalOmok(true, T + 200)).toBe(false)
    expect(getOmokVisit().work).toEqual({ since: T + 100, told: false })
    omokWorkTold(T + 150)
    expect(getOmokVisit().work).toMatchObject({ told: true, toldAt: T + 150 })
    expect(getOmokVisit().game?.end).toBeNull()
    expect(omokHoldsAgent(T + 300)).toBe(true)
    play(CENTER, T + 1000)
    expect(omokHoldsAgent(T + 12_000)).toBe(true) // still playing
    closeOmok(T + 15_000) // the visitor leaves
    expect(omokHoldsAgent(T + 15_000)).toBe(false)
  })
  it('the game ends with the hold on: the agent goes at once (no staying for the visitor)', () => {
    sitDown()
    workSignalOmok(true, T)
    const g = getOmokVisit().game!
    // a five for the visitor in a row of the board, put as it stands
    const row = 7 * N
    const board = g.s.board.slice()
    for (let k = 0; k < 4; k++) board[row + k] = 1
    seedOmok({ ...g, s: { ...g.s, board } })
    expect(placeOmok(row + 4, T + 1000)).toBe(true)
    expect(getOmokVisit().game?.end?.result).toBe('black')
    // its line at the board, then away
    expect(omokHoldsAgent(T + 1000 + WORK_HOLD.leaveMs - 1)).toBe(true)
    expect(omokHoldsAgent(T + 1000 + WORK_HOLD.leaveMs)).toBe(false)
  })
  it('past the cap the game is wound up with the cap line; the camera stays (the visitor leaves when they like)', () => {
    sitDown()
    workSignalOmok(true, T)
    drainOmokEvents()
    workSignalOmok(true, T + WORK_HOLD.capMs - 1)
    expect(getOmokVisit().game?.end).toBeNull()
    workSignalOmok(true, T + WORK_HOLD.capMs)
    expect(getOmokVisit().game?.end?.result).toBe('work')
    expect(drainOmokEvents()).toContainEqual({ kind: 'say', text: WORK_LINES.cap })
    expect(getOmokVisit().phase).toBe('open')
    expect(omokHoldsAgent(T + WORK_HOLD.capMs + 100)).toBe(true) // the cap's line at the board
    expect(omokHoldsAgent(T + WORK_HOLD.capMs + WORK_HOLD.leaveMs)).toBe(false)
  })
  it('back to rest before the end: the hold is dropped and the game goes on as before', () => {
    sitDown()
    workSignalOmok(true, T)
    workSignalOmok(false, T + 1000)
    expect(getOmokVisit().work).toBeNull()
    expect(omokHoldsAgent(T + 2000)).toBe(true)
    workSignalOmok(true, T + WORK_HOLD.capMs + 5000) // a new call: a new hold from now, not wound up
    expect(getOmokVisit().game?.end).toBeNull()
  })
})
