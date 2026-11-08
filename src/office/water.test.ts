/// <reference types="node" />
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { loadOffice } from './glbLoad'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import { stubCanvas } from './glbLoad'
import { WATERED, WATER_PLANTS, plantsFrom, standOf, canPose, headingTo, landing, plantAhead, solvePour, spoutOf, type Plant } from './water'
import { playAt } from './play'

stubCanvas()
const LOG = process.env.FIT_LOG

async function spoutLocal() {
  const { scene, nodes } = await loadOffice()
  scene.updateMatrixWorld(true)
  const can = nodes.prop_watering_can
  return { local: new Matrix4().copy(can.matrixWorld).invert().multiply(nodes.prop_watering_can_spout.matrixWorld), scene, nodes }
}

describe('watering lands on the soil (#184)', () => {
  it('for every plant: standing in front of it, the stream lands inside the soil circle, at the soil height', async () => {
    const { local, scene } = await spoutLocal()
    const plants = plantsFrom(scene)
    for (const p of plants) {
      const st = standOf(p)
      const heading = headingTo(st.x, st.z, p.x, p.z)
      expect(plantAhead(st.x, st.z, heading, 1.6, plants)?.name).toBe(p.name)
      const pour = solvePour(p, st.x, st.z, heading, local)
      // the finished pose, from the tilted can
      const { tip, dir } = spoutOf(canPose(st.x, st.z, heading, pour.hold, 1), local)
      const l = landing(tip, dir, p.soilY)!
      expect(l, p.name).toBeTruthy()
      const d = Math.hypot(l.at.x - p.x, l.at.z - p.z)
      if (LOG) appendFileSync(LOG, 'water ' + p.name + ' landing ' + (d * 1000).toFixed(1) + ' mm from the soil centre (soil r ' + (p.r * 1000).toFixed(0) + ' mm), y ' + l.at.y.toFixed(3) + ' soil ' + p.soilY.toFixed(3) + ', hold fwd ' + pour.hold.fwd.toFixed(2) + ' lat ' + pour.hold.lat.toFixed(2) + ', spout tip ' + (Math.hypot(tip.x - p.x, tip.z - p.z) * 1000).toFixed(0) + ' mm off-centre at ' + tip.y.toFixed(2) + ' m\n')
      expect(d, p.name + ' inside the soil circle').toBeLessThan(p.r)
      expect(l.at.y).toBeCloseTo(p.soilY, 4)
      expect(tip.y, p.name + ' spout above the soil').toBeGreaterThan(p.soilY)
      expect(pour.hold.fwd, p.name + ' within an arm\'s reach').toBeLessThan(0.9)
    }
  })

  it('the schedule stands the watering agent at the spot that works for its plant, facing it', () => {
    let found: ReturnType<typeof playAt>[string] | null = null
    for (let m = 0; m < 4000 && !found; m++) {
      const a = playAt(m * 3, ['agent_0', 'agent_1', 'agent_2', 'agent_3'])
      found = Object.values(a).find((x) => x.kind === 'water') ?? null
    }
    const plant = WATER_PLANTS.find((p) => p.x === found?.face?.x && p.z === found?.face?.z)!
    expect(plant).toBeTruthy()
    expect(found?.stand).toEqual(standOf(plant))
  })

  it('in the running stage the stream lands on the soil for each agent\'s own hands', async () => {
    const { scene, nodes } = await loadOffice()
    const props = new PropBank(scene, nodes)
    const rigs = Object.fromEntries([0, 1, 2, 3].map((i) => [`agent_${i}`, new AgentRig(`agent_${i}`, i, buildRig(scene, nodes, i), '#ffffff')]))
    const stage = new PlayStage(scene, nodes, props)
    const st = standOf(WATERED)
    const heading = headingTo(st.x, st.z, WATERED.x, WATERED.z)
    for (const [id, r] of Object.entries(rigs)) {
      r.at = 'hall_lounge'
      r.x = st.x
      r.z = st.z
      r.heading = heading
      r.parts.root.position.set(st.x, 0, st.z)
      r.parts.root.rotation.set(0, heading, 0)
      r.parts.root.updateMatrixWorld(true)
      const goals = Object.fromEntries(Object.keys(rigs).map((k) => [k, { spot: k === id ? 'hall_lounge' : 'work_0', pose: k === id ? 'water' : 'idle', label: '' }]))
      let worst = 0
      let seen = 0
      for (let k = 0; k < 500; k++) {
        stage.update({ now: 0, t: k * 0.02, dt: 0.02, reduced: false, replaying: false, rigs, goals: goals as never, status: {}, tablet: false, stamp: false, colors: {} })
        props.hold(new Map(Object.values(rigs).map((x) => [x, x.want])))
        props.update(0.02)
        const sp = nodes.prop_watering_can_spout
        if (!sp || !r.want?.attached) continue
        scene.updateMatrixWorld(true)
        const tip = sp.getWorldPosition(new Vector3())
        const dir = new Vector3(0, 0, 1).transformDirection(sp.matrixWorld)
        const l = landing(tip, dir, WATERED.soilY)
        if (!l || k < 75 || k > 100) continue
        worst = Math.max(worst, Math.hypot(l.at.x - WATERED.x, l.at.z - WATERED.z))
        seen++
      }
      expect(seen, id).toBeGreaterThan(0)
      if (LOG) appendFileSync(LOG, 'water in stage ' + id + ' worst landing ' + (worst * 1000).toFixed(1) + ' mm over ' + seen + ' frames\n')
      expect(worst, id).toBeLessThan(WATERED.r)
    }
  })
})
void ({} as Plant)

describe('where the watering agent stands (#184)', () => {
  it('every plant: a walkable stand beside the pot (≤ 0.6 m from its centre), facing it, reachable by the grid planner, and the stream lands in the soil from there', async () => {
    const { local, scene, nodes } = await spoutLocal()
    const { meshesOf } = await import('./nodes')
    const { rasterFootprint } = await import('./floorMask')
    const { buildGrid, cellAt, findPath } = await import('./grid')
    const { GRAPH } = await import('./navSpots.fixture')
    const grid = buildGrid(rasterFootprint(Object.values(nodes).filter((m) => m.userData.atlas).flatMap(meshesOf), 0.05, scene), GRAPH)
    for (const p of PLANTS_FOR_STANDS(scene)) {
      const st = standOf(p)
      const d = Math.hypot(st.x - p.x, st.z - p.z)
      const heading = headingTo(st.x, st.z, p.x, p.z)
      // the bearing from the stand to the pot, against the heading the Director's slot gives (atan2(-dx, -dz))
      const want = Math.atan2(-(p.x - st.x), -(p.z - st.z))
      const err = Math.abs(Math.atan2(Math.sin(heading - want), Math.cos(heading - want))) * (180 / Math.PI)
      const c = cellAt(grid, st.x, st.z)
      expect(c, p.name + ' on the grid').toBeGreaterThanOrEqual(0)
      expect(grid.blocked[c], p.name + ' stand is walkable').toBeFalsy()
      expect(findPath(grid, { x: -1, z: -0.6 }, st), p.name + ' reachable').toBeTruthy()
      const pour = solvePour(p, st.x, st.z, heading, local)
      expect(pour.err, p.name + ' stream lands on the soil centre').toBeLessThan(p.r)
      if (LOG) appendFileSync(LOG, 'water stand ' + p.name + ': ' + (d * 1000).toFixed(0) + ' mm from the pot centre, facing error ' + err.toFixed(1) + ' deg, landing ' + (pour.err * 1000).toFixed(1) + ' mm from the soil centre\n')
      expect(d, p.name + ' close to the pot').toBeLessThanOrEqual(0.6)
      expect(err, p.name + ' faces the pot').toBeLessThanOrEqual(20)
    }
  }, 60000)
})

const PLANTS_FOR_STANDS = (scene: Parameters<typeof plantsFrom>[0]) => plantsFrom(scene).filter((p) => p.name in STANDS_KEYS)
const STANDS_KEYS: Record<string, true> = { plant_corner: true, plant_sofa: true, plant_desk: true, succulent: true }
