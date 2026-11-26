/// <reference types="node" />
// #718 ②-b (play.md 9.7 ①, #732, 3D #735): the tidy-up on the stage. One left at the ping-pong table's west end takes its own paddle like a tray, picks the
// ball up and lays it on the blade, takes the partner's paddle at the east end and lays both by the net (pp_tidy_paddle_a / _b), the ball staying on its
// own. The ball never trails the blade it rides; afterwards the paddles and the ball lie there.
import { Vector3, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { IDS, Walk, world } from './errandWorld.fixture'

const DT = 0.03

describe('the tidy-up on the stage (#718)', () => {
  it('the stages in order; both paddles end by the net, the ball on its own paddle; the ball rides the blade', async () => {
    const w = await world()
    const walk = new Walk(w)
    const me = 'agent_3'
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    for (let k = 0; k < 10; k++) walk.step(DT)
    walk.status[me] = { state: 'idle', since: 0 }
    // to the west end of the table first (as the game it played there)
    const goals = walk.director.goals.bind(walk.director)
    let atEnd = true
    walk.director.goals = ((...a: Parameters<typeof goals>) => {
      const g = goals(...a)
      return atEnd ? { ...g, [me]: { spot: 'pingpong_a', pose: 'idle', label: '' } } : g
    }) as typeof walk.director.goals
    for (let k = 0; k < 30 / DT && w.rigs[me].arrived !== 'pingpong_a'; k++) walk.step(DT)
    expect(w.rigs[me].arrived).toBe('pingpong_a')
    atEnd = false
    walk.director.forceAlone(me, walk.t0 + walk.t * 1000)
    const pos = (n: string) => (w.nodes as Record<string, Object3D>)[n].getWorldPosition(new Vector3())
    // the ball on the blade it rides, every frame from the lay to the put
    let off = 0
    const stages: string[] = []
    let ended = false
    for (let k = 0; k < 60 / DT; k++) {
      walk.step(DT)
      const st = walk.goals[me].tidy?.stage
      if (st === 'toPartner' || st === 'grip' || st === 'toSide') off = Math.max(off, pos('pp_ball').distanceTo(pos('prop_paddle_a_ball')))
      if (st && stages[stages.length - 1] !== st) stages.push(st)
      if (!st && stages.length) {
        ended = true
        break
      }
    }
    // the hands let go and settle
    for (let k = 0; k < 2 / DT; k++) walk.step(DT)
    expect(stages).toEqual(['take', 'toBall', 'pick', 'lay', 'toPartner', 'grip', 'toSide', 'put'])
    expect(ended).toBe(true)
    expect(walk.director.tableTidied()).toBe('a')
    expect(off, 'the ball stays on the blade').toBeLessThan(0.01)
    expect(pos('prop_paddle_a').distanceTo(pos('pp_tidy_paddle_a')), 'paddle a by the net').toBeLessThan(0.02)
    expect(pos('prop_paddle_b').distanceTo(pos('pp_tidy_paddle_b')), 'paddle b by the net').toBeLessThan(0.02)
    expect(pos('pp_ball').distanceTo(pos('prop_paddle_a_ball')), 'the ball on its own paddle').toBeLessThan(0.02)
  }, 180_000)
})
