// The timelapse's stage (#158): what the office does at replay time tau, with the speed reduced to the rate tau advances at.
// Pure (no three.js, no DOM): the 3D scene feeds it real frame time and reads goals and the planner's samples back; the
// determinism test drives the very same code with fake frames.
//
// A frame adds real dt x speed to a pending amount of replay time and spends it in ticks of at most TICK_MS, each cut short
// at the playhead's next boundary. A tick moves the clock, lets the playhead land, takes the goals at that tau (scene spots,
// the meeting), asks the traffic planner for them and replans. The ticks depend only on the replay's own state, never on the
// frame length, so x1 and x16 run the identical sequence and agree on every position and pose at the same tau.

import type { Goal } from '../office/director'
import type { MeetingRunner } from '../office/meetingRun'
import type { DocMeta } from '../docs/library'
import { requestOf } from '../office/director'
import type { StatusMap } from '../office/status'
import { TrafficPlanner, type Sample } from '../office/traffic'
import type { Point } from '../timeline/types'
import { replayGoals, scriptFor } from './scene'
import type { ReplayStore } from './store'
import { HOLD_CAP_MS } from './store'
import { REPLAY_PACE, stageSpot, WALK_HOLD_MS } from './walk'

/** the longest piece of replay time one tick covers, ms */
export const TICK_MS = 50

export interface StageEnv {
  store: ReplayStore
  /** a planner of the replay's own: its clock is tau, so the live planner's clock is never disturbed */
  planner: TrafficPlanner
  meeting: MeetingRunner
  ids: readonly string[]
  /** where to turn for the owner's line */
  door?: { x: number; z: number }
  reduced: () => boolean
  /** a nav spot's floor position (the meeting's formation is laid out around the talk circles) */
  spot?: (id: string) => { x: number; z: number } | null
}

const seatOf = (id: string) => Number(id.split('_')[1])

export class Stage {
  /** the goals at the last tick */
  goals: Record<string, Goal> = {}
  /** someone is still walking to a scene spot */
  walking = false
  private pending = 0
  private seen = -1
  private ready = false

  constructor(private env: StageEnv) {
    env.store.hold = this.holdCap
  }

  get planner() {
    return this.env.planner
  }

  dispose() {
    this.env.store.hold = () => 0
  }

  /** how long the next point may wait (replay ms): for a meeting, or briefly for walkers */
  holdCap = () => (this.env.meeting.busy ? HOLD_CAP_MS : this.walking ? WALK_HOLD_MS : 0)

  /** the replay time the screen shows: the committed clock plus what the current frame has not spent yet, ms */
  get now() {
    return this.env.store.clock + this.pending
  }
  /** the committed clock (what the last tick computed), ms */
  get clock() {
    return this.env.store.clock
  }

  /**
   * Open the stage (#362, timelapse.md 10.4): everyone is put at their spot of the first scene at once, playing or not
   * (the screen is dimmed meanwhile). Nobody walks in from where they stood in the live office.
   */
  begin() {
    this.seen = this.env.store.landings
    this.ready = true
    this.evaluate(true)
  }

  /** the planner's sample of an agent at the shown replay time */
  sample(id: string): Sample {
    return this.env.planner.sample(id, this.now / 1000)
  }

  /**
   * One frame of `dtMs` real ms. Returns the replay ms it advanced (0 when paused). `until` stops the clock there
   * (tests compare two speeds at the same tau); `onTick` runs after each tick (the scene moves the rigs there).
   */
  frame(dtMs: number, until = Infinity, onTick?: (clock: number, len: number) => void): number {
    const { store } = this.env
    if (!this.ready) return 0
    const c0 = store.clock
    let ran = false
    // a viewer's seek is a jump: everyone is at the point's spots at once
    if (this.seen !== store.landings) {
      this.seen = store.landings
      if (store.landedVia === 'seek') {
        this.pending = 0
        this.evaluate(true)
        ran = true
      }
    }
    const s = store.getSnapshot()
    if (s.mode === 'office' && s.playing) this.pending += dtMs * s.speed
    while (store.getSnapshot().playing) {
      const len = Math.min(TICK_MS, store.untilBoundary())
      if (this.pending < len || store.clock + len > until) break
      this.pending -= len
      store.advance(len)
      this.seen = store.landings
      this.evaluate(false)
      onTick?.(store.clock, len)
      ran = true
    }
    if (!store.getSnapshot().playing) this.pending = 0
    if (!ran && !Object.keys(this.goals).length) this.evaluate(false)
    return store.clock - c0
  }

  private arrivedAt = (id: string, tau: number) => (this.env.planner.has(id) ? this.env.planner.sample(id, tau / 1000).arrived : null)

  /** the goals at the clock, and the planner's requests for them (`place` = stand there at once) */
  private evaluate(snap: boolean) {
    const { store, planner, meeting, ids, door } = this.env
    const scene = store.scene()
    if (!scene) return
    const tau = store.clock
    const spots: Record<string, string> = {}
    for (const id of ids) spots[id] = this.env.reduced() ? `work_${seatOf(id)}` : stageSpot(scene.point, seatOf(id))
    const goals = replayGoals(scene.status, spots)
    const place = { at: (a: string) => (planner.has(a) ? planner.position(a, tau / 1000) : null), spot: (sp: string) => this.env.spot?.(sp) ?? null }
    meeting.apply(tau, (a) => this.arrivedAt(a, tau), goals, door, place)
    for (const id of ids) {
      const g = goals[id]
      if (!g || g.pose === 'leave') continue
      // a staggered departure is in replay ms, the planner runs on replay seconds
      const req = requestOf(g, REPLAY_PACE, g.depart !== undefined ? g.depart / 1000 : undefined)
      if (snap) planner.place(id, req, tau / 1000, seatOf(id))
      else planner.request(id, req, tau / 1000, seatOf(id))
    }
    planner.update(tau / 1000)
    this.goals = goals
    this.walking = ids.some((id) => goals[id] && goals[id].pose !== 'leave' && this.arrivedAt(id, tau) !== goals[id].spot)
  }
}

/** the fastest a body moves on screen in the timelapse, m/s of real time (timelapse.md, x16 rules) */
export const SCREEN_MPS = 6

/**
 * The drawn position follows the replay-clock position (the truth) at no more than SCREEN_MPS of real time: when it
 * lags it heads straight for where the truth is now, so nobody teleports. `reset` (a seek, a new stage) snaps.
 */
export class DrawnTrack {
  private at = new Map<string, { x: number; z: number }>()
  reset() {
    this.at.clear()
  }
  follow(id: string, x: number, z: number, realDtS: number): { x: number; z: number } {
    const q = this.at.get(id)
    if (!q) {
      const p = { x, z }
      this.at.set(id, p)
      return p
    }
    const dx = x - q.x
    const dz = z - q.z
    const d = Math.hypot(dx, dz)
    const max = SCREEN_MPS * Math.max(0, realDtS)
    if (d <= max) {
      q.x = x
      q.z = z
    } else {
      q.x += (dx / d) * max
      q.z += (dz / d) * max
    }
    return q
  }
}

/** how a meeting line shows at this speed: a speech bubble (typed), a bubble that is there in full at once, or the subtitle line */
export function lineMode(speed: number, lineMs: number): 'bubble' | 'full' | 'subtitle' {
  if (speed <= 1) return 'bubble'
  if (speed >= 16) return 'subtitle'
  return lineMs / speed >= 600 ? 'full' : 'subtitle'
}

/** a minutes point plays its brief meeting from the clock it landed on (a late body load does not move its start) */
export function startMinutes(meeting: MeetingRunner, p: Point, meta: DocMeta | undefined, convs: Parameters<typeof scriptFor>[2], at: number, status: StatusMap): boolean {
  return meeting.start(scriptFor(p, meta, convs, false), at, status, {})
}
