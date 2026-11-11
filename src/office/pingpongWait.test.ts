// #416 ②: a ping-pong player without a game (the other one has not come yet, or the timelapse, which plays no sessions) used to
// swing the empty right hand like a stroke: the body's own ping-pong pose (rig.ts) was the stroke, and only the paddle grip of a
// running game covered it. Without a game the hand waits still at the table, empty, and holds no paddle.
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { IDS, Walk, world } from './errandWorld.fixture'

stubCanvas()

describe('a ping-pong player alone at the table (#416)', () => {
  it('waits with the right hand still and empty: no stroke without a paddle', async () => {
    const w = await world()
    const walk = new Walk(w)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    // agent_0 is sent to the table to play; its partner stays at work, so there is no game
    const goals = walk.director.goals.bind(walk.director)
    walk.director.goals = ((...a: Parameters<typeof goals>) => {
      const g = goals(...a)
      g.agent_0 = { spot: 'pingpong_a', pose: 'pingpong', label: '탁구' }
      return g
    }) as typeof goals
    const dt = 0.03
    const rig = w.rigs.agent_0
    for (let k = 0; k < 40 / dt && rig.arrived !== 'pingpong_a'; k++) walk.step(dt)
    expect(rig.arrived, 'reached the table').toBe('pingpong_a')
    // settle, then watch 3 s
    for (let k = 0; k < 1.5 / dt; k++) walk.step(dt)
    const ps: Vector3[] = []
    let held = false
    for (let k = 0; k < 3 / dt; k++) {
      walk.step(dt)
      ps.push(rig.parts.hands.r.node.getWorldPosition(new Vector3()))
      if (rig.want?.kind === 'paddle') held = true
    }
    const spread = Math.max(...ps.map((p) => p.distanceTo(ps[0])))
    expect(held, 'no paddle without a game').toBe(false)
    // the old pose swung the fist ±12 cm sideways and ±10 cm forward at 0.9 Hz
    expect(spread, 'the right hand stays put (no empty stroke)').toBeLessThan(0.02)
  }, 120_000)
})
