/// <reference types="node" />
// #257 (agents.md 2.5): walking hands are attached to their body-relative place and swing with the step, opposite phases; a stop sinks the swing in 0.5 s without
// overshoot; a hand that holds something does not swing; no swing under reduced motion.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'

// rig.update draws the face screen: a canvas whose 2D context accepts every call
const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60
const AMP = 0.07 // the cap of the swing (agents.md 2.5); the pendulum's rise (1.2 cm) and the inward step (1 cm) are inside the margin
const MARGIN = 0.02

const goal = (spot: string): Goal => ({ spot, pose: 'idle', label: '' }) as Goal

async function setup(from: string, to: string) {
  const { scene, nodes } = await loadOffice()
  const rig = new AgentRig('agent_0', 0, buildRig(scene, nodes, 0), '#ffffff')
  const rigs = { agent_0: rig }
  rig.setGoal(goal(from), GRAPH)
  for (let k = 0; k < 120; k++) rig.update(DT, k * DT, GRAPH, rigs, false)
  rig.setGoal(goal(to), GRAPH)
  return { rig, rigs, scene }
}
const priv = (r: AgentRig) => r as unknown as { speed: number; path: string[]; walkSt: { mode: string } }
/** a hand in the agent's frame */
const local = (rig: AgentRig, side: 'l' | 'r') => {
  rig.parts.root.updateMatrixWorld(true)
  return rig.parts.root.worldToLocal(rig.parts.hands[side].node.getWorldPosition(new Vector3()))
}
const offset = (rig: AgentRig, side: 'l' | 'r') => local(rig, side).sub(rig.parts.hands[side].restPos)

describe('walking hands (#257)', () => {
  it('walking: each hand stays within the swing amplitude (+ a small margin) of its body-relative place, straight and round corners, never trailing outside the body', async () => {
    const { rig, rigs } = await setup('door', 'work_3')
    let t = 120 * DT
    let worst = 0
    let walking = 0
    let turned = 0
    let lastHeading = rig.heading
    for (let k = 0; k < 60 * 40 && (priv(rig).path.length || k < 5); k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
      if (Math.abs(rig.heading - lastHeading) > 0.002) turned++
      lastHeading = rig.heading
      if (priv(rig).walkSt.mode !== 'walk' || priv(rig).speed < 0.3) continue
      walking++
      for (const side of ['l', 'r'] as const) worst = Math.max(worst, offset(rig, side).length())
    }
    expect(walking).toBeGreaterThan(120)
    expect(turned, 'the route has a corner').toBeGreaterThan(3)
    expect(worst).toBeLessThanOrEqual(AMP + MARGIN)
  })

  it('the two hands swing in opposite phase, about the cruise rate, forward and back by about the amplitude', async () => {
    const { rig, rigs } = await setup('door', 'hall_east')
    let t = 120 * DT
    const z = { l: [] as number[], r: [] as number[] }
    for (let k = 0; k < 60 * 12 && priv(rig).path.length; k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
      if (priv(rig).walkSt.mode === 'walk' && priv(rig).speed > 0.7) for (const side of ['l', 'r'] as const) z[side].push(offset(rig, side).z)
    }
    expect(z.l.length).toBeGreaterThan(90)
    // opposite: the sum is small next to each (the arc and the inward step only move y and x)
    let worstSum = 0
    for (let i = 0; i < z.l.length; i++) worstSum = Math.max(worstSum, Math.abs(z.l[i] + z.r[i]))
    expect(worstSum).toBeLessThan(0.004)
    const amp = Math.max(...z.l.map(Math.abs))
    expect(amp).toBeGreaterThan(0.04)
    expect(amp).toBeLessThanOrEqual(0.07 + 1e-3)
    // one cycle is 1 / 0.8 s at cruise: count the zero crossings of the left hand (2 per cycle)
    let cross = 0
    for (let i = 1; i < z.l.length; i++) if (Math.sign(z.l[i]) !== Math.sign(z.l[i - 1])) cross++
    const hz = cross / 2 / (z.l.length * DT)
    expect(hz).toBeGreaterThan(0.7)
    expect(hz).toBeLessThan(1.05)
  })

  it('a stop sinks the swing to nothing in 0.5 s, never overshooting, then the standing bob blends in over 0.3 s', async () => {
    const { rig, rigs } = await setup('door', 'hall_east')
    let t = 120 * DT
    for (let k = 0; k < 60 * 4; k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
    }
    expect(priv(rig).walkSt.mode).toBe('walk')
    // stop on a frame where the left hand is well off its place
    let guard = 0
    while (Math.abs(offset(rig, 'l').z) < 0.03 && guard++ < 200) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
    }
    const off0 = offset(rig, 'l')
    expect(Math.abs(off0.z)).toBeGreaterThan(0.03)
    priv(rig).path = []
    const dist: number[] = []
    const along: number[] = []
    for (let k = 0; k < 40; k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
      const o = offset(rig, 'l')
      dist.push(o.length())
      along.push(o.dot(off0) / off0.lengthSq())
    }
    const at = (s: number) => Math.round(s / DT) - 1
    // no overshoot: it falls monotonically and never passes the rest place (the component along the first offset stays >= 0; the 1 cm bob may remain)
    for (let i = 1; i <= at(0.5); i++) expect(dist[i], 'frame ' + i).toBeLessThanOrEqual(dist[i - 1] + 1e-4)
    expect(Math.min(...along.slice(0, at(0.5) + 1))).toBeGreaterThanOrEqual(-0.02)
    expect(dist[at(0.5)], 'at 0.5 s').toBeLessThan(0.002)
    expect(priv(rig).walkSt.mode).toBe('settle')
    // then the bob blends in and it ends in the plain standing mode
    for (let k = 0; k < 60; k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
    }
    expect(priv(rig).walkSt.mode).toBe('none')
  })

  it('a hand that holds something does not swing and the free hand beside it swings at 60 %', async () => {
    const run = async (held: 'l' | null) => {
      const { rig, rigs } = await setup('door', 'hall_east')
      let t = 120 * DT
      const amp = { l: 0, r: 0 }
      for (let k = 0; k < 60 * 8 && priv(rig).path.length; k++) {
        t += DT
        // the grip owns the hand: the object is attached to it (the stage sets this every frame)
        ;(rig as unknown as { want: unknown }).want = held ? { kind: 'book', side: held, attached: true } : null
        rig.update(DT, t, GRAPH, rigs, false)
        if (priv(rig).walkSt.mode === 'walk' && priv(rig).speed > 0.7 && t > 6) for (const side of ['l', 'r'] as const) amp[side] = Math.max(amp[side], Math.abs(offset(rig, side).z))
      }
      return amp
    }
    const free = await run(null)
    const left = await run('l')
    expect(free.l).toBeGreaterThan(0.04)
    expect(left.l, 'the carrying hand').toBeLessThan(0.002)
    expect(left.r / free.r, 'the free hand beside it').toBeGreaterThan(0.5)
    expect(left.r / free.r).toBeLessThan(0.7)
  })

  it('reduced motion: no swing at all, the hands stay on their body-relative place', async () => {
    const { rig, rigs } = await setup('door', 'hall_east')
    let t = 120 * DT
    let worst = 0
    let walking = 0
    for (let k = 0; k < 60 * 8 && priv(rig).path.length; k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, true)
      if (priv(rig).walkSt.mode !== 'walk' || priv(rig).speed < 0.5 || t < 3) continue
      walking++
      for (const side of ['l', 'r'] as const) worst = Math.max(worst, offset(rig, side).length())
    }
    expect(walking).toBeGreaterThan(60)
    expect(worst).toBeLessThan(0.003)
  })
})
