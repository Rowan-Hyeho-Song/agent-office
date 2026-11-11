import { describe, expect, it } from 'vitest'
import { FOOTPRINT_DATA } from '../office/footprint.data'
import { buildGrid, decodeFootprint } from '../office/grid'
import { MeetingRunner } from '../office/meetingRun'
import { GRAPH } from '../office/navSpots.fixture'
import { TRAFFIC, TrafficPlanner } from '../office/traffic'
import type { Point } from '../timeline/types'
import agentOffice from '../timeline/fixtures/agent-office.json'
import { atMs, type Speed } from './engine'
import { DrawnTrack, lineMode, SCREEN_MPS, Stage, startMinutes } from './stage'
import { ReplayStore } from './store'
import { REPLAY_PACE } from './walk'

const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const POINTS = agentOffice.points as unknown as Point[]
// plan points (the planner walks to the whiteboard) and a minutes point (a meeting) lie in this stretch of the fixture
const FROM = 30
/** the fastest a walker goes: the planner's cruise speed at the replay pace */
const WALKER_MPS = TRAFFIC.cruise * REPLAY_PACE
/** a new plan may shift the shown position by a few cm (the shown time is a little ahead of the planned one) */
// 0.10 (was 0.08): the memo seat (#195) is the end of a dock lane under the window; its first frame leaving shifts 0.089 m past the walker's step
// (0.36 m in a 0.27 s frame at x16), a replan snap and not a teleport (planning accepted 2026-11-10; the teleport guards of #228 stay separate)
const REPLAN_SLACK_M = 0.1

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
  const stage = new Stage({ store, planner, meeting, ids: IDS, door: GRAPH.spots.door ? { x: GRAPH.spots.door.x, z: GRAPH.spots.door.z } : undefined, reduced: () => false, spot: (id) => GRAPH.spots[id] ?? null })
  store.play()
  stage.begin()
  const dt = 1000 / fps
  const snaps: Record<number, unknown> = {}
  let maxStep = 0
  let maxRate = 0
  let excess = -Infinity
  let frames = 0
  let prev = IDS.map((id) => stage.sample(id))
  const drawn = new DrawnTrack()
  let prevDrawn = IDS.map((id, k) => drawn.follow(id, prev[k].x, prev[k].z, dt / 1000)).map((p) => ({ ...p }))
  let drawnRate = 0
  let lag = 0
  let meetings = 0
  let walked = 0
  let placedCount = 0
  for (const until of checkpoints) {
    while (stage.clock < until) {
      const adv = stage.frame(dt, until)
      frames++
      const cur = IDS.map((id) => stage.sample(id))
      // a schedule change put down at once (x16, timelapse.md 12.2) is the one jump that is meant; it is counted, not measured
      const placed = stage.takePlaced()
      placedCount += placed.length
      if (adv > 0) {
        // the shown time moves by what the frame spent; nobody jumps further than they can walk meanwhile
        cur.forEach((c, k) => {
          if (placed.includes(IDS[k])) return
          const d = Math.hypot(c.x - prev[k].x, c.z - prev[k].z)
          maxStep = Math.max(maxStep, d)
          maxRate = Math.max(maxRate, d / ((dt * speed) / 1000))
          excess = Math.max(excess, d - (WALKER_MPS * (dt * speed)) / 1000)
          if (c.moving) walked++
        })
      }
      // the drawn bodies follow the plan positions at the screen speed cap, per frame of real time
      const dr = IDS.map((id, k) => ({ ...drawn.follow(id, cur[k].x, cur[k].z, dt / 1000) }))
      dr.forEach((p, k) => {
        drawnRate = Math.max(drawnRate, Math.hypot(p.x - prevDrawn[k].x, p.z - prevDrawn[k].z) / (dt / 1000))
        lag = Math.max(lag, Math.hypot(p.x - cur[k].x, p.z - cur[k].z))
      })
      prevDrawn = dr
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
  return { snaps, maxStep, maxRate, excess, drawnRate, lag, frames, meetings, walked, placedCount, store }
}

const CHECK = [5000, 12_000, 20_000, 31_000, 45_000, 70_000, 100_000]

describe('the replay stage', () => {
  // timelapse.md 12.2 replaces "x1 and x16 agree on every position": x1 and x4 walk the schedule's changes, x16 puts the body down at once, so the walkers
  // are compared at x1 and x4 (the same replay clock, only run faster), and x16 on what it still promises (the meeting is walked, the screen cap, no big jump)
  it('plays x1 and x4 to the same positions and poses at the same replay time, and nobody teleports', async () => {
    const a = await run(1, CHECK)
    const b = await run(4, CHECK)
    console.log(`stage: x1 ${a.frames} frames, max step ${a.maxStep.toFixed(3)} m (${a.excess.toFixed(3)} m over a walker), ${a.walked} moving samples, ${a.meetings} meeting frames; x4 ${b.frames} frames, max step ${b.maxStep.toFixed(3)} m (${b.excess.toFixed(3)} m over a walker), ${b.walked} moving samples, ${b.meetings} meeting frames`)
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
    // the drawn position never moves faster than the screen cap, and follows (no teleport to catch up)
    expect(a.drawnRate).toBeLessThanOrEqual(SCREEN_MPS + 1e-9)
    expect(b.drawnRate).toBeLessThanOrEqual(SCREEN_MPS + 1e-9)
    console.log(`drawn: x1 max ${a.drawnRate.toFixed(2)} m/s, lag ${a.lag.toFixed(2)} m; x4 max ${b.drawnRate.toFixed(2)} m/s, lag ${b.lag.toFixed(2)} m`)
    // both speeds walked and held the meeting
    expect(a.walked).toBeGreaterThan(0)
    expect(b.walked).toBeGreaterThan(0)
    expect(a.meetings).toBeGreaterThan(0)
    expect(b.meetings).toBeGreaterThan(0)
    // no teleport: per frame nobody moves further than a walker could (cruise x replay pace), plus a few cm of replan shift
    expect(a.excess).toBeLessThan(REPLAN_SLACK_M)
    expect(b.excess).toBeLessThan(REPLAN_SLACK_M)
    // x1 and x4 walk every schedule change: nobody is put down
    expect(a.placedCount).toBe(0)
    expect(b.placedCount).toBe(0)
  }, 120_000)

  it('x16 walks the meeting but puts a schedule change down at once, and the drawn bodies still obey the screen speed cap', async () => {
    const c = await run(16, CHECK)
    expect(c.meetings).toBeGreaterThan(0)
    expect(c.walked).toBeGreaterThan(0)
    expect(c.drawnRate).toBeLessThanOrEqual(SCREEN_MPS + 1e-9)
    // nobody who walks jumps further than a walker (the put-down bodies are not measured)
    expect(c.excess).toBeLessThan(REPLAN_SLACK_M)
    expect(c.placedCount).toBeGreaterThan(0)
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

describe('how a meeting line shows by speed', () => {
  it('x1 bubbles, x4 full bubbles unless shorter than 0.6 s real, x16 the subtitle', () => {
    expect(lineMode(1, 100)).toBe('bubble')
    expect(lineMode(4, 2400)).toBe('full')
    expect(lineMode(4, 2399)).toBe('subtitle')
    expect(lineMode(16, 60_000)).toBe('subtitle')
  })
})
