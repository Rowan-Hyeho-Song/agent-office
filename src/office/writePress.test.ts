/// <reference types="node" />
// #505 (docs/design/wrapup.md 9.1): where each desk's other hand rests while it writes, found on the baked model with the real rig. The palm (the support pose,
// its underside 1 mm above the desk under it) is tried 6-16 cm from the card's centre toward the pressing side and -4 to +14 cm along it (+ toward the body, #506),
// 1 cm apart. A point holds when, in every piece (a line, a new line, the taps, a strike) on every line (0-4):
//  - the two hands are at least 1 cm apart (every vertex of their visible meshes, none thinned out);
//  - the resting hand goes into nothing baked on the desk (keyboard, mouse pad, calendar ...), and all of it is over the desk (#506: nothing hangs off its edge).
// Of the points that hold, the one nearest the card's corner on the pressing side nearest the body is the desk's; a desk where none does takes the clear point
// where the hands come closest to 1 cm apart, and says so (`ok: false`). A desk with no point at all may rest the palm on a thin board (a mouse pad, at most
// 3 mm thick: its top + 1 mm, #507); the mouse and the rest are still kept out, and nothing may hang off the desk.
//   PRESS_SEATS=1 PRESS_THIN=1 PRESS_WRITE=1 ...    (that desk alone, the thin board allowed; the other desks keep their stored points)
//   PRESS_WRITE=1 npx vitest run src/office/writePress.test.ts     (searches, rewrites writePress.data.ts)
// Without it the stored points are checked against the same rules.
import { writeFileSync } from 'node:fs'
import { Box3, Raycaster, Vector3, type Mesh, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { LINES_MAX, WRITE_CARD, writePlace, type PressAt } from './wrapPose'
import { WRITE_PRESS } from './writePress.data'
import { WriteDesk } from './writeDesk'

const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60
const KINDS = ['line', 'newline', 'tapPen', 'strike'] as const
const GAP_M = 0.01
/** a point is chosen only with this much to spare over GAP_M: the same point measured from a fresh start lands a fraction of a millimetre either way */
const SPARE_M = 0.001
const SEATS = [0, 1, 2, 3, 4]
/** a board this thin under the palm may carry it (#507: the mouse pad), on a desk with no point otherwise */
const THIN_M = 0.003
/** how far toward the body the palm is tried (cm, #506: desks 1, 3 and 4 had nothing clear up to +10, the keyboard and the mouse pad under the fingers) */
const BACK_MAX_CM = 14

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
    for (let k = 0; k < 90; k++) step({ spot: spot.id, pose: 'idle', label: '' } as Goal)
  }
  // the desk itself, and what is baked on it (desk_<seat>_*: the keyboard, the mouse pad, the calendar ... are merged into one node, so they are felt by their surface)
  scene.updateMatrixWorld(true)
  const bare = scene.getObjectByName(`desk_${seat}`)!
  const props = scene.children.filter((o) => o.name.startsWith(`desk_${seat}_`))
  const place = writePlace(GRAPH.spots, `work_${seat}`)
  return { rig, desk, spot, step, reset, scene, seat, bare, props, place, pressSide: (place?.side ?? 1) < 0 ? ('r' as const) : ('l' as const) }
}
type Writer = Awaited<ReturnType<typeof writer>>

const write = (spot: string, kind: string, u: number, v: number) => ({ spot, pose: 'write', label: '', beat: { kind, u, k: 0, v } }) as unknown as Goal

/** the visible meshes' vertices under a node, in world */
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

/** the closest two vertices of two hands (m); further apart than `enough` counts as `enough` (only "enough or not" decides, and how near when none is) */
function handGap(a: Object3D, b: Object3D, enough: number) {
  const pa = points(a)
  const pb = points(b)
  const ba = new Box3().setFromPoints(pa)
  const bb = new Box3().setFromPoints(pb)
  const near = pb.filter((q) => ba.distanceToPoint(q) < enough)
  let best = enough * enough
  for (const p of pa) if (bb.distanceToPoint(p) < enough) for (const q of near) best = Math.min(best, p.distanceToSquared(q))
  return Math.sqrt(best)
}

const down = new Vector3(0, -1, 0)
/** the top of `objs` under a point, or null */
function surface(objs: Object3D[], at: Vector3): { y: number; name: string } | null {
  const hit = new Raycaster(new Vector3(at.x, 1.4, at.z), down, 0, 1.4).intersectObjects(objs, true)[0]
  if (!hit) return null
  return { y: hit.point.y, name: hit.object.name }
}

/** what the resting hand goes into (a vertex below the surface under it: the bare desk, or something baked on it), and 'off the desk' where nothing is under a vertex */
function sunk(w: Writer): string[] {
  const out = new Set<string>()
  const pts = points(w.rig.parts.hands[w.pressSide].node)
  for (let k = 0; k < pts.length; k += 3) {
    const top = surface([w.bare, ...w.props], pts[k])
    if (!top) out.add('off the desk')
    else if (pts[k].y < top.y - 0.0005) out.add(top.name)
  }
  return [...out]
}

/**
 * the palm height (seat frame) that puts the resting hand's lowest vertex 1 mm above the bare desk under its palm, or (thin) above a thin board there (three
 * passes: the hand follows its target)
 */
function palmHeight(w: Writer, at: PressAt, thin = false): number {
  let y = 0.82
  for (let k = 0; k < 3; k++) {
    w.rig.pressAt = { ...at, y }
    w.reset()
    for (let f = 0; f < 60; f++) w.step(write(w.spot.id, 'line', 0.5, 0))
    const hand = w.rig.parts.hands[w.pressSide].node
    const palm = hand.getWorldPosition(new Vector3())
    const bareTop = surface([w.bare], palm)?.y ?? 0.76
    const fullTop = surface([w.bare, ...w.props], palm)?.y ?? bareTop
    const top = thin && fullTop - bareTop <= THIN_M ? fullTop : bareTop
    y -= Math.min(...points(hand).map((p) => p.y)) - (top + 0.001)
  }
  return Number(y.toFixed(4))
}

/** one point tried: the closest the hands come (counted up to 1 cm), and what of the desk the resting hand goes into */
function tryPress(w: Writer, press: PressAt, enough = GAP_M): { gap: number; hits: string[]; where: string } {
  w.rig.pressAt = press
  w.reset()
  for (let k = 0; k < 60; k++) w.step(write(w.spot.id, 'line', 0, 0))
  let gap = enough
  let where = ''
  // the resting hand stays where it is put while the other one writes: what it goes into is felt once it has settled
  const hits = new Set<string>(sunk(w))
  for (let row = 0; row <= LINES_MAX; row++)
    for (const kind of KINDS)
      for (let i = 0; i <= 30; i++) {
        w.step(write(w.spot.id, kind, i / 30, row))
        if (i % 2) continue
        const g = handGap(w.rig.parts.hands.l.node, w.rig.parts.hands.r.node, enough)
        if (g < gap) {
          gap = g
          where = `${kind} row ${row} u ${(i / 30).toFixed(2)}`
        }
      }
  return { gap, hits: [...hits], where }
}

describe('the resting hand per desk (#505)', () => {
  if (process.env.PRESS_WRITE) {
    it('searches every desk and writes writePress.data.ts', async () => {
      const found: Record<number, PressAt & { gap?: number; ok?: boolean }> = { ...WRITE_PRESS }
      const seats = process.env.PRESS_SEATS ? process.env.PRESS_SEATS.split(',').map(Number) : SEATS
      const thin = !!process.env.PRESS_THIN
      for (const seat of seats) {
        const w = await writer(seat)
        // the card's corner on the pressing side nearest the body, in (side, back)
        const corner = { side: WRITE_CARD.w / 2, back: WRITE_CARD.d / 2 }
        const cands: PressAt[] = []
        for (let side = 6; side <= 16; side++) for (let back = -4; back <= BACK_MAX_CM; back++) cands.push({ side: side / 100, back: back / 100 })
        cands.sort((a, b) => Math.hypot(a.side - corner.side, a.back - corner.back) - Math.hypot(b.side - corner.side, b.back - corner.back) || a.side - b.side || a.back - b.back)
        let best: (PressAt & { gap: number; ok: boolean }) | null = null
        for (const c of cands) {
          const p = { ...c, y: palmHeight(w, c, thin) }
          const r = tryPress(w, p, GAP_M + SPARE_M)
          console.log(`desk ${seat} side ${(p.side * 100).toFixed(0)} back ${(p.back * 100).toFixed(0)} y ${p.y}: gap ${(r.gap * 100).toFixed(2)} ${r.where} hits ${r.hits.join(',')}`)
          if (r.hits.length) continue
          if (r.gap >= GAP_M + SPARE_M) {
            best = { ...p, gap: r.gap, ok: true }
            break
          }
          if (!best || r.gap > best.gap) best = { ...p, gap: r.gap, ok: false }
        }
        found[seat] = best ?? { side: WRITE_CARD.pressSide, back: WRITE_CARD.pressBack, gap: 0, ok: false }
      }
      const rows = SEATS.map((s) => `  ${s}: { side: ${found[s].side}, back: ${found[s].back}, y: ${found[s].y}, gap: ${Number((found[s].gap ?? 0).toFixed(4))}, ok: ${found[s].ok} },`).join('\n')
      writeFileSync(
        new URL('./writePress.data.ts', import.meta.url),
        `// GENERATED by src/office/writePress.test.ts (PRESS_WRITE=1 npx vitest run src/office/writePress.test.ts). Do not edit by hand.
// #505 (wrapup.md 9.1): per desk, where the other hand rests its palm on the desk beside the card while it writes: \`side\` from the card's centre toward the
// pressing side, \`back\` toward the body, \`y\` the palm's height (its underside 1 mm above the desk) (m). The point nearest the card's corner on that side nearest
// the body where the two hands stay 1 cm apart and the hand goes into nothing baked on the desk; \`gap\` the closest they come there (m, counted up to 1 cm),
// \`ok\` false where no point keeps them 1 cm apart (then the clear point nearest to it).
import type { PressAt } from './wrapPose'

export const WRITE_PRESS: Record<number, PressAt & { gap?: number; ok?: boolean }> = {
${rows}
}
`,
      )
    }, 3_600_000)
  } else {
    for (const seat of SEATS) {
      it(`desk ${seat}: the stored point keeps the hands ${GAP_M * 100} cm apart (or as found, where no point does) and the hand out of what is on the desk`, async () => {
        const p = WRITE_PRESS[seat]
        expect(p, 'a point for every desk').toBeDefined()
        const r = tryPress(await writer(seat), p)
        expect(r.hits, 'into nothing on the desk, all of it over the desk').toEqual([])
        if (p.ok) expect(r.gap, r.where).toBeGreaterThanOrEqual(GAP_M)
        else expect(r.gap).toBeCloseTo(p.gap ?? 0, 3)
      }, 120_000)
    }
  }
})
