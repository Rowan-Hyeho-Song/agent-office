// #481 (docs/design/wrapup.md 9.5): the card and the pen on the writing desk, on the baked model. While writing, the pen's tip is on the card's top
// (a line, a strike: within 1 mm; lifted at most the beat's own lift), inside the card; the other hand rests its palm on the desk beside it (#505); the
// pen is at 45°. (The two hands 1 cm apart: writePress.test.ts, per desk.)
import { Vector3, type Mesh, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { PEN, STACK, WRITE_CARD, writeCard, writePlace } from './wrapPose'
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

// #481 2단계 (wrapup.md 9.4, #514): the done cards' stack beside the card, the resting hand on it, the next card, the card read up, the cards gathered
/** a world point in the seat's frame, from the card's centre */
const toSeat = (rig: AgentRig, p: Vector3, c: { x: number; z: number }) => p.clone().sub(rig.seatToWorld(c.x, 0, c.z)).applyQuaternion(rig.seatQuat().invert())
const beat = (spot: string, kind: string, u: number, k: number, v = 0) => ({ spot, pose: 'write', label: '', wrapStep: 'write', beat: { kind, u, k, v } }) as unknown as Goal

describe('the done cards under the card (#481, wrapup.md 9.4 P)', () => {
  for (const seat of [0, 1, 2, 3, 4]) {
    it(`desk ${seat}: with 0, 2 and 4 cards written the card is 1.5 mm higher per card and the pen writes on it (1 mm); two or more edges show under it; the other hand stays on the desk`, async () => {
      const w = await writer(seat)
      const place = writePlace(GRAPH.spots, `work_${seat}`)
      const c = writeCard(place)
      const restSide = place && place.side < 0 ? 'r' : 'l'
      const hand = w.rig.parts.hands[restSide].node
      let first = 0
      for (const n of [0, 2, 4]) {
        for (let k = 0; k < 60; k++) w.step(beat(w.spot.id, 'line', 0.5, n, 1))
        let s = w.desk.state(w.rig.id)!
        if (n === 0) first = s.top!
        expect(s.stack, 'cards under it').toBe(n)
        expect(s.top! - first, 'a step per card').toBeCloseTo(n * STACK.step, 9)
        for (let i = 0; i <= 20; i++) {
          w.step(beat(w.spot.id, 'line', i / 20, n, 1))
          s = w.desk.state(w.rig.id)!
          expect(s.tip!.y - s.top!, 'the tip on the top card').toBeLessThanOrEqual(0.001)
          expect(s.tip!.y - s.top!, 'not through it').toBeGreaterThanOrEqual(-0.0005)
        }
        // the cards under the top one: turned ±5° and moved up to 1 cm toward the pressing side, so their corners show beyond its edges
        if (n > 0) {
          const top = s.cardAt!
          const showing = Array.from({ length: n }, (_, i) => w.scene.getObjectByName(`${w.rig.id}_write_card_stack_${i}`)!).filter((g) => {
            g.updateMatrixWorld(true)
            return [-1, 1].some((a) => [-1, 1].some((b) => {
              const p = new Vector3((a * WRITE_CARD.w) / 2, 0, (b * WRITE_CARD.d) / 2).applyMatrix4(g.matrixWorld).sub(top.p).applyQuaternion(top.q.clone().invert())
              return Math.abs(p.x) > WRITE_CARD.w / 2 + 0.001 || Math.abs(p.z) > WRITE_CARD.d / 2 + 0.001
            }))
          })
          if (n >= 2) expect(showing.length, `${n} cards: edges showing`).toBeGreaterThanOrEqual(2)
          for (let i = 0; i < n; i++) {
            const g = w.scene.getObjectByName(`${w.rig.id}_write_card_stack_${i}`)!
            const p = toSeat(w.rig, g.getWorldPosition(new Vector3()), c)
            expect(-c.s * p.x, 'moved toward the pressing side').toBeGreaterThanOrEqual(-1e-9)
            expect(Math.hypot(p.x, p.z), 'at most 1 cm').toBeLessThanOrEqual(STACK.offM + 1e-9)
          }
        }
        // the resting hand: its palm on the desk as before (#505)
        const low = Math.min(...points(hand).map((p) => p.y)) - deskTop(w.scene, seat, hand.getWorldPosition(new Vector3()))!
        expect(low).toBeGreaterThanOrEqual(-0.0005)
        expect(low).toBeLessThanOrEqual(0.003)
      }
    })
  }

  it('next card: the done card is turned to its place where it lies by the pressing hand reaching its edge (0.3 s), then a new square card appears on it, 1.5 mm higher', async () => {
    const w = await writer(0)
    const place = writePlace(GRAPH.spots, 'work_0')
    const c = writeCard(place)
    const restSide = place && place.side < 0 ? 'r' : 'l'
    const hand = w.rig.parts.hands[restSide].node
    for (let k = 0; k < 60; k++) w.step(beat(w.spot.id, 'line', 1, 1, 3))
    const s0 = w.desk.state(w.rig.id)!
    const hand0 = toSeat(w.rig, hand.getWorldPosition(new Vector3()), c)
    let reached = 0
    const N = 36
    for (let i = 1; i <= N; i++) {
      const u = i / N
      w.step(beat(w.spot.id, 'next', u, 1, 4))
      const s = w.desk.state(w.rig.id)!
      const at = toSeat(w.rig, s.cardAt!.p, c)
      const turn = Math.abs(2 * Math.asin(Math.min(1, Math.abs(s.cardAt!.q.clone().multiply(w.rig.seatQuat().invert()).y))))
      if (u < 0.5) {
        // the hand toward the card (in), and the card turning where it lies
        reached = Math.max(reached, c.s * (toSeat(w.rig, hand.getWorldPosition(new Vector3()), c).x - hand0.x))
        expect(s.stack).toBe(1)
        expect(Math.hypot(at.x, at.z), 'where it lies').toBeLessThanOrEqual(STACK.offM + 1e-9)
        expect(turn * (180 / Math.PI)).toBeLessThanOrEqual(STACK.turnDeg + 1e-6)
        expect(s.top! - s0.top!, 'the same height').toBeCloseTo(0, 9)
      } else {
        expect(s.stack, 'the done card under it').toBe(2)
        expect(Math.hypot(at.x, at.z), 'the new card square on the place').toBeLessThan(1e-6)
        expect(turn).toBeLessThan(1e-6)
        expect(s.top! - s0.top!, 'a step higher').toBeCloseTo(STACK.step, 9)
      }
    }
    expect(reached, 'the fingertips went to the card').toBeGreaterThan(0.01)
    expect(toSeat(w.rig, hand.getWorldPosition(new Vector3()), c).distanceTo(hand0), 'back at rest').toBeLessThan(0.003)
  })

  it('read up: the card goes up on the pressing palm and comes back to its place exactly', async () => {
    const w = await writer(2)
    const place = writePlace(GRAPH.spots, 'work_2')
    const c = writeCard(place)
    for (let k = 0; k < 60; k++) w.step(beat(w.spot.id, 'line', 1, 0, 2))
    let highest = 0
    let onPalm = Infinity
    for (let i = 0; i <= 108; i++) {
      w.step(beat(w.spot.id, 'readUp', i / 108, 0, 2))
      const s = w.desk.state(w.rig.id)!
      highest = Math.max(highest, s.cardAt!.p.y - s.top!)
      if (i === 54) onPalm = s.cardAt!.p.distanceTo(new Vector3().setFromMatrixPosition(w.rig.palmCard(w.rig.cardSide)))
    }
    expect(highest, 'held up').toBeGreaterThan(0.15)
    expect(onPalm, 'on the palm').toBeLessThan(0.001)
    const s = w.desk.state(w.rig.id)!
    const back = toSeat(w.rig, s.cardAt!.p, c)
    expect(Math.hypot(back.x, back.z), 'back on its place').toBeLessThan(1e-6)
    expect(Math.abs(s.cardAt!.p.y - s.top!)).toBeLessThan(1e-9)
  })

  it('gathering: the pen laid beside the card (tip toward the monitor, along the seat), the desk cards as many as then go on the palm; the pen stays till the wrap-up is over, then fades', async () => {
    const w = await writer(0)
    const place = writePlace(GRAPH.spots, 'work_0')
    const c = writeCard(place)
    for (let k = 0; k < 60; k++) w.step(beat(w.spot.id, 'line', 1, 2, 3))
    const before = w.desk.state(w.rig.id)!
    const onDesk = before.stack + (before.cardAt ? 1 : 0)
    expect(onDesk, 'three cards written').toBe(3)
    for (let i = 0; i <= 30; i++) w.step(beat(w.spot.id, 'collect', i / 30, 2, 0))
    const s = w.desk.state(w.rig.id)!
    expect(s.cardAt, 'no card left on the desk').toBeNull()
    expect(s.stack, 'no stack left on the desk').toBe(0)
    expect(s.lying, 'the pen lies on the desk').toBe(true)
    // the pen along the seat's z, its tip toward the monitor (-z), on the desk, 3 cm beyond the card's edge on the pen side
    const pen = w.scene.getObjectByName(`${w.rig.id}_write_pen`)!
    pen.updateMatrixWorld(true)
    const tip = toSeat(w.rig, new Vector3(0, 0, PEN.tipZ).applyMatrix4(pen.matrixWorld), c)
    const end = toSeat(w.rig, new Vector3(0, 0, PEN.tipZ + PEN.len).applyMatrix4(pen.matrixWorld), c)
    expect(tip.z).toBeLessThan(end.z)
    expect(Math.abs(tip.x - end.x)).toBeLessThan(1e-6)
    expect(Math.abs(tip.y - end.y)).toBeLessThan(1e-6)
    expect(c.s * tip.x).toBeCloseTo(WRITE_CARD.w / 2 + STACK.penOut, 6)
    const mid = new Vector3(0, 0, PEN.tipZ + PEN.len / 2).applyMatrix4(pen.matrixWorld)
    expect(mid.y - deskTop(w.scene, 0, mid)!).toBeCloseTo(PEN.r, 6)
    // to the board with the cards on the palm: as many as were on the desk; the pen stays laid
    const walk = { spot: w.spot.id, pose: 'carry', label: '', carry: onDesk, wrapStep: 'walk' } as unknown as Goal
    for (let k = 0; k < 30; k++) w.step(walk)
    const bundle = (w.rig as unknown as { cards: Record<'l' | 'r', Mesh | null> }).cards.l!
    expect(bundle.visible).toBe(true)
    expect(bundle.scale.y, 'the cards on the palm').toBe(onDesk)
    expect(w.desk.state(w.rig.id)!.lying).toBe(true)
    // the wrap-up over: it fades out in 0.3 s
    const idle = { spot: w.spot.id, pose: 'idle', label: '' } as Goal
    for (let k = 0; k < 12; k++) w.step(idle)
    expect(w.desk.state(w.rig.id)!.lying, 'still fading').toBe(true)
    for (let k = 0; k < 12; k++) w.step(idle)
    expect(w.desk.state(w.rig.id)!.lying, 'gone').toBe(false)
  })
})
