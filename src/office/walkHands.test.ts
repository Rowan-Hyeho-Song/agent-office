/// <reference types="node" />
// #257 (agents.md 2.5): walking hands are attached to their body-relative place and swing with the step, opposite phases; a stop sinks the swing in 0.5 s without
// overshoot; a hand that holds something does not swing; no swing under reduced motion.
import { Matrix4, Vector3 } from 'three'
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
    /** the cruising frames come in runs (a corner slows it): the crossings are counted inside each run only */
    const runs: number[][] = []
    let run: number[] | null = null
    for (let k = 0; k < 60 * 12 && priv(rig).path.length; k++) {
      t += DT
      rig.update(DT, t, GRAPH, rigs, false)
      if (priv(rig).walkSt.mode === 'walk' && priv(rig).speed > 0.7) {
        for (const side of ['l', 'r'] as const) z[side].push(offset(rig, side).z)
        ;(run ??= runs[runs.push([]) - 1]).push(offset(rig, 'l').z)
      } else run = null
    }
    expect(z.l.length).toBeGreaterThan(90)
    // opposite: the sum is small next to each (the arc and the inward step only move y and x)
    let worstSum = 0
    for (let i = 0; i < z.l.length; i++) worstSum = Math.max(worstSum, Math.abs(z.l[i] + z.r[i]))
    expect(worstSum).toBeLessThan(0.004)
    const amp = Math.max(...z.l.map(Math.abs))
    expect(amp).toBeGreaterThan(0.04)
    expect(amp).toBeLessThanOrEqual(0.07 + 1e-3)
    // at cruise the swing runs 0.8 x sqrt(cruise / 0.75) Hz, clamped to 0.5 .. 1.0 (#329: 1.0 m/s -> 0.92 Hz): count the zero
    // crossings of the left hand (2 per cycle) inside each cruising run
    let cross = 0
    let frames = 0
    for (const r of runs) {
      frames += r.length
      for (let i = 1; i < r.length; i++) if (Math.sign(r[i]) !== Math.sign(r[i - 1])) cross++
    }
    const hz = cross / 2 / (frames * DT)
    expect(hz).toBeGreaterThan(0.8)
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

  it('a hand that holds something bobs +-0.6 cm up and down at twice the step rate (the watering can +-1 cm), no fore / aft swing, none with reduced motion', async () => {
    const run = async (kind: string, reduced: boolean) => {
      const { rig, rigs } = await setup('door', 'hall_east')
      let t = 120 * DT
      const ys: number[] = []
      let zs = 0
      const hold = new Vector3(-0.2, 1.0, -0.3)
      for (let k = 0; k < 60 * 8 && priv(rig).path.length; k++) {
        t += DT
        ;(rig as unknown as { want: unknown }).want = { kind, side: 'l', attached: true }
        rig.update(DT, t, GRAPH, rigs, reduced)
        // the stage: the hand goes to a body-relative carry place with full weight
        ;(rig as unknown as { want: unknown }).want = { kind, side: 'l', attached: true }
        rig.parts.root.updateMatrixWorld(true)
        rig.drive.l = { target: new Matrix4().setPosition(rig.parts.root.localToWorld(hold.clone())), w: 1, curl: null, wc: 0, spread: null }
        rig.applyDrive('l', t, reduced)
        if (priv(rig).walkSt.mode === 'walk' && priv(rig).speed > 0.7 && t > 6) {
          const o = local(rig, 'l').sub(hold)
          ys.push(o.y)
          zs = Math.max(zs, Math.abs(o.z))
        }
      }
      return { ys, zs }
    }
    const book = await run('book', false)
    const can = await run('watering_can', false)
    const red = await run('book', true)
    expect(book.ys.length).toBeGreaterThan(60)
    expect(Math.max(...book.ys)).toBeGreaterThan(0.0055)
    expect(Math.max(...book.ys)).toBeLessThanOrEqual(0.006 + 1e-4)
    expect(Math.min(...book.ys)).toBeGreaterThanOrEqual(-0.006 - 1e-4)
    expect(Math.max(...can.ys)).toBeGreaterThan(0.0095)
    expect(Math.max(...can.ys)).toBeLessThanOrEqual(0.01 + 1e-4)
    expect(book.zs, 'no fore / aft swing').toBeLessThan(0.0005)
    expect(Math.max(...red.ys.map(Math.abs)), 'reduced motion').toBeLessThan(1e-4)
    // twice the step rate: crossings of the bob per second are about twice the swing's (2 x 0.8 Hz x 2 = 3.2 / s)
    let cross = 0
    for (let i = 1; i < book.ys.length; i++) if (Math.sign(book.ys[i]) !== Math.sign(book.ys[i - 1])) cross++
    const hz = cross / 2 / (book.ys.length * DT)
    expect(hz).toBeGreaterThan(1.4)
    expect(hz).toBeLessThan(2.5)
  })

  for (const [from, pose, label] of [['work_0', 'type', 'standing up from the desk (the hands were typing)'], ['sofa_0', 'sofa', 'getting up from the sofa']] as const) {
    it(label + ': from the first walking frame each hand is within amplitude + 2 cm of its place, the blend from a far pose only gets nearer, the ramp starts at 0', async () => {
      const { scene, nodes } = await loadOffice()
      const rig = new AgentRig('agent_0', 0, buildRig(scene, nodes, 0), '#ffffff')
      const rigs = { agent_0: rig }
      rig.setGoal({ spot: from, pose, label: '' } as Goal, GRAPH)
      let t = 0
      for (let k = 0; k < 60 * 4; k++) rig.update(DT, (t += DT), GRAPH, rigs, false)
      const far = ['l', 'r'].map((s) => offset(rig, s as 'l' | 'r').length())
      expect(Math.max(...far), 'the hands start away from the walking place').toBeGreaterThan(0.1)
      rig.setGoal(goal('hall_east'), GRAPH)
      const P = rig as unknown as { attachT: Record<string, number>; walkSt: { mode: string; ramp: number; off: Record<string, { dx: number; dy: number; dz: number }> } }
      let first = true
      const last = { l: Infinity, r: Infinity }
      const lastPlace = { l: new Vector3(), r: new Vector3() }
      const lastHand = { l: new Vector3(), r: new Vector3() }
      let maxStep = 0
      let blended = 0
      let maxNear = 0
      for (let k = 0; k < 60 * 6; k++) {
        rig.update(DT, (t += DT), GRAPH, rigs, false)
        if (P.walkSt.mode !== 'walk') continue
        if (first) {
          first = false
          expect(P.walkSt.ramp, 'the amplitude ramp starts at 0').toBeLessThanOrEqual(DT / 0.4 + 1e-9)
        }
        for (const side of ['l', 'r'] as const) {
          const rest = rig.parts.hands[side].restPos
          const o = P.walkSt.off[side]
          const place = new Vector3(rest.x + o.dx, rest.y + o.dy, rest.z + o.dz)
          const d = local(rig, side).distanceTo(place)
          const hand = local(rig, side)
          if (P.attachT[side] < 1) {
            blended++
            // the place itself moves with the swing (up to ~4 mm a frame): the distance may grow by at most that
            expect(d, side + ' during the blend').toBeLessThanOrEqual(last[side] + place.distanceTo(lastPlace[side]) + 1e-4)
            if (blended > 2) maxStep = Math.max(maxStep, hand.distanceTo(lastHand[side]))
          } else maxNear = Math.max(maxNear, offset(rig, side).length())
          last[side] = d
          lastPlace[side].copy(place)
          lastHand[side].copy(hand)
        }
      }
      expect(blended).toBeGreaterThan(5)
      expect(maxNear).toBeLessThanOrEqual(AMP + 0.02)
      expect(maxStep, 'no jump during the blend (a smoothstep over 0.25 s moves a 0.4 m offset by at most 4 cm a frame)').toBeLessThan(0.06)
    })
  }

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
