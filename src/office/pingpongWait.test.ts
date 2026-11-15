// #416 ②: a ping-pong player without a game (the other one has not come yet, or the timelapse, which plays no sessions) used to
// swing the empty right hand like a stroke: the body's own ping-pong pose (rig.ts) was the stroke, and only the paddle grip of a
// running game covered it. Without a game the hand waits still at the table, empty, and holds no paddle.
// #490 B (play.md 9.2): the first one at the table waiting for its partner (partnerWait) holds the paddle face up and bounces the ball on it.
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
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

  it('#490 B waiting for the partner: the paddle face up in the hand, the ball bouncing on it, up to 25 cm above the face', async () => {
    const w = await world()
    const walk = new Walk(w)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    const goals = walk.director.goals.bind(walk.director)
    walk.director.goals = ((...a: Parameters<typeof goals>) => {
      const g = goals(...a)
      g.agent_0 = { spot: 'pingpong_a', pose: 'pingpong', partnerWait: true, label: '탁구 · 짝 기다리는 중' }
      return g
    }) as typeof goals
    const dt = 1 / 60
    const rig = w.rigs.agent_0
    for (let k = 0; k < 40 / dt && rig.arrived !== 'pingpong_a'; k++) walk.step(dt)
    expect(rig.arrived, 'reached the table').toBe('pingpong_a')
    for (let k = 0; k < 2 / dt; k++) walk.step(dt)
    const paddle = w.nodes.prop_paddle_a
    const ball = w.nodes.pp_ball
    let lo = Infinity
    let hi = -Infinity
    let faceUp = Infinity
    for (let k = 0; k < 1.8 / dt; k++) {
      walk.step(dt)
      // the face's normal (the paddle's z) points up
      faceUp = Math.min(faceUp, new Vector3(0, 0, 1).applyQuaternion(paddle.getWorldQuaternion(new Quaternion())).y)
      const blade = paddle.localToWorld(new Vector3(0, 0.175, 0))
      const h = ball.getWorldPosition(new Vector3()).y - blade.y
      expect(ball.visible).toBe(true)
      expect(Math.hypot(ball.position.x - blade.x, ball.position.z - blade.z), 'the ball over the blade').toBeLessThan(0.03)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
    }
    expect(faceUp, 'the face up').toBeGreaterThan(0.95)
    // the ball meets the face (ball radius + half the blade) and rises 25 cm above that
    expect(lo).toBeLessThan(0.03)
    expect(hi).toBeGreaterThan(0.22)
    expect(hi).toBeLessThan(0.3)
  }, 120_000)
})
