import { describe, expect, it } from 'vitest'
import { FRIDGE, sweptDistance, syncFridgeHold } from './lounge'
import { office } from './errandWorld.fixture'
import { TRAFFIC } from './traffic'

// The fridge door's swing is held for the one at the fridge (traffic.ts reserve, lounge.ts syncFridgeHold): nobody else's centre comes within a body radius of the area it sweeps.
// agent_3 holds it here; it need not be near it for the others to be kept out (it is sent, and the hold begins).
const INSIDE = { x: 3.9, z: -0.62 } // a floor point inside the swing: the door's length is 0.48 m from the hinge (4.335, -0.492)

describe('an area reserved in the planner (the fridge door, #280)', () => {
  /** agent_0 is sent into the swung area from the east hall; returns the closest it came to the area and where it ended */
  function visit(hold: boolean) {
    const p = office()
    p.place('agent_0', { spot: 'hall_east', pace: 1 }, 0, 0)
    p.place('agent_3', { spot: 'work_3', pace: 1 }, 0, 3)
    p.request('agent_0', { spot: 'hall_ne', slot: { x: INSIDE.x, z: INSIDE.z, ry: -1.57 }, pace: 1 }, 0, 0)
    if (hold) syncFridgeHold(p, { user: null, from: 0 }, 'agent_3', 0)
    p.update(0)
    let min = Infinity
    for (let t = 0; t < 40; t += 0.05) {
      const s = p.sample('agent_0', t)
      min = Math.min(min, sweptDistance(s.x, s.z))
    }
    return { min, end: p.sample('agent_0', 40), p }
  }

  it('without the hold the walker goes into the swept area; with it, it keeps a body radius off', () => {
    expect(sweptDistance(INSIDE.x, INSIDE.z)).toBe(0)
    const free = visit(false)
    expect(free.min, "the walk goes into the door's swing when nothing holds it (else this checks nothing)").toBeLessThan(0.1)
    const held = visit(true)
    // the smoothed path moves a few cm from the cells it was searched on
    expect(held.min).toBeGreaterThanOrEqual(TRAFFIC.bodyR - 0.06)
    // and it is not lost: it waits beside the area, near what it asked for
    expect(Math.hypot(held.end.x - INSIDE.x, held.end.z - INSIDE.z)).toBeLessThan(1.5)
  })

  it('the owner of the hold is not kept out: it walks to its stand 0.5 m off the swing', () => {
    const p = office()
    p.place('agent_3', { spot: 'work_3', pace: 1 }, 0, 3)
    p.request('agent_3', { spot: 'hall_ne', slot: { x: FRIDGE.stand.x, z: FRIDGE.stand.z, ry: -1.2 }, pace: 1 }, 0, 3)
    syncFridgeHold(p, { user: null, from: 0 }, 'agent_3', 0)
    p.update(0)
    const s = p.sample('agent_3', 60)
    expect(Math.hypot(s.x - FRIDGE.stand.x, s.z - FRIDGE.stand.z)).toBeLessThan(0.05)
    expect(sweptDistance(s.x, s.z)).toBeGreaterThanOrEqual(FRIDGE.offM)
  })

  it('letting go of the hold opens the area again', () => {
    const p = office()
    const st = { user: null as string | null, from: 0 }
    p.place('agent_0', { spot: 'hall_east', pace: 1 }, 0, 0)
    syncFridgeHold(p, st, 'agent_3', 1)
    expect(st.user).toBe('agent_3')
    syncFridgeHold(p, st, null, 5)
    expect(st.user).toBeNull()
    p.request('agent_0', { spot: 'hall_ne', slot: { x: INSIDE.x, z: INSIDE.z, ry: -1.57 }, pace: 1 }, 6, 0)
    p.update(6)
    let min = Infinity
    for (let t = 6; t < 46; t += 0.05) {
      const s = p.sample('agent_0', t)
      min = Math.min(min, sweptDistance(s.x, s.z))
    }
    expect(min).toBeLessThan(0.1)
  })
})
