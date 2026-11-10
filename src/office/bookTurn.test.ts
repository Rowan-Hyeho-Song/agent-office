/// <reference types="node" />
// A page turn on the stage (#231): one leaf turns about the spine (0 → 150°), bent, held at its corner by the right thumb and index; the halves
// stay at their open angle (150° between them: lower +15°, upper π − 15°) after the book has opened. Headless: PlayStage on the baked model, a reader at the book.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Vector3, type Mesh } from 'three'
import { stubCanvas } from './glbLoad'
import { IDS, world, type World } from './errandWorld.fixture'
import { SPOTS } from './navSpots.fixture'
import { PLAYS } from './play'
import { TURN_S } from './bookLeaf'
import { LIFT, OPEN_ANGLE, halfAngle } from './bookGeom'
import type { Goal } from './director'

stubCanvas()
const LOG = process.env.FIT_LOG
const books = PLAYS.find((p) => p.kind === 'books')!
const slot = (() => {
  const f = books.face!
  return { x: books.stand!.x, z: books.stand!.z, ry: Math.atan2(-(f.x - books.stand!.x), -(f.z - books.stand!.z)) }
})()
const goal: Goal = { spot: 'shelf', pose: 'books', face: books.face, slot, label: '' }
void SPOTS

interface Frame {
  t: number
  lz: number
  rz: number
  /** the leaf's angle on top of the lower half's lift (φ) */
  th: number
  vis: boolean
  corner: Vector3 | null
  thumb: Vector3
  index: Vector3
}

/** run a reader for `secs`; sample every frame */
function run(w: World, secs: number, reduced = false, gestureMin = 0): Frame[] {
  const rig = w.rigs.agent_0
  rig.at = goal.spot
  rig.x = slot.x
  rig.z = slot.z
  rig.heading = slot.ry
  rig.gestureMin = gestureMin
  rig.parts.root.position.set(slot.x, 0, slot.z)
  rig.parts.root.rotation.set(0, slot.ry, 0)
  rig.parts.root.updateMatrixWorld(true)
  const idle: Goal = { spot: 'work_1', pose: 'idle', label: '' }
  const goals = Object.fromEntries(IDS.map((id) => [id, id === 'agent_0' ? goal : idle]))
  const page = w.nodes.prop_book_page
  const l = w.nodes.prop_book_l
  const r = w.nodes.prop_book_r
  // the page node is a pivot with the paper mesh (and the text lines' mesh) under it
  let paper: Mesh | null = null
  page.traverse((o) => {
    if (!paper && (o as Mesh).isMesh) paper = o as Mesh
  })
  const geo = (paper as unknown as Mesh).geometry as unknown as { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } }
  const pos = geo.getAttribute('position')
  const au = geo.getAttribute('_page_u')
  const av = geo.getAttribute('_page_v')
  const nor = geo.getAttribute('normal')
  let corner = -1
  for (let i = 0; i < pos.count; i++) if (au.getX(i) > 0.999 && av.getX(i) > 0.999 && nor.getY(i) > 0) corner = i
  const out: Frame[] = []
  const dt = 0.02
  for (let k = 0; k * dt < secs; k++) {
    const t = k * dt
    w.stage.update({ now: 0, t, dt, reduced, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {} })
    w.props.hold(new Map(Object.values(w.rigs).map((x) => [x, x.want])))
    w.props.update(dt)
    w.scene.updateMatrixWorld(true)
    const h = rig.parts.hands.r
    const tip = (f: 'thumb' | 0) => {
      const j = f === 'thumb' ? h.thumb[2]!.node : h.fingers[0][2]!.node
      j.updateWorldMatrix(true, false)
      return (f === 'thumb' ? h.thumbTip! : h.tips[0]!).clone().applyMatrix4(j.matrixWorld)
    }
    out.push({
      t,
      lz: l.rotation.z,
      rz: r.rotation.z,
      th: page.rotation.z - LIFT,
      vis: page.visible,
      corner: corner >= 0 ? (paper as unknown as Mesh).localToWorld(new Vector3(pos.getX(corner), pos.getY(corner), pos.getZ(corner))) : null,
      thumb: tip('thumb'),
      index: tip(0),
    })
  }
  return out
}

describe('one leaf turns', () => {
  it('the halves stay at 150° after the opening; the leaf shows only while it turns, 0 → 150° without going back, in the turn time', async () => {
    const w = await world()
    const f = run(w, 14)
    // both halves open once (monotonic to their open angle: the lower one is lifted by LIFT, the upper one at π − LIFT) and stay
    for (let i = 1; i < f.length; i++) {
      expect(f[i].lz).toBeGreaterThanOrEqual(f[i - 1].lz - 1e-9)
      expect(f[i].rz).toBeGreaterThanOrEqual(f[i - 1].rz - 1e-9)
    }
    expect(f[f.length - 1].lz).toBeCloseTo(halfAngle('l'), 6)
    expect(f[f.length - 1].rz).toBeCloseTo(halfAngle('r'), 6)
    expect(f[f.length - 1].lz - f[f.length - 1].rz, 'the angle between the two halves').toBeCloseTo(OPEN_ANGLE, 6)
    // the leaf: visible only in runs of frames (its turns); within one run the angle never goes down; a run reaches 135° at least
    const runs: Frame[][] = []
    for (const x of f) {
      if (x.vis) {
        if (!runs.length || runs[runs.length - 1][runs[runs.length - 1].length - 1] !== f[f.indexOf(x) - 1]) runs.push([])
        runs[runs.length - 1].push(x)
      }
    }
    expect(runs.length, 'at least two turns in 14 s (one every 6 s)').toBeGreaterThanOrEqual(2)
    for (const run of runs) {
      for (let i = 1; i < run.length; i++) expect(run[i].th).toBeGreaterThanOrEqual(run[i - 1].th - 1e-9)
      expect(run[run.length - 1].th).toBeGreaterThan(OPEN_ANGLE * 0.9)
      // the leaf is on show for about the turn plus the lift before it
      const shown = run[run.length - 1].t - run[0].t
      expect(shown).toBeGreaterThan(TURN_S * 0.6)
      expect(shown).toBeLessThan(TURN_S + 0.5)
    }
    if (LOG) appendFileSync(LOG, `turn on stage: ${runs.length} turns in 14 s, each on show ${runs.map((r) => (r[r.length - 1].t - r[0].t).toFixed(2)).join(' / ')} s\n`)
  }, 120000)

  it('the thumb and index follow the leaf corner while it turns', async () => {
    const w = await world()
    const f = run(w, 9)
    let n = 0
    let worstThumb = 0
    let worstIndex = 0
    for (const x of f) {
      if (!x.vis || !x.corner || x.th < 0.3 || x.th > 1.3) continue // from ~17° to ~75°: the hand holds the corner
      n++
      // the pads are 12 mm in from the edge and from the end (the bake's page contacts): about 17 mm from the corner point
      worstThumb = Math.max(worstThumb, Math.abs(x.thumb.distanceTo(x.corner) - 0.017))
      worstIndex = Math.max(worstIndex, Math.abs(x.index.distanceTo(x.corner) - 0.017))
    }
    if (LOG) appendFileSync(LOG, `turn on stage: ${n} frames holding the corner, thumb pad ${(worstThumb * 1000).toFixed(1)} mm and index pad ${(worstIndex * 1000).toFixed(1)} mm off their place at the corner (worst)\n`)
    expect(n).toBeGreaterThan(10)
    expect(worstThumb).toBeLessThan(0.006)
    expect(worstIndex).toBeLessThan(0.006)
  }, 120000)

  it('reduced motion: the book opens at once, no leaf turns, nothing moves in the halves', async () => {
    const w = await world()
    const f = run(w, 9, true)
    expect(f.every((x) => !x.vis)).toBe(true)
    expect(f[f.length - 1].rz).toBeCloseTo(halfAngle('r'), 6)
    expect(f[f.length - 1].lz).toBeCloseTo(halfAngle('l'), 6)
  }, 120000)

  it('a timelapse (gestureMin 0.8 s) turns it in at least that long', async () => {
    const w = await world()
    const f = run(w, 20, false, 0.8)
    const shown = f.filter((x) => x.vis)
    expect(shown.length).toBeGreaterThan(0)
    const first = shown[0].t
    const last = shown[shown.length - 1].t
    // the first turn: from the first sighting (the corner lifting) to the landing, at least gestureMin for the lift and again for the turn
    const firstRun = shown.filter((x) => x.t < first + 3)
    expect(firstRun[firstRun.length - 1].t - firstRun[0].t).toBeGreaterThanOrEqual(0.8 * 2 - 0.1)
    expect(last).toBeGreaterThan(first)
  }, 120000)
})
