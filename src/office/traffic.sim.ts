// A whole day of the real schedule (time-seeded play, working windows, talks, the night shift) driven through the
// planner the way Agents.tsx drives it, for the day-simulation test and its report. Not part of the app.

import { deskOf, Director, requestOf, type Goal } from './director'
import { applyDuty } from './duty'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint } from './grid'
import { GRAPH } from './navSpots.fixture'
import type { OfficeMessage, StatusMap } from './status'
import { TRAFFIC, TrafficPlanner } from './traffic'
import type { Shown } from './wrap'

const WRAP_POSES = ['idle', 'write', 'carry', 'cardpost', 'tidy']

/**
 * Does what an agent shows (Shown) match what its body does (goal, where the planner has it)? Returns why not, or null.
 * work = at the desk typing (or on the way, saying so); wrap = one of the wrap-up steps; rest = play / rest at the desk;
 * off = dozing / resting at the desk; duty = the night shift's quiet solo; talk = a conversation.
 */
export function mismatch(a: string, sh: Shown | undefined, g: Goal, arrived: string | null, near: (spot: string) => boolean = (s) => arrived === s): string | null {
  const desk = `work_${deskOf(a)}`
  if (!sh) return 'nothing shown'
  const s = sh.status.state
  // #228: called to work (or off) while carrying the watering can, the agent first brings it back: it shows the errand's words, whatever it is
  if (g.pose === 'water' && sh.kind !== 'rest') return sh.detail && g.water ? null : 'water errand without its words'
  switch (sh.kind) {
    case 'work':
      if (s !== 'working' || (g.pose !== 'type' && g.pose !== 'listen') || g.spot !== desk) return 'work: not typing at the desk'
      // at the desk = within 0.6 m of it, as for the wrap-up steps: a seated agent nudged a few cm aside for a passer (the planner's yield,
      // e.g. 6 cm for 0.8 s in the west row of #195) is still working at its desk, and its tag rightly keeps saying so
      // (and "on the way" is wrong only once it has really arrived; walking the last 0.6 m it rightly says so)
      if (sh.detail === undefined) return near(desk) ? null : 'work: says at-desk while away'
      return arrived === desk ? 'work: says on-the-way while at the desk' : null
    case 'wrap': {
      if (s !== 'wrapping' || !sh.detail || !sh.step || !WRAP_POSES.includes(g.pose)) return 'wrap: no wrap step'
      const want = { write: 'write', walk: 'carry', post: 'cardpost', tidy: 'tidy', seat: 'idle' }[sh.step]
      if (g.pose !== want) return `wrap: ${sh.step} shows but pose is ${g.pose}`
      if ((sh.step === 'write' || sh.step === 'tidy') && !near(desk)) return `wrap: ${sh.step} away from the desk`
      if (sh.step === 'post' && !near('whiteboard')) return 'wrap: posting away from the board'
      return null
    }
    case 'rest':
      if (s !== 'idle' || sh.detail) return 'rest: not shown as rest'
      return WRAP_POSES.includes(g.pose) && g.pose !== 'idle' ? 'rest: wrap pose' : g.pose === 'type' || g.pose === 'doze' ? 'rest: working / dozing pose' : null
    case 'off':
      return (g.pose === 'doze' || g.pose === 'idle') && g.spot === desk && s === 'off' ? null : 'off: not at the desk dozing / resting'
    case 'duty':
      return (g.pose === 'coffee' || g.pose === 'books') && s === 'idle' ? null : 'duty: not the night solo'
    case 'talk':
      return ['idle', 'talk', 'listen'].includes(g.pose) ? null : 'talk: not talking'
  }
}

export const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
export const DAY0 = Date.parse('2026-11-09T00:00:00+09:00')

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** a deterministic working pattern: ~45 min windows with a wrap-up at the end, per agent, from the minute alone */
function rawStatus(minute: number, ms: number): StatusMap {
  const out: StatusMap = {}
  for (const a of AGENTS) {
    const seat = Number(a.split('_')[1])
    const block = Math.floor((minute + seat * 13) / 45)
    const working = rng(block * 31 + seat)() < 0.4
    const inBlock = (minute + seat * 13) % 45
    if (working && inBlock < 30) out[a] = { state: 'working', activity: 'test', since: ms - inBlock * 60000 }
    else if (working && inBlock < 32) out[a] = { state: 'wrapping', since: ms - (inBlock - 30) * 60000 }
    else out[a] = { state: 'idle', since: ms }
  }
  return out
}

export function simulateDay(opts: { fromMin: number; toMin: number; onStep?: (t: number, planner: TrafficPlanner, goals: Record<string, Goal>) => void }) {
  const planner = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
  const director = new Director(AGENTS)
  const rand = rng(7)
  let min = Infinity
  let minExempt = Infinity
  // a body resting on a seat of the sofa row and one in the row's approach area (#341): the seat pitch apart is allowed
  let minSeated = Infinity
  // every pair of which one rests on a seat of the row, whoever the other is and wherever: never closer than the seat pitch (#280)
  let minSeatRest = Infinity
  // how far a body that has arrived on a sofa seat is ever from it while that is still its goal: nobody is moved off a seat for someone else (#280)
  let maxSeatDrift = 0
  const seatHeld: Record<string, string | undefined> = {}
  let replans = 0
  let t = opts.fromMin * 60
  const end = opts.toMin * 60
  let lastMinute = -1
  let status: StatusMap = {}
  let msgId = 0
  const exempt = planner.exemptPairs
  // two agents in the arrival / departure zone (within 0.45 m) of a designed pair of spots may be that pair's distance apart
  const near = (p: { x: number; z: number }, id: string) => Math.hypot(p.x - GRAPH.spots[id].x, p.z - GRAPH.spots[id].z) < 0.45
  const isExempt = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    exempt.some(([s1, s2]) => ((near(a, s1) && near(b, s2)) || (near(a, s2) && near(b, s1))) && Math.hypot(a.x - b.x, a.z - b.z) >= Math.hypot(GRAPH.spots[s1].x - GRAPH.spots[s2].x, GRAPH.spots[s1].z - GRAPH.spots[s2].z) - 0.06)
  const worst: { t: number; d: number; who: string; goals: string; at: string }[] = []
  const planMs: number[] = []
  const departs = new Map<string, number>()
  // the watering errands (#228): how many entered each stage, and whether two agents ever had one at once
  const errands: Record<string, number> = { fetch: 0, lift: 0, carry: 0, pour: 0, return: 0, put: 0, done: 0 }
  const stageOf: Record<string, string | undefined> = {}
  let errandsAtOnce = 0
  // frames where what is shown and what the body does disagree; the longest an agent went without reaching its goal (the #188 leftover)
  const mism: { t: number; who: string; why: string }[] = []
  let frames = 0
  const goalSince: Record<string, { key: string; t: number }> = {}
  const maxWait = { s: 0, who: '', spot: '', t: 0 }
  const longWaits: { who: string; spot: string; t: number; s: number }[] = []
  let first = true
  let samples = 0
  while (t < end) {
    const now = DAY0 + t * 1000
    const minute = Math.floor(now / 60000)
    if (minute !== lastMinute) {
      lastMinute = minute
      const kmin = Math.floor((now - DAY0) / 60000)
      status = applyDuty(rawStatus(kmin, now), AGENTS, now)
      // a talk now and then between two agents
      if (rand() < 0.12) {
        const m: OfficeMessage = { id: `m${msgId++}`, kind: 'talk', from: AGENTS[Math.floor(rand() * AGENTS.length)], to: AGENTS[Math.floor(rand() * AGENTS.length)], at: now }
        director.receive(m)
      }
    }
    const arrived = (a: string) => (planner.has(a) ? planner.sample(a, t).arrived : null)
    const goals: Record<string, Goal> = director.goals(now, minute, status, arrived)
    // as Agents.tsx does: forget the departures no goal holds any more, keep the held ones
    const held = new Set(Object.entries(goals).filter(([, g]) => g.depart !== undefined).map(([id, g]) => `${id}|${g.spot}|${g.depart}`))
    for (const k of [...departs.keys()]) if (!held.has(k)) departs.delete(k)
    for (const a of AGENTS) {
      const g = goals[a]
      // a goal that sets off later (a play ending: the prop goes back first) is held to that time, as Agents.tsx does
      let notBefore: number | undefined
      if (g.depart !== undefined) {
        const key = `${a}|${g.spot}|${g.depart}`
        notBefore = departs.get(key) ?? t + Math.max(0, (g.depart - now) / 1000)
        departs.set(key, notBefore)
      }
      const req = requestOf(g, 1, notBefore)
      if (first) planner.place(a, req, t, AGENTS.indexOf(a))
      else planner.request(a, req, t, AGENTS.indexOf(a))
    }
    let onErrand = 0
    for (const a of AGENTS) {
      const st = goals[a].water?.stage
      if (st) onErrand++
      if (st !== stageOf[a]) {
        if (st) errands[st]++
        else if (stageOf[a] === 'put') errands.done++
        stageOf[a] = st
      }
    }
    errandsAtOnce = Math.max(errandsAtOnce, onErrand)
    for (const a of AGENTS) {
      const g = goals[a]
      const at = planner.has(a) ? planner.sample(a, t).arrived : null
      frames++
      const me = planner.has(a) ? planner.sample(a, t) : null
      // briefly stepping aside for a passer (the planner's yield) is still being at the spot: within 0.6 m
      const why = mismatch(a, director.shown[a], g, at, (s) => !!me && Math.hypot(me.x - GRAPH.spots[s].x, me.z - GRAPH.spots[s].z) < 0.6)
      if (why) mism.push({ t, who: a, why })
      const key = `${g.spot}|${g.slot ? `${g.slot.x.toFixed(1)},${g.slot.z.toFixed(1)}` : ''}`
      const gs = (goalSince[a] = goalSince[a]?.key === key ? goalSince[a] : { key, t })
      if (!first && at !== g.spot) {
        const w = t - gs.t
        if (w > maxWait.s) Object.assign(maxWait, { s: w, who: a, spot: g.spot, t })
        if (w > 60 && !longWaits.some((x) => x.who === a && x.spot === g.spot && t - x.t < 600)) longWaits.push({ who: a, spot: g.spot, t, s: w })
      } else gs.t = t
    }
    first = false
    opts.onStep?.(t, planner, goals)
    const t0 = performance.now()
    if (planner.update(t)) {
      replans++
      planMs.push(performance.now() - t0)
    }
    // is anyone still on the way? then step finely, otherwise coarsely
    const busy = AGENTS.some((a) => planner.settledAt(a) > t || planner.sample(a, t).moving)
    const step = busy ? 0.1 : 2
    for (let k = 0; k < (busy ? 2 : 1); k++) {
      const tt = t + k * 0.05
      const s = AGENTS.map((a) => planner.sample(a, tt))
      samples++
      AGENTS.forEach((a, i) => {
        const spot = GRAPH.spots[goals[a].spot]
        if (!spot || spot.kind !== 'sofa') seatHeld[a] = undefined
        else if (s[i].arrived === spot.id) seatHeld[a] = spot.id
        else if (seatHeld[a] !== spot.id) seatHeld[a] = undefined
        if (seatHeld[a]) maxSeatDrift = Math.max(maxSeatDrift, Math.hypot(s[i].x - spot.x, s[i].z - spot.z))
      })
      for (let i = 0; i < AGENTS.length; i++) {
        for (let j = i + 1; j < AGENTS.length; j++) {
          const d = Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z)
          if (planner.restsOnRowSeat(s[i].x, s[i].z) || planner.restsOnRowSeat(s[j].x, s[j].z)) minSeatRest = Math.min(minSeatRest, d)
          if (isExempt(s[i], s[j])) minExempt = Math.min(minExempt, d)
          else if (planner.isSeatedPair(s[i].x, s[i].z, s[j].x, s[j].z) && d >= planner.seatPassM - 0.005) minSeated = Math.min(minSeated, d)
          else {
            if (d < min) min = d
            if (d < 2 * TRAFFIC.bodyR) worst.push({ t: tt, d, who: `${AGENTS[i]}/${AGENTS[j]}`, goals: `${goals[AGENTS[i]].spot}/${goals[AGENTS[j]].spot}`, at: `${s[i].x.toFixed(2)},${s[i].z.toFixed(2)}/${s[j].x.toFixed(2)},${s[j].z.toFixed(2)}` })
          }
        }
      }
    }
    t += step
  }
  planMs.sort((a, b) => a - b)
  return { min, minExempt, minSeated, minSeatRest, maxSeatDrift, seatPassM: planner.seatPassM, replans, worst, samples, planMs, stats: planner.stats, mismatch: mism, frames, maxWait, longWaits, errands, errandsAtOnce }
}
