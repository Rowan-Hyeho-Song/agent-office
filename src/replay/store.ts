// The timelapse's state (#82): whether the replay is on, the project, the playhead and the clock that moves it. A small
// external store: getSnapshot returns the same object until something the screen shows changes (a new object per call
// blanked the page in #94). The per-frame progress of the current step is a plain field (`prog`), not part of the
// snapshot, so the bar can read it from its animation frame without re-rendering React.
//
// One replay clock (#158): `clock` (ms, "tau") only ever moves by `advance(dTau)`, which the 3D scene calls with real dt x
// speed. The speed is nothing but that rate: a step lasts the same tau at x1 and x16, the playhead lands at exact boundaries,
// and everything on screen (walking, meetings, bubbles) is computed from tau, so x16 is x1 played faster.

import { useSyncExternalStore } from 'react'
import type { Point } from '../timeline/types'
import { adjacentDay, dayId, daysOf, openingDay, pickDay, type DayInfo } from './days'
import { ALL, daybreakMs, flipText, indexAt, isDaybreak, prepare, projectFrom, sceneAt, shortName, stepMs, atMs, whenText, type Scene, type Speed } from './engine'
import { supabase } from '../office/supabase'
import { loadPoints } from './livePoints'

export type Mode = 'off' | 'office' | 'list'

export interface ReplayState {
  mode: Mode
  /** `all` or `owner/name` */
  project: string
  projects: readonly string[]
  /** the playhead: index into the playing window (the points of `project`, or one issue's span) */
  i: number
  count: number
  playing: boolean
  speed: Speed
  /** a day flip is running: the date text while it flips */
  flip: string | null
  /** the last point has played; the replay returns to live a moment later */
  ended: boolean
  loaded: boolean
  /** the window is one issue's span ("이 일의 이력 재생") */
  issue: { repo: string; n: number } | null
  /** the day being viewed, `YYYY-MM-DD` Seoul time (#362); null while the window is one issue's span */
  day: string | null
  /** the office picture is dimmed: the moment the day / places change is hidden behind it (timelapse.md 10.4) */
  fade: boolean
}

export interface OpenOptions {
  project?: string
  /** ms since the epoch: start at the last point at or before it, paused */
  t?: number
  issue?: { repo: string; n: number; lo: number; hi: number }
  /** open on this day (`YYYY-MM-DD`; the nearest earlier day with points when it has none) */
  day?: string
  mode?: Mode
}

/** a change of day: the picture dims for OUT, the swap happens in the dark, it comes back over BACK (the CSS transition) */
export const FADE_OUT_MS = 160
export const FADE_BACK_MS = 200
/** a meeting never holds the next point longer than this (replay ms) */
export const HOLD_CAP_MS = 45_000
/** a minutes point plays all its table rows: it may hold the next point this long (timelapse.md 11.4; src/office/minutes.ts plans the rows to fit) */
export const MINUTES_HOLD_CAP_MS = 60_000

const INITIAL: ReplayState = { mode: 'off', project: ALL, projects: [], i: 0, count: 0, playing: false, speed: 1, flip: null, ended: false, loaded: false, issue: null, day: null, fade: false }

export type PointVia = 'play' | 'seek'

export class ReplayStore {
  private state: ReplayState = INITIAL
  private listeners = new Set<() => void>()
  private pointListeners = new Set<(p: Point, via: PointVia) => void>()
  private closeListeners = new Set<() => void>()
  private all: Point[] | null = null
  private loading: Promise<Point[]> | null = null
  private base: Point[] = []
  private lo = 0
  private win: Point[] = []
  private cache: Scene | null = null
  private phase: 'step' | 'daybreak' = 'step'
  private elapsed = 0
  private held = 0
  private dayList: DayInfo[] = []
  /** the day a running fade is heading for (a second press during the fade continues from there) */
  private target: string | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  /** the list was opened from the office: the day to mark there (timelapse.md 10.8) */
  markDay: string | null = null
  /** progress 0..1 of the current step (or the day flip), for the bar's playhead */
  prog = 0
  /** the replay clock, ms: moves only by advance() */
  clock = 0
  /** the clock when the playhead last landed on a point */
  landedClock = 0
  /** how many landings so far (a scene tells a new one apart) */
  landings = 0
  /** how the current point was reached (a `seek` is a jump: the scene snaps everyone to the point) */
  landedVia: PointVia = 'seek'
  /** set by the scene: how long (replay ms, 0 = not at all) the next point waits for a meeting or for walkers to arrive */
  hold: () => number = () => 0
  /** reduced motion (or no screen): the day changes at once, without the fade */
  reduced: () => boolean = () => {
    if (typeof document === 'undefined') return true
    const forced = document.documentElement.dataset.motion
    if (forced === 'reduce' || forced === 'full') return forced === 'reduce'
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  }
  /** where the points come from: the timeline table over the bundled copies, or the copies alone (#413, livePoints.ts); swapped in tests */
  source: () => Promise<Point[]> = () => loadPoints(loadFixtures, supabase)

  getSnapshot = () => this.state
  subscribe = (cb: () => void) => {
    this.listeners.add(cb)
    return () => void this.listeners.delete(cb)
  }
  /** a point became the current one: by playing (`play`) or by the viewer moving there (`seek`) */
  onPoint(cb: (p: Point, via: PointVia) => void) {
    this.pointListeners.add(cb)
    return () => void this.pointListeners.delete(cb)
  }
  onClose(cb: () => void) {
    this.closeListeners.add(cb)
    return () => void this.closeListeners.delete(cb)
  }

  private set(patch: Partial<ReplayState>) {
    const next = { ...this.state, ...patch }
    if ((Object.keys(next) as (keyof ReplayState)[]).every((k) => next[k] === this.state[k])) return
    this.state = next
    this.listeners.forEach((l) => l())
  }

  // ---- data ----------------------------------------------------------------------------------------------------------

  /** every point of every project, sorted; loaded once */
  async load(): Promise<Point[]> {
    if (this.all) return this.all
    this.loading ??= this.source().then((points) => {
      this.all = prepare(points)
      this.set({ loaded: true, projects: [...new Set(this.all.map((p) => p.project))].sort() })
      return this.all
    })
    return this.loading
  }
  /** the loaded points of every project (empty until load) */
  get everything(): readonly Point[] {
    return this.all ?? []
  }
  /** the playing window */
  get points(): readonly Point[] {
    return this.win
  }
  /** the current point */
  get point(): Point | null {
    return this.win[this.state.i] ?? null
  }
  /** the office at the current point (cached per point) */
  scene(): Scene | null {
    if (!this.win.length) return null
    const i = this.state.i
    if (this.cache && this.cache.index === this.lo + i && this.cache.point === this.win[i]) return this.cache
    return (this.cache = sceneAt(this.base, this.lo + i))
  }

  /** an issue's span (indices of its own project's list) */
  private window(project: string, issue: NonNullable<OpenOptions['issue']>) {
    this.base = prepare(this.all ?? [], project)
    this.dayList = daysOf(this.base)
    this.lo = issue.lo
    this.win = this.base.slice(issue.lo, issue.hi + 1)
    this.cache = null
  }

  // ---- days (#362) ---------------------------------------------------------------------------------------------------

  /** the days of the project being viewed that have points, oldest first */
  get days(): readonly DayInfo[] {
    return this.dayList
  }
  /** the day being viewed (or the one a running fade is heading for) */
  get currentDay(): string | null {
    return this.target ?? this.state.day
  }
  /** the previous / next day that has points, or null at the first / last (and while the window is an issue's span) */
  adjacent(dir: 1 | -1): DayInfo | null {
    const id = this.currentDay
    return id === null ? null : adjacentDay(this.dayList, id, dir)
  }

  /** the window of one day of a project, and where the playhead stands in it; nothing is changed */
  private resolve(project: string, want: string, at: { t: number } | { i: number }) {
    const base = prepare(this.all ?? [], project)
    const days = daysOf(base)
    const day = pickDay(days, want)
    if (!day) return null
    const win = base.slice(day.lo, day.hi + 1)
    const i = 'i' in at ? Math.max(0, Math.min(win.length - 1, at.i)) : Math.max(0, indexAt(win, at.t))
    return { project, base, days, day, win, i }
  }
  /** put a resolved day in place: the window, the playhead, the day (everyone is placed by the `seek` landing) */
  private commit(r: NonNullable<ReturnType<ReplayStore['resolve']>>, patch: Partial<ReplayState> = {}) {
    this.clearTimers()
    this.target = null
    this.base = r.base
    this.dayList = r.days
    this.lo = r.day.lo
    this.win = r.win
    this.cache = null
    this.phase = 'step'
    this.elapsed = 0
    this.prog = 0
    this.held = 0
    this.landedClock = this.clock
    this.set({ project: r.project, day: r.day.id, issue: null, i: r.i, count: r.win.length, flip: null, ended: false, fade: false, ...patch })
  }
  private clearTimers() {
    this.timers.forEach(clearTimeout)
    this.timers = []
  }
  /** a screen-wide dim that starts dark and comes back (the first picture after opening) */
  private dimIn() {
    if (this.reduced()) return
    this.set({ fade: true })
    this.timers.push(setTimeout(() => this.set({ fade: false }), 60))
  }

  /**
   * Show a day of a project (timelapse.md 10.4): with `fade` the picture dims, and in the dark the window, the playhead,
   * the board, the clock and every body's place change (a `seek` landing: bodies are put there, nobody walks). `play`
   * sets whether it plays afterwards (default: as it was).
   */
  private moveTo(project: string, want: string, at: { t: number } | { i: number }, opts: { fade: boolean; play?: boolean }): boolean {
    const r = this.resolve(project, want, at)
    if (!r) return false
    const apply = () => {
      this.commit(r, { playing: (opts.play ?? this.state.playing) && r.win.length > 0 })
      this.land('seek')
    }
    this.clearTimers()
    if (!opts.fade || this.reduced() || this.state.mode !== 'office') {
      apply()
      return true
    }
    // the date text turns over a character at a time while the picture is dark
    const from = this.point ? whenText(atMs(this.point)) : ''
    const to = whenText(atMs(r.win[r.i]))
    this.target = r.day.id
    this.set({ fade: true })
    for (const k of [1, 2, 3]) this.timers.push(setTimeout(() => this.set({ flip: flipText(from, to, k / 4) }), (FADE_OUT_MS * k) / 4))
    this.timers.push(setTimeout(apply, FADE_OUT_MS))
    return true
  }

  /** the previous / next day that has points: its first point, with the fade; false at the first / last day */
  goDay(dir: 1 | -1, opts: { play?: boolean } = {}): boolean {
    const to = this.adjacent(dir)
    return !!to && this.moveTo(this.state.project, to.id, { i: 0 }, { fade: true, play: opts.play })
  }
  /** a day picked in the calendar: its first point */
  selectDay(id: string): boolean {
    if (id === this.currentDay) return false
    return this.moveTo(this.state.project, id, { i: 0 }, { fade: true })
  }
  /** "▶ 이 날 보기" in the list (a day), or "사무실에서 보기" (null: the latest day): the office opens there and plays */
  async showDay(project: string, id: string | null) {
    await this.load()
    const proj = projectFrom(project, this.state.projects)
    const days = daysOf(prepare(this.all ?? [], proj))
    const day = id === null ? openingDay(days) : pickDay(days, id)
    if (!day) return
    const r = this.resolve(proj, day.id, { i: 0 })!
    this.commit(r, { mode: 'office', playing: true })
    this.dimIn()
    this.land('seek')
  }
  /** the chip's ×: leave the issue's span for the day view of the day the playhead is in (same point, no fade) */
  endIssue() {
    const p = this.point
    if (!this.state.issue || !p) return
    const r = this.resolve(this.state.project, dayId(atMs(p)), { t: atMs(p) })
    if (!r) return
    const k = r.win.findIndex((q) => q.key === p.key)
    this.commit({ ...r, i: k >= 0 ? k : r.i }, { playing: this.state.playing })
    this.land('seek')
  }

  // ---- open / close --------------------------------------------------------------------------------------------------

  async open(opts: OpenOptions = {}) {
    await this.load()
    const project = opts.issue ? opts.issue.repo : (opts.project ?? ALL)
    const mode = opts.mode ?? (narrow() ? 'list' : 'office')
    this.markDay = null
    this.clearTimers()
    this.target = null
    if (opts.issue) {
      this.window(project, opts.issue)
      this.phase = 'step'
      this.elapsed = 0
      this.prog = 0
      this.held = 0
      this.landedClock = this.clock
      this.set({ mode, project, i: opts.t === undefined ? 0 : Math.max(0, indexAt(this.win, opts.t)), count: this.win.length, playing: opts.t === undefined && !!this.win.length, flip: null, ended: false, issue: { repo: opts.issue.repo, n: opts.issue.n }, day: null, fade: false })
    } else {
      // the day: the one asked for, the one that holds `t`, else the latest day with points (timelapse.md 10.5)
      const days = daysOf(prepare(this.all ?? [], project))
      const want = opts.day ?? (opts.t !== undefined ? dayId(opts.t) : openingDay(days)?.id)
      const r = want === undefined ? null : this.resolve(project, want, opts.t === undefined || opts.day !== undefined ? { i: 0 } : { t: opts.t })
      if (r) this.commit(r, { mode, playing: opts.t === undefined && r.win.length > 0 })
      else {
        this.base = []
        this.dayList = []
        this.win = []
        this.cache = null
        this.set({ mode, project, i: 0, count: 0, playing: false, flip: null, ended: false, issue: null, day: null, fade: false })
      }
    }
    if (this.state.mode === 'office') {
      this.dimIn()
      this.land('seek')
    }
  }

  /** back to live */
  close() {
    if (this.state.mode === 'off') return
    this.clearTimers()
    this.target = null
    this.set({ mode: 'off', playing: false, flip: null, ended: false, fade: false })
    this.closeListeners.forEach((l) => l())
  }

  /** list <-> office without losing the place */
  setMode(mode: Mode) {
    if (this.state.mode === 'off' || mode === 'off') return this.close()
    // the list opened from the office scrolls to the day that was being viewed (timelapse.md 10.8)
    this.markDay = mode === 'list' && this.point ? dayId(atMs(this.point)) : null
    this.set({ mode, playing: mode === 'office' ? this.state.playing : false })
    if (mode === 'office') this.land('seek')
  }

  // ---- moving --------------------------------------------------------------------------------------------------------

  private land(via: PointVia) {
    this.landedClock = this.clock
    this.landings++
    this.landedVia = via
    const p = this.point
    if (p) this.pointListeners.forEach((l) => l(p, via))
  }

  /** move the playhead to a point (the viewer's drag, buttons, keys); a pause-free jump while playing */
  seek(i: number) {
    if (!this.win.length) return
    const next = Math.max(0, Math.min(this.win.length - 1, Math.round(i)))
    this.phase = 'step'
    this.elapsed = 0
    this.prog = 0
    this.held = 0
    this.set({ i: next, flip: null, ended: false })
    this.land('seek')
  }
  step(dir: 1 | -1) {
    this.seek(this.state.i + dir)
  }
  /** the first point of the next / previous day */
  dayStep(dir: 1 | -1) {
    const key = (p: Point) => whenText(atMs(p)).slice(0, 10)
    let i = this.state.i
    const cur = key(this.win[i])
    if (dir > 0) while (i < this.win.length - 1 && key(this.win[i]) === cur) i++
    else {
      while (i > 0 && key(this.win[i]) === cur) i--
      const d = key(this.win[i])
      if (i > 0 || key(this.win[0]) !== cur) while (i > 0 && key(this.win[i - 1]) === d) i--
    }
    this.seek(i)
  }
  seekTime(t: number) {
    this.seek(indexAt(this.win, t))
  }

  play() {
    if (!this.win.length) return
    // at the end: start over
    const atEnd = this.state.ended || this.state.i >= this.win.length - 1
    if (atEnd) this.seek(0)
    this.set({ playing: true, ended: false })
  }
  pause() {
    this.set({ playing: false })
  }
  toggle() {
    if (this.state.playing) this.pause()
    else this.play()
  }
  setSpeed(speed: Speed) {
    this.set({ speed })
  }

  async setProject(value: string) {
    const all = await this.load()
    const project = projectFrom(value, [...new Set(all.map((p) => p.project))])
    if (project === this.state.project && !this.state.issue) return
    // the same day when the project has points on it, else the nearest earlier day that has (timelapse.md 10.5)
    const t = this.point ? atMs(this.point) : 0
    const days = daysOf(prepare(all, project))
    const want = this.currentDay ?? dayId(t)
    const day = pickDay(days, want)
    if (!day) return
    this.moveTo(project, day.id, day.id === want ? { t } : { i: 0 }, { fade: day.id !== want })
  }

  /** replay ms until the playhead reaches its next boundary (Infinity when it is not moving or is waiting there) */
  untilBoundary(): number {
    const s = this.state
    if (s.mode !== 'office' || !s.playing || !this.win.length) return Infinity
    const room = (this.phase === 'step' ? stepMs(this.win[s.i]) : daybreakMs()) - this.elapsed
    return room > 0 ? room : Infinity
  }

  /**
   * Move the replay clock on by `dTau` ms (real dt x speed) while playing. The playhead lands on each point at the exact
   * clock of its boundary, so it lands at the same tau at any speed; a hold (a meeting, someone still walking) makes the
   * next point wait, measured in tau, and the clock keeps running meanwhile.
   */
  advance(dTau: number) {
    const s = this.state
    if (s.mode !== 'office' || !s.playing || !this.win.length || s.ended || s.fade) return
    while (dTau > 0) {
      const cur = this.win[this.state.i]
      const next = this.win[this.state.i + 1]
      const dur = this.phase === 'step' ? stepMs(cur) : daybreakMs()
      const room = dur - this.elapsed
      if (room > dTau) {
        this.elapsed += dTau
        this.clock += dTau
        this.prog = this.elapsed / dur
        if (this.phase === 'daybreak') this.set({ flip: flipText(whenText(atMs(cur)), whenText(atMs(next)), this.prog) })
        return
      }
      this.clock += room
      dTau -= room
      this.elapsed = dur
      this.prog = 1
      if (this.phase === 'step') {
        const cap = Math.min(MINUTES_HOLD_CAP_MS, this.hold())
        if (this.held < cap) {
          // wait here; the rest of this advance is spent waiting (the hold is released the moment its cap is used up)
          const wait = Math.min(dTau, cap - this.held)
          this.held += wait
          this.clock += wait
          dTau -= wait
          if (this.held < cap) return
        }
        if (!next) {
          // the day (or the issue) is over: it stops here, the viewer decides where to go (timelapse.md 10.7)
          this.clock += dTau
          return void this.set({ playing: false, ended: true })
        }
        if (isDaybreak(cur, next)) {
          this.phase = 'daybreak'
          this.elapsed = 0
          this.prog = 0
          this.set({ flip: whenText(atMs(cur)) })
          continue
        }
      }
      this.phase = 'step'
      this.elapsed = 0
      this.prog = 0
      this.held = 0
      this.set({ i: this.state.i + 1, flip: null })
      this.land('play')
    }
  }

  // ---- sharing -------------------------------------------------------------------------------------------------------

  /** `?replay=<project|all>&t=<time of the current point>` */
  shareUrl(): string {
    const p = this.point
    const q = new URLSearchParams()
    q.set('replay', this.state.project === ALL ? ALL : shortName(this.state.project))
    if (p) q.set('t', p.at)
    return `${location.origin}${location.pathname}?${q.toString()}`
  }
}

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches

async function loadFixtures(): Promise<Point[]> {
  const [office, hub] = await Promise.all([import('../timeline/fixtures/agent-office.json'), import('../timeline/fixtures/rowansong.dev.json')])
  return [...(office.default.points as unknown as Point[]), ...(hub.default.points as unknown as Point[])]
}

/** one store per page */
export const replay = new ReplayStore()

export const useReplay = () => useSyncExternalStore(replay.subscribe, replay.getSnapshot)
export const isReplayActive = () => replay.getSnapshot().mode !== 'off'

/** the points as the 2D list and the docs viewer's button need them (loads on first use) */
export function useReplayPoints(): readonly Point[] {
  useReplay()
  return replay.everything
}
