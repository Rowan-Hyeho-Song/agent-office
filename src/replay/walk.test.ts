import { describe, expect, it } from 'vitest'
import { shouldWalk, stageSpot } from './walk'
import type { Point } from '../timeline/types'

const base = { speed: 1, via: 'play', reduced: false, distanceM: 1.5, budgetMs: 3000 } as const
const plan = { kind: 'plan', agent: 0 } as Point

describe('shouldWalk', () => {
  it('walks while playing at x1', () => expect(shouldWalk(base)).toBe(true))
  it('stays put at x4 and x16', () => {
    expect(shouldWalk({ ...base, speed: 4, budgetMs: 750 })).toBe(false)
    expect(shouldWalk({ ...base, speed: 16, budgetMs: 190 })).toBe(false)
  })
  it('snaps after a seek and with reduced motion', () => {
    expect(shouldWalk({ ...base, via: 'seek' })).toBe(false)
    expect(shouldWalk({ ...base, reduced: true })).toBe(false)
  })
  it('snaps when the walk cannot finish inside the point', () => {
    expect(shouldWalk({ ...base })).toBe(true)
    expect(shouldWalk({ ...base, distanceM: 1.7 })).toBe(false)
    expect(shouldWalk({ ...base, distanceM: Infinity })).toBe(false)
    expect(shouldWalk({ ...base, distanceM: 3.7, budgetMs: 7000 })).toBe(true)
  })
})

describe('stageSpot', () => {
  it('sends only the plan point agent to the whiteboard', () => {
    expect(stageSpot(plan, 0)).toBe('whiteboard')
    expect(stageSpot(plan, 1)).toBe('work_1')
    expect(stageSpot({ kind: 'work', agent: 0 } as Point, 0)).toBe('work_0')
  })
})
