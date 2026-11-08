import { describe, expect, it } from 'vitest'
import { conversations, type DocMeta } from '../docs/library'
import { requestOf, type Goal } from './director'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint } from './grid'
import { buildScript } from './meeting'
import { MeetingRunner, seatLabel } from './meetingRun'
import { GRAPH } from './navSpots.fixture'
import type { StatusMap } from './status'
import { TRAFFIC, TrafficPlanner } from './traffic'

// A whole meeting (gather, lines, decide, disperse) through the real traffic planner, the way Agents.tsx drives it:
// the four agents never come closer than two bodies, everyone reaches its seat, and the meeting ends.
const meta: DocMeta = { id: 11, kind: 'minutes', repo: 'o/r', folder: 28, title: 'T', agents: [], grade: 'public', approved: true, readable: true, created_at: '', updated_at: '' }
const row = (order: number, from: number, to: number[], text: string) => ({ order, from: { seat: from }, to: to.map((seat) => ({ seat })), text })
const rows = [row(1, 0, [1], '하나.'), row(2, 1, [2], '둘.'), row(3, 2, [3], '셋.'), row(4, 3, [0], '넷.')]
const status: StatusMap = Object.fromEntries([0, 1, 2, 3].map((i) => [`agent_${i}`, { state: 'idle' as const, since: 0 }]))
const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']

function meet(decision: string | null, followUp: string | null, shift = 0, seats = 4) {
  // the real scene rasters its own footprint: where the planner's cells fall against the seats differs a little
  const fp = decodeFootprint(FOOTPRINT_DATA)
  const planner = new TrafficPlanner(buildGrid({ ...fp, minX: fp.minX + shift, minZ: fp.minZ + shift * 0.7 }, GRAPH), GRAPH)
  const r = new MeetingRunner()
  r.start(buildScript(meta, conversations({ minutes: [{ date: null, rows: rows.filter((r) => r.from.seat < seats && r.to.every((t) => t.seat < seats)), decision, followUp }] })), 0, status)
  // they start at their desks
  AGENTS.forEach((a, k) => planner.place(a, { spot: `work_${k}`, pace: 1 }, 0, k))
  const departs = new Map<string, number>()
  let min = Infinity
  let phases = new Set<string>()
  let gathered = 0
  let t = 0
  for (let i = 0; i < 4000 && r.busy; i++, t += 0.05) {
    const now = t * 1000
    // the director would send everybody to its desk
    const goals: Record<string, Goal> = Object.fromEntries(AGENTS.map((a, k) => [a, { spot: `work_${k}`, pose: 'idle', label: 'x' } as Goal]))
    r.apply(now, (a) => (planner.has(a) ? planner.sample(a, t).arrived : null), goals, undefined, {
      at: (a) => (planner.has(a) ? planner.sample(a, t) : null),
      spot: (s) => GRAPH.spots[s] ?? null,
    })
    for (const a of AGENTS) {
      const g = goals[a]
      let notBefore: number | undefined
      if (g.depart !== undefined) {
        const key = `${a}|${g.spot}|${g.depart}`
        notBefore = departs.get(key) ?? t + Math.max(0, (g.depart - now) / 1000)
        departs.set(key, notBefore)
      }
      planner.request(a, requestOf(g, 1, notBefore), t, AGENTS.indexOf(a))
    }
    planner.update(t)
    if (r.phase) phases.add(r.phase)
    if (r.phase === 'lines' && !gathered) gathered = t
    const s = AGENTS.map((a) => planner.sample(a, t))
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) min = Math.min(min, Math.hypot(s[p].x - s[q].x, s[p].z - s[q].z))
  }
  return { min, phases, gathered, ended: !r.busy, planner, t }
}

describe('a meeting through the traffic planner (#141)', () => {
  it('with a decision and a follow-up: gathers on the open circle, posts at the board, disperses, nobody closer than 2R', () => {
    const m = meet('정했다.', '루프가 한다.')
    expect(m.ended).toBe(true)
    expect([...m.phases]).toEqual(['gather', 'lines', 'decide', 'follow'])
    expect(m.gathered).toBeGreaterThan(0)
    expect(m.gathered).toBeLessThan(20)
    expect(m.gathered).toBeGreaterThan(5) // they walk from the desks
    console.log(`meeting with decision: min pair distance ${m.min.toFixed(3)} m over ${m.t.toFixed(0)} s, gathered at ${m.gathered.toFixed(1)} s`)
    expect(m.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
  })
  it('the formation settles wherever the cells fall (the scene rasters its own footprint)', () => {
    for (const shift of [0.02, 0.05, 0.08, 0.11, 0.14]) {
      for (const seats of [3, 4]) {
        const m = meet('정했다.', null, shift, seats)
        expect(m.gathered, 'shift ' + shift + ', ' + seats + ' seats').toBeLessThan(20)
        expect(m.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
      }
    }
  })
  it('without a decision: the closed circle at the floor centre, nobody closer than 2R', () => {
    const m = meet(null, null)
    expect(m.ended).toBe(true)
    console.log(`meeting without decision: min pair distance ${m.min.toFixed(3)} m`)
    expect(m.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
    expect(seatLabel(0)).toBe('meet_seat_0')
  })
})
