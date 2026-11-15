// #481 (docs/design/wrapup.md 9.5): the card and the pen on the writing desk, on the baked model. While writing, the pen's tip is on the card's top
// (a line, a strike: within 1 mm; lifted at most the beat's own lift), inside the card; the pressing hand holds the card's corner with its fingertips, the
// palm off the card (#499); the two hands at least 1 cm apart; the pen is at 45°.
import { Vector3, type Mesh, type Object3D } from 'three'
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
    it(`desk ${seat}: the tip on the card (a line, a strike: within 1 mm), inside it; the pressing fingertips on it, the palm off it; the hands 1 cm apart; the pen at 45°`, async () => {
      const w = await writer(seat)
      const place = writePlace(GRAPH.spots, `work_${seat}`)
      // settle into the pose (the body turns toward the card, #461; the hand takes the pen)
      for (let k = 0; k < 60; k++) w.step(write(w.spot.id, 'line', 0))
      const lifts: Record<string, number> = { line: 0.001, strike: 0.001, readUp: 0.001, newline: 0.0105, tapPen: 0.0165 }
      const pressSide = place && place.side < 0 ? 'r' : 'l'
      const gaps: Record<string, number> = {}
      const tips: Record<string, number> = {}
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
          // #499: the pressing hand's fingertips on the card, its palm off it, nothing of it through the card
          const toCard = (p: Vector3) => p.clone().sub(at).applyQuaternion(w.rig.seatQuat().invert())
          const palm = toCard(w.rig.parts.hands[pressSide].node.getWorldPosition(new Vector3()))
          expect(Math.abs(palm.x) > WRITE_CARD.w / 2 || Math.abs(palm.z) > WRITE_CARD.d / 2, `${kind} palm off the card`).toBe(true)
          const onCard = points(w.rig.parts.hands[pressSide].node).map((p) => ({ p, l: toCard(p) })).filter(({ l }) => Math.abs(l.x) < WRITE_CARD.w / 2 && Math.abs(l.z) < WRITE_CARD.d / 2)
          tips[kind] = Math.min(tips[kind] ?? Infinity, onCard.length)
          if (onCard.length) expect(Math.min(...onCard.map(({ p }) => p.y)) - s.top!, `${kind} nothing through the card`).toBeGreaterThanOrEqual(-0.0005)
          // the two hands at least 1 cm apart (wrapup.md 9.1)
          if (i % 5 === 0) {
            const gap = meshGap(w.rig.parts.hands.l.node, w.rig.parts.hands.r.node)
            gaps[kind] = Math.min(gaps[kind] ?? Infinity, gap)
          }
        }
      // the PR's table: the closest the hands came in each piece
      console.log(`GAPS desk ${seat} ${Object.entries(gaps).map(([k, g]) => `${k} ${(g * 100).toFixed(2)}`).join(' | ')} TIPS ${Object.entries(tips).map(([k, n]) => `${k} ${n}`).join(' | ')}`)
      for (const [k, g] of Object.entries(gaps)) expect(g, `${k} hands apart`).toBeGreaterThanOrEqual(0.01)
      for (const [k, n] of Object.entries(tips)) expect(n, `${k} fingertips on the card`).toBeGreaterThan(0)
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

/** the closest two vertices of the two hands' visible meshes (m) */
function meshGap(a: Object3D, b: Object3D) {
  const pa = points(a)
  const pb = points(b)
  let best = Infinity
  for (const p of pa) for (const q of pb) best = Math.min(best, p.distanceToSquared(q))
  return Math.sqrt(best)
}
