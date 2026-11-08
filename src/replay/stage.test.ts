import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from '../office/footprint.data'
import { buildGrid, decodeFootprint } from '../office/grid'
import { MeetingRunner } from '../office/meetingRun'
import { GRAPH } from '../office/navSpots.fixture'
import { TRAFFIC, TrafficPlanner } from '../office/traffic'
import type { Point } from '../timeline/types'
import agentOffice from '../timeline/fixtures/agent-office.json'
import { atMs, type Speed } from './engine'
import { Stage, startMinutes } from './stage'
import { ReplayStore } from './store'
import { REPLAY_PACE } from './walk'

const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const POINTS = agentOffice.points as unknown as Point[]
// plan points (the planner walks to the whiteboard) and a minutes point (a meeting) lie in this stretch of the fixture
const FROM = 30
/** the fastest a walker goes: the planner's cruise speed at the replay pace */
const WALKER_MPS = TRAFFIC.cruise * REPLAY_PACE
/** a new plan may shift the shown position by a few cm (the shown time is a little ahead of the planned one) */
const REPLAN_SLACK_M = 0.08

async function run(speed: Speed, checkpoints: number[], fps = 60) {
  const store = new ReplayStore()
  store.source = async () => POINTS
  await store.open({ project: 'all', t: atMs(POINTS[FROM]), mode: 'office' })
  store.setSpeed(speed)
  const meeting = new MeetingRunner()
  store.onPoint((p, via) => {
    meeting.stop()
    if (via === 'play' && p.kind === 'minutes') startMinutes(meeting, p, undefined, null, store.landedClock, store.scene()!.status)
  })
  const planner = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
  const stage = new Stage({ store, planner, meeting, ids: IDS, door: GRAPH.spots.door ? { x: GRAPH.spots.door.x, z: GRAPH.spots.door.z } : undefined, reduced: () => false })
  store.play()
  stage.begin()
  const dt = 1000 / fps
  const snaps: Record<number, unknown> = {}
  let maxStep = 0
  let maxRate = 0
  let excess = -Infinity
  let frames = 0
  let prev = IDS.map((id) => stage.sample(id))
  let meetings = 0
  let walked = 0
  for (const until of checkpoints) {
    while (stage.clock < until) {
      const adv = stage.frame(dt, until)
      frames++
      const cur = IDS.map((id) => stage.sample(id))
      if (adv > 0) {
        // the shown time moves by what the frame spent; nobody jumps further than they can walk meanwhile
        cur.forEach((c, k) => {
          const d = Math.hypot(c.x - prev[k].x, c.z - prev[k].z)
          maxStep = Math.max(maxStep, d)
          maxRate = Math.max(maxRate, d / ((dt * speed) / 1000))
          excess = Math.max(excess, d - (WALKER_MPS * (dt * speed)) / 1000)
          if (c.moving) walked++
        })
      }
      prev = cur
      if (meeting.phase === 'lines') meetings++
      if (frames > 2_000_000) throw new Error('replay does not advance')
    }
    const t = stage.clock / 1000
    snaps[until] = {
      i: store.getSnapshot().i,
      meeting: meeting.phase,
      agents: IDS.map((id) => {
        const s = planner.sample(id, t)
        return { id, x: s.x, z: s.z, arrived: s.arrived, spot: stage.goals[id]?.spot, pose: stage.goals[id]?.pose }
      }),
    }
  }
  return { snaps, maxStep, maxRate, excess, frames, meetings, walked, store }
}

const CHECK = [5000, 12_000, 20_000, 31_000, 45_000, 70_000, 100_000]

describe('the replay stage', () => {
  it('plays x1 and x16 to the same positions and poses at the same replay time, and nobody teleports', async () => {
    const a = await run(1, CHECK)
    const b = await run(16, CHECK)
    console.log(`stage: x1 ${a.frames} frames, max step ${a.maxStep.toFixed(3)} m (${a.excess.toFixed(3)} m over a walker), ${a.walked} moving samples, ${a.meetings} meeting frames; x16 ${b.frames} frames, max step ${b.maxStep.toFixed(3)} m (${b.excess.toFixed(3)} m over a walker), ${b.walked} moving samples, ${b.meetings} meeting frames`)
    for (const until of CHECK) {
      const x = a.snaps[until] as { i: number; meeting: string | null; agents: { x: number; z: number; arrived: string | null; spot: string; pose: string }[] }
      const y = b.snaps[until] as typeof x
      expect(y.i).toBe(x.i)
      expect(y.meeting).toBe(x.meeting)
      x.agents.forEach((p, k) => {
        expect(y.agents[k].x).toBeCloseTo(p.x, 6)
        expect(y.agents[k].z).toBeCloseTo(p.z, 6)
        expect(y.agents[k].arrived).toBe(p.arrived)
        expect(y.agents[k].spot).toBe(p.spot)
        expect(y.agents[k].pose).toBe(p.pose)
      })
    }
    // both speeds walked and held the meeting
    expect(a.walked).toBeGreaterThan(0)
    expect(b.walked).toBeGreaterThan(0)
    expect(a.meetings).toBeGreaterThan(0)
    expect(b.meetings).toBeGreaterThan(0)
    // no teleport: per frame nobody moves further than a walker could (cruise x replay pace), plus a few cm of replan shift
    expect(a.excess).toBeLessThan(REPLAN_SLACK_M)
    expect(b.excess).toBeLessThan(REPLAN_SLACK_M)
  }, 120_000)

  it('lands the playhead on the same clock at any speed', async () => {
    const landings = async (speed: Speed) => {
      const store = new ReplayStore()
      store.source = async () => POINTS
      await store.open({ project: 'all', t: atMs(POINTS[FROM]), mode: 'office' })
      store.setSpeed(speed)
      const got: number[] = []
      store.onPoint((_p, via) => via === 'play' && got.push(store.landedClock))
      store.play()
      // frames of 1/60 s real time; the clock only ever moves by what they carry
      while (store.clock < 30_000 && store.getSnapshot().playing) store.advance((1000 / 60) * speed)
      return got.filter((c) => c <= 30_000)
    }
    const a = await landings(1)
    const b = await landings(16)
    expect(a.length).toBeGreaterThan(2)
    expect(b.map((c) => Math.round(c))).toEqual(a.map((c) => Math.round(c)))
    // every landing is on a step boundary: 3 s a point (4.5 s a minutes point), whatever the speed
    expect(a.every((c, k) => k === 0 || [3000, 4500].includes(Math.round(c - a[k - 1])))).toBe(true)
  })
})
