import { afterEach, describe, expect, it, vi } from 'vitest'
import { FOOTPRINT_DATA } from '../office/footprint.data'
import { buildGrid, decodeFootprint } from '../office/grid'
import { MeetingRunner } from '../office/meetingRun'
import { GRAPH } from '../office/navSpots.fixture'
import { TrafficPlanner } from '../office/traffic'
import agentOffice from '../timeline/fixtures/agent-office.json'
import hub from '../timeline/fixtures/test/rowansong.dev.2026-11-08.json'
import type { Point } from '../timeline/types'
import { dayId } from './days'
import { atMs, issueRange, prepare } from './engine'
import { Stage } from './stage'
import { FADE_OUT_MS, ReplayStore } from './store'
import { stageSpot } from './walk'

const OFFICE = 'Rowan-Hyeho-Song/agent-office'
const HUB = 'Rowan-Hyeho-Song/rowansong.dev'
const POINTS = [...(agentOffice.points as unknown as Point[]), ...(hub.points as unknown as Point[])]
const at = (iso: string) => Date.parse(iso)

async function opened(opts: Parameters<ReplayStore['open']>[0] = { mode: 'office' }) {
  const store = new ReplayStore()
  store.source = async () => POINTS
  store.reduced = () => true
  await store.open({ mode: 'office', ...opts })
  return store
}

afterEach(() => vi.useRealTimers())

describe('which day opens (timelapse.md 10.5)', () => {
  it('the wall clock / HUD button: the latest day that has points, at its first point, playing', async () => {
    const s = await opened({ project: 'all' })
    const st = s.getSnapshot()
    expect(st.day).toBe('2026-11-08')
    expect(st.i).toBe(0)
    expect(st.count).toBe(210)
    expect(st.playing).toBe(true)
    expect(s.points.every((p) => dayId(atMs(p)) === '2026-11-08')).toBe(true)
  })
  it('a share link: the day that holds t, the last point at or before t, paused', async () => {
    const t = at('2026-11-06T05:00:00Z')
    const s = await opened({ project: 'all', t })
    const st = s.getSnapshot()
    expect(st.day).toBe('2026-11-06')
    expect(st.playing).toBe(false)
    expect(atMs(s.point!)).toBeLessThanOrEqual(t)
    expect(s.points[st.i + 1] === undefined || atMs(s.points[st.i + 1]) > t).toBe(true)
  })
  it('a t on a day without points opens the nearest earlier day, at its last point', async () => {
    const s = await opened({ project: 'all', t: at('2026-11-12T00:00:00Z') })
    expect(s.getSnapshot().day).toBe('2026-11-08')
    expect(s.getSnapshot().i).toBe(209)
    const gap = await opened({ project: 'all', t: at('2026-11-01T00:00:00Z') })
    expect(gap.getSnapshot().day).toBe('2026-11-05')
    expect(gap.getSnapshot().i).toBe(0)
  })
  it('"▶ 이 날 보기" in the list: that day from its first point, playing, in the office', async () => {
    const s = await opened({ project: 'all', mode: 'list' })
    expect(s.getSnapshot().mode).toBe('list')
    await s.showDay('all', '2026-11-06')
    const st = s.getSnapshot()
    expect(st.mode).toBe('office')
    expect(st.day).toBe('2026-11-06')
    expect(st.i).toBe(0)
    expect(st.playing).toBe(true)
    expect(s.landedVia).toBe('seek')
    // "사무실에서 보기": the latest day
    await s.showDay(HUB, null)
    expect(s.getSnapshot().day).toBe('2026-11-08')
    expect(s.getSnapshot().project).toBe(HUB)
  })
  it('the project follows the day: the same day, else the nearest earlier, else the first later', async () => {
    const s = await opened({ project: 'all', day: '2026-11-06' })
    await s.setProject(HUB)
    expect(s.getSnapshot().day).toBe('2026-11-06')
    // agent-office has nothing on 11.05 or 11.06: from the desk room's 11.05 it goes on to its first day
    await s.setProject('all')
    s.selectDay('2026-11-05')
    await s.setProject(OFFICE)
    expect(s.getSnapshot().day).toBe('2026-11-07')
    expect(s.points.every((p) => p.project === OFFICE)).toBe(true)
    // the desk room's 11.07 -> the office has 11.07 too: it stays
    await s.setProject(HUB)
    expect(s.getSnapshot().day).toBe('2026-11-07')
  })
})

describe('previous / next day', () => {
  it('goes to the first point of the day with data, skipping days without, and stops at the ends', async () => {
    const s = await opened({ project: 'all' })
    expect(s.adjacent(1)).toBeNull()
    expect(s.adjacent(-1)!.id).toBe('2026-11-07')
    expect(s.goDay(-1)).toBe(true)
    expect(s.getSnapshot().day).toBe('2026-11-07')
    expect(s.getSnapshot().i).toBe(0)
    expect(s.getSnapshot().count).toBe(18)
    expect(s.goDay(-1)).toBe(true)
    expect(s.goDay(-1)).toBe(true)
    expect(s.getSnapshot().day).toBe('2026-11-05')
    expect(s.adjacent(-1)).toBeNull()
    expect(s.goDay(-1)).toBe(false)
    expect(s.getSnapshot().day).toBe('2026-11-05')
    expect(s.goDay(1)).toBe(true)
    expect(s.getSnapshot().day).toBe('2026-11-06')
  })
  it('keeps playing as it was, or plays when asked (the end card)', async () => {
    const s = await opened({ project: 'all', day: '2026-11-06' })
    s.pause()
    s.goDay(1)
    expect(s.getSnapshot().playing).toBe(false)
    s.goDay(1, { play: true })
    expect(s.getSnapshot().playing).toBe(true)
  })
  it('the board and the shelf are the state at that moment, not just that day', async () => {
    const s = await opened({ project: 'all', day: '2026-11-08' })
    const first = s.scene()!
    // the first point of the 8th already has the binders of the earlier days
    expect(first.layout.binders.length).toBeGreaterThan(0)
    expect(first.index).toBe(52) // the 52 points of the earlier days are folded in
  })
  it('selecting the day already shown does nothing; another day switches to it', async () => {
    const s = await opened({ project: 'all' })
    expect(s.selectDay('2026-11-08')).toBe(false)
    expect(s.selectDay('2026-11-06')).toBe(true)
    expect(s.getSnapshot().day).toBe('2026-11-06')
    // a day without data resolves to the nearest earlier one
    expect(s.selectDay('2026-11-09')).toBe(true)
    expect(s.getSnapshot().day).toBe('2026-11-08')
  })
})

describe('the fade hides the change (timelapse.md 10.4)', () => {
  it('dims, swaps in the dark after 160 ms, and a second press continues from the day it was heading for', async () => {
    vi.useFakeTimers()
    const s = await opened({ project: 'all' })
    s.reduced = () => false
    expect(s.goDay(-1)).toBe(true)
    // still the old day on screen, the picture dimmed
    expect(s.getSnapshot().fade).toBe(true)
    expect(s.getSnapshot().day).toBe('2026-11-08')
    expect(s.currentDay).toBe('2026-11-07')
    // pressed again during the fade: two days back, not one twice
    expect(s.goDay(-1)).toBe(true)
    expect(s.currentDay).toBe('2026-11-06')
    vi.advanceTimersByTime(FADE_OUT_MS)
    expect(s.getSnapshot().day).toBe('2026-11-06')
    expect(s.getSnapshot().fade).toBe(false)
    expect(s.getSnapshot().flip).toBeNull()
  })
  it('the clock does not run while the picture is dark', async () => {
    vi.useFakeTimers()
    const s = await opened({ project: 'all' })
    s.reduced = () => false
    s.goDay(-1)
    const clock = s.clock
    s.advance(1000)
    expect(s.clock).toBe(clock)
  })
  it('reduced motion: no fade, the day changes at once', async () => {
    const s = await opened({ project: 'all' })
    s.goDay(-1)
    expect(s.getSnapshot().fade).toBe(false)
    expect(s.getSnapshot().day).toBe('2026-11-07')
  })
})

describe('teleport: nobody walks in when the replay opens or the day changes', () => {
  const planner = () => new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
  const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
  const standingAtScene = (stage: Stage, s: ReplayStore) => {
    const scene = s.scene()!
    for (const id of IDS) {
      const seat = Number(id.split('_')[1])
      const sample = stage.sample(id)
      expect(sample.arrived).toBe(stageSpot(scene.point, seat))
      expect(sample.moving).toBe(false)
    }
  }

  it('opening playing: everyone is at the first scene spot at once', async () => {
    const s = await opened({ project: 'all' })
    const stage = new Stage({ store: s, planner: planner(), meeting: new MeetingRunner(), ids: IDS, reduced: () => false, spot: (id) => GRAPH.spots[id] ?? null })
    expect(s.getSnapshot().playing).toBe(true)
    stage.begin()
    standingAtScene(stage, s)
  })
  it('a day change is a seek landing: the stage puts everyone at the new scene in the same frame', async () => {
    const s = await opened({ project: 'all', day: '2026-11-07' })
    const stage = new Stage({ store: s, planner: planner(), meeting: new MeetingRunner(), ids: IDS, reduced: () => false, spot: (id) => GRAPH.spots[id] ?? null })
    stage.begin()
    // go to a day whose first point is a plan (an agent walks to the whiteboard), then back
    for (const day of ['2026-11-08', '2026-11-06', '2026-11-07']) {
      s.selectDay(day)
      expect(s.landedVia).toBe('seek')
      stage.frame(16)
      standingAtScene(stage, s)
    }
  })
})

describe('the end of a day (timelapse.md 10.7)', () => {
  it('stops at the last point of the day, does not go on to the next day and does not return to live', async () => {
    vi.useFakeTimers()
    const s = await opened({ project: 'all', day: '2026-11-07' })
    expect(s.getSnapshot().count).toBe(18)
    for (let n = 0; n < 5000 && !s.getSnapshot().ended; n++) s.advance(500)
    const st = s.getSnapshot()
    expect(st.ended).toBe(true)
    expect(st.playing).toBe(false)
    expect(st.i).toBe(17)
    expect(st.day).toBe('2026-11-07')
    s.advance(60_000)
    vi.advanceTimersByTime(60_000)
    expect(s.getSnapshot().mode).toBe('office')
    expect(s.getSnapshot().day).toBe('2026-11-07')
    // "처음부터 다시"
    s.play()
    expect(s.getSnapshot().i).toBe(0)
    expect(s.getSnapshot().ended).toBe(false)
    expect(s.getSnapshot().playing).toBe(true)
  })
  it('a day never plays a day flip: the span between days is not in the window', async () => {
    const s = await opened({ project: 'all', day: '2026-11-08' })
    expect(s.untilBoundary()).toBeGreaterThan(0)
    for (let n = 0; n < 4000 && !s.getSnapshot().ended; n++) s.advance(500)
    expect(s.getSnapshot().flip).toBeNull()
  })
})

describe('an issue replay (timelapse.md 10.6)', () => {
  const base = prepare(POINTS, OFFICE)
  const range = issueRange(base, OFFICE, 1)!

  it('opens on the issue\'s span, not a day: the day is none, the issue\'s points only, from its first', async () => {
    expect(range).not.toBeNull()
    const s = await opened({ issue: { repo: OFFICE, n: 1, lo: range.lo, hi: range.hi } })
    const st = s.getSnapshot()
    expect(st.day).toBeNull()
    expect(st.issue).toEqual({ repo: OFFICE, n: 1 })
    expect(st.count).toBe(range.hi - range.lo + 1)
    expect(st.playing).toBe(true)
    expect(s.point).toBe(base[range.lo])
    expect(s.adjacent(1)).toBeNull()
  })
  it('the chip\'s x: the day view of the day the playhead is in, on the same point, without a fade', async () => {
    const s = await opened({ issue: { repo: OFFICE, n: 1, lo: range.lo, hi: range.hi } })
    s.reduced = () => false
    s.seek(s.points.length - 1)
    const here = s.point!
    s.pause()
    s.endIssue()
    const st = s.getSnapshot()
    expect(st.issue).toBeNull()
    expect(st.fade).toBe(false)
    expect(st.day).toBe(dayId(atMs(here)))
    expect(s.point).toBe(here)
    expect(s.points.every((p) => dayId(atMs(p)) === st.day && p.project === OFFICE)).toBe(true)
    expect(st.playing).toBe(false)
  })
  it('Shift + arrows inside an issue still step by day of the span', async () => {
    const s = await opened({ issue: { repo: OFFICE, n: 1, lo: range.lo, hi: range.hi } })
    const days = new Set(s.points.map((p) => dayId(atMs(p))))
    s.dayStep(1)
    expect(dayId(atMs(s.point!))).toBe([...days].at(-1))
  })
})

describe('the list', () => {
  it('opened from the office it marks the day that was being viewed', async () => {
    const s = await opened({ project: 'all', day: '2026-11-06' })
    s.setMode('list')
    expect(s.markDay).toBe('2026-11-06')
    s.setMode('office')
    s.setMode('list')
    expect(s.markDay).toBe('2026-11-06')
    const fresh = await opened({ project: 'all', mode: 'list' })
    expect(fresh.markDay).toBeNull()
  })
})

describe('the time left', () => {
  it('reads 0 once the end card is up, at any speed, not the 3 s the last point lasts', async () => {
    const { remainingMs } = await import('./engine')
    const s = await opened({ project: 'all', day: '2026-11-05' })
    s.seek(s.points.length - 1)
    // standing on the last point (not played to the end) still has its own step ahead
    expect(remainingMs(s.points, s.getSnapshot().i, 1)).toBe(3000)
    for (let n = 0; n < 100 && !s.getSnapshot().ended; n++) s.advance(500)
    expect(s.getSnapshot().ended).toBe(true)
    for (const speed of [1, 4, 16] as const) expect(remainingMs(s.points, s.getSnapshot().i, speed, undefined, s.getSnapshot().ended)).toBe(0)
  })
})
