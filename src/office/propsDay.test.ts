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
import { Guard, IDS, Walk, expectClean, expectCleanAll, runErrand, world, type World } from './errandWorld.fixture'
import { SPOTS } from './navSpots.fixture'
import { BLOCK_MINUTES, PLAYS, playAt, soloAt } from './play'
import type { Goal } from './director'
import { sessionsAt, type PlaySession } from '../play/session'

stubCanvas()
const LOG = process.env.FIT_LOG
const DAY0 = Date.parse('2026-11-09T00:00:00+09:00')
const MIN0 = Math.floor(DAY0 / 60000)

/** every combination the day's blocks produce: with nobody busy, and with each agent busy in turn (a game partner left alone, the schedule's own reshuffle) */
function dayCombos() {
  const solo = new Set<string>() // `${agent}|${kind}`
  const water = new Set<string>() // `${agent}|${plant}`
  const pairs = new Map<string, PlaySession>()
  for (let m = 0; m < 24 * 60; m += BLOCK_MINUTES) {
    for (const busy of [[], ...IDS.map((a) => [a])]) {
      const out = playAt(MIN0 + m, IDS, new Set(busy))
      for (const [agent, as] of Object.entries(out)) {
        if (as.kind === 'water') water.add(`${agent}|${as.plant}`)
        else if (as.kind === 'coffee' || as.kind === 'books') solo.add(`${agent}|${as.kind}`)
      }
      // the two players of a pair game, in either order (the sides differ in the paddle / stone colour, not in what the hands do)
      for (const s of sessionsAt((MIN0 + m) * 60000, IDS, new Set(busy))) if (!pairs.has(`${s.kind}|${[...s.players].sort().join('|')}`)) pairs.set(`${s.kind}|${[...s.players].sort().join('|')}`, s)
    }
    // the night-duty agent's quiet solo (any of them may hold the shift)
    for (const a of IDS) solo.add(`${a}|${soloAt(MIN0 + m, a).kind}`)
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
function solo(w: World, agent: string, kind: 'coffee' | 'books', guard: Guard) {
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

/** a pair plays 9 s of its session (settled in, rally / stones running) */
function pair(w: World, s: PlaySession, guard: Guard) {
  const spots = s.kind === 'pingpong' ? ['pingpong_a', 'pingpong_b'] : ['game_a', 'game_b']
  s.players.forEach((id, i) => {
    const sp = SPOTS.find((x) => x.id === spots[i])!
    stand(w, id, spots[i], { x: sp.x, z: sp.z, ry: sp.ry })
  })
  const dt = 0.03
  for (let k = 0; k < 330; k++) {
    const t = k * dt
    const active = t < 9
    if (!active) for (const id of s.players) w.rigs[id].at = null
    const goals = Object.fromEntries(IDS.map((id) => [id, active && s.players.includes(id) ? { spot: spots[s.players.indexOf(id)], pose: s.kind, label: '' } : IDLE(id)])) as Record<string, Goal>
    w.stage.update({ now: s.startMs + 20_000 + t * 1000, t, dt, reduced: false, replaying: false, rigs: w.rigs, goals, status: {}, tablet: false, stamp: false, colors: {} })
    w.props.hold(new Map(Object.values(w.rigs).map((r) => [r, r.want])))
    w.props.update(dt)
    w.scene.updateMatrixWorld(true)
    guard.frame(t)
  }
}

describe('a day of the schedule: no prop moves on its own, whatever the schedule hands out', () => {
  const day = dayCombos()

  it('the day really contains what the checks below cover', () => {
    const kinds = new Set([...day.solo].map((x) => x.split('|')[1]))
    expect([...kinds].sort()).toEqual(['books', 'coffee'])
    expect(new Set([...day.water].map((x) => x.split('|')[1])).size, 'every watered plant').toBe(3)
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
        solo(w, agent, kind, guard)
        expectClean(`${agent} ${kind}`, guard.stats, kind === 'coffee' ? 'cup' : 'book')
        n++
      }
    }
    expect(n).toBeGreaterThanOrEqual(8)
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
        pair(w, s, guard)
        expectClean(`${s.kind} ${s.players.join('/')}`, guard.stats, kind === 'pingpong' ? 'paddle' : 'piece')
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
    // a block where one agent waters and the next block another does
    let m0 = -1
    for (let m = MIN0 - (MIN0 % BLOCK_MINUTES); m < MIN0 + 24 * 60 && m0 < 0; m += BLOCK_MINUTES) {
      const a = Object.entries(playAt(m, IDS)).find(([, x]) => x.kind === 'water')
      const b = Object.entries(playAt(m + BLOCK_MINUTES, IDS)).find(([, x]) => x.kind === 'water')
      if (a && b && a[0] !== b[0]) m0 = m
    }
    expect(m0, 'a block where two agents water in a row').toBeGreaterThanOrEqual(0)
    const [first] = Object.entries(playAt(m0, IDS)).find(([, x]) => x.kind === 'water')!
    const [second] = Object.entries(playAt(m0 + BLOCK_MINUTES, IDS)).find(([, x]) => x.kind === 'water')!
    const w = await world()
    // the first is sent 1 s before the next block begins and is still on the way with the can when the second one's block starts
    const walk = new Walk(w, (m0 + BLOCK_MINUTES) * 60000 - 1000)
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
