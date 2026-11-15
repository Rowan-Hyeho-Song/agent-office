/// <reference types="node" />
// #532 (docs/design/wrapup.md 9.5): the bundle held in the hand while writing, on the baked model. On every desk (0–4, 휴 too), in every piece and line,
// the cards, both hands and the pen stay over the desk and its things: every point at least 3 cm above what is under it (a ray straight down onto the
// desk and the things baked on it: nothing goes into them). While writing the pen's tip is on the front card (a line, a strike: within 1 mm; lifted at
// most the beat's own lift), inside it; the pen at 50° to it; the two hands 1 cm apart; the palm 3 mm behind the last card; the bundle is the cards of
// this sitting. Numbers are appended to FIT_LOG when set (the PR's table).
import { appendFileSync } from 'node:fs'
import { Matrix4, Raycaster, Vector3, type Mesh, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { Goal } from './director'
import { loadOffice, stubCanvas } from './glbLoad'
import { GRAPH } from './navSpots.fixture'
import { AgentRig, buildRig } from './rig'
import { HELD, PEN, WRITE_CARD } from './wrapPose'
import { WriteDesk } from './writeDesk'

const ctx: Record<string, unknown> = new Proxy({ fillStyle: '' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k: string, v) => ((t[k] = v), true) })
;(globalThis as { document?: unknown }).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
stubCanvas()
const DT = 1 / 60
const LOG = process.env.FIT_LOG

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
  // the desk and everything baked on it (what the cards, the hands and the pen must stay over)
  const things = scene.children.filter((o) => o.name === `desk_${seat}` || o.name.startsWith(`desk_${seat}_`))
  return { rig, desk, spot, step, scene, things }
}

const beat = (spot: string, kind: string, u: number, k: number, v = 0, n = 4, wait?: number, reread?: boolean) =>
  ({ spot, pose: 'write', label: '', wrapStep: 'write', ...(reread ? { reread } : {}), beat: { kind, u, k, v, n, ...(wait !== undefined ? { wait } : {}) } }) as unknown as Goal

/** every vertex of the visible meshes under `o`, in world */
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

/** the palm block's vertices only (the hand's own meshes, not its fingers' chains) */
function palmPoints(hand: Object3D): Vector3[] {
  const own = new RegExp(`^${hand.name}_\\d+$`)
  return hand.children.filter((c) => (c as Mesh).isMesh && own.test(c.name)).flatMap((m) => points(m))
}

/** how far `p` is above the desk or the thing under it (a ray straight down from above everything), or null over nothing of the desk */
const ray = new Raycaster()
function above(things: Object3D[], p: Vector3): number | null {
  ray.set(new Vector3(p.x, 2, p.z), new Vector3(0, -1, 0))
  ray.far = 2
  const hit = ray.intersectObjects(things, true)[0]
  return hit ? p.y - hit.point.y : null
}

/** the closest two point sets come */
function gap(a: Vector3[], b: Vector3[]): number {
  let best = Infinity
  for (const p of a) for (const q of b) best = Math.min(best, p.distanceToSquared(q))
  return Math.sqrt(best)
}

/** every piece of the writing, each swept through (k: the card on the front) */
const PIECES: { kind: string; k: number; v?: number; wait?: number; reread?: boolean }[] = [
  { kind: 'line', k: 0, v: 0 },
  { kind: 'line', k: 0, v: 4 },
  { kind: 'newline', k: 0, v: 2 },
  { kind: 'tapPen', k: 0, v: 3 },
  { kind: 'strike', k: 0, v: 3 },
  { kind: 'readUp', k: 1, v: 2 },
  { kind: 'next', k: 1, v: 4 },
  { kind: 'line', k: 2, v: 1 },
  // #532 waiting at the desk for the board, rereading after the last card: at 25 s the held cards are lowered and laid back (every piece of the
  // reread loop), and in the reread the back card comes over the top to the front
  { kind: 'line', k: 3, v: 1, wait: 25, reread: true },
  { kind: 'newline', k: 3, v: 2, wait: 25, reread: true },
  { kind: 'tapPen', k: 3, v: 3, wait: 25, reread: true },
  { kind: 'strike', k: 3, v: 3, wait: 25, reread: true },
  { kind: 'readUp', k: 3, v: 0, wait: 25, reread: true },
  { kind: 'readUp', k: 3, v: 0, wait: 0, reread: true },
  { kind: 'collect', k: 3, v: 0 },
]

describe('the bundle held in the hand while writing (#532, wrapup.md 9.5)', () => {
  for (const seat of [0, 1, 2, 3, 4]) {
    it(`desk ${seat}: the cards, both hands and the pen at least 3 cm over the desk and its things in every piece; the bundle is the sitting's cards`, async () => {
      const w = await writer(seat)
      for (let k = 0; k < 40; k++) w.step(beat(w.spot.id, 'line', 0, 0))
      let low = Infinity
      let where = ''
      for (const p of PIECES)
        for (let i = 0; i <= 24; i++) {
          w.step(beat(w.spot.id, p.kind, i / 24, p.k, p.v, 4, p.wait, p.reread))
          const s = w.desk.state(w.rig.id)!
          if (p.kind !== 'collect') expect(s.cards, `${p.kind}: the bundle`).toBe(4)
          const pts = [...s.cardGroups.flatMap(points), ...points(w.rig.parts.hands.l.node), ...points(w.rig.parts.hands.r.node), ...(s.pen ? points(s.pen) : [])]
          // the lowest point in each 5 mm column (a ray per column: what is under it is the same within it)
          const cols = new Map<string, Vector3>()
          for (const q of pts) {
            const key = `${Math.round(q.x / 0.005)}:${Math.round(q.z / 0.005)}`
            const c = cols.get(key)
            if (!c || q.y < c.y) cols.set(key, q)
          }
          for (const q of cols.values()) {
            const h = above(w.things, q)
            if (h !== null && h < low) {
              low = h
              where = `${p.kind}${p.wait ? ` wait ${p.wait}` : ''}${p.reread ? ' reread' : ''} u ${(i / 24).toFixed(2)}`
            }
          }
        }
      if (LOG) appendFileSync(LOG, `desk ${seat}: lowest over the desk ${(low * 100).toFixed(1)} cm (${where})\n`)
      expect(low, `lowest point over the desk (${where})`).toBeGreaterThanOrEqual(0.03)
    }, 60_000)
  }
})

describe('the pen on the held card (#532, wrapup.md 9.2 · 9.3)', () => {
  for (const seat of [0, 2, 4]) {
    it(`desk ${seat}: the tip on the front card (a line, a strike: within 1 mm; a new line 1 cm, a tap 1.6 cm), inside it; the pen at 50° to it; the hands 1 cm apart; the palm 3 mm behind the last card`, async () => {
      const w = await writer(seat)
      for (let k = 0; k < 40; k++) w.step(beat(w.spot.id, 'line', 0, 0, 2))
      const lifts: Record<string, number> = { line: 0.001, strike: 0.001, newline: 0.0105, tapPen: 0.0165 }
      let handsGap = Infinity
      let palm = { lo: Infinity, hi: -Infinity }
      let penFingers = Infinity
      let holdFingers = -Infinity
      for (const kind of [...Object.keys(lifts), 'next'])
        for (let i = 0; i <= 30; i++) {
          w.step(beat(w.spot.id, kind, i / 30, 1, 2))
          const s = w.desk.state(w.rig.id)!
          expect(s.tip, 'the pen in the hand').not.toBeNull()
          const inv = new Matrix4().copy(s.front!).invert()
          const l = s.tip!.clone().applyMatrix4(inv)
          if (kind !== 'next') {
            expect(l.y, `${kind}: tip above the card`).toBeLessThanOrEqual(lifts[kind])
            expect(l.y, `${kind}: tip not through the card`).toBeGreaterThanOrEqual(-0.0005)
            expect(Math.abs(l.x), `${kind}: across`).toBeLessThan(WRITE_CARD.w / 2)
            expect(Math.abs(l.z), `${kind}: along`).toBeLessThan(WRITE_CARD.d / 2)
            // 50° to the card's face
            const axis = s.grip!.clone().sub(s.tip!).applyMatrix4(new Matrix4().extractRotation(inv)).normalize()
            expect(Math.asin(axis.y) * (180 / Math.PI), `${kind}: the pen's angle`).toBeCloseTo(PEN.elevDeg, 0)
            // the palm behind the bundle: its nearest point (inside the card's outline) 3 mm behind the last card's back
            const back = -4 * HELD.step
            const inCard = (c: Vector3) => Math.abs(c.x) <= WRITE_CARD.w / 2 && Math.abs(c.z) <= WRITE_CARD.d / 2
            for (const q of palmPoints(w.rig.parts.hands.l.node)) {
              const c = q.applyMatrix4(inv)
              if (inCard(c)) palm = { lo: Math.min(palm.lo, back - c.y), hi: Math.max(palm.hi, c.y) }
            }
            // #532 (designer): no finger through the cards: the pen hand's 2 mm or more in front of the face, the holding hand's fingers behind the back
            // (its thumb comes round the foot, wrapup.md 9.1)
            for (const q of points(w.rig.parts.hands.r.node)) {
              const c = q.applyMatrix4(inv)
              if (inCard(c)) penFingers = Math.min(penFingers, c.y)
            }
            w.rig.parts.hands.l.node.traverseVisible((m) => {
              if (!(m as Mesh).isMesh || /_t_\d/.test(m.name) || new RegExp(`^${w.rig.parts.hands.l.node.name}_\\d+$`).test(m.name)) return
              for (const q of points(m)) {
                const c = q.applyMatrix4(inv)
                if (inCard(c)) holdFingers = Math.max(holdFingers, c.y - back)
              }
            })
          }
          handsGap = Math.min(handsGap, gap(points(w.rig.parts.hands.l.node), points(w.rig.parts.hands.r.node)))
        }
      if (LOG) appendFileSync(LOG, `desk ${seat}: hands ${(handsGap * 100).toFixed(1)} cm apart; palm nearest the bundle's back ${(palm.lo * 1000).toFixed(1)} mm behind it; pen hand ${(penFingers * 1000).toFixed(1)} mm off the face; holding fingers ${(-holdFingers * 1000).toFixed(1)} mm behind the back\n`)
      expect(handsGap, 'the two hands 1 cm apart').toBeGreaterThanOrEqual(0.01)
      expect(penFingers, "the pen hand's fingers off the card").toBeGreaterThanOrEqual(0.002)
      expect(holdFingers, "the holding hand's fingers behind the bundle").toBeLessThanOrEqual(0)
      expect(palm.lo, "the palm's nearest point behind the bundle").toBeGreaterThanOrEqual(HELD.palmGap - 0.0015)
      expect(palm.lo, "the palm's nearest point behind the bundle").toBeLessThanOrEqual(HELD.palmGap + 0.0015)
    }, 60_000)
  }
})

describe('turning a card over, reading, finishing (#532, wrapup.md 9.4)', () => {
  it("'next' takes the written card over the top to the back: it is never drawn through the bundle, and the bundle is the same cards after", async () => {
    const w = await writer(1)
    for (let k = 0; k < 40; k++) w.step(beat(w.spot.id, 'line', 1, 1, 4))
    for (let i = 0; i <= 36; i++) {
      w.step(beat(w.spot.id, 'next', i / 36, 1, 4))
      const s = w.desk.state(w.rig.id)!
      expect(s.cards, 'the bundle stays four cards').toBe(4)
      // the card going over: none of its corners behind the front card's face while it is still above the bundle's top edge... and when it comes down behind, behind the last card
      const inv = new Matrix4().copy(s.front!).invert()
      for (const g of s.cardGroups) {
        for (const c of points(g).map((p) => p.applyMatrix4(inv))) {
          const inOutline = Math.abs(c.x) < WRITE_CARD.w / 2 - 0.001 && c.z > -WRITE_CARD.d / 2 + 0.001 && c.z < WRITE_CARD.d / 2 - 0.001
          // inside the bundle's outline a card is either in the bundle (in its depth) or in front of the face, never cut through it at an angle
          if (inOutline) expect(c.y > 0.0005 || c.y < -4 * HELD.step - 0.0015 || c.y >= -5 * HELD.step - 0.0001, 'no card through the bundle').toBe(true)
        }
      }
    }
  })

  it('reading lifts the bundle before the face and brings it back; finishing ends with the bundle gone to the carrying hold and the pen gone', async () => {
    const w = await writer(3)
    for (let k = 0; k < 40; k++) w.step(beat(w.spot.id, 'line', 0.5, 1, 2))
    const at = (s: ReturnType<WriteDesk['state']>) => new Vector3().setFromMatrixPosition(s!.front!)
    const head = () => w.rig.parts.head.getWorldPosition(new Vector3())
    const base = at(w.desk.state(w.rig.id))
    let nearest = Infinity
    for (let i = 0; i <= 30; i++) {
      w.step(beat(w.spot.id, 'readUp', i / 30, 1, 2))
      nearest = Math.min(nearest, at(w.desk.state(w.rig.id)).distanceTo(head()))
    }
    expect(nearest, 'up before the face').toBeLessThan(base.distanceTo(head()) - 0.04)
    w.step(beat(w.spot.id, 'line', 0, 1, 3))
    expect(at(w.desk.state(w.rig.id)).distanceTo(base), 'back where it was').toBeLessThan(0.005)
    for (let i = 0; i <= 24; i++) w.step(beat(w.spot.id, 'collect', i / 24, 3, 0))
    const s = w.desk.state(w.rig.id)!
    expect(s.cards, 'the bundle gone to the carrying hold').toBe(0)
    expect(s.pen, 'the pen gone').toBeNull()
  })
})

describe('rereading after the last card (#532, wrapup.md 9.4)', () => {
  it('the back-most written card comes over the top to the front, is read on top, and goes back; the bundle stays the same cards', async () => {
    const w = await writer(2)
    const reread = (u: number) => ({ spot: w.spot.id, pose: 'write', label: '', wrapStep: 'write', reread: true, beat: { kind: 'readUp', u, k: 3, v: 0, n: 4 } }) as unknown as Goal
    for (let k = 0; k < 40; k++) w.step(beat(w.spot.id, 'line', 1, 3, 4))
    let onTop = 0
    for (let i = 0; i <= 60; i++) {
      w.step(reread(i / 60))
      const s = w.desk.state(w.rig.id)!
      expect(s.cards, 'the bundle').toBe(4)
      const inv = new Matrix4().copy(s.front!).invert()
      // a card laid on the front card's face (read on top of it)
      if (s.cardGroups.some((g) => Math.abs(g.position.clone().applyMatrix4(inv).y - 0.0005) < 0.0002)) onTop++
    }
    // most of the 1.8 s (all but 0.3 s each way) on top
    expect(onTop).toBeGreaterThan(30)
    // at the end it is back: nothing on top
    w.step(beat(w.spot.id, 'line', 0, 3, 0))
    const s = w.desk.state(w.rig.id)!
    const inv = new Matrix4().copy(s.front!).invert()
    expect(s.cardGroups.some((g) => g.position.clone().applyMatrix4(inv).y > 0.0002)).toBe(false)
  }, 60_000)

  it('with reduced motion no card comes over: the bundle is read as it is', async () => {
    const w = await writer(2)
    const reread = (u: number) => ({ spot: w.spot.id, pose: 'write', label: '', wrapStep: 'write', reread: true, beat: { kind: 'readUp', u, k: 3, v: 0, n: 4 } }) as unknown as Goal
    for (let k = 0; k < 40; k++) w.step(beat(w.spot.id, 'line', 1, 3, 4), true)
    for (let i = 0; i <= 60; i++) {
      w.step(reread(i / 60), true)
      const s = w.desk.state(w.rig.id)!
      expect(s.cards, 'the bundle').toBe(4)
      const inv = new Matrix4().copy(s.front!).invert()
      expect(s.cardGroups.some((g) => g.position.clone().applyMatrix4(inv).y > 0.0002), `nothing over the front card at u ${(i / 60).toFixed(2)}`).toBe(false)
    }
  }, 60_000)
})
