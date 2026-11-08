import { describe, expect, it } from 'vitest'
import { pointWaitMs, stageSpot, walkWaitMs, WALK_HOLD_MS, WALK_MPS } from './walk'
import { remainingMs } from './engine'
import type { Point } from '../timeline/types'

const plan = { kind: 'plan', agent: 0 } as Point

describe('stageSpot', () => {
  it('sends only the plan point agent to the whiteboard', () => {
    expect(stageSpot(plan, 0)).toBe('whiteboard')
    expect(stageSpot(plan, 1)).toBe('work_1')
    expect(stageSpot({ kind: 'work', agent: 0 } as Point, 0)).toBe('work_0')
  })
})

describe('walk waits', () => {
  const step = () => 3000
  const at = (n: number, over: Partial<Point> = {}) => ({ kind: 'work', agent: 3, at: `2026-11-07T0${n}:00:00Z`, ...over }) as Point
  it('holds only by the part that does not fit, capped, and not at all when skipped', () => {
    expect(walkWaitMs(1, 3000)).toBe(0)
    expect(walkWaitMs(3.69, 3000)).toBeCloseTo((3.69 / WALK_MPS) * 1000 - 3000, 5)
    expect(walkWaitMs(Infinity, 3000)).toBe(0)
    expect(walkWaitMs(50, 3000)).toBe(WALK_HOLD_MS)
    expect(walkWaitMs(undefined, 3000)).toBe(0)
    expect(walkWaitMs(3.9, 3000)).toBeLessThanOrEqual(WALK_HOLD_MS)
  })
  it('counts the planner trip and the walk back', () => {
    const pts = [at(1), at(2, { kind: 'plan', agent: 0 }), at(3), at(4, { kind: 'plan', agent: 0 }), at(5, { kind: 'plan', agent: 0 })]
    const d = { 0: 4 }
    const w = walkWaitMs(4, 3000)
    expect(w).toBeGreaterThan(0)
    expect(pointWaitMs(pts, 0, step, d)).toBe(0)
    expect(pointWaitMs(pts, 1, step, d)).toBe(w)
    expect(pointWaitMs(pts, 2, step, d)).toBe(w)
    expect(pointWaitMs(pts, 4, step, d)).toBe(0)
    expect(pointWaitMs(pts, 2, step, d, true)).toBe(0)
  })
  it('adds to the time left at every speed, scaled with it', () => {
    const pts = [at(1), at(2)]
    expect(remainingMs(pts, 0, 1, () => 500)).toBe(7000)
    expect(remainingMs(pts, 0, 4, () => 500)).toBe(1750)
    expect(remainingMs(pts, 0, 16, () => 800)).toBe(2 * (3000 + 800) / 16)
  })
})
