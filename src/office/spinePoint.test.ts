/// <reference types="node" />
// #718 ②-b (play.md 9.7 둘러보기, 3D #730): looking over the second bookshelf's spines, row by row, the right index pointing at one every 20 s. The rows
// are the `spines_row_<k>` empties of the baked model; on the stage the fingertip comes to the spine it points at (5 cm off its face), never into the shelf.
import { Vector3, type Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import { Walk, world } from './errandWorld.fixture'
import { loadOffice } from './glbLoad'
import { SPINES } from './play'
import type { AgentRig } from './rig'
import { SPINE_FACE_Z, SPINE_POINT, SPINE_ROWS, SPINE_SWEEP, spineAt, spineLook, spinePoint } from './shelfRun'

const DT = 1 / 60

describe('the spines rows (#718, 3D #730)', () => {
  it('SPINE_ROWS are the baked spines_row_<k> empties: height, centre, width, gaps; the face z', async () => {
    const { nodes } = await loadOffice()
    SPINE_ROWS.forEach((r, k) => {
      const o = (nodes as Record<string, Object3D>)[`spines_row_${k}`]
      expect(o, `spines_row_${k}`).toBeDefined()
      o.updateWorldMatrix(true, false)
      const p = o.getWorldPosition(new Vector3())
      expect(p.y).toBeCloseTo(r.y, 3)
      expect(p.x).toBeCloseTo(r.cx, 3)
      expect(p.z).toBeCloseTo(SPINE_FACE_Z, 3)
      expect(o.userData.w).toBeCloseTo(r.w, 3)
      expect(o.userData.gaps).toEqual(r.gaps)
    })
  })

  it('the gaze runs a row from its left end to its right end, top to bottom; the eye looks at it within the head reach', () => {
    const r0 = SPINE_ROWS[0]
    expect(spineAt(0)).toMatchObject({ row: 0, x: r0.cx - r0.w / 2, y: r0.y })
    const end = spineAt(SPINE_SWEEP.rowS - SPINE_SWEEP.backS - 1e-6)
    expect(end.x).toBeCloseTo(r0.cx + r0.w / 2, 4)
    expect(spineAt(SPINE_SWEEP.rowS).row).toBe(1)
    const eye = { x: SPINES.stand.x, z: SPINES.stand.z, y: 1.2, heading: 0 }
    // the left end is to the left (+yaw), the head never past its reach
    const h = spineLook(SPINE_SWEEP.rowS, false, eye)
    expect(h.yaw).toBeGreaterThan(0)
    expect(Math.abs(h.yaw)).toBeLessThanOrEqual(1.2)
    expect(h.pitch).toBeGreaterThanOrEqual(-0.6)
    expect(h.pitch).toBeLessThanOrEqual(0.3)
  })

  it('pointing: every everyS s for holdS, at the middle two rows, never in a pot\'s stretch; none with reduced motion', () => {
    for (let k = 0; k < 12; k++) {
      const t0 = SPINE_POINT.firstS + k * SPINE_POINT.everyS
      expect(spinePoint(t0 - 0.5, false)).toBeNull()
      const p = spinePoint(t0 + 0.5, false)!
      expect(p).not.toBeNull()
      expect(spinePoint(t0 + SPINE_POINT.holdS + 0.1, false)).toBeNull()
      const row = SPINE_ROWS.findIndex((r) => Math.abs(r.y - p.y) < 1e-6)
      expect(SPINE_POINT.rows).toContain(row)
      const dx = p.x - SPINE_ROWS[row].cx
      for (const [a, b] of SPINE_ROWS[row].gaps) expect(dx <= a || dx >= b, `${dx} in a gap`).toBe(true)
      expect(Math.abs(dx)).toBeLessThanOrEqual(SPINE_ROWS[row].w / 2)
      expect(spinePoint(t0 + 0.5, true)).toBeNull()
    }
  })
})

const tipWorld = (rig: AgentRig) => {
  const h = rig.parts.hands.r
  const j = h.fingers[0][2]!.node
  j.updateWorldMatrix(true, false)
  return h.tips[0]!.clone().applyMatrix4(j.matrixWorld)
}

describe('pointing at a spine on the stage (#718)', () => {
  it('at the spines: the index fingertip comes to the spine pointed at (within 3 cm), and never past the shelf face', async () => {
    const w = await world()
    const walk = new Walk(w, Date.UTC(2026, 10, 9, 1, 0, 0))
    const goals = walk.director.goals.bind(walk.director)
    let go = false
    walk.director.goals = ((...a: Parameters<typeof goals>) => {
      const g = goals(...a)
      const desks = Object.fromEntries([0, 1, 2, 3].map((k) => [`agent_${k}`, { spot: `work_${k}`, pose: 'idle', label: '' }]))
      return go ? { ...g, ...desks, agent_4: { spot: SPINES.spot, pose: 'idle', gap: 'spines', browse: true, face: SPINES.face, slot: { ...SPINES.stand, ry: 0 }, label: '' } } : g
    }) as typeof walk.director.goals
    for (let k = 0; k < 120; k++) walk.step(DT)
    go = true
    const rig = w.rigs.agent_4
    let arrived = -1
    let nearest = Infinity
    let deepest = -Infinity
    for (let k = 0; k < 60 / DT; k++) {
      walk.step(DT)
      if (rig.arrived === SPINES.spot && arrived < 0) arrived = walk.t
      if (arrived < 0) continue
      const u = walk.t - arrived
      const p = spinePoint(u, false)
      const tip = tipWorld(rig)
      deepest = Math.max(deepest, -(tip.z - SPINE_FACE_Z))
      if (p && u - (SPINE_POINT.firstS + Math.floor((u - SPINE_POINT.firstS) / SPINE_POINT.everyS) * SPINE_POINT.everyS) > 0.8) nearest = Math.min(nearest, tip.distanceTo(new Vector3(p.x, p.y, p.z)))
      if (u > SPINE_POINT.firstS + SPINE_POINT.everyS + SPINE_POINT.holdS) break
    }
    expect(arrived, 'at the spines').toBeGreaterThan(0)
    expect(nearest, 'the fingertip at the spine pointed at').toBeLessThanOrEqual(0.03)
    expect(deepest, 'never into the shelf').toBeLessThanOrEqual(0)
  }, 120_000)
})
