// #481 (docs/design/wrapup.md 9.5): the card and the pen on the writing desk, on the baked model. While writing, the pen's tip is on the card's top
// (a line, a strike: within 1 mm; lifted at most the beat's own lift), inside the card; the other hand rests its palm on the desk beside it (#505); the
// pen is at 45°. (The two hands 1 cm apart: writePress.test.ts, per desk.)
import { Vector3, type Mesh, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { WRITE_CARD, writeCard, writePlace } from './wrapPose'
import { WriteDesk, deskTop } from './writeDesk'

const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60

async function writer(seat: number) {
  const { scene, nodes } = await loadOffice()
  const id = `agent_${seat}`
  const rig = new AgentRig(id, seat, buildRig(scene, nodes, seat), '#ffffff')
  const rigs = { [id]: rig }
  const spot = GRAPH.spots[`work_${seat}`]
  rig.x = spot.x
  rig.z = spot.z
  rig.heading = spot.ry
  const desk = new WriteDesk(scene)
  let t = 0
  const inp = (reduced: boolean) => ({ t, dt: DT, reduced, colors: { [id]: '#7aa2ff' } })
  const step = (goal: Goal, reduced = false) => {
    rig.setGoal(goal, GRAPH)
    rig.update(DT, (t += DT), GRAPH, rigs, reduced)
    rig.drive = { l: null, r: null }
    desk.drive(rig, goal, inp(reduced))
    rig.applyDrive('l', t, reduced)
    rig.applyDrive('r', t, reduced)
    desk.draw(rig, goal, inp(reduced))
  }
  const idle = { spot: spot.id, pose: 'idle', label: '' } as Goal
  for (let k = 0; k < 120; k++) step(idle)
  return { rig, desk, spot, step, scene }
}

const write = (spot: string, kind: string, u: number, v = 0) => ({ spot, pose: 'write', label: '', beat: { kind, u, k: 0, v } }) as unknown as Goal

describe('the card and the pen while writing (#481)', () => {
  for (const seat of [0, 2, 4]) {
    it(`desk ${seat}: the tip on the card (a line, a strike: within 1 mm), inside it; the pen at 45°; the other hand rests its palm on the desk beside it`, async () => {
      const w = await writer(seat)
      const place = writePlace(GRAPH.spots, `work_${seat}`)
      // settle into the pose (the body turns toward the card, #461; the hand takes the pen)
      for (let k = 0; k < 60; k++) w.step(write(w.spot.id, 'line', 0))
      // reading the card held up last: the resting hand lifts it then, and comes back down after (wrapup.md 9.4, the card follows it in the second step)
      const lifts: Record<string, number> = { line: 0.001, strike: 0.001, newline: 0.0105, tapPen: 0.0165, readUp: 0.001 }
      const restSide = place && place.side < 0 ? 'r' : 'l'
      for (const kind of Object.keys(lifts))
        for (let i = 0; i <= 30; i++) {
          w.step(write(w.spot.id, kind, i / 30, 2))
          const s = w.desk.state(w.rig.id)!
          expect(s.card, 'the card on the desk').not.toBeNull()
          expect(s.tip, 'the pen in the hand').not.toBeNull()
          const above = s.tip!.y - s.top!
          expect(above, `${kind} tip above the card`).toBeLessThanOrEqual(lifts[kind])
          expect(above, `${kind} tip not through the card`).toBeGreaterThanOrEqual(-0.0005)
          // inside the card: the tip in the card's own frame
          const c = writeCard(place)
          const at = w.rig.seatToWorld(c.x, 0, c.z)
          const local = s.tip!.clone().sub(at).applyQuaternion(w.rig.seatQuat().invert())
          expect(Math.abs(local.x), `${kind} across`).toBeLessThan(WRITE_CARD.w / 2)
          expect(Math.abs(local.z), `${kind} along`).toBeLessThan(WRITE_CARD.d / 2)
          // the pen at 45° to the desk
          const axis = s.grip!.clone().sub(s.tip!).normalize()
          expect(Math.asin(axis.y) * (180 / Math.PI)).toBeCloseTo(45, 0)
          // #505: the other hand's palm rests on the desk beside the card: its underside 0-2 mm above the desk, never through it (the place: writePress.test.ts)
          if (kind !== 'readUp') {
            const hand = w.rig.parts.hands[restSide].node
            const top = deskTop(w.scene, seat, hand.getWorldPosition(new Vector3()))!
            const low = Math.min(...points(hand).map((p) => p.y)) - top
            expect(low, `${kind} resting hand through the desk`).toBeGreaterThanOrEqual(-0.0005)
            expect(low, `${kind} resting hand on the desk`).toBeLessThanOrEqual(0.003)
          }
        }
    })
  }
})

/** every vertex of a hand's visible meshes, in world */
function points(o: Object3D): Vector3[] {
  const out: Vector3[] = []
  o.updateMatrixWorld(true)
  o.traverseVisible((m) => {
    const g = (m as Mesh).geometry?.getAttribute('position')
    if (!(m as Mesh).isMesh || !g) return
    for (let i = 0; i < g.count; i++) out.push(new Vector3().fromBufferAttribute(g, i).applyMatrix4(m.matrixWorld))
  })
  return out
}
