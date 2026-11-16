import { afterEach, describe, expect, it } from 'vitest'
import { N } from '../../play/omok'
import { VISITOR_OMOK } from '../../play/visitorOmok'
import {
  CENTER, closeOmok, drainOmokEvents, getOmokVisit, isOmokActive, moveCursor, omokArrived, omokLeft, openOmok, placeOmok, resetOmok, setOmokTag,
  omokHoldsAgent, omokWorkTold, seedOmok, stepOmok, viewName, visitorMayPlace, workOmok, workSignalOmok, type Orient,
} from './store'
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
