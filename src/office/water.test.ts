/// <reference types="node" />
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { loadOffice } from './glbLoad'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import { stubCanvas } from './glbLoad'
import { WATERED, plantsFrom, WATER_STAND, canPose, headingTo, landing, plantAhead, solvePour, spoutOf, standFor, type Plant } from './water'
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
      const st = p.name === WATERED.name ? WATER_STAND : standFor(p)
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
    expect(found?.stand).toEqual(WATER_STAND)
    expect(found?.face).toEqual({ x: WATERED.x, z: WATERED.z })
  })

  it('in the running stage the stream lands on the soil for each agent\'s own hands', async () => {
    const { scene, nodes } = await loadOffice()
    const props = new PropBank(scene, nodes)
    const rigs = Object.fromEntries([0, 1, 2, 3].map((i) => [`agent_${i}`, new AgentRig(`agent_${i}`, i, buildRig(scene, nodes, i), '#ffffff')]))
    const stage = new PlayStage(scene, nodes, props)
    const st = WATER_STAND
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
