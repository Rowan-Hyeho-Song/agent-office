// #481 (docs/design/wrapup.md 9.5): the card and the pen on the writing desk, on the baked model. While writing, the pen's tip is on the card's top
// (a line, a strike: within 1 mm; lifted at most the beat's own lift), inside the card; the pressing palm stays above the card; the pen is at 45°.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { WRITE_CARD, writeCard, writePlace } from './wrapPose'
import { WriteDesk } from './writeDesk'

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
  return { rig, desk, spot, step }
}

const write = (spot: string, kind: string, u: number, v = 0) => ({ spot, pose: 'write', label: '', beat: { kind, u, k: 0, v } }) as unknown as Goal

describe('the card and the pen while writing (#481)', () => {
  for (const seat of [0, 2, 4]) {
    it(`desk ${seat}: the tip on the card (a line, a strike: within 1 mm), inside it; the pressing palm above it; the pen at 45°`, async () => {
      const w = await writer(seat)
      const place = writePlace(GRAPH.spots, `work_${seat}`)
      // settle into the pose (the body turns toward the card, #461; the hand takes the pen)
      for (let k = 0; k < 60; k++) w.step(write(w.spot.id, 'line', 0))
      const lifts: Record<string, number> = { line: 0.001, strike: 0.001, readUp: 0.001, newline: 0.0105, tapPen: 0.0165 }
      const pressSide = place && place.side < 0 ? 'r' : 'l'
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
          // the pressing palm never below the card's top
          const press = w.rig.parts.hands[pressSide].node.getWorldPosition(new Vector3())
          expect(press.y, 'pressing palm').toBeGreaterThan(s.top!)
        }
    })
  }
})
