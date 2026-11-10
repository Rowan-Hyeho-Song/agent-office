/// <reference types="node" />
// The open book, 150° (#231): the hands hold it per grips.md without a finger inside it, and one leaf turns, bent, under the right thumb and index.
//  1. the solids the check uses (bookGeom.ts: cover boards and paper blocks, each half lifted by LIFT) agree with the baked halves' bounds, for all six books;
//  2. reading grip, from the bake's own grip / contact empties (<book>_l|r_grip, <book>_l|r_contact_*): for every book (the table one and the five
//     shelf books) and agent, with the stored hand offsets and the fitted fingers, no sampled point of any finger's centre line is inside a cover
//     board or a paper block (≥ −0.1 mm), each pad is within 1 mm of its surface, the four fingers are on the cover's outer face and only the
//     thumb is on the paper, within 1.5 cm of its fore-edge;
//  3. the turn: the hand's whole path (to the corner along the arc, with the corner through the turn, back along the arc) stays out of the book;
//  4. the leaf: the outer third lags 25° at mid-turn, it is straight flat and landed, 16 segments, the vertices change in place.
// The numbers are appended to FIT_LOG when set (the PR's table).
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Quaternion, Vector3, type Mesh, type Object3D } from 'three'
import { loadOffice, stubCanvas } from './glbLoad'
import { buildRig, fingerModelOf } from './rig'
import { GRIPS, pointsAtJoints, tableJoints } from './grip'
import { fingerPenetration, fitFingers, handInObject, offsetOf, resolveTarget } from './gripTargets'
import { COVER_T, LIFT, OPEN_ANGLE, bookBoxes, bookDimsOf, distToBook, halfAngle, readingContacts } from './bookGeom'
import { LeafBend, PINCH_LET_GO, PINCH_LIFT, TURN_S, cornerOf, fingerWeight, lagAt, leafAngle, pinchArc, poseWeight } from './bookLeaf'

stubCanvas()
const LOG = process.env.FIT_LOG
const log = (s: string) => LOG && appendFileSync(LOG, s + '\n')
const BOOKS = ['prop_book', ...[0, 1, 2, 3, 4].map((k) => 'prop_shelfbook_' + k)]
const FINGERS = ['index', 'middle', 'ring', 'little'] as const
const EPS = 1e-4
/** nothing inside (≥ −0.1 mm), pads within 1 mm of their surface (the numbers are in FIT_LOG) */
const STRICT = true
const IN_LIMIT = STRICT ? EPS : 0.0025
const PAD_LIMIT = STRICT ? 0.001 : 0.005
const mm = (x: number) => (x * 1000).toFixed(2)

/** the first mesh under a node (the leaf's paper) */
const firstMesh = (n: Object3D) => {
  let m: Mesh | null = null
  n.traverse((o) => {
    if (!m && (o as Mesh).isMesh) m = o as Mesh
  })
  return m as unknown as Mesh
}

const halfBox = (n: Object3D) => {
  const b = new Box3()
  n.traverse((o) => {
    const g = (o as { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry
    if (!g) return
    if (!g.boundingBox) g.computeBoundingBox()
    b.union(g.boundingBox!)
  })
  return b
}

const blend = (a: Matrix4, b: Matrix4, k: number) => {
  const pa = new Vector3()
  const pb = new Vector3()
  const qa = new Quaternion()
  const qb = new Quaternion()
  a.decompose(pa, qa, new Vector3())
  b.decompose(pb, qb, new Vector3())
  return new Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), new Vector3(1, 1, 1))
}

describe('the open book as geometry', () => {
  it('the solids agree with the baked halves (all six books)', async () => {
    const { scene } = await loadOffice()
    for (const name of BOOKS) {
      const l = scene.getObjectByName(name + '_l')!
      const r = scene.getObjectByName(name + '_r')!
      const d = bookDimsOf(l, r)
      const bl = halfBox(l)
      const br = halfBox(r)
      // the cover's outer face, the fore-edge and the head / tail, within 1 mm (the label and bands stand a fraction of a millimetre proud)
      expect(br.min.y, `${name} lower cover's outer face`).toBeCloseTo(-d.T / 2, 3)
      expect(bl.max.y - d.T / 2, `${name} upper cover's outer face`).toBeLessThan(0.001)
      expect(bl.max.x, `${name} fore-edge`).toBeCloseTo(d.W, 3)
      expect(bl.max.z, `${name} head`).toBeCloseTo(d.H / 2, 3)
      expect(d.T, `${name} thickness`).toBeGreaterThan(0.02)
      // the boxes are inside the baked halves' bounds (they are solids of it) and fill them but for the spine strip and the cover's 2 mm
      const boxes = bookBoxes(d)
      const lower = boxes.filter((b) => b.half === 'r')
      expect(Math.max(...lower.map((b) => b.max.x))).toBeLessThanOrEqual(br.max.x + 1e-4)
      expect(Math.min(...lower.map((b) => b.min.y))).toBeGreaterThanOrEqual(br.min.y - 1e-4)
      const cover = lower.find((b) => b.name === 'cover')!
      expect(cover.max.y - cover.min.y).toBeCloseTo(COVER_T, 6)
    }
  })

  it('the angle between the halves is 150°: each lifted 15° (the bake lies them flat)', () => {
    expect(OPEN_ANGLE).toBeCloseTo((150 * Math.PI) / 180, 9)
    expect(LIFT).toBeCloseTo((15 * Math.PI) / 180, 9)
    expect(halfAngle('l') - halfAngle('r')).toBeCloseTo(OPEN_ANGLE, 9)
  })

  it("the bake's grip and contact empties: four fingers on the cover face, the thumb alone on the paper within 1.5 cm of the fore-edge (all six books, both halves)", async () => {
    const { scene } = await loadOffice()
    for (const name of BOOKS) {
      const d = bookDimsOf(scene.getObjectByName(name + '_l')!, scene.getObjectByName(name + '_r')!)
      const boxes = bookBoxes(d)
      for (const side of ['l', 'r'] as const) {
        for (const f of [...FINGERS, 'thumb'] as const) expect(scene.getObjectByName(`${name}_${side}_contact_${f}`), `${name} has the baked ${side} ${f} contact (else the computed one is used)`).toBeTruthy()
        expect(scene.getObjectByName(`${name}_${side}_grip`), `${name} has the baked ${side} grip`).toBeTruthy()
        const cs = resolveTarget(scene, name, 'book', side)!.contacts
        expect(cs.map((c) => c.finger)).toEqual(['index', 'middle', 'ring', 'little', 'thumb'])
        for (const c of cs) {
          const { d: dist, box } = distToBook(c.p, boxes)
          expect(Math.abs(dist), `${name} ${side} ${c.finger} on a surface`).toBeLessThan(1e-3)
          // in the half's own frame (the closed pose): x along the page, +y the half's outside
          const nb = c.n.clone().transformDirection(box.toBox)
          const pb = c.p.clone().applyMatrix4(box.toBox)
          if (c.finger === 'thumb') {
            expect(box.name.startsWith('paper'), `${name} ${side} thumb on the paper`).toBe(true)
            expect(nb.y, `${name} ${side} thumb's normal out of the paper`).toBeCloseTo(side === 'r' ? 1 : -1, 5)
            expect(d.W - 0.004 - Math.abs(pb.x), `${name} ${side} thumb from the fore-edge`).toBeLessThanOrEqual(0.015)
            expect(c.p.z).toBeGreaterThan(0)
          } else {
            expect(box.name, `${name} ${side} ${c.finger} on the cover`).toBe('cover')
            expect(nb.y, `${name} ${side} ${c.finger}'s normal out of the cover`).toBeCloseTo(side === 'r' ? -1 : 1, 5)
            expect(c.p.z, `${name} ${side} ${c.finger} in the lower half`).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('the computed fallback (for a missing empty) lies on the same surfaces: four fingers on the cover, the thumb on the paper', async () => {
    const { scene } = await loadOffice()
    for (const name of BOOKS) {
      const d = bookDimsOf(scene.getObjectByName(name + '_l')!, scene.getObjectByName(name + '_r')!)
      const boxes = bookBoxes(d)
      for (const side of ['l', 'r'] as const) {
        const cs = readingContacts(d, side)
        expect(cs.map((c) => c.finger)).toEqual(['index', 'middle', 'ring', 'little', 'thumb'])
        for (const c of cs) {
          const { d: dist, box } = distToBook(c.p, boxes)
          expect(Math.abs(dist), `${name} ${side} ${c.finger} on a surface`).toBeLessThan(1e-3)
          const nb = c.n.clone().transformDirection(box.toBox)
          if (c.finger === 'thumb') {
            expect(box.name.startsWith('paper'), `${name} ${side} thumb on the paper`).toBe(true)
            expect(nb.y).toBeCloseTo(side === 'r' ? 1 : -1, 5)
          } else {
            expect(box.name, `${name} ${side} ${c.finger} on the cover`).toBe('cover')
            expect(nb.y).toBeCloseTo(side === 'r' ? -1 : 1, 5)
          }
          expect(c.p.z, `${name} ${side} ${c.finger} in the lower half`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('no finger through the book while it is read', () => {
  it('every book, hand and agent: nothing inside the cover boards or paper blocks; pads within 1 mm', async () => {
    const { scene, nodes } = await loadOffice()
    const rigs = [0, 1, 2, 3, 4].map((i) => buildRig(scene, nodes, i))
    scene.updateMatrixWorld(true)
    let worst = Infinity
    let worstAt = ''
    let farthestPad = 0
    const bad: string[] = []
    for (const name of BOOKS) {
      for (const side of ['l', 'r'] as const) {
        const t = resolveTarget(scene, name, 'book', side)!
        expect(t.solids?.length, `${name} has solids`).toBeGreaterThan(0)
        for (const [i, rig] of rigs.entries()) {
          const hand = rig.hands[side]
          const off = offsetOf(t.key, i)
          const fits = fitFingers(t, hand, off)
          const pen = fingerPenetration(t, hand, off, fits, 10)
          log(`book ${t.key} agent_${i}: min ${mm(pen.min)} mm (${pen.finger}) ` + Object.entries(pen.per).map(([f, v]) => `${f} ${mm(v)}`).join(' '))
          if (pen.min < worst) {
            worst = pen.min
            worstAt = `${t.key} agent_${i} ${pen.finger}`
          }
          if (pen.min < -IN_LIMIT) bad.push(`${t.key} agent_${i}: ${pen.finger} ${mm(pen.min)} mm`)
          for (const f of fits) {
            // the pad is on its surface: not through it, not more than 1 mm off it
            expect(f.off, `${t.key} agent_${i} ${f.finger} off the surface`).toBeGreaterThanOrEqual(-EPS)
            expect(f.off, `${t.key} agent_${i} ${f.finger} pad within 1 mm`).toBeLessThanOrEqual(PAD_LIMIT)
            farthestPad = Math.max(farthestPad, f.off)
          }
        }
      }
    }
    expect(bad, 'fingers inside the book').toEqual([])
    log(`book grip: worst clearance ${mm(worst)} mm at ${worstAt}; farthest pad ${mm(farthestPad)} mm off its surface`)
  }, 600000)
})

describe('the turn: the hand never goes into the book', () => {
  it('to the corner along the arc, through the turn, and back: every book and agent', async () => {
    const { scene, nodes } = await loadOffice()
    const rigs = [0, 1, 2, 3, 4].map((i) => buildRig(scene, nodes, i))
    scene.updateMatrixWorld(true)
    let worst = Infinity
    let worstAt = ''
    const bad: string[] = []
    for (const name of BOOKS) {
      const l = scene.getObjectByName(name + '_l')!
      const r = scene.getObjectByName(name + '_r')!
      const ex = scene.getObjectByName(name + '_page')!.userData as { page_w: number; page_h: number }
      const boxes = bookBoxes(bookDimsOf(l, r))
      const tb = resolveTarget(scene, name, 'book', 'r')!
      const tl = resolveTarget(scene, name, 'leaf', 'r')!
      expect(tl, `${name} has a pinch target`).toBeTruthy()
      for (const [i, rig] of rigs.entries()) {
        const hand = rig.hands.r
        const ob = offsetOf(tb.key, i)
        const ol = offsetOf(tl.key, i)
        const fb = fitFingers(tb, hand, ob)
        const fl = fitFingers(tl, hand, ol)
        const spec = GRIPS.leaf.r!
        const models = [0, 1, 2, 3, 'thumb' as const].map((k) => fingerModelOf(hand, k, 'r')!)
        const joints = (k0: number): { finger: string; joints: number[] }[] =>
          [...FINGERS, 'thumb' as const].map((f, n) => {
            const a = fb.find((x) => x.finger === f)!.joints
            const b = fl.find((x) => x.finger === f)?.joints ?? (f === 'thumb' ? tableJoints(models[4], spec.hold[4], spec.hold[5]) : tableJoints(models[n], spec.hold[n], 0))
            const k = fingerWeight(k0)
            return { finger: f, joints: a.map((x, q) => x * (1 - k) + b[q] * k) }
          })
        const M0 = handInObject(tb, hand, ob)
        const minAt = (M: Matrix4, k: number) => {
          let mn = Infinity
          let wf = ''
          const p = new Vector3()
          for (const f of joints(k)) {
            const pts = pointsAtJoints(models[f.finger === 'thumb' ? 4 : FINGERS.indexOf(f.finger as (typeof FINGERS)[number])], f.joints)
            for (let s = 0; s + 1 < pts.length; s++)
              for (let u = 0; u <= 6; u++) {
                p.copy(pts[s]).lerp(pts[s + 1], u / 6).applyMatrix4(M)
                const d = distToBook(p, boxes).d
                if (d < mn) {
                  mn = d
                  wf = f.finger
                }
              }
          }
          return { mn, wf }
        }
        const pinchAt = (th: number) => cornerOf(th, 0.003, ex.page_w, ex.page_h / 2).multiply(handInObject(tl, hand, ol))
        const thGo = leafAngle(PINCH_LET_GO * TURN_S)
        const check = (what: string, M: Matrix4, k: number) => {
          const { mn, wf } = minAt(M, k)
          if (mn < worst) {
            worst = mn
            worstAt = `${name} agent_${i} ${what} ${wf}`
          }
          // no finger inside the book at any point of the path (the reading grip's own clearance is judged above)
          if (mn < -EPS) bad.push(`${name} agent_${i} ${what}: ${wf} ${mm(mn)} mm`)
        }
        // approach: the leaf lifts to PINCH_LIFT while the hand goes to its corner (k eased as the stage does), with the arc
        const arcAt = (M: Matrix4, k: number) => M.clone().premultiply(new Matrix4().makeTranslation(...pinchArc(k, new Vector3()).toArray()))
        for (let a = 0; a <= 20; a++) {
          const k = a / 20
          const e = k * k * (3 - 2 * k)
          check(`approach ${a}`, arcAt(blend(M0, pinchAt(PINCH_LIFT * e), poseWeight(e)), e), e)
        }
        // the turn proper: the hand rides the corner
        for (let a = 0; a <= 40; a++) check(`turn ${a}`, pinchAt(PINCH_LIFT + (thGo - PINCH_LIFT) * (a / 40)), 1)
        // back: from the pose where it let go to the reading grip
        for (let a = 0; a <= 20; a++) {
          const k = a / 20
          const e = 1 - k * k * (3 - 2 * k)
          check(`return ${a}`, arcAt(blend(M0, pinchAt(thGo), poseWeight(e)), e), e)
        }
      }
    }
    log(['turn bad:', ...bad].join('\n'))
    expect(bad.slice(0, 40), 'fingers inside the book on the way to the corner, through the turn, or back').toEqual([])
    log(`turn: worst clearance over approach, turn and return ${mm(worst)} mm at ${worstAt}`)
  }, 600000)
})

describe('the leaf', () => {
  it('the timeline: 0.75 s, lifted for the pinch first, 0 → 150° without going back', () => {
    expect(TURN_S).toBeGreaterThanOrEqual(0.6)
    expect(TURN_S).toBeLessThanOrEqual(0.9)
    expect(leafAngle(-1)).toBe(0)
    expect(leafAngle(0)).toBeCloseTo(PINCH_LIFT, 9)
    expect(leafAngle(TURN_S)).toBeCloseTo(OPEN_ANGLE, 9)
    let prev = -1
    for (let t = -0.2; t <= TURN_S + 0.1; t += 0.01) {
      const a = leafAngle(t)
      expect(a).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = a
    }
  })

  it('bends: the outer third lags 25° at mid-turn, straight when flat and when landed; 16 segments; vertices change in place', async () => {
    const { scene } = await loadOffice()
    for (const name of BOOKS) {
      const lf = new LeafBend(scene.getObjectByName(name + '_page')!)
      const pos = firstMesh(lf.node).geometry.getAttribute('position') as unknown as { array: Float32Array; count: number }
      const arr = pos.array
      const n = pos.count
      expect(n).toBe(170)
      expect(lf.phi.length).toBe(16)
      lf.set(OPEN_ANGLE / 2)
      expect(pos.array, 'the vertex array is reused').toBe(arr)
      const deg = (x: number) => (x * 180) / Math.PI
      expect(Math.abs(deg(lf.phi[0])), `${name} inner part`).toBeLessThan(1)
      expect(deg(lf.phi[15]), `${name} outer segment lags 25°`).toBeCloseTo(-25, 0)
      // the outer third: a smooth bend, the lag growing outward
      for (let j = 1; j < 16; j++) expect(lf.phi[j]).toBeLessThanOrEqual(lf.phi[j - 1] + 1e-9)
      expect(lagAt(0.2)).toBe(0)
      // the free outer edge really is lower than a straight leaf would put it (it lags): the corner's height above its straight position
      const straightY = lf.width + 0.003
      const bentX = lf.px[16]
      expect(bentX, `${name} the bent leaf is shorter along x`).toBeLessThan(straightY)
      lf.set(0)
      for (let j = 0; j < 16; j++) expect(Math.abs(lf.phi[j])).toBeLessThan(1e-6)
      lf.set(OPEN_ANGLE)
      for (let j = 0; j < 16; j++) expect(Math.abs(deg(lf.phi[j])), `${name} landed leaf is straight`).toBeLessThan(0.5)
      // the corner frame is where the polyline ends
      const C = lf.corner(new Matrix4(), PINCH_LIFT)
      const ref = cornerOf(PINCH_LIFT, 0.003, lf.width, lf.zEnd)
      for (let q = 0; q < 16; q++) expect(C.elements[q]).toBeCloseTo(ref.elements[q], 4)
    }
  })

  it('bends every mesh under the leaf: the paper and the text lines (both carry _PAGE_U / _PAGE_V); a vertex between two columns lies between their places', async () => {
    const { scene } = await loadOffice()
    const node = scene.getObjectByName('prop_book_page')!
    const meshes: Mesh[] = []
    node.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh)
    })
    expect(meshes.length, 'paper and text lines').toBe(2)
    const lf = new LeafBend(node)
    lf.set(OPEN_ANGLE / 2)
    for (const m of meshes) {
      const pos = m.geometry.getAttribute('position')
      const au = m.geometry.getAttribute('_page_u')
      let moved = 0
      for (let k = 0; k < pos.count; k++) {
        if (Math.abs(pos.getY(k)) > 1e-3) moved++
        // the vertex is on its column's segment of the bent polyline: x between that segment's two ends
        const c0 = Math.min(15, Math.floor(au.getX(k) * 16))
        const lo = Math.min(lf.px[c0], lf.px[c0 + 1])
        const hi = Math.max(lf.px[c0], lf.px[c0 + 1])
        expect(pos.getX(k)).toBeGreaterThan(lo - 1.5e-3)
        expect(pos.getX(k)).toBeLessThan(hi + 1.5e-3)
      }
      expect(moved, `${m.name}: the bend lifted the outer vertices`).toBeGreaterThan(10)
    }
  })
})
