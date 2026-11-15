import { afterEach, describe, expect, it } from 'vitest'
import { N } from '../../play/omok'
import { VISITOR_OMOK } from '../../play/visitorOmok'
import {
  CENTER, closeOmok, drainOmokEvents, getOmokVisit, isOmokActive, moveCursor, omokArrived, omokLeft, openOmok, placeOmok, resetOmok, setOmokTag,
  stepOmok, viewName, visitorMayPlace, workOmok, type Orient,
} from './store'

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
