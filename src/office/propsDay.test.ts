/// <reference types="node" />
// A day of the schedule, for every prop (#228): the issue asks "zero teleport frames for every liftable prop over a day". A literal 24 h at
// 60 fps through PlayStage is minutes of work, so this runs what the schedule actually produces, once each:
//   1. every (agent, activity, plant) the day's blocks hand out: coffee and books at their places (also for the night-duty agent), every
//      watering errand (the agent walks to the can, carries it to the plant, brings it back), every pair that plays ping-pong or omok;
//   2. a stretch of the real schedule with everyone free, run through Director + TrafficPlanner + rigs + PlayStage like the app, across a
//      block boundary where one agent is still watering when another is sent for the can (one can: the second waits).
// Every prop, in every one of them: loose only at home, no jump when a hand takes it or lets go, always within the holder's reach.
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, Walk, expectClean, expectCleanAll, runErrand, runRead, world, type World } from './errandWorld.fixture'
import { GRAPH, SPOTS } from './navSpots.fixture'
import { PLAYS, dayPlan, planDay, playAt, soloAt } from './play'
import type { Goal } from './director'
import { SETTLE_MS, sessionsAt, type PlaySession } from '../play/session'
import { WATER_PLANTS } from './water'

stubCanvas()
const LOG = process.env.FIT_LOG
const DAY0 = Date.parse('2026-11-09T00:00:00+09:00')
/** the day swept: every 3 minutes (#490: the plan changes at any moment, 3 minutes catches what it hands out over a day) */
const STEP_MS = 3 * 60_000

/** every combination the day's plan produces: with nobody busy, and with each agent busy in turn (a game partner left alone, the schedule's own reshuffle) */
function dayCombos() {
  const solo = new Set<string>() // `${agent}|${kind}`
  const water = new Set<string>() // `${agent}|${plant}`
  const pairs = new Map<string, PlaySession>()
  for (let t = DAY0; t < DAY0 + 86_400_000; t += STEP_MS) {
    for (const busy of [[], ...IDS.map((a) => [a])]) {
      const out = playAt(t, IDS, new Set(busy))
      for (const [agent, as] of Object.entries(out)) {
        if (as.kind === 'water') water.add(`${agent}|${as.plant}`)
        else if (as.kind === 'coffee' || as.kind === 'books') solo.add(`${agent}|${as.kind}`)
      }
      // the two players of a pair game, in either order (the sides differ in the paddle / stone colour, not in what the hands do)
      for (const s of sessionsAt(t, IDS, new Set(busy))) if (!pairs.has(`${s.kind}|${[...s.players].sort().join('|')}`)) pairs.set(`${s.kind}|${[...s.players].sort().join('|')}`, s)
    }
    // the night-duty agent's quiet solo (any of them may hold the shift)
    for (const a of IDS) {
      const n = soloAt(t, a)
      if (n.kind !== 'gap') solo.add(`${a}|${n.kind}`)
    }
  }
  return { solo, water, pairs }
}

const slotOf = (p: { stand?: { x: number; z: number }; face?: { x: number; z: number } }, spot: string) => {
  const sp = SPOTS.find((s) => s.id === spot)!
  if (!p.stand) return { x: sp.x, z: sp.z, ry: sp.ry }
  return { x: p.stand.x, z: p.stand.z, ry: Math.atan2(-(p.face!.x - p.stand.x), -(p.face!.z - p.stand.z)) }
}
const stand = (w: World, id: string, at: string | null, place: { x: number; z: number; ry: number }) => {
  const r = w.rigs[id]
  r.at = at
  r.x = place.x
  r.z = place.z
  r.heading = place.ry
  r.parts.root.position.set(place.x, 0, place.z)
  r.parts.root.rotation.set(0, place.ry, 0)
  r.parts.root.updateMatrixWorld(true)
}
const IDLE = (id: string): Goal => ({ spot: `work_${id.split('_')[1]}`, pose: 'idle', label: '' })

/** one agent does a solo activity at its place for 10 s, then walks off */
function solo(w: World, agent: string, kind: 'coffee' | 'books' /* books: the old standing pick, kept for the close-up */, guard: Guard) {
  const def = PLAYS.find((p) => p.kind === kind)!
  const spot = def.spots[0]
  const goal: Goal = { spot, pose: kind, ...(def.stand ? { face: def.face, slot: slotOf(def, spot) } : {}), label: '' }
  stand(w, agent, spot, slotOf(def, spot))
  const dt = 0.03
  for (let k = 0; k < 500; k++) {
    const t = k * dt
    const active = t < 10
    if (!active) w.rigs[agent].at = null
    const goals = Object.fromEntries(IDS.map((id) => [id, id === agent && active ? goal : IDLE(id)]))
    w.stage.update({ now: 0, t, dt, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {} })
    w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
    w.props.update(dt)
    w.scene.updateMatrixWorld(true)
    guard.frame(t)
  }
}

function pair(w: World, s: PlaySession, guard: Guard) {
  let held = 0 // frames a hand held a light stone (#538: omok has no prop)
  const spots = s.kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b']
  // a record placed alone (#137 ①): one agent at game_a, the white bowl already at the corner, the game 20 s later
  const lead = 0
  ;(s.solo ? [s.players[0]] : s.players).forEach((id, i) => {
    const sp = SPOTS.find((x) => x.id === spots[i])!
    stand(w, id, spots[i], { x: sp.x, z: sp.z, ry: sp.ry })
  })
  const dt = 0.03
  for (let k = 0; k < 330; k++) {
    const t = k * dt
    const active = t < 9
    if (!active) for (const id of s.players) w.rigs[id].at = null
    const goals = Object.fromEntries(IDS.map((id) => [id, active && s.players.includes(id) ? { spot: spots[s.players.indexOf(id)], pose: s.kind, label: '' } : IDLE(id)])) as Record<string, Goal>
    w.stage.update({ now: s.startMs + 20_000 + lead + t * 1000, t, dt, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, forcedSessions: [s] })
    w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
    w.props.update(dt)
    w.scene.updateMatrixWorld(true)
    guard.frame(t)
    for (const id of s.players) if (w.stage.lastPlace[id]?.held) held++
  }
  return held
}

describe('a day of the schedule: no prop moves on its own, whatever the schedule hands out', () => {
  const day = dayCombos()

  it('the day really contains what the checks below cover', () => {
    const kinds = new Set([...day.solo].map((x) => x.split('|')[1]))
    expect([...kinds].sort()).toEqual(['books', 'coffee'])
    expect(new Set([...day.water].map((x) => x.split('|')[1])).size, 'every watered plant').toBe(WATER_PLANTS.length)
    expect(new Set([...day.pairs.values()].map((s) => s.kind)).size, 'both pair games').toBe(2)
    if (LOG) appendFileSync(LOG, `props day: ${day.solo.size} solo (agent, activity), ${day.water.size} watering (agent, plant), ${day.pairs.size} pairs (game, players)\n`)
  })

  it('coffee and books: every agent that gets them', async () => {
    let n = 0
    for (const agent of IDS) {
      const w = await world()
      for (const kind of ['coffee', 'books'] as const) {
        if (!day.solo.has(`${agent}|${kind}`)) continue
        const guard = new Guard(w)
        // the cup is taken at the machine; the book is a seated reading (#280): from the low table to the sofa and back
        if (kind === 'coffee') solo(w, agent, kind, guard)
        else runRead(w, agent, 0, guard)
        expectClean(`${agent} ${kind}`, guard.stats, kind === 'coffee' ? 'cup' : 'book')
        n++
      }
    }
    expect(n, 'every (agent, solo) the day hands out').toBe(day.solo.size)
    expect(n, 'every agent gets coffee').toBeGreaterThanOrEqual(IDS.length)
  }, 60000)

  it('watering: every (agent, plant) the day produces — fetch, lift, carry, pour, return, put; the body is beside the can and the plant', async () => {
    let n = 0
    let worst = 0
    let jump = 0
    for (const agent of IDS) {
      const w = await world()
      for (const key of [...day.water].sort()) {
        const [a, plant] = key.split('|')
        if (a !== agent) continue
        const guard = new Guard(w)
        const r = runErrand(w, agent, plant, guard, { dt: 0.06 })
        expect(r.stages, key).toEqual(['fetch', 'lift', 'carry', 'pour', 'return', 'put'])
        expectClean(key, guard.stats, 'watering_can')
        expect(guard.stats.byProp, key + ': only the can').toEqual({ prop_watering_can: 1 })
        worst = Math.max(worst, guard.stats.heldReach)
        jump = Math.max(jump, guard.stats.graspJump, guard.stats.releaseJump)
        n++
      }
    }
    expect(n).toBe(day.water.size)
    if (LOG) appendFileSync(LOG, `props day water: ${n} errands, worst held reach ${worst.toFixed(3)} m, worst grasp/release jump ${(jump * 1000).toFixed(2)} mm\n`)
  }, 90000)

  it('ping-pong and omok: every pair the day produces', async () => {
    let n = 0
    let worst = 0
    for (const kind of ['pingpong', 'boardgame'] as const) {
      const w = await world() // one office per game, the pairs take their turns in it
      for (const s of day.pairs.values()) {
        if (s.kind !== kind) continue
        const guard = new Guard(w)
        const held = pair(w, s, guard)
        if (kind === 'pingpong') expectClean(`${s.kind} ${s.players.join('/')}`, guard.stats, 'paddle')
        else {
          // #538 the board is light: a hand pinches a light stone and no prop is taken or moved
          expect(held, `omok ${s.players.join('/')}: a hand held a light stone`).toBeGreaterThan(0)
          expect(guard.stats.grasps, `omok ${s.players.join('/')}: no prop taken`).toBe(0)
          expect(guard.stats.loose, `omok ${s.players.join('/')}: no prop away from home`).toBe(0)
        }
        worst = Math.max(worst, guard.stats.heldReach)
        n++
      }
    }
    expect(n).toBe(day.pairs.size)
    if (LOG) appendFileSync(LOG, `props day pairs: ${n} sessions, worst held reach ${worst.toFixed(3)} m\n`)
  }, 90000)
})

describe('one can for the whole office: a second agent sent for it while the first still has it waits (#228)', () => {
  it('everyone free, the real schedule through the planner across a block boundary: never two on the can, both errands whole, every prop clean', async () => {
    // #490: one agent's watering stay begins while another's is under way (from the day plans, by day; the first such day from DAY0 on)
    const roster = [...IDS].sort()
    let start = -1
    let first = ''
    let second = ''
    for (let k = 0; k < 30 && start < 0; k++) {
      const { day, start: dayStart } = planDay(DAY0 + 12 * 3_600_000 + k * 86_400_000)
      const plan = dayPlan(day, roster)
      for (const [i, segs] of plan.entries())
        for (const seg of segs) {
          // by day: 09:00-23:00 KST (the plan's day starts at 04:00)
          if (start >= 0 || seg.kind !== 'water' || seg.start < dayStart + 5 * 3_600_000 || seg.start > dayStart + 19 * 3_600_000) continue
          const other = plan.findIndex((o, n) => n !== i && o.some((x) => x.kind === 'water' && x.start <= seg.start - 1000 && x.end > seg.start))
          if (other < 0) continue
          start = seg.start
          first = roster[other]
          second = roster[i]
        }
    }
    expect(start, 'one waters while another\'s watering begins').toBeGreaterThanOrEqual(0)
    const w = await world()
    // the first is sent 1 s before the second's watering begins and is still on the way with the can when it does
    const walk = new Walk(w, start - 1000)
    const guard = new Guard(w)
    const dt = 0.05
    const on: Record<string, { from: number; to: number }> = {}
    let both = 0
    let waited = false
    let maxHolders = 0
    for (let k = 0; k < 110 / dt; k++) {
      walk.step(dt, guard)
      const stage = IDS.filter((a) => walk.goals[a].water)
      for (const a of stage) on[a] = { from: on[a]?.from ?? walk.t, to: walk.t }
      if (stage.length > both) both = stage.length
      if (walk.goals[second].label.includes('차례') && walk.goals[first].water) waited = true
      maxHolders = Math.max(maxHolders, IDS.filter((a) => w.rigs[a].want?.attached && w.rigs[a].want?.kind === 'watering_can').length)
    }
    expect(Object.keys(on).sort(), 'both agents ran their errand').toEqual([first, second].sort())
    expect(both, 'never two errands at once').toBe(1)
    expect(maxHolders, 'never two hands on the can').toBe(1)
    expect(waited, 'the second one waited at its desk').toBe(true)
    expect(on[second].from, 'the second went only after the first had put it down').toBeGreaterThan(on[first].to)
    expectCleanAll('stretch', w, guard)
    expect(guard.stats.byProp.prop_watering_can, 'the can was taken once by each').toBe(2)
    if (LOG) appendFileSync(LOG, `props stretch: ${guard.stats.frames} frames, ${Object.keys(guard.stats.byProp).length} props taken (${JSON.stringify(guard.stats.byProp)}), loose frames ${guard.stats.loose}, worst held reach ${guard.stats.heldReach.toFixed(3)} m\n`)
  }, 120000)
})

// #280 regression: the pairs test above plays 9 s of each session, at one fixed moment. A go stone placed on a far corner of the board (the stretch of the one-can test found one: agent_1 at game_a,
// 35 s into its game, the stone 0.761 m from its body) is farther than an arm from the player's spot. Nobody walks off with it: the body leans over the board the few cm it takes (rig.leanOver).
describe('omok through a whole game: the stone is always within an arm of the body', () => {
  /** one session of a pair game played from its first move for `s` seconds, both players standing at the game spots */
  function whole(w: World, session: PlaySession, guard: Guard, seconds: number) {
    const spots = ['game_a', 'game_b']
    const lead = 0
    ;(session.solo ? [session.players[0]] : session.players).forEach((id, i) => {
      const sp = SPOTS.find((x) => x.id === spots[i])!
      stand(w, id, spots[i], { x: sp.x, z: sp.z, ry: sp.ry })
    })
    const dt = 0.05
    let lean = 0
    let held = 0
    for (let k = 0; k < seconds / dt; k++) {
      const t = k * dt
      const goals = Object.fromEntries(IDS.map((id) => [id, session.players.includes(id) ? { spot: spots[session.players.indexOf(id)], pose: 'boardgame', label: '' } : IDLE(id)])) as Record<string, Goal>
      for (const id of session.players) w.rigs[id].update(dt, t, GRAPH, w.rigs, false, undefined)
      w.stage.update({ now: session.startMs + SETTLE_MS + lead + t * 1000, t, dt, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {}, forcedSessions: [session] })
      w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
      w.props.update(dt)
      w.scene.updateMatrixWorld(true)
      guard.frame(t)
      for (const id of session.players) if (w.stage.lastPlace[id]?.held) held++
      for (const id of session.players) lean = Math.max(lean, Math.hypot(w.rigs[id].parts.root.position.x - w.rigs[id].x, w.rigs[id].parts.root.position.z - w.rigs[id].z))
    }
    return { lean, held }
  }

  it('the exact pair of the one-can stretch (agent_1 at game_a, agent_3 at game_b) for 120 s of its game, and every omok pair of the day', async () => {
    const day = dayCombos()
    const exact = [...day.pairs.values()].find((s) => s.kind === 'boardgame' && s.players.includes('agent_1') && s.players.includes('agent_3'))!
    expect(exact, 'the pair is in the day').toBeTruthy()
    let worstLean = 0
    for (const s of [exact, ...[...day.pairs.values()].filter((p) => p.kind === 'boardgame' && p !== exact)]) {
      const w = await world()
      const guard = new Guard(w)
      const r = whole(w, s, guard, 120)
      worstLean = Math.max(worstLean, r.lean)
      expect(r.held, `omok ${s.players.join('/')} whole game: a hand held a light stone`).toBeGreaterThan(0)
      expect(guard.stats.grasps, `omok ${s.players.join('/')} whole game: no prop taken`).toBe(0)
      expect(guard.stats.loose, `omok ${s.players.join('/')} whole game: no prop away from home`).toBe(0)
    }
    // the lean is a few cm at most, and it did happen (else this checks nothing)
    expect(worstLean).toBeLessThanOrEqual(0.08 + 1e-6)
    expect(worstLean).toBeGreaterThan(0.001)
  }, 300000)
})
