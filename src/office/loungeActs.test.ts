/// <reference types="node" />
// The lounge acts, drawn on the baked model (#280): each act run through the Director, the planner, the rigs and the play stage the way Agents.tsx runs them, and every prop watched
// (props stay home unless a hand has them; nothing jumps; the body can reach what it holds). The sounds are the cues the stage fires (the audio graph itself is not built here).
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, Walk, expectCleanAll, world, type World } from './errandWorld.fixture'
import { GRAPH } from './navSpots.fixture'
import { ACT_PLACE, DISPENSER, FRIDGE, FRIDGE_T, RECORD_T, recordBeats, sweptDistance, type ActKind, type RecordMode } from './lounge'
import { deckNow, resetDeck } from '../audio/speaker'
import type { Goal } from './director'

stubCanvas()
const DT = 0.02
const rad = (d: number) => (d * Math.PI) / 180

/** everybody works at their desks but `agent`, who is free and is sent to the act */
function setup(w: World, agent: string) {
  const walk = new Walk(w)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  const guard = new Guard(w)
  for (let k = 0; k < 10; k++) walk.step(DT, guard)
  walk.status[agent] = { state: 'idle', since: 0 }
  return { walk, guard }
}

interface Run {
  fired: { name: string; u: number }[]
  /** u of the act when the first / last frame of its goal was seen */
  reachedAt: number
  maxDoor: number
  doorEnd: number
  streamFrames: number
  handFrames: { l: number; r: number }
  arm: { max: number; end: number }
  platterSpun: number
  /** the farthest the body was from the act's stand while the act ran (from its first u >= 0.3) */
  stood: number
  guard: Guard
  walk: Walk
  endAt: number
}

async function runAct(w: World, agent: string, kind: ActKind, mode?: RecordMode, opts: { maxS?: number; after?: number } = {}): Promise<Run> {
  const { walk, guard } = setup(w, agent)
  const now = walk.t0 + walk.t * 1000
  walk.director.forceAct(agent, kind, now, mode)
  const r: Run = { fired: [], reachedAt: -1, maxDoor: 0, doorEnd: 0, streamFrames: 0, handFrames: { l: 0, r: 0 }, arm: { max: 0, end: 0 }, platterSpun: 0, stood: 0, guard, walk, endAt: -1 }
  const lounge = w.stage.lounge
  const arm = w.nodes.turntable_arm
  const platter = w.nodes.turntable_platter
  let spin0 = platter.rotation.y
  let seen = false
  let after = 0
  for (let k = 0; k < (opts.maxS ?? 60) / DT; k++) {
    walk.step(DT, guard)
    const g: Goal = walk.goals[agent]
    const u = g.act?.u ?? -1
    for (const f of lounge.fired) r.fired.push({ name: f.name, u: f.at })
    if (g.act) seen = true
    if (g.act && u >= 0 && r.reachedAt < 0) r.reachedAt = walk.t
    r.maxDoor = Math.max(r.maxDoor, lounge.doorDeg())
    if (u >= 0.3) {
      const root = w.rigs[agent].parts.root.position
      const st = ACT_PLACE[kind].stand
      r.stood = Math.max(r.stood, Math.hypot(root.x - st.x, root.z - st.z))
    }
    if (lounge.stream()) r.streamFrames++
    if (w.rigs[agent].drive.l) r.handFrames.l++
    if (w.rigs[agent].drive.r) r.handFrames.r++
    r.arm.max = Math.max(r.arm.max, Math.abs(arm.rotation.y) / rad(1))
    if (seen && !g.act) {
      if (r.endAt < 0) r.endAt = walk.t
      // a moment more: the hand lets go, the door shuts, the arm settles
      if (++after > (opts.after ?? 3) / DT) break
    }
  }
  r.doorEnd = lounge.doorDeg()
  r.arm.end = Math.abs(arm.rotation.y) / rad(1)
  r.platterSpun = Math.abs(platter.rotation.y - spin0)
  spin0 = 0
  return r
}

describe('the fridge', () => {
  it('the door opens 100° (cue fridge.open as it starts), is held, shuts (cue fridge.close as it ends); the hand takes the handle; every prop clean', async () => {
    const w = await world()
    const r = await runAct(w, 'agent_3', 'fridge')
    const names = r.fired.map((f) => f.name)
    expect(names, 'cues in order, once each').toEqual(['fridge.open', 'fridge.close'])
    expect(r.fired[0].u).toBeGreaterThanOrEqual(FRIDGE_T.open)
    expect(r.fired[0].u).toBeLessThan(FRIDGE_T.open + 0.2)
    expect(r.fired[1].u).toBeGreaterThanOrEqual(FRIDGE_T.shut)
    expect(r.maxDoor, 'open').toBeCloseTo(FRIDGE.openDeg, 0)
    expect(r.doorEnd, 'shut again').toBe(0)
    expect(w.nodes.fridge_door.rotation.y).toBe(0)
    expect(r.handFrames.r, 'the right hand was driven').toBeGreaterThan(40)
    expectCleanAll('fridge', w, r.guard)
    // the agent stood off the swept area while it worked
    expect(r.stood, 'at the stand the whole act').toBeLessThan(0.15)
    expect(sweptDistance(FRIDGE.stand.x, FRIDGE.stand.z)).toBeGreaterThanOrEqual(0.5)
  }, 90000)

  it('the hand is on the handle while it pulls: its grip frame is within 1.5 cm of the handle as the door starts to move (the hand has closed on it; it then follows with the spring lag of the hand, under 4 cm)', async () => {
    const w = await world()
    const { walk, guard } = setup(w, 'agent_2')
    walk.director.forceAct('agent_2', 'fridge', walk.t0 + walk.t * 1000)
    const handle = w.scene.getObjectByName('fridge_door_grip_r')!
    let best = Infinity
    for (let k = 0; k < 20 / DT; k++) {
      walk.step(DT, guard)
      const u = walk.goals.agent_2.act?.u ?? -1
      if (u >= FRIDGE_T.open - 0.02 && u <= FRIDGE_T.open + 0.05) {
        const hand = w.rigs.agent_2.parts.hands.r.grip!.getWorldPosition(new Vector3())
        best = Math.min(best, hand.distanceTo(handle.getWorldPosition(new Vector3())))
      }
      if (u > FRIDGE_T.open + 0.4) break
    }
    expect(best).toBeLessThan(0.015)
  }, 60000)
})

describe('the water dispenser', () => {
  it('the index finger presses a tap, the cue dispenser.pour fires once as it does, and the stream runs for its dur', async () => {
    const w = await world()
    const r = await runAct(w, 'agent_1', 'dispenser')
    expect(r.fired.map((f) => f.name)).toEqual(['dispenser.pour'])
    expect(r.fired[0].u).toBeGreaterThanOrEqual(0.5)
    expect(r.streamFrames * DT, 'the stream runs about as long as the cue says').toBeGreaterThan(DISPENSER.pourS - 0.1)
    expect(r.streamFrames * DT).toBeLessThan(DISPENSER.pourS + 0.1)
    expect(r.handFrames.r).toBeGreaterThan(40)
    expectCleanAll('dispenser', w, r.guard)
  }, 90000)
})

describe('the turntable', () => {
  it('put a record on: the disc comes out, lands on the platter, the arm goes over and down; cues in order; the speakers are told; the jacket goes back (hidden at rest)', async () => {
    resetDeck()
    const w = await world()
    const r = await runAct(w, 'agent_4', 'record', 'put', { after: 4 })
    expect(r.fired.map((f) => f.name)).toEqual(['record.out', 'record.place', 'record.needle'])
    const b = recordBeats('put', false)
    expect(r.fired[0].u).toBeGreaterThanOrEqual(RECORD_T.take)
    expect(r.fired[1].u).toBeGreaterThanOrEqual(RECORD_T.place)
    expect(r.fired[2].u).toBeGreaterThanOrEqual(b.down)
    expect(w.stage.lounge.deck).toEqual({ recordOn: true, needle: true })
    expect(deckNow().down, 'needleDown() was called').toBe(true)
    expect(r.arm.end, 'the arm rests over the record (play_deg 25)').toBeCloseTo(25, 0)
    expect(r.platterSpun, 'the platter turns once the needle is down').toBeGreaterThan(0.1)
    // the jacket is back at its place and out of sight; the disc stays on the platter
    const rec = w.nodes.prop_record
    expect(rec.visible).toBe(false)
    expect(w.nodes.turntable_platter.children.filter((c) => c.visible && (c as { isMesh?: boolean }).isMesh).length).toBeGreaterThanOrEqual(5)
    expectCleanAll('record', w, r.guard)
    expect(r.guard.per.prop_record?.grasps, 'the jacket was taken once').toBe(1)
    expect(r.guard.per.prop_record?.heldReach ?? 0).toBeLessThanOrEqual(0.75)
  }, 90000)

  it('with a record on, only the arm goes down; then lifting it: the arm comes back, cue record.lift, the speakers are told', async () => {
    resetDeck()
    const w = await world()
    const first = await runAct(w, 'agent_4', 'record', 'put', { after: 4 })
    expect(deckNow().down).toBe(true)
    // a second run of the same world: the record is on already
    const second = await runAct(w, 'agent_0', 'record', 'lift', { after: 4 })
    expect(second.fired.map((f) => f.name)).toEqual(['record.lift'])
    expect(w.stage.lounge.deck.needle).toBe(false)
    expect(deckNow().down).toBe(false)
    expect(second.arm.end).toBeCloseTo(0, 0)
    expectCleanAll('record lift', w, second.guard)
    void first
  }, 120000)
})

describe('the sofa', () => {
  /** a free agent sits where `spot` is for `s` seconds; returns the cues and what the rig showed */
  async function sit(w: World, agent: string, spot: string, s: number, t0?: number) {
    const walk = new Walk(w, t0)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    const guard = new Guard(w)
    const goals = walk.director.goals.bind(walk.director)
    walk.director.goals = ((...a: Parameters<typeof goals>) => ({ ...goals(...a), [agent]: { spot, pose: 'sofa', label: '' } as Goal })) as typeof goals
    for (let k = 0; k < 10; k++) walk.step(DT, guard)
    walk.status[agent] = { state: 'idle', since: 0 }
    const fired: string[] = []
    let hugged = 0
    let lie = 0
    for (let k = 0; k < s / DT; k++) {
      walk.step(DT, guard)
      for (const f of w.stage.lounge.fired) fired.push(f.name)
      if (w.rigs[agent].want?.kind === 'pillow' && w.rigs[agent].want?.attached) hugged++
      lie = Math.max(lie, w.rigs[agent].lyingK)
    }
    return { fired, hugged, lie, walk, guard }
  }

  it('sitting makes the cue sofa.sit once; now and then the pillow is hugged to the chest (cue pillow.hug) and put back when the agent gets up; nothing is left loose', async () => {
    let hug: Awaited<ReturnType<typeof sit>> | null = null
    let sat: Awaited<ReturnType<typeof sit>> | null = null
    for (let k = 0; k < 8 && !hug; k++) {
      const w = await world()
      const r = await sit(w, 'agent_0', 'sofa_0', 40, Date.UTC(2026, 10, 9, 5, k * 7, 0))
      sat ??= r
      if (r.fired.includes('pillow.hug')) {
        hug = r
        // up again: the pillow goes home, the guard sees no prop away from it
        const walk = r.walk
        const goals = walk.director.goals
        walk.director.goals = ((...a: Parameters<typeof goals>) => ({ ...goals(...a), agent_0: { spot: 'work_0', pose: 'idle', label: '' } as Goal })) as typeof goals
        for (let i = 0; i < 25 / DT; i++) walk.step(DT, r.guard)
        expectCleanAll('pillow', w, r.guard)
        expect(w.nodes.prop_pillow_0.position.distanceTo(new Vector3(2.57, 0.64, 3.43))).toBeLessThan(0.01)
      }
    }
    expect(sat!.fired.filter((n) => n === 'sofa.sit'), 'one sit sound').toHaveLength(1)
    expect(hug, 'a sitting with a hug came up').not.toBeNull()
    expect(hug!.fired.filter((n) => n === 'pillow.hug')).toHaveLength(1)
    expect(hug!.hugged).toBeGreaterThan(50)
  }, 240000)

  it('the east seat lies down: the head goes to the head point of the model, face up, whatever way that point lies (nav extras lie + head, no direction in the code)', async () => {
    const ud = (await world()).scene.getObjectByName('nav_sofa_3')!.userData as { lie?: boolean; head?: number[] }
    expect(ud.lie).toBe(true)
    const spot = GRAPH.spots.sofa_3
    const own = spot.head
    try {
      // the model's own head point (the north armrest's inside face) and two others the code could not have guessed: the head follows each
      for (const head of [{ x: ud.head![0], z: ud.head![1] }, { x: spot.x + 0.3, z: spot.z + 0.2 }, { x: spot.x - 0.25, z: spot.z + 0.25 }]) {
        spot.head = head
        const w = await world()
        const walk = new Walk(w)
        for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
        const goals = walk.director.goals.bind(walk.director)
        walk.director.goals = ((...a: Parameters<typeof goals>) => ({ ...goals(...a), agent_2: { spot: 'sofa_3', pose: 'sofa', label: '' } as Goal })) as typeof goals
        for (let k = 0; k < 10; k++) walk.step(DT)
        walk.status.agent_2 = { state: 'idle', since: 0 }
        const rig = w.rigs.agent_2
        for (let k = 0; k < 40 / DT; k++) walk.step(DT)
        expect(rig.arrived).toBe('sofa_3')
        w.scene.updateMatrixWorld(true)
        const at = rig.parts.head.getWorldPosition(new Vector3())
        expect(Math.hypot(at.x - head.x, at.z - head.z), 'the head is at the head point').toBeLessThan(0.02)
        expect(at.y, 'low, on the cushion').toBeLessThan(0.75)
        expect(at.y).toBeGreaterThan(0.5)
        // the face (the head's -z) looks up
        const face = new Vector3(0, 0, -1).transformDirection(rig.parts.head.matrixWorld)
        expect(face.y, 'face up').toBeGreaterThan(0.9)
        expect(rig.lyingK).toBeGreaterThan(0.99)
      }
    } finally {
      spot.head = own
    }
    // a sitting seat does not lie
    const w = await world()
    const walk = new Walk(w)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    const goals = walk.director.goals.bind(walk.director)
    walk.director.goals = ((...a: Parameters<typeof goals>) => ({ ...goals(...a), agent_2: { spot: 'sofa_1', pose: 'sofa', label: '' } as Goal })) as typeof goals
    for (let k = 0; k < 10; k++) walk.step(DT)
    walk.status.agent_2 = { state: 'idle', since: 0 }
    for (let k = 0; k < 40 / DT; k++) walk.step(DT)
    expect(w.rigs.agent_2.lyingK).toBe(0)
  }, 240000)
})

describe('the door', () => {
  it('an agent at the door spot steps on the mat (cue mat.step, once) and presses the lever with its left hand (30°, then back); the grip stays on the lever', async () => {
    const w = await world()
    const walk = new Walk(w)
    for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
    const guard = new Guard(w)
    const goals = walk.director.goals.bind(walk.director)
    walk.director.goals = ((...a: Parameters<typeof goals>) => ({ ...goals(...a), agent_1: { spot: 'door', pose: 'idle', label: '' } as Goal })) as typeof goals
    for (let k = 0; k < 10; k++) walk.step(DT, guard)
    walk.status.agent_1 = { state: 'idle', since: 0 }
    const fired: string[] = []
    let min = 0
    let leftFrames = 0
    let worstGrip = 0
    const lever = w.nodes.door_lever
    for (let k = 0; k < 60 / DT; k++) {
      walk.step(DT, guard)
      for (const f of w.stage.lounge.fired) fired.push(f.name)
      min = Math.min(min, w.stage.lounge.leverDeg())
      if (w.rigs.agent_1.drive.l) {
        leftFrames++
        const hg = w.rigs.agent_1.parts.hands.l.grip!.getWorldPosition(new Vector3())
        const lg = w.scene.getObjectByName('door_lever_grip_l')!.getWorldPosition(new Vector3())
        if (lever.quaternion.angleTo(w.stage.lounge['lever']!.base) > 0.2) worstGrip = Math.max(worstGrip, hg.distanceTo(lg))
      }
    }
    expect(w.rigs.agent_1.arrived).toBe('door')
    expect(fired.filter((n) => n === 'mat.step'), 'one step on the mat').toHaveLength(1)
    expect(fired.filter((n) => n.startsWith('lever.')), 'the latch at the bottom, the spring at the top, once each').toEqual(['lever.down', 'lever.up'])
    expect(min, 'pressed down 30°').toBeCloseTo(-30, 0)
    expect(Math.abs(w.stage.lounge.leverDeg()), 'and let up again').toBeLessThan(0.5)
    expect(leftFrames, 'the left hand held the lever').toBeGreaterThan(30)
    expect(worstGrip, 'the hand rides the lever while it is down (the spring lag of the hand)').toBeLessThan(0.05)
  }, 120000)
})
