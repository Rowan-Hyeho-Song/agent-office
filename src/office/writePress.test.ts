/// <reference types="node" />
// #501 (docs/design/wrapup.md 9.1): where each desk's pressing hand holds the card, found on the baked model with the real rig. The palm's centre is tried
// 3-10 cm beyond the card's short edge nearest the body and 0-8 cm from its centre toward the pressing side (1 cm steps), nearest the corner first:
//  (1) three or more vertices of the index / middle fingertips are on the card, the palm's centre off it, nothing of the hand through it (reading the card
//      held up, and the new line right after it, are left out: the hand is lifting the card then);
//  (2) the two hands are at least 1 cm apart in every piece (a line, a new line, the taps, a strike, reading it) on every line (0-4); no vertex thinned out.
// The first point that holds both is the desk's; a desk where none does takes the point where the hands come closest least (and says so).
//   PRESS_WRITE=1 npx vitest run src/office/writePress.test.ts     (searches, rewrites writePress.data.ts)
// Without it the stored points are checked against the same rules.
import { writeFileSync } from 'node:fs'
import { Box3, Vector3, type Mesh, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { LINES_MAX, WRITE_CARD, writeCard, writePlace, type PressAt } from './wrapPose'
import { WRITE_PRESS } from './writePress.data'
import { WriteDesk } from './writeDesk'

const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60
const KINDS = ['line', 'newline', 'tapPen', 'strike', 'readUp'] as const
const GAP_M = 0.01

async function writer(seat: number) {
  const { scene, nodes } = await loadOffice()
  const id = `agent_${seat}`
  const rig = new AgentRig(id, seat, buildRig(scene, nodes, seat), '#ffffff')
  const rigs = { [id]: rig }
  const spot = GRAPH.spots[`work_${seat}`]
  const desk = new WriteDesk(scene)
  let t = 0
  const step = (goal: Goal) => {
    rig.setGoal(goal, GRAPH)
    rig.update(DT, (t += DT), GRAPH, rigs, false)
    rig.drive = { l: null, r: null }
    desk.drive(rig, goal, { t, dt: DT, reduced: false, colors: {} })
    rig.applyDrive('l', t, false)
    rig.applyDrive('r', t, false)
    desk.draw(rig, goal, { t, dt: DT, reduced: false, colors: {} })
  }
  const reset = () => {
    rig.x = spot.x
    rig.z = spot.z
    rig.heading = spot.ry
    const idle = { spot: spot.id, pose: 'idle', label: '' } as Goal
    for (let k = 0; k < 90; k++) step(idle)
  }
  return { rig, desk, spot, step, reset, place: writePlace(GRAPH.spots, `work_${seat}`) }
}
type Writer = Awaited<ReturnType<typeof writer>>

const write = (spot: string, kind: string, u: number, v: number) => ({ spot, pose: 'write', label: '', beat: { kind, u, k: 0, v } }) as unknown as Goal

/** the visible meshes' vertices under a node, in world; `only` keeps the meshes whose names match */
function points(o: Object3D, only?: RegExp): Vector3[] {
  const out: Vector3[] = []
  o.updateMatrixWorld(true)
  o.traverseVisible((m) => {
    const g = (m as Mesh).geometry?.getAttribute('position')
    if (!(m as Mesh).isMesh || !g || (only && !only.test(m.name))) return
    for (let i = 0; i < g.count; i++) out.push(new Vector3().fromBufferAttribute(g, i).applyMatrix4(m.matrixWorld))
  })
  return out
}

/** the closest two vertices of two hands (m); boxes further apart than `enough` are not looked into (the gap is at least that) */
function handGap(a: Object3D, b: Object3D, enough: number) {
  const pa = points(a)
  const pb = points(b)
  const ba = new Box3().setFromPoints(pa)
  const bb = new Box3().setFromPoints(pb)
  const far = Math.hypot(Math.max(0, ba.min.x - bb.max.x, bb.min.x - ba.max.x), Math.max(0, ba.min.y - bb.max.y, bb.min.y - ba.max.y), Math.max(0, ba.min.z - bb.max.z, bb.min.z - ba.max.z))
  if (far >= enough) return far
  const near = pb.filter((q) => ba.distanceToPoint(q) < enough)
  let best = Infinity
  for (const p of pa) if (bb.distanceToPoint(p) < enough) for (const q of near) best = Math.min(best, p.distanceToSquared(q))
  return Math.min(Math.sqrt(best), enough)
}

/** one point tried: the closest the hands come (capped at 1 cm: only "enough or not" matters for the choice), and whether (1) held throughout */
function tryPress(w: Writer, press: PressAt): { gap: number; tips: boolean; why: string } {
  w.rig.pressAt = press
  w.reset()
  for (let k = 0; k < 60; k++) w.step(write(w.spot.id, 'line', 0, 0))
  const c = writeCard(w.place, press)
  const at = w.rig.seatToWorld(c.x, 0, c.z)
  const toCard = (p: Vector3) => p.clone().sub(at).applyQuaternion(w.rig.seatQuat().invert())
  const pressSide = w.place && w.place.side < 0 ? 'r' : 'l'
  let gap = Infinity
  let tips = true
  let why = ''
  let prev = ''
  for (let row = 0; row <= LINES_MAX; row++)
    for (const kind of KINDS) {
      for (let i = 0; i <= 30; i++) {
        const u = i / 30
        w.step(write(w.spot.id, kind, u, row))
        if (i % 2 === 0) {
          const g = handGap(w.rig.parts.hands.l.node, w.rig.parts.hands.r.node, GAP_M)
          if (g < gap) {
            gap = g
            if (g < GAP_M) why ||= `hands ${(g * 100).toFixed(2)} cm in ${kind} row ${row} u ${u.toFixed(2)}`
          }
        }
        // (1), not while the card is read held up nor on the new line just after
        if (kind === 'readUp' || (kind === 'newline' && prev === 'readUp')) continue
        const s = w.desk.state(w.rig.id)!
        const hand = w.rig.parts.hands[pressSide].node
        const palm = toCard(hand.getWorldPosition(new Vector3()))
        const off = Math.abs(palm.x) > WRITE_CARD.w / 2 || Math.abs(palm.z) > WRITE_CARD.d / 2
        const onCard = points(hand, /_f[12]_3_/).filter((p) => {
          const l = toCard(p)
          return Math.abs(l.x) < WRITE_CARD.w / 2 && Math.abs(l.z) < WRITE_CARD.d / 2 && p.y - s.top! <= 0.01
        })
        const through = points(hand).some((p) => {
          const l = toCard(p)
          const onIt = Math.abs(l.x) < WRITE_CARD.w / 2 && Math.abs(l.z) < WRITE_CARD.d / 2
          // through the card, or through the desk beside it (its top is the card's less the card's lift)
          return p.y < s.top! - (onIt ? 0.0005 : WRITE_CARD.lift + WRITE_CARD.t + 0.0005)
        })
        if (!off || onCard.length < 3 || through) {
          if (tips) why ||= `${!off ? 'palm on the card' : through ? 'through the card' : `${onCard.length} fingertip vertices on the card`} in ${kind} row ${row} u ${u.toFixed(2)}`
          tips = false
        }
      }
      prev = kind
    }
  return { gap, tips, why }
}

const SEATS = [0, 1, 2, 3, 4]

/** the palm height (seat frame) that puts the lowest index / middle fingertip 1 mm above the card, measured in the first line's pose (twice: the fingers follow the hand) */
function palmHeight(w: Writer, at: PressAt): number {
  let y = 0.82
  for (let k = 0; k < 3; k++) {
    w.rig.pressAt = { ...at, y }
    w.reset()
    for (let f = 0; f < 60; f++) w.step(write(w.spot.id, 'line', 0.5, 0))
    const s = w.desk.state(w.rig.id)!
    const pressSide = w.place && w.place.side < 0 ? 'r' : 'l'
    const tip = Math.min(...points(w.rig.parts.hands[pressSide].node, /_f[12]_3_/).map((p) => p.y))
    y -= tip - (s.top! + 0.001)
  }
  return Number(y.toFixed(4))
}

describe('the pressing hand per desk (#501)', () => {
  if (process.env.PRESS_WRITE) {
    it('searches every desk and writes writePress.data.ts', async () => {
      const found: Record<number, PressAt & { gap: number; ok: boolean }> = {}
      for (const seat of SEATS) {
        const w = await writer(seat)
        const cands: PressAt[] = []
        for (let out = 3; out <= 10; out++) for (let side = 0; side <= 8; side++) cands.push({ out: out / 100, side: side / 100 })
        cands.sort((a, b) => Math.hypot(a.out - 0.03, a.side) - Math.hypot(b.out - 0.03, b.side) || a.out - b.out)
        // the palm's height: lowered until the lowest index / middle fingertip is 1 mm above the card (the support pose holds it 7-8 cm up; the fingers hovered)
        const y = palmHeight(w, cands[Math.floor(cands.length / 2)])
        for (const c of cands) c.y = y
        let best: (PressAt & { gap: number; ok: boolean }) | null = null
        for (const p of cands) {
          const r = tryPress(w, p)
          console.log(`desk ${seat} out ${(p.out * 100).toFixed(0)} side ${(p.side * 100).toFixed(0)}: gap ${(r.gap * 100).toFixed(2)} tips ${r.tips} ${r.why}`)
          if (r.tips && r.gap >= GAP_M) {
            best = { ...p, gap: r.gap, ok: true }
            break
          }
          if (r.tips && (!best || r.gap > best.gap)) best = { ...p, gap: r.gap, ok: false }
        }
        found[seat] = best ?? { out: WRITE_CARD.pressOut, side: WRITE_CARD.pressSide, gap: 0, ok: false }
      }
      const rows = SEATS.map((s) => `  ${s}: { out: ${found[s].out}, side: ${found[s].side}, y: ${found[s].y}, gap: ${Number(found[s].gap.toFixed(4))}, ok: ${found[s].ok} },`).join('\n')
      writeFileSync(
        new URL('./writePress.data.ts', import.meta.url),
        `// GENERATED by src/office/writePress.test.ts (PRESS_WRITE=1 npx vitest run src/office/writePress.test.ts). Do not edit by hand.
// #501 (wrapup.md 9.1): per desk, where the pressing palm's centre holds the card's near corner: \`out\` beyond the card's short edge nearest the body,
// \`side\` from the card's centre toward the pressing side (m). The point nearest the corner where the index / middle fingertips are on the card, the palm
// off it, and the two hands at least 1 cm apart in every piece and line; \`gap\` is the closest the hands come there (m, counted up to 1 cm), \`ok\` whether both held.
import type { PressAt } from './wrapPose'

export const WRITE_PRESS: Record<number, PressAt & { gap?: number; ok?: boolean }> = {
${rows}
}
`,
      )
    }, 3_600_000)
  } else {
    for (const seat of SEATS) {
      it(`desk ${seat}: the stored point keeps the fingertips on the card and the hands ${GAP_M * 100} cm apart (or, where no point does, is as found)`, async () => {
        const p = WRITE_PRESS[seat]
        expect(p, 'a point for every desk').toBeDefined()
        const r = tryPress(await writer(seat), p)
        expect(r.tips, r.why).toBe(true)
        if (p.ok) expect(r.gap, r.why).toBeGreaterThanOrEqual(GAP_M)
        else expect(r.gap).toBeCloseTo(p.gap ?? 0, 3)
      }, 120_000)
    }
  }
})
