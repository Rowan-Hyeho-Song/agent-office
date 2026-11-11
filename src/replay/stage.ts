// The timelapse's stage (#158): what the office does at replay time tau, with the speed reduced to the rate tau advances at.
// Pure (no three.js, no DOM): the 3D scene feeds it real frame time and reads goals and the planner's samples back; the
// determinism test drives the very same code with fake frames.
//
// A frame adds real dt x speed to a pending amount of replay time and spends it in ticks of at most TICK_MS, each cut short
// at the playhead's next boundary. A tick moves the clock, lets the playhead land, takes the goals at that tau (scene spots,
// the meeting), asks the traffic planner for them and replans. The ticks depend only on the replay's own state, never on the
// frame length, so x1 and x16 run the identical sequence and agree on every position and pose at the same tau.

import { Director, type Goal } from '../office/director'
import type { MeetingRunner } from '../office/meetingRun'
import type { DocMeta } from '../docs/library'
import { requestOf } from '../office/director'
import type { StatusMap } from '../office/status'
import { TrafficPlanner, type Sample } from '../office/traffic'
import type { Point } from '../timeline/types'
import { passOf } from '../office/minutes'
import { replayGoals, scriptFor } from './scene'
import { minutesLoading } from './minutesInfo'
import type { ReplayStore } from './store'
import { HOLD_CAP_MS, MINUTES_HOLD_CAP_MS } from './store'
import { atMs } from './engine'
import { REPLAY_PACE, stageSpot, WALK_HOLD_MS, WALK_MPS } from './walk'

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
  /** a 1:1 row of a minutes point starts: hand a paper from one agent to the other (the scene's PaperPlanes, paper-pass.md) */
  pass?: (from: string, to: string) => void
  /** the replay's own day (errands, play, rest: a Director that only this stage feeds); one is made when none is given */
  life?: Director
}

/** a walk is judged by the straight line times this (a route is longer than the line) */
const ROUTE_FACTOR = 1.3
/**
 * The longest a walk to a new schedule spot may take before the body is put there instead, replay ms (timelapse.md 12.2). The bodies walk on the replay
 * clock, so a walk takes the same replay time at x1, x4 and x16 (the speed only runs that clock faster): "the walk would not end before the next point"
 * does not depend on the speed here, and the room has no route near this long, so in practice only the x16 / reduced-motion rules put a body down.
 */
const WALK_CAP_MS = 30_000

const seatOf = (id: string) => Number(id.split('_')[1])

export class Stage {
  /** the goals at the last tick */
  goals: Record<string, Goal> = {}
  /** someone is still walking to a scene spot */
  walking = false
  private pending = 0
  private seen = -1
  private ready = false
  private speed: number
  /** the pass row that was handed over last (one pass per row) */
  private passed = ''
  private life: Director
  /** what each body's goal was last tick: its place, whether a meeting steered it, whether it was at the board */
  private last = new Map<string, { key: string; meet: boolean; board: boolean }>()
  private placedNow: string[] = []

  constructor(private env: StageEnv) {
    env.store.hold = this.holdCap
    this.speed = env.store.getSnapshot().speed
    this.life = env.life ?? new Director([...env.ids])
  }

  get planner() {
    return this.env.planner
  }

  dispose() {
    this.env.store.hold = () => 0
  }

  /** how long the next point may wait (replay ms): for a meeting, or briefly for walkers */
  holdCap = () =>
    this.env.meeting.busy
      ? this.env.meeting.script?.minutes
        ? MINUTES_HOLD_CAP_MS
        : HOLD_CAP_MS
      : // a minutes point whose document is still loading waits for its meeting (ReplayDriver starts it when the document is there)
        minutesLoading()
        ? MINUTES_HOLD_CAP_MS
        : this.walking
          ? WALK_HOLD_MS
          : 0

  /** the replay time the screen shows: the committed clock plus what the current frame has not spent yet, ms */
  get now() {
    return this.env.store.clock + this.pending
  }
  /** the replay's KST time at the shown clock, ms: the point's own time plus what has passed since the playhead landed on it (the one clock the scene follows, 12.1) */
  get time() {
    const p = this.env.store.point
    return p ? atMs(p) + Math.max(0, this.now - this.env.store.landedClock) : 0
  }
  /** the bodies that were put at their new place this tick (a schedule change at x16 and the like): the scene blurs each for 0.15 s. Read once */
  takePlaced(): string[] {
    const out = this.placedNow
    this.placedNow = []
    return out
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

  /** the new schedule spot is too far to walk to (see WALK_CAP_MS) */
  private tooFar(id: string, g: Goal, tau: number): boolean {
    const { planner } = this.env
    const to = g.slot ?? this.env.spot?.(g.spot)
    const from = planner.has(id) ? planner.position(id, tau / 1000) : null
    if (!to || !from) return false
    return ((Math.hypot(to.x - from.x, to.z - from.z) * ROUTE_FACTOR) / WALK_MPS) * 1000 > WALK_CAP_MS
  }

  /** the goals at the clock, and the planner's requests for them (`place` = stand there at once) */
  private evaluate(snap: boolean) {
    const { store, planner, meeting, ids, door } = this.env
    const scene = store.scene()
    if (!scene) return
    const tau = store.clock
    const reduced = this.env.reduced()
    const T = atMs(scene.point) + Math.max(0, tau - store.landedClock)
    const spots: Record<string, string> = {}
    for (const id of ids) spots[id] = reduced ? `work_${seatOf(id)}` : stageSpot(scene.point, seatOf(id))
    // the day at the replay's own time (12.1): the schedule of the live day run on the replay's clock, the replay's own statuses, nothing live
    const life = this.life.goals(T, Math.floor(T / 60_000), scene.status, (a) => this.arrivedAt(a, tau), { reduced })
    // the director's departures are in its own clock (the replay's time); the planner's are in tau
    for (const id of ids) if (life[id]?.depart !== undefined) life[id] = { ...life[id], depart: life[id].depart! - T + tau }
    const goals = replayGoals(life, spots)
    const base = { ...goals }
    const place = { at: (a: string) => (planner.has(a) ? planner.position(a, tau / 1000) : null), spot: (sp: string) => this.env.spot?.(sp) ?? null }
    // a minutes point is timed for the speed it plays at (timelapse.md 11.4): a change of speed times the rest of its rows again
    const speed = store.getSnapshot().speed
    if (speed !== this.speed) {
      this.speed = speed
      meeting.replan(speed, tau)
    }
    meeting.apply(tau, (a) => this.arrivedAt(a, tau), goals, door, place)
    // a 1:1 row hands a paper over when it begins (the replay clock drives it, so x4 and a seek behave)
    const v = meeting.view(tau)
    const pass = v ? passOf(v.script, v.frame.index) : null
    if (!pass) this.passed = ''
    else if (!snap && pass.key !== this.passed) {
      this.passed = pass.key
      this.env.pass?.(`agent_${pass.from}`, `agent_${pass.to}`)
    }
    for (const id of ids) {
      const g = goals[id]
      if (!g || g.pose === 'leave') continue
      // a staggered departure is in replay ms, the planner runs on replay seconds
      const req = requestOf(g, REPLAY_PACE, g.depart !== undefined ? g.depart / 1000 : undefined)
      const key = g.slot ? `${g.spot}|${g.slot.x.toFixed(2)},${g.slot.z.toFixed(2)}` : g.spot
      const now = { key, meet: goals[id] !== base[id], board: g.spot === 'whiteboard' }
      const was = this.last.get(id)
      this.last.set(id, now)
      // a change of the schedule (rest, play, work, night) is walked at x1 / x4 and put down at x16, with reduced motion, or when the walk would not end before the
      // schedule moves on (12.2); a meeting's and the board's movements are events and always walk
      const schedule = !!was && was.key !== key && !was.meet && !now.meet && !was.board && !now.board
      if (snap || (schedule && (speed >= 16 || reduced || this.tooFar(id, g, tau)))) {
        planner.place(id, req, tau / 1000, seatOf(id))
        if (!snap) this.placedNow.push(id)
      } else planner.request(id, req, tau / 1000, seatOf(id))
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
export function startMinutes(meeting: MeetingRunner, p: Point, meta: DocMeta | undefined, convs: Parameters<typeof scriptFor>[2], at: number, status: StatusMap, speed = 1, reduced = false): boolean {
  return meeting.start(scriptFor(p, meta, convs, reduced, speed), at, status, {})
}
