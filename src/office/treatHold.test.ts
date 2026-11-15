/// <reference types="node" />
// #455 (office-ui.md 12.2): a visitor's treat taken in a free hand by a robot resting or playing: held before the chest for 8 s (a coffee sipped once),
// then faded and put away. Two levels: the times (treatHold.ts), and the baked model: the treat in the hand's grip while held, out of sight after.
import { describe, expect, it } from 'vitest'
import { Box3, Vector3, type Mesh } from 'three'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, Walk, world } from './errandWorld.fixture'
import { SIP_TOP_S, TREAT_HOLD, TREAT_LOOK, TREAT_PROP, takeSounds, treatPhase } from './treatHold'

stubCanvas()

describe('the hold (treatHold.ts)', () => {
  it('up into the hand, 8 s held, faded; a coffee sipped once, nothing else is', () => {
    expect(treatPhase('cookie', -0.1, false)).toBeNull()
    expect(treatPhase('cookie', 0, false)).toMatchObject({ w: 0, opacity: 1, sip: 0 })
    expect(treatPhase('cookie', TREAT_HOLD.reachS, false)!.w).toBeCloseTo(1, 6)
    expect(treatPhase('cookie', TREAT_HOLD.holdS - 0.01, false)).toMatchObject({ w: 1, opacity: 1 })
    expect(treatPhase('cookie', TREAT_HOLD.holdS + TREAT_HOLD.fadeS, false)).toBeNull()
    expect(treatPhase('cookie', TREAT_HOLD.holdS + 0.2, false)!.opacity).toBeLessThan(1)
    expect(treatPhase('coffee', SIP_TOP_S, false)!.sip).toBeCloseTo(1, 6)
    expect(treatPhase('apple', SIP_TOP_S, false)!.sip).toBe(0)
    // reduced motion: in the hand at once, no sip, gone at once
    expect(treatPhase('coffee', 0, true)).toMatchObject({ w: 1, sip: 0 })
    expect(treatPhase('coffee', SIP_TOP_S, true)!.sip).toBe(0)
    expect(takeSounds()).toBe(true)
  })
})

describe('a treat in the hand on the baked model', () => {
  it('a resting robot: in the right hand (free) at its grip while held, then out of sight (the hand chosen as paper-pass.md 3: paperRun.ts handsOf)', async () => {
    const w = await world()
    const guard = new Guard(w)
    const walk = new Walk(w)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    const dt = 0.03
    for (let k = 0; k < 20; k++) walk.step(dt, guard)
    walk.status.agent_2 = { state: 'idle', since: 0 }
    for (let k = 0; k < 60; k++) walk.step(dt, guard)
    const node = w.scene.getObjectByName(TREAT_PROP.cookie)!
    const t0 = walk.t0 + walk.t * 1000
    walk.treats.agent_2 = { kind: 'cookie', at: t0 }
    let worst = 0
    let shown = 0
    let side: string | null = null
    for (let k = 0; k < (TREAT_HOLD.holdS + 1) / dt; k++) {
      walk.step(dt, guard)
      const u = walk.t0 + walk.t * 1000 - t0
      side ??= w.stage.treatSide('agent_2')
      if (u > 600 && u < (TREAT_HOLD.holdS - 0.2) * 1000) {
        // the treat on the hand: its grip point within reach of the hand's grip
        const hand = w.rigs.agent_2.parts.hands.r
        const hg = hand.grip!.getWorldPosition(new Vector3())
        const tp = node.getWorldPosition(new Vector3())
        worst = Math.max(worst, hg.distanceTo(tp))
        if (node.visible) shown++
      }
    }
    expect(side).toBe('r')
    expect(shown).toBeGreaterThan(100)
    expect(worst, 'the cookie stays at the hand').toBeLessThan(0.12)
    delete walk.treats.agent_2
    for (let k = 0; k < 20; k++) walk.step(dt, guard)
    expect(node.visible, 'put away after').toBe(false)
    expect(w.stage.treatSide('agent_2')).toBeNull()
  }, 120_000)

  it("the coffee (designer): drawn 1.35 times its size, held by its lower half: the cup's top 4 cm or more over the hand", async () => {
    const w = await world()
    const guard = new Guard(w)
    const walk = new Walk(w)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    const dt = 0.03
    for (let k = 0; k < 20; k++) walk.step(dt, guard)
    walk.status.agent_2 = { state: 'idle', since: 0 }
    for (let k = 0; k < 60; k++) walk.step(dt, guard)
    const node = w.scene.getObjectByName(TREAT_PROP.coffee)!
    const t0 = walk.t0 + walk.t * 1000
    walk.treats.agent_2 = { kind: 'coffee', at: t0 }
    let over = Infinity
    for (let k = 0; k < 2 / dt; k++) {
      walk.step(dt, guard)
      if (walk.t0 + walk.t * 1000 - t0 < 700) continue
      w.scene.updateMatrixWorld(true)
      const cup = new Box3().setFromObject(node)
      let hand = -Infinity
      w.rigs.agent_2.parts.hands[w.stage.treatSide('agent_2') ?? 'r'].node.traverseVisible((m) => {
        const g = (m as Mesh).geometry?.getAttribute('position')
        if (!(m as Mesh).isMesh || !g) return
        for (let i = 0; i < g.count; i++) hand = Math.max(hand, new Vector3().fromBufferAttribute(g, i).applyMatrix4(m.matrixWorld).y)
      })
      over = Math.min(over, cup.max.y - hand)
    }
    expect(node.scale.x).toBeCloseTo(TREAT_LOOK.coffee.scale, 6)
    expect(over, "the lid and the sleeve band over the fingers").toBeGreaterThanOrEqual(0.04)
  }, 120_000)
})
