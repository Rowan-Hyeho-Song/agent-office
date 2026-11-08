// A whole day of the real schedule (time-seeded play, working windows, talks, the night shift) driven through the
// planner the way Agents.tsx drives it, for the day-simulation test and its report. Not part of the app.

import { Director, type Goal } from './director'
import { applyDuty } from './duty'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint } from './grid'
import { DESK_SIDES } from './nav'
import { GRAPH } from './navSpots.fixture'
import type { OfficeMessage, StatusMap } from './status'
import { TRAFFIC, TrafficPlanner } from './traffic'

export const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
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
        const m: OfficeMessage = { id: `m${msgId++}`, kind: 'talk', from: AGENTS[Math.floor(rand() * 4)], to: AGENTS[Math.floor(rand() * 4)], at: now }
        director.receive(m)
      }
    }
    const arrived = (a: string) => (planner.has(a) ? planner.sample(a, t).arrived : null)
    const goals: Record<string, Goal> = director.goals(now, minute, status, arrived)
    for (const a of AGENTS) {
      const g = goals[a]
      const req = { spot: g.spot, pace: 1, avoid: g.quiet ? DESK_SIDES : undefined }
      if (first) planner.place(a, req, t, AGENTS.indexOf(a))
      else planner.request(a, req, t, AGENTS.indexOf(a))
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
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const d = Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z)
          if (isExempt(s[i], s[j])) minExempt = Math.min(minExempt, d)
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
  return { min, minExempt, replans, worst, samples, planMs, stats: planner.stats }
}
