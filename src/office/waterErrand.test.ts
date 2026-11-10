/// <reference types="node" />
// The watering can is an errand (#228): walk to where it rests, take hold of it and lift, carry it to the plant, pour, carry it back, put it
// down exactly where it was and let go. Headless: Director + TrafficPlanner + rigs + PlayStage on the baked model, driven like Agents.tsx.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, REACH, Walk, runErrand, world } from './errandWorld.fixture'
import { CAN_HOME, STANDS, WATER_PLANTS, canStand } from './water'
import { WATER_S } from './waterRun'

stubCanvas()
const LOG = process.env.FIT_LOG
const DT = 0.03
const AGENT = 'agent_1'

async function errand(plant: string, agent = AGENT, reduced = false) {
  const w = await world()
  const guard = new Guard(w)
  const r = runErrand(w, agent, plant, guard, { dt: DT, reduced })
  return { w, guard, ...r }
}

describe('watering is an errand: take the can from where it rests, bring it back and put it down (#228)', () => {
  for (const plant of WATER_PLANTS) {
    it(`${plant.name}: fetch, lift, carry, pour, return, put — the hand takes the can where it rests and the body is beside it, nothing flies`, async () => {
      const { w, guard, stages, at, ended } = await errand(plant.name)
      const s = guard.stats
      expect(stages).toEqual(['fetch', 'lift', 'carry', 'pour', 'return', 'put'])
      expect(ended, 'the errand ends').toBeGreaterThan(0)
      // the can's stand is beside the can (arm's reach), the plant's stand beside the plant
      const c = canStand()
      expect(Math.hypot(c.x - CAN_HOME.x, c.z - CAN_HOME.z), 'can stand beside the can').toBeLessThanOrEqual(REACH)
      expect(Math.hypot(at.lift.x - c.x, at.lift.z - c.z), 'it lifts at the can stand').toBeLessThan(0.15)
      const p = STANDS[plant.name]
      expect(Math.hypot(at.pour.x - p.x, at.pour.z - p.z), 'it pours at the plant stand').toBeLessThan(0.15)
      expect(Math.hypot(at.put.x - c.x, at.put.z - c.z), 'it puts the can down at the can stand').toBeLessThan(0.15)
      // the fig: the can rests on its stand in front of it (#259, watering.md 1.1), so lifting, pouring and putting back happen without a step
      if (plant.name === 'plant_corner')
        for (const k of ['pour', 'put'] as const) expect(Math.hypot(at[k].x - at.lift.x, at[k].z - at.lift.z), `fig: ${k} where it lifted, no walk`).toBeLessThan(0.1)
      // exactly one grasp and one release, of the can, no move at either, the whole time within the body's reach
      expect(s.byProp, 'only the can was taken').toEqual({ prop_watering_can: 1 })
      expect(s.grasps).toBe(1)
      expect(s.releases).toBe(1)
      expect(s.graspJump, 'the can does not jump when the hand takes it').toBeLessThanOrEqual(0.005)
      expect(s.releaseJump, 'the can does not jump when the hand lets go').toBeLessThanOrEqual(0.005)
      expect(s.graspReach, 'taken within reach of the body').toBeLessThanOrEqual(REACH)
      expect(s.releaseReach, 'put down within reach of the body').toBeLessThanOrEqual(REACH)
      expect(s.heldReach, 'within reach of the body every frame it is held').toBeLessThanOrEqual(REACH)
      expect(s.loose, 'loose frames away from where it rests').toBe(0)
      // down where it came from
      const can = w.nodes.prop_watering_can
      const home = w.props.homeWorld(can).decompose(new Vector3(), new Quaternion(), new Vector3())
      void home
      expect(can.position.distanceTo(new Vector3(CAN_HOME.x, CAN_HOME.y, CAN_HOME.z)), 'back exactly where it rests').toBeLessThan(0.001)
      if (LOG)
        appendFileSync(
          LOG,
          `water errand ${plant.name}: ${ended.toFixed(1)} s; stages ${Object.entries(at).map(([k, v]) => `${k}@${v.t.toFixed(1)}s`).join(' ')}; held ${s.heldFrames} frames; grasp jump ${(s.graspJump * 1000).toFixed(2)} mm, release jump ${(s.releaseJump * 1000).toFixed(2)} mm; reach at grasp ${s.graspReach.toFixed(3)} m, at release ${s.releaseReach.toFixed(3)} m, worst held ${s.heldReach.toFixed(3)} m (limit ${REACH}); loose frames ${s.loose}\n`,
        )
    }, 60000)
  }

  it('reduced motion: nobody walks, the can is in the hand while it pours and gone from it after, back where it rests (watering.md 5)', async () => {
    const { guard, stages } = await errand(WATER_PLANTS[0].name, AGENT, true)
    expect(stages).toEqual(['carry', 'pour', 'put'])
    expect(guard.stats.loose, 'no loose frames away from rest').toBe(0)
  }, 60000)

  it('one can: a second agent assigned to water waits at its desk until the first has put it down', async () => {
    const w = await world()
    const walk = new Walk(w)
    const guard = new Guard(w)
    for (let k = 0; k < 10; k++) walk.step(DT, guard)
    walk.director.forceWater('agent_0', WATER_PLANTS[0].name, walk.t0 + walk.t * 1000)
    let holders = 0
    let worst = 0
    for (let k = 0; k < 3000; k++) {
      walk.step(DT, guard)
      // the schedule may assign water to others meanwhile: never two on the can
      const stage = IDS.filter((a) => walk.goals[a].water)
      worst = Math.max(worst, stage.length)
      holders = Math.max(holders, IDS.filter((a) => w.rigs[a].want?.attached && w.rigs[a].want?.kind === 'watering_can').length)
    }
    expect(worst).toBeLessThanOrEqual(1)
    expect(holders).toBeLessThanOrEqual(1)
    expect(guard.stats.loose).toBe(0)
  }, 60000)

  it('the errand has a time: fetch, lift and put last as long as waterRun.ts says (the hand needs the lift time)', () => {
    expect(WATER_S.lift).toBeGreaterThanOrEqual(0.3 + 0.12 + 0.35)
    expect(WATER_S.put).toBeGreaterThanOrEqual(WATER_S.lower + 0.3)
  })
})
