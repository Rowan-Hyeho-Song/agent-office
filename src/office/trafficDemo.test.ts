import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from './footprint.data'
import { buildGrid, decodeFootprint } from './grid'
import { GRAPH } from './navSpots.fixture'
import { TRAFFIC, TrafficPlanner } from './traffic'
import { DEMO_HOLD_S, TRAFFIC_DEMOS, demoRequest, type DemoKind } from './trafficDemo'

/** the demo as the scene runs it: place at the start, then request the far end; cues seen and the closest approach */
function play(kind: DemoKind) {
  const p = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
  const d = { kind, at: 0 }
  const ids = TRAFFIC_DEMOS[kind].map((l) => l.id)
  ids.forEach((id, i) => p.place(id, demoRequest(d, id, 0)!.req, 0, i))
  const cues = new Set<string>()
  let yieldGesture = false
  let min = Infinity
  for (let t = 0; t <= 40; t += 0.05) {
    ids.forEach((id) => p.request(id, demoRequest(d, id, t)!.req, t))
    p.update(t)
    const s = ids.map((id) => p.sample(id, t))
    for (const x of s) {
      if (x.cue) cues.add(x.cue.kind)
      if (x.cue?.kind === 'yield' && x.cue.gesture) yieldGesture = true
    }
    min = Math.min(min, Math.hypot(s[0].x - s[1].x, s[0].z - s[1].z))
  }
  return { cues, yieldGesture, min, end: ids.map((id) => p.sample(id, 40).arrived) }
}

describe('traffic demos (?debug=1 trafficDemo)', () => {
  it('narrow: the two meet in the lane, one yields, both reach the far end, never closer than 2R', () => {
    const r = play('narrow')
    // #272: one steps aside and the cue is a yield, with its gesture (it used to be classed 'wide' because the one aside is already setting off again at the closest approach)
    expect(r.cues.has('yield')).toBe(true)
    expect(r.yieldGesture).toBe(true)
    expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
    expect(r.end).toEqual(['demo_narrow_agent_0_to', 'demo_narrow_agent_1_to'])
  })
  it('wide: head on in the open, they pass keeping right, never closer than 2R', () => {
    const r = play('wide')
    expect(r.cues.has('pass') || r.cues.has('wide')).toBe(true)
    expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
    expect(r.end).toEqual(['demo_wide_agent_0_to', 'demo_wide_agent_1_to'])
  })
  it('holds at the start first', () => {
    expect(demoRequest({ kind: 'wide', at: 5 }, 'agent_0', 5 + DEMO_HOLD_S / 2)!.start).toBe(true)
    expect(demoRequest({ kind: 'wide', at: 5 }, 'agent_0', 5 + DEMO_HOLD_S)!.start).toBe(false)
    expect(demoRequest({ kind: 'wide', at: 5 }, 'agent_2', 9)).toBeNull()
  })
})
