/// <reference types="node" />
// The water's effects on the real model (#185): the stream lands on the soil and never misses, the pool never passes its cap, the soil goes dark, the plant sways
// within ±1.5° and comes to rest, the leaf-tip drips appear, and the speed and reduced motion keep what watering.md 5 says. Headless: PlayStage on the baked model.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { loadOffice, stubCanvas } from './glbLoad'
import { PlayStage } from './playStage'
import { AgentRig, PropBank, buildRig } from './rig'
import { POUR_S, WATER_PLANTS, headingTo, pourHoldOf, pourTotal, standOf } from './water'
import { PARTICLE_CAP, SWAY_RAD, WET_DARK, habitSeconds, type HabitKind } from './waterFx'
import type { WaterScene } from './waterScene'

stubCanvas()
const LOG = process.env.FIT_LOG

async function world() {
  const { scene, nodes } = await loadOffice()
  const props = new PropBank(scene, nodes)
  const rigs = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`agent_${i}`, new AgentRig(`agent_${i}`, i, buildRig(scene, nodes, i), '#ffffff')]))
  const stage = new PlayStage(scene, nodes, props)
  return { scene, nodes, props, rigs, stage, fx: (stage as unknown as { fx: WaterScene }).fx }
}
type World = Awaited<ReturnType<typeof world>>

/** one pour of `plant` by `id`, frame by frame at the stage time u; `after` frames of an idle agent follow (the plant's sway dies away) */
function pour(w: World, id: string, plantName: string, o: { habit?: HabitKind | null; reduced?: boolean; speed?: number; dt?: number } = {}) {
  const plant = WATER_PLANTS.find((p) => p.name === plantName)!
  const st = standOf(plant)
  const heading = headingTo(st.x, st.z, plant.x, plant.z)
  const r = w.rigs[id]
  r.at = 'water_' + plant.name
  r.x = st.x
  r.z = st.z
  r.heading = heading
  r.parts.root.position.set(st.x, 0, st.z)
  r.parts.root.rotation.set(0, heading, 0)
  r.parts.root.updateMatrixWorld(true)
  const dt = o.dt ?? 0.02
  const habitS = habitSeconds(o.habit)
  const t4 = POUR_S.settle + POUR_S.up + pourHoldOf(plant.name) + POUR_S.down
  const total = pourTotal(plant.name, habitS)
  const stats = { maxN: 0, maxDrawn: 0, hitsAtT4: 0, missesAtT4: 0, maxWet: 0, maxSway: 0, dripsSeen: false, dripFell: false, wetAt: [] as number[], frames: 0, firstWetAt: -1, particlesSeen: false }
  const swayNode = w.scene.getObjectByName(plant.name)!
  const t0 = 100
  w.fx.stream.clear()
  w.fx.stream.resetCounts()
  for (let k = 0; k * dt <= total + 0.4; k++) {
    const u = k * dt
    const goals = Object.fromEntries(Object.keys(w.rigs).map((o2) => [o2, o2 === id ? { spot: 'water_' + plant.name, pose: 'water', water: { stage: 'pour', plant: plant.name, u, habit: o.habit ?? null }, label: '' } : { spot: 'work_0', pose: 'idle', label: '' }]))
    w.stage.update({ now: 0, t: t0 + u, dt, reduced: o.reduced ?? false, speed: o.speed ?? 1, replaying: false, rigs: w.rigs, goals: goals as never, status: {}, tablet: false, stamp: false, colors: {} })
    w.props.hold(new Map(Object.values(w.rigs).map((x) => [x, x.want])))
    w.props.update(dt)
    w.scene.updateMatrixWorld(true)
    stats.frames++
    stats.maxN = Math.max(stats.maxN, w.fx.stream.n)
    stats.maxDrawn = Math.max(stats.maxDrawn, w.fx.drawn)
    if (w.fx.stream.n > 0) stats.particlesSeen = true
    if (w.fx.drawn > w.fx.stream.n) stats.dripsSeen = true
    if (w.fx.drips.drips.some((x) => x.phase === 'fall')) stats.dripFell = true
    const wet = w.fx.wetness(plant.name)
    stats.maxWet = Math.max(stats.maxWet, wet)
    if (wet > 0 && stats.firstWetAt < 0) stats.firstWetAt = u
    const ang = 2 * Math.acos(Math.min(1, Math.abs(swayNode.quaternion.w)))
    stats.maxSway = Math.max(stats.maxSway, ang)
    if (u <= t4 && u + dt > t4) {
      stats.hitsAtT4 = w.fx.stream.hits
      stats.missesAtT4 = w.fx.stream.misses
    }
  }
  return { plant, stats, t4, total }
}

/** the agent lets go and the rest of the frames pass (drops fall, the plant settles) */
function idle(w: World, frames: number, dt = 0.02, t = 200) {
  const off = Object.fromEntries(Object.keys(w.rigs).map((o) => [o, { spot: 'work_0', pose: 'idle', label: '' }]))
  for (let k = 0; k < frames; k++) {
    w.stage.update({ now: 0, t: t + k * dt, dt, reduced: false, replaying: false, rigs: w.rigs, goals: off as never, status: {}, tablet: false, stamp: false, colors: {} })
    w.props.hold(new Map(Object.values(w.rigs).map((x) => [x, x.want])))
    w.props.update(dt)
  }
}

describe('the water on the model (#185)', () => {
  for (const p of WATER_PLANTS) {
    it(`${p.name}: every drop of the stream reaches the soil circle (no misses), the pool stays under its cap, the soil goes dark, the sway stays within 1.5°`, async () => {
      const w = await world()
      const { stats, plant } = pour(w, 'agent_2', p.name)
      if (LOG) appendFileSync(LOG, `water fx ${plant.name}: hits ${stats.hitsAtT4} misses ${stats.missesAtT4} peak ${stats.maxN} drawn ${stats.maxDrawn} wet ${stats.maxWet.toFixed(2)} sway ${((stats.maxSway * 180) / Math.PI).toFixed(2)} deg, drips ${stats.dripsSeen}\n`)
      expect(stats.hitsAtT4, 'the stream reaches the soil').toBeGreaterThan(8)
      expect(stats.missesAtT4, 'no drop of the stream lands outside the soil (last miss ' + w.fx.stream.lastMiss.toFixed(3) + ' m from the centre, soil r ' + plant.r.toFixed(3) + ')').toBe(0)
      expect(stats.maxN).toBeLessThanOrEqual(PARTICLE_CAP.desktop)
      expect(stats.maxDrawn).toBeLessThanOrEqual(PARTICLE_CAP.desktop)
      expect(stats.maxWet).toBe(1)
      expect(stats.maxSway).toBeLessThanOrEqual(SWAY_RAD * 1.001)
      // the dark layer shows over the soil, as dark as the spec says
      const disc = w.scene.getObjectByName('wet_' + plant.name) as unknown as { visible: boolean; material: { opacity: number } }
      expect(disc.visible).toBe(true)
      expect(disc.material.opacity).toBeCloseTo(WET_DARK, 2)
    }, 60000)
  }

  it('the soil darkens gradually: no wet at the start of the stream, full 0.8 s later', async () => {
    const w = await world()
    const { stats } = pour(w, 'agent_1', 'plant_corner')
    expect(stats.firstWetAt).toBeGreaterThan(POUR_S.settle + 0.4) // not before the water runs
    expect(stats.maxWet).toBe(1)
  }, 60000)

  it('the leaves sway (the fig, the monstera, the sansevieria) a little, drips gather at their tips and stay there (outside the soil), and the plant comes to rest after', async () => {
    const w = await world()
    for (const name of ['plant_corner', 'plant_sofa', 'plant_desk']) {
      const { stats } = pour(w, 'agent_3', name)
      expect(stats.maxSway, name).toBeGreaterThan(0.3 * (Math.PI / 180))
      // the model's leaf tips of these three all hang outside the soil disc: the drips form, glint and shrink away on the leaf; none falls to the floor
      expect(stats.dripsSeen, name + ' drips').toBe(true)
      expect(stats.dripFell, name + ' no drip falls outside the soil').toBe(false)
      idle(w, 300)
      const node = w.scene.getObjectByName(name)!
      expect(node.quaternion.angleTo(new Quaternion()), name + ' back at rest').toBeLessThan(1e-6)
      expect(node.position.length(), name + ' back at rest').toBeLessThan(1e-6)
      expect(w.fx.drips.active, name + ' drops are done').toBe(false)
    }
  }, 90000)

  it('the hanging planters do not sway and have no drips (their pivot is the ceiling hook, the model gives no tips)', async () => {
    const w = await world()
    const { stats } = pour(w, 'agent_2', 'plant_hang_0')
    expect(stats.maxSway).toBe(0)
    expect(stats.dripsSeen).toBe(false)
    expect(stats.maxWet).toBe(1)
  }, 60000)

  it('mobile has half the cap', async () => {
    const w = await world()
    const mobile = new (w.fx.constructor as new (...a: unknown[]) => WaterScene)(w.scene, (w.fx as unknown as { mesh: never }).mesh, WATER_PLANTS, true)
    expect(mobile.stream.cap + 3).toBe(PARTICLE_CAP.mobile)
  })

  it('x16 leaves out the particles and the drips but keeps the soil and the sway', async () => {
    const w = await world()
    const { stats } = pour(w, 'agent_0', 'plant_corner', { speed: 16 })
    expect(stats.particlesSeen).toBe(false)
    expect(stats.dripsSeen).toBe(false)
    expect(stats.maxWet).toBe(1)
    expect(stats.maxSway).toBeGreaterThan(0.3 * (Math.PI / 180))
  }, 60000)

  it('reduced motion: no particles, no drips, no sway, the soil darkens at once', async () => {
    const w = await world()
    const { stats } = pour(w, 'agent_0', 'plant_corner', { reduced: true })
    expect(stats.particlesSeen).toBe(false)
    expect(stats.dripsSeen).toBe(false)
    expect(stats.maxSway).toBe(0)
    expect(stats.maxWet).toBe(1)
  }, 60000)

  it('every habit plays through the pour without a hand flying off: the left fingertip stays within an arm of the body and the can stays attached', async () => {
    const w = await world()
    for (const [i, habit] of (['poke', 'look', 'leaf', 'tap', 'listen'] as HabitKind[]).entries()) {
      const id = `agent_${i}`
      const r = w.rigs[id]
      const plant = WATER_PLANTS[0]
      const total = pourTotal(plant.name, habitSeconds(habit))
      const hand = r.parts.hands.l.node
      let far = 0
      let lost = 0
      const st = standOf(plant)
      const heading = headingTo(st.x, st.z, plant.x, plant.z)
      r.at = 'water_' + plant.name
      r.x = st.x
      r.z = st.z
      r.heading = heading
      r.parts.root.position.set(st.x, 0, st.z)
      r.parts.root.rotation.set(0, heading, 0)
      r.parts.root.updateMatrixWorld(true)
      for (let k = 0; k * 0.02 <= total; k++) {
        const u = k * 0.02
        const goals = Object.fromEntries(Object.keys(w.rigs).map((o2) => [o2, o2 === id ? { spot: 'water_' + plant.name, pose: 'water', water: { stage: 'pour', plant: plant.name, u, habit }, label: '' } : { spot: 'work_0', pose: 'idle', label: '' }]))
        w.stage.update({ now: 0, t: 300 + u, dt: 0.02, reduced: false, replaying: false, rigs: w.rigs, goals: goals as never, status: {}, tablet: false, stamp: false, colors: {} })
        w.props.hold(new Map(Object.values(w.rigs).map((x) => [x, x.want])))
        w.props.update(0.02)
        w.scene.updateMatrixWorld(true)
        r.applyDrive('l', 300 + u, false)
        r.applyDrive('r', 300 + u, false)
        w.scene.updateMatrixWorld(true)
        if (!r.want?.attached && u > 0.8) lost++
        const p = hand.getWorldPosition(new Vector3())
        // (the rig was never updated: its hands start from the rest place of the model, the first second is them arriving)
        if (u > 1) far = Math.max(far, Math.hypot(p.x - r.parts.root.position.x, p.z - r.parts.root.position.z))
      }
      expect(lost, habit + ': the can stays in the hand').toBe(0)
      expect(far, habit + ': the left hand stays within reach of the body').toBeLessThan(0.75)
      idle(w, 60)
    }
  }, 120000)
})
