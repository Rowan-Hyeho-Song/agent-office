/// <reference types="node" />
// #457 taking a drink out of the fridge, on the baked model (lounge-props.md 5.4 · 5.5): the Director, the planner, the rigs and the play stage run
// the way Agents.tsx runs them. The light follows the door; the agent steps in clear of the door's swing, the left hand takes the drink off its
// shelf, carries it, sips twice where it stays, and it fades out and is back on its shelf, out of sight until the fridge is shut.
import { describe, expect, it } from 'vitest'
import { Vector3, type Material } from 'three'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, Walk, expectCleanAll, world, type World } from './errandWorld.fixture'
import { DRINKS, FRIDGE, FRIDGE_LIGHT, FRIDGE_T, grabAt, sweptDistance, type DrinkKind } from './lounge'
import { DRINK_T } from './fridgeDrink'
import { FRIDGE_REACH } from './loungeActs'

stubCanvas()
const DT = 0.02

function setup(w: World, agent: string, reduced = false, skip?: (n: { name: string }) => boolean) {
  const walk = new Walk(w, undefined, reduced)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  const guard = new Guard(w, skip)
  for (let k = 0; k < 10; k++) walk.step(DT, guard)
  walk.status[agent] = { state: 'idle', since: 0 }
  return { walk, guard }
}

const opacityOf = (w: World, kind: DrinkKind) => {
  let o = 1
  w.nodes[DRINKS[kind].prop].traverse((x) => {
    const m = (x as { material?: Material }).material
    if (m) o = Math.min(o, m.opacity)
  })
  return o
}

describe('#457 a drink from the fridge, drawn', () => {
  it('the can: light with the door, the step in clear of the swing, the hand on the grip, carried, two sips at the desk, faded, back on the shelf once dark; nothing loose', async () => {
    const w = await world()
    const agent = 'agent_3'
    const { walk, guard } = setup(w, agent)
    walk.director.forceAct(agent, 'fridge', walk.t0 + walk.t * 1000, undefined, 'can')
    const lounge = w.stage.lounge
    const can = w.nodes.prop_fridge_can
    const home = can.position.clone()
    const gripAt = () => w.scene.getObjectByName('prop_fridge_can_grip_l')!.getWorldPosition(new Vector3())
    const cues: { name: string; u: number }[] = []
    let maxStep = 0
    let atStep = Infinity
    let minSwept = Infinity
    let handOnGrip = Infinity
    let maxI = 0
    let maxSpill = 0
    let lightWrong = 0
    let onSeen = false
    let actEnd = -1
    let heldAfter = 0
    let arrived = -1
    let fadeSeen = false
    let goneAt = -1
    let hiddenFrames = 0
    let wasOn = false
    let switched = 0
    for (let k = 0; k < 60 / DT; k++) {
      walk.step(DT, guard)
      const g = walk.goals[agent]
      const u = g.act?.u ?? -1
      for (const f of lounge.fired) if (f.agent === agent) cues.push({ name: f.name, u: f.at })
      const root = w.rigs[agent].parts.root.position
      const ls = lounge.fridgeLightState()
      const deg = lounge.doorDeg()
      // the light: switched on past 8° and fully up 0.12 s later, switched off below 4° and dark 0.08 s later; never above 0.5; the spill never above 0.16
      maxI = Math.max(maxI, ls.intensity)
      maxSpill = Math.max(maxSpill, ls.spill)
      if (ls.on && !wasOn) {
        expect(deg, 'switched on past 8°').toBeGreaterThan(FRIDGE_LIGHT.onDeg)
        switched = walk.t
      }
      if (!ls.on && wasOn) {
        expect(deg, 'switched off below 4°').toBeLessThan(FRIDGE_LIGHT.offDeg)
        switched = walk.t
      }
      if (ls.on && walk.t > switched + FRIDGE_LIGHT.onS + DT && ls.k < 1) lightWrong++
      if (!ls.on && walk.t > switched + FRIDGE_LIGHT.offS + DT && ls.intensity > 0) lightWrong++
      if (deg < FRIDGE_LIGHT.offDeg - 0.5 && ls.on) lightWrong++
      wasOn = ls.on
      if (ls.on) onSeen = true
      if (g.act && u >= 0) {
        const off = Math.hypot(root.x - FRIDGE.stand.x, root.z - FRIDGE.stand.z)
        maxStep = Math.max(maxStep, off)
        minSwept = Math.min(minSwept, sweptDistance(root.x, root.z))
        if (u >= FRIDGE_T.reach && u <= FRIDGE_T.back) atStep = Math.min(atStep, -Math.hypot(root.x - FRIDGE.step.x, root.z - FRIDGE.step.z))
        // the moment the hand has it: its grip frame on the can's grip empty
        const want = w.rigs[agent].want
        if (want?.attached && want.prefer === 'prop_fridge_can' && handOnGrip === Infinity)
          handOnGrip = w.rigs[agent].parts.hands.l.grip!.getWorldPosition(new Vector3()).distanceTo(gripAt())
      }
      if (!g.act && g.drink && actEnd < 0) {
        actEnd = walk.t
        // over to its desk, off for a while (resting there, standing idle): it sips there
        walk.status[agent] = { state: 'off', since: 0 }
      }
      if (actEnd >= 0 && g.drink && w.rigs[agent].want?.attached && w.rigs[agent].want?.prefer === 'prop_fridge_can') heldAfter++
      if (actEnd >= 0 && arrived < 0 && w.rigs[agent].arrived === g.spot) arrived = walk.t
      if (g.drink && g.drink.fade >= 0) {
        fadeSeen = true
        expect(opacityOf(w, 'can'), 'fading').toBeCloseTo(Math.max(0, 1 - g.drink.fade / DRINK_T.fadeS), 5)
      }
      if (actEnd >= 0 && !g.drink && goneAt < 0) goneAt = walk.t
      if (goneAt >= 0 && !can.visible) hiddenFrames++
      if (goneAt >= 0 && walk.t > goneAt + 1) break
    }
    const names = cues.map((c) => c.name)
    expect(names.slice(0, 4), 'open, hum, the can, close').toEqual(['fridge.open', 'fridge.hum', 'fridge.can', 'fridge.close'])
    expect(cues[2].u).toBeCloseTo(FRIDGE_T.grab, 1)
    expect(names.filter((n) => n === 'drink.sip').length, 'two sips at the desk').toBe(2)
    expect(onSeen).toBe(true)
    expect(lightWrong, 'the light follows the door').toBe(0)
    expect(maxI).toBeCloseTo(FRIDGE_LIGHT.intensity, 6)
    expect(maxSpill).toBeLessThanOrEqual(FRIDGE_LIGHT.spill + 1e-9)
    expect(maxStep, 'stepped 0.30 m in').toBeGreaterThan(0.27)
    expect(maxStep).toBeLessThan(0.33)
    expect(-atStep, 'at the step while the hand is in').toBeLessThan(0.03)
    expect(minSwept, 'clear of the door\'s swing').toBeGreaterThanOrEqual(FRIDGE.stepOffM)
    expect(handOnGrip, 'the hand closes on the can\'s grip').toBeLessThan(0.015)
    expect(actEnd, 'carried after the act').toBeGreaterThan(0)
    expect(heldAfter * DT, 'held on the way and at the desk').toBeGreaterThan(5)
    expect(fadeSeen).toBe(true)
    expect(goneAt - arrived, 'kept about 20 s where it stays').toBeGreaterThan(DRINK_T.keepS - 1)
    expect(goneAt - arrived).toBeLessThan(DRINK_T.keepS + 1)
    // the door is shut, so it is back on its shelf at once: seen, exactly home, fully opaque again
    expect(lounge.doorDeg()).toBe(0)
    expect(hiddenFrames, 'out of sight only until the next frame finds the fridge dark').toBeLessThanOrEqual(2)
    expect(can.visible).toBe(true)
    expect(can.position.distanceTo(home), 'exactly home (matrix rounding only)').toBeLessThan(1e-4)
    expect(opacityOf(w, 'can')).toBe(1)
    expect(walk.director.drinkOf(agent)).toBeNull()
    expectCleanAll('fridge can', w, guard)
  }, 120000)

  it('the milk from the middle shelf: the body bends to it, the hand closes on its grip, it comes out before the chest; nothing loose', async () => {
    const w = await world()
    const agent = 'agent_2'
    const { walk, guard } = setup(w, agent)
    walk.director.forceAct(agent, 'fridge', walk.t0 + walk.t * 1000, undefined, 'milk')
    const grip = () => w.scene.getObjectByName('prop_fridge_milk_grip_l')!.getWorldPosition(new Vector3())
    let handOnGrip = Infinity
    let dip = 0
    let minY = Infinity
    for (let k = 0; k < 30 / DT; k++) {
      walk.step(DT, guard)
      const g = walk.goals[agent]
      const u = g.act?.u ?? -1
      if (u < 0) continue
      dip = Math.max(dip, -w.rigs[agent].parts.root.position.y)
      const want = w.rigs[agent].want
      if (want?.attached && want.prefer === 'prop_fridge_milk') {
        if (handOnGrip === Infinity) handOnGrip = w.rigs[agent].parts.hands.l.grip!.getWorldPosition(new Vector3()).distanceTo(grip())
        minY = Math.min(minY, w.nodes.prop_fridge_milk.position.y)
      }
      if (u > FRIDGE_T.total - 0.1) break
    }
    expect(handOnGrip, 'the hand closes on the carton\'s grip').toBeLessThan(0.015)
    expect(dip, 'bent to the middle shelf').toBeGreaterThan(DRINKS.milk.dip * 0.8)
    expect(minY, 'never below its shelf while in the hand').toBeGreaterThanOrEqual(DRINKS.milk.grip.y - 0.04 - 1e-3)
    expect(w.nodes.prop_fridge_milk.position.y, 'before the chest at the end').toBeGreaterThan(0.7)
    expectCleanAll('fridge milk', w, guard)
  }, 90000)

  for (const kind of ['can', 'milk'] as const)
    it(`the reach for the ${kind} goes in through the opening, not across its front edge (#472 designer): crossing x 4.335 the hand is within z −0.90 … −0.56`, async () => {
      const w = await world()
      const agent = 'agent_3'
      const { walk, guard } = setup(w, agent)
      walk.director.forceAct(agent, 'fridge', walk.t0 + walk.t * 1000, undefined, kind)
      const hand = w.rigs[agent].parts.hands.l
      const pts: Record<'centre' | 'grip', Vector3[]> = { centre: [], grip: [] }
      for (let k = 0; k < 30 / DT; k++) {
        walk.step(DT, guard)
        const u = walk.goals[agent].act?.u ?? -1
        if (u >= FRIDGE_T.reach - 0.05 && u <= FRIDGE_T.grab + 0.6) {
          pts.centre.push(hand.node.getWorldPosition(new Vector3()))
          pts.grip.push(hand.grip!.getWorldPosition(new Vector3()))
        }
        if (u > FRIDGE_T.grab + 0.6) break
      }
      const [lo, hi] = FRIDGE_REACH.zIn
      for (const [name, path] of Object.entries(pts)) {
        let crossings = 0
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1]
          const b = path[i]
          if ((a.x - FRIDGE_REACH.frontX) * (b.x - FRIDGE_REACH.frontX) > 0 || a.x === b.x) continue
          const z = a.z + ((FRIDGE_REACH.frontX - a.x) / (b.x - a.x)) * (b.z - a.z)
          crossings++
          expect(z, `${kind} ${name} crossing the front`).toBeGreaterThanOrEqual(lo)
          expect(z).toBeLessThanOrEqual(hi)
        }
        // in and out again
        expect(crossings, `${kind} ${name}`).toBeGreaterThanOrEqual(2)
        // and every frame inside the front is within the opening
        for (const p of path.filter((q) => q.x > FRIDGE_REACH.frontX)) {
          expect(p.z, `${kind} ${name} inside`).toBeGreaterThanOrEqual(lo)
          expect(p.z).toBeLessThanOrEqual(hi)
        }
      }
    }, 90000)

  it('reduced motion, the milk: no step, no reach; it is in the hand from 70°, appearing in 0.12 s; no sips; the door\'s milk carton is not faded with it', async () => {
    const w = await world()
    const agent = 'agent_1'
    // the drink appears in the hand (the agreed jump of reduced motion): the guard watches everything else
    const { walk, guard } = setup(w, agent, true, (n) => n.name === 'prop_fridge_milk')
    walk.director.forceAct(agent, 'fridge', walk.t0 + walk.t * 1000, undefined, 'milk')
    const lounge = w.stage.lounge
    let maxStep = 0
    let firstHeld = -1
    let sips = 0
    let rampSeen = false
    const door = w.nodes.fridge_door
    for (let k = 0; k < 12 / DT; k++) {
      walk.step(DT, guard)
      const g = walk.goals[agent]
      const u = g.act?.u ?? -1
      sips += lounge.fired.filter((f) => f.name === 'drink.sip').length
      if (g.act && u >= 0) {
        const root = w.rigs[agent].parts.root.position
        maxStep = Math.max(maxStep, Math.hypot(root.x - FRIDGE.stand.x, root.z - FRIDGE.stand.z))
        const want = w.rigs[agent].want
        if (want?.attached && want.prefer === 'prop_fridge_milk' && firstHeld < 0) firstHeld = u
        if (u > grabAt(true) && u < grabAt(true) + DRINK_T.appearS - DT) {
          const o = opacityOf(w, 'milk')
          if (o > 0 && o < 1) rampSeen = true
        }
      }
      if (u > FRIDGE_T.total - 0.1) break
    }
    expect(maxStep, 'no step').toBeLessThan(0.05)
    expect(firstHeld).toBeGreaterThanOrEqual(grabAt(true) - 1e-6)
    expect(firstHeld).toBeLessThan(grabAt(true) + 2 * DT)
    expect(rampSeen, 'it appears over 0.12 s').toBe(true)
    expect(sips).toBe(0)
    // the door's own carton shares the model's milk material: it stays as it is
    let doorMilk = 1
    door.traverse((x) => {
      const m = (x as { material?: Material }).material
      if (m && /milk/.test(m.name)) doorMilk = Math.min(doorMilk, m.opacity)
    })
    expect(doorMilk).toBe(1)
  }, 90000)

  it('at rest the light is off: no light, the strip dark, no spill', async () => {
    const w = await world()
    const { walk, guard } = setup(w, 'agent_0')
    for (let k = 0; k < 5; k++) walk.step(DT, guard)
    const s = w.stage.lounge.fridgeLightState()
    expect(s).toEqual({ on: false, k: 0, intensity: 0, spill: 0 })
    expect(w.nodes.fridge_spill.visible).toBe(false)
    expect(w.scene.getObjectByName('fridge_light_app')).toBeTruthy()
  }, 60000)
})
