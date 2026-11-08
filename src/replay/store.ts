// The timelapse's state (#82): whether the replay is on, the project, the playhead and the clock that moves it. A small
// external store: getSnapshot returns the same object until something the screen shows changes (a new object per call
// blanked the page in #94). The per-frame progress of the current step is a plain field (`prog`), not part of the
// snapshot, so the bar can read it from its animation frame without re-rendering React.

import { useSyncExternalStore } from 'react'
import type { Point } from '../timeline/types'
import { ALL, daybreakMs, flipText, indexAt, isDaybreak, prepare, projectFrom, sceneAt, shortName, stepMs, atMs, whenText, type Scene, type Speed } from './engine'

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
}

export interface OpenOptions {
  project?: string
  /** ms since the epoch: start at the last point at or before it, paused */
  t?: number
  issue?: { repo: string; n: number; lo: number; hi: number }
  mode?: Mode
}

const END_HOLD_MS = 3000
/** a meeting that holds a step at x1 never holds it longer than this */
const HOLD_CAP_MS = 45_000

const INITIAL: ReplayState = { mode: 'off', project: ALL, projects: [], i: 0, count: 0, playing: false, speed: 1, flip: null, ended: false, loaded: false, issue: null }

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
  private last = 0
  private held = 0
  private endedAt = 0
  /** progress 0..1 of the current step (or the day flip), for the bar's playhead */
  prog = 0
  /** performance.now() when the playhead last landed on a point */
  landedAt = 0
  /** how the current point was reached (walking only follows `play`) */
  landedVia: PointVia = 'seek'
  /** set by the scene: a long scene (a meeting) holds the next point at x1 */
  hold: () => boolean = () => false
  /** where the points come from (the fixtures until /api/timeline is deployed); swapped in tests */
  source: () => Promise<Point[]> = loadFixtures

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

  private window(project: string, issue: OpenOptions['issue']) {
    this.base = prepare(this.all ?? [], project)
    const range = issue && project === ALL ? null : issue
    // an issue's span is in the base list of its own project; indices are of that list
    this.lo = range ? range.lo : 0
    this.win = this.base.slice(this.lo, range ? range.hi + 1 : undefined)
    this.cache = null
  }

  // ---- open / close --------------------------------------------------------------------------------------------------

  async open(opts: OpenOptions = {}) {
    await this.load()
    const project = opts.issue ? opts.issue.repo : (opts.project ?? ALL)
    this.window(project, opts.issue)
    const i = opts.t === undefined ? 0 : Math.max(0, indexAt(this.win, opts.t))
    this.phase = 'step'
    this.elapsed = 0
    this.prog = 0
    this.last = performance.now()
    this.held = 0
    this.landedAt = this.last
    this.set({
      mode: opts.mode ?? (narrow() ? 'list' : 'office'),
      project,
      i,
      count: this.win.length,
      playing: opts.t === undefined && !!this.win.length,
      flip: null,
      ended: false,
      issue: opts.issue ? { repo: opts.issue.repo, n: opts.issue.n } : null,
    })
    if (this.state.mode === 'office') this.land('seek')
  }

  /** back to live */
  close() {
    if (this.state.mode === 'off') return
    this.set({ mode: 'off', playing: false, flip: null, ended: false })
    this.closeListeners.forEach((l) => l())
  }

  /** list <-> office without losing the place */
  setMode(mode: Mode) {
    if (this.state.mode === 'off' || mode === 'off') return this.close()
    this.set({ mode, playing: mode === 'office' ? this.state.playing : false })
    if (mode === 'office') this.land('seek')
  }

  // ---- moving --------------------------------------------------------------------------------------------------------

  private land(via: PointVia) {
    this.landedAt = performance.now()
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
    this.last = performance.now()
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
    const t = this.point ? atMs(this.point) : 0
    this.window(project, undefined)
    this.set({ project, issue: null, count: this.win.length, i: Math.max(0, indexAt(this.win, t)), flip: null, ended: false })
    this.phase = 'step'
    this.elapsed = 0
    this.prog = 0
    this.land('seek')
  }

  /** every animation frame while the office replay is on */
  tick(now: number) {
    const dt = Math.max(0, Math.min(100, now - this.last))
    this.last = now
    const s = this.state
    if (s.mode !== 'office') return
    if (s.ended) {
      if (now - this.endedAt >= END_HOLD_MS) this.close()
      return
    }
    if (!s.playing || !this.win.length) return
    // a long scene (a meeting) holds the next point at x1 only
    if (s.speed === 1 && this.phase === 'step' && this.prog >= 1 && this.hold() && this.held < HOLD_CAP_MS) {
      this.held += dt
      return
    }
    this.elapsed += dt
    const cur = this.win[s.i]
    const next = this.win[s.i + 1]
    if (this.phase === 'step') {
      const dur = stepMs(cur, s.speed)
      this.prog = Math.min(1, this.elapsed / dur)
      if (this.prog < 1) return
      if (this.hold() && s.speed === 1 && this.held < HOLD_CAP_MS) return
      if (!next) {
        this.endedAt = now
        return void this.set({ playing: false, ended: true })
      }
      if (isDaybreak(cur, next)) {
        this.phase = 'daybreak'
        this.elapsed = 0
        this.prog = 0
        return void this.set({ flip: whenText(atMs(cur)) })
      }
      return this.advance()
    }
    const dur = daybreakMs(s.speed)
    this.prog = Math.min(1, this.elapsed / dur)
    const text = flipText(whenText(atMs(cur)), whenText(atMs(next)), this.prog)
    if (this.prog < 1) return void this.set({ flip: text })
    this.advance()
  }

  private advance() {
    this.phase = 'step'
    this.elapsed = 0
    this.prog = 0
    this.held = 0
    this.set({ i: this.state.i + 1, flip: null })
    this.land('play')
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
