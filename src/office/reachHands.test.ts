/// <reference types="node" />
// #255 (grips.md 1.1) on the rig and the stage: a reaching hand's fingers follow the reach direction (shoulder -> the hand's place), within 30 degrees when it is above
// the shoulder, and the wrist stays inside its limits; while a grip holds the object, the grip's own pose wins.
import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { standSlot, type Goal } from './director'
import type { GripDemo } from './debugPlay'
import { loadOffice, stubCanvas } from './glbLoad'
import { SPOTS } from './navSpots.fixture'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import { SHOULDER, WRIST_LIMITS } from './reach'

// rig.update draws the face screen: a canvas whose 2D context accepts every call
const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const DEG = Math.PI / 180

/** the angle (degrees) between a hand's fingers and the reach direction shoulder -> hand, in the agent's frame, and whether the hand is above the shoulder */
function reachOf(rig: AgentRig, side: 'l' | 'r') {
  const root = rig.parts.root
  root.updateMatrixWorld(true)
  const hand = rig.parts.hands[side].node
  const pos = root.worldToLocal(hand.getWorldPosition(new Vector3()))
  const shoulder = new Vector3((side === 'l' ? -1 : 1) * SHOULDER.x, SHOULDER.y + seatOf(rig), SHOULDER.z)
  const a = pos.clone().sub(shoulder).normalize()
  const fingers = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion())).applyQuaternion(root.getWorldQuaternion(new Quaternion()).invert()).normalize()
  return { angle: Math.acos(Math.max(-1, Math.min(1, fingers.dot(a)))) / DEG, above: pos.y > shoulder.y + 0.02, pos }
}
const seatOf = (rig: AgentRig) => (rig as unknown as { seat: number }).seat

describe('reaching hands (#255)', () => {
  it('the paper plane catch: the catching hand is above the shoulder, its fingers within 30 degrees of the reach direction, the wrist inside its limits', async () => {
    const { scene, nodes } = await loadOffice()
    let checked = 0
    let worst = 0
    for (const seat of [0, 1, 2, 3]) {
      const rig = new AgentRig(IDS[seat], seat, buildRig(scene, nodes, seat), '#ffffff')
      const rigs = { [IDS[seat]]: rig }
      const sp = SPOTS.find((s) => s.id === 'work_' + seat)!
      const goal = { spot: sp.id, pose: 'idle', label: '' } as Goal
      const graph = (await import('./navSpots.fixture')).GRAPH
      rig.setGoal(goal, graph)
      let t = 0
      for (let k = 0; k < 60; k++) rig.update(1 / 60, (t += 1 / 60), graph, rigs, false)
      // a plane coming from the front left and above
      const at = new Vector3(rig.x - 0.5, 1.6, rig.z - 0.9)
      rig.startGesture('catch', t, at, { flyFor: 1.2 })
      for (let k = 0; k < 150; k++) {
        rig.update(1 / 60, (t += 1 / 60), graph, rigs, false)
        // the catching (right) hand once the arm has risen (the spring has converged): the hold phase
        const r = reachOf(rig, 'r')
        if (rig.gesture && t > rig.gesture.t0! + 0.9 && r.above && !rig.gesture.caught) {
          worst = Math.max(worst, r.angle)
          expect(r.angle, `agent_${seat} t=${t.toFixed(2)}`).toBeLessThanOrEqual(30 + 3)
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(20)
    expect(WRIST_LIMITS.extension).toBeGreaterThan(worst)
  })

  for (const [prop, kind, obj, side, spot] of [['book', 'book', 'prop_book', 'l', 'shelf'], ['marker', 'marker', 'prop_marker_0', 'r', 'whiteboard'], ['paddle', 'paddle', 'prop_paddle_a', 'r', 'pingpong_a']] as const) {
    it(`${prop}: on the way to the grip the fingers follow the reach (within 30 degrees), at the grip the grip's own pose wins`, async () => {
      const { scene, nodes } = await loadOffice()
      const props = new PropBank(scene, nodes)
      const rigs = Object.fromEntries(IDS.map((id, i) => [id, new AgentRig(id, i, buildRig(scene, nodes, i), '#ffffff')]))
      const stage = new PlayStage(scene, nodes, props)
      const rig = rigs.agent_0
      let sp: { x: number; z: number; ry: number } = SPOTS.find((s) => s.id === spot)!
      let extra: Partial<Goal> = {}
      if (prop === 'book') {
        // the high shelf (#199): where the grip demo stands (debugPlay.ts BOOK)
        const BOOK = { stand: { x: 0.07, z: 2.0 }, face: { x: 0.065, z: 2.66 } }
        extra = { face: BOOK.face, ...standSlot(BOOK) }
        sp = { x: BOOK.stand.x, z: BOOK.stand.z, ry: Math.atan2(-(BOOK.face.x - BOOK.stand.x), -(BOOK.face.z - BOOK.stand.z)) }
      }
      rig.at = spot
      rig.x = sp.x
      rig.z = sp.z
      rig.heading = sp.ry
      rig.parts.root.position.set(sp.x, 0, sp.z)
      rig.parts.root.rotation.set(0, sp.ry, 0)
      rig.parts.root.updateMatrixWorld(true)
      const demo: GripDemo = { agent: 'agent_0', kind, obj, side, goal: { spot, ...extra } }
      const goals = Object.fromEntries(IDS.map((id) => [id, id === 'agent_0' ? { spot, pose: 'idle', label: '', ...extra } : { spot: 'work_1', pose: 'idle', label: '' }])) as Record<string, Goal>
      const approach: { angle: number; above: boolean }[] = []
      let held = 0
      for (let k = 0; k < 400; k++) {
        stage.update({ now: 0, t: k * 0.02, dt: 0.02, reduced: false, replaying: false, rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, gripDemo: demo })
        props.hold(new Map(Object.values(rigs).map((r) => [r, r.want])))
        props.update(0.02)
        const d = rig.drive[side]
        if (!d?.target) continue
        if (d.w >= 0.5 && d.w <= 0.6) {
          const r = reachOf(rig, side)
          approach.push({ angle: r.angle, above: r.above })
        }
        if (d.w >= 1) {
          // the grip's own pose: the hand sits exactly on the drive's target orientation
          const q = rig.parts.hands[side].node.quaternion
          const want = new Quaternion().setFromRotationMatrix(d.target)
          expect(Math.abs(q.dot(want)), 'the grip pose wins at w = 1').toBeGreaterThan(0.9999)
          held++
        }
      }
      expect(approach.length, prop + ' approach frames').toBeGreaterThan(2)
      expect(held).toBeGreaterThan(20)
      for (const a of approach) expect(a.angle, prop + (a.above ? ' above the shoulder' : '')).toBeLessThanOrEqual(30 + 1e-3)
    })
  }
})
