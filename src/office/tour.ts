// The tour (#207, docs/design/office-ui.md 10): which agent the camera shows next, for how long, from where, and the
// way there. Pure: no three.js, no React. TourRig.tsx drives the camera from these decisions, tourAdapter.ts reads the
// office into the observations below.
//
// Framings are relative to the agent's seat frame (the nav spot work_<n>: x, z and the heading ry the agent faces at the
// desk), not to compass words, so they keep working when the pods are rotated (#195 / #206) and for a fifth seat (#193).

import { ROOM } from './room'
import { boxDistance, type Box } from './view'

export type V3 = [number, number, number]
export interface Pose {
  pos: V3
  target: V3
}
/** a seat / a standing place: floor position and the heading the body faces (rig.heading: forward = (-sin ry, -cos ry)) */
export interface Frame {
  x: number
  z: number
  ry: number
}

export const DEG = Math.PI / 180

// ---- when it starts and ends --------------------------------------------------------------------------------------

export const TOUR = {
  idleMs: 45_000,
  /** the cut that is on keeps running at least this long before an event may cut in */
  interruptAfterMs: 4000,
  eventWindowMs: 15_000,
  /** an establishing shot after this many agent / meeting cuts */
  establishEvery: 4,
  historyMax: 8,
  /** the replay speed from which only event cuts are used */
  eventsOnlySpeed: 16,
  swipe: { px: 60, ms: 300 },
  announceThrottleMs: 5000,
} as const

// ---- score and order ----------------------------------------------------------------------------------------------

export type Why = 'event' | 'meeting' | 'working' | 'wrapping' | 'play' | 'idle' | 'establishing'
export const SCORE: Record<Why, number> = { event: 6, meeting: 5, working: 4, wrapping: 3, play: 2, idle: 1, establishing: 0 }

/** what the adapter saw of one agent this moment */
export interface AgentObs {
  id: string
  /** off = not shown (also a dozing one); false when the rig is hidden */
  visible: boolean
  state?: 'working' | 'wrapping' | 'idle' | 'off'
  /** the goal pose the agent is acting out ('type', 'pingpong', 'boardgame', 'water', 'books', 'coffee', 'sofa', 'doze', 'talk' ...) */
  pose?: string
  /** the talk circle it stands in (a key; the agents with the same key are one cut) */
  meet?: string
  /** the last event at this agent (paper plane, test result, stamp, omok win, ping-pong point), office ms, and when it is over */
  event?: { at: number; until: number }
}

export interface AgentView {
  /** the agent's id, or `meet:<key>` for a circle */
  id: string
  agents: string[]
  why: Why
  score: number
  /** the pose it plays / rests in: what to frame (pingpong, boardgame, water, books, coffee, sofa) */
  focus?: string
  event?: { at: number; until: number }
}

const PLAY_POSES = new Set(['pingpong', 'boardgame', 'water', 'books'])

/** the agents' observations as scored views: a circle is one view, off / dozing ones are left out */
export function buildViews(obs: readonly AgentObs[], now: number): AgentView[] {
  const views: AgentView[] = []
  const circles = new Map<string, AgentView>()
  for (const o of obs) {
    if (!o.visible || o.state === 'off' || o.pose === 'doze') continue
    if (o.meet) {
      const c = circles.get(o.meet)
      if (c) c.agents.push(o.id)
      else circles.set(o.meet, { id: `meet:${o.meet}`, agents: [o.id], why: 'meeting', score: SCORE.meeting })
      continue
    }
    const ev = o.event && now - o.event.at <= TOUR.eventWindowMs ? o.event : undefined
    let why: Why
    if (ev) why = 'event'
    else if (o.state === 'working') why = 'working'
    else if (o.state === 'wrapping') why = 'wrapping'
    else if (o.pose && PLAY_POSES.has(o.pose)) why = 'play'
    else why = 'idle'
    views.push({ id: o.id, agents: [o.id], why, score: SCORE[why], focus: o.pose, ...(ev ? { event: ev } : {}) })
  }
  return [...views, ...circles.values()]
}

export interface Cut {
  /** unique per cut (keys an announcement, tests) */
  key: string
  type: 'agent' | 'meeting' | 'establishing'
  /** the view's id (the agent id, `meet:<key>`, or 'establishing') */
  id: string
  agents: string[]
  why: Why
  focus?: string
  /** an event cut lasts until then + 2 s (office ms) */
  eventUntil?: number
}

let cutSeq = 0
export const cutOf = (v: AgentView): Cut => ({
  key: `cut${++cutSeq}`,
  type: v.why === 'meeting' ? 'meeting' : 'agent',
  id: v.id,
  agents: v.agents,
  why: v.why,
  focus: v.focus,
  ...(v.event ? { eventUntil: v.event.until } : {}),
})
export const establishingCut = (): Cut => ({ key: `cut${++cutSeq}`, type: 'establishing', id: 'establishing', agents: [], why: 'establishing' })

/**
 * The order of the cuts: highest score first, the one not shown for longest on a tie; never the same agent(s) twice
 * in a row; an establishing shot every `establishEvery` cuts and whenever nobody scores (or the only one is the one
 * just shown); from replay speed x16 only event cuts. History of the last 8 cuts for the back button.
 */
export class TourPlan {
  history: Cut[] = []
  cursor = -1
  private sinceEstablishing = 0
  private lastSeen = new Map<string, number>()

  get current(): Cut | null {
    return this.cursor >= 0 ? this.history[this.cursor] : null
  }
  get canGoBack() {
    return this.cursor > 0
  }

  reset() {
    this.history = []
    this.cursor = -1
    this.sinceEstablishing = 0
  }

  private choose(views: readonly AgentView[], speed: number): Cut {
    const last = this.current?.agents ?? []
    let pool = views.filter((v) => v.score > 0)
    if (speed >= TOUR.eventsOnlySpeed) pool = pool.filter((v) => v.why === 'event')
    pool = pool.filter((v) => !(last.length > 0 && v.agents.every((a) => last.includes(a))))
    if (this.sinceEstablishing >= TOUR.establishEvery || pool.length === 0) return establishingCut()
    const seen = (v: AgentView) => Math.max(...v.agents.map((a) => this.lastSeen.get(a) ?? -Infinity))
    pool.sort((a, b) => b.score - a.score || seen(a) - seen(b) || a.id.localeCompare(b.id))
    return cutOf(pool[0])
  }

  private push(c: Cut, now: number) {
    // a new cut after going back replaces what came after it
    this.history = this.history.slice(0, this.cursor + 1)
    this.history.push(c)
    if (this.history.length > TOUR.historyMax) this.history.shift()
    this.cursor = this.history.length - 1
    if (c.type === 'establishing') this.sinceEstablishing = 0
    else this.sinceEstablishing++
    for (const a of c.agents) this.lastSeen.set(a, now)
  }

  /** the next cut: forward in the history after going back, else a new one */
  next(now: number, views: readonly AgentView[], speed = 1): Cut {
    if (this.cursor < this.history.length - 1) {
      this.cursor++
      return this.history[this.cursor]
    }
    const c = this.choose(views, speed)
    this.push(c, now)
    return c
  }

  /** the cut before (null at the oldest) */
  prev(): Cut | null {
    if (this.cursor <= 0) return null
    this.cursor--
    return this.history[this.cursor]
  }

  /** the tour starts at this agent (the agent list); when it does not score, the usual first cut */
  startAt(now: number, agent: string | undefined, views: readonly AgentView[], speed = 1): Cut {
    this.reset()
    const v = agent ? views.find((x) => x.agents.includes(agent) && x.score > 0) : undefined
    if (!v) return this.next(now, views, speed)
    const c = cutOf(v)
    this.push(c, now)
    return c
  }

  /** an event that began after this cut started cuts in once the cut has run `interruptAfterMs` (null when none) */
  interrupt(now: number, views: readonly AgentView[], cutStart: number): Cut | null {
    if (now - cutStart < TOUR.interruptAfterMs) return null
    const cur = this.current
    const ev = views
      .filter((v) => v.why === 'event' && v.event && v.event.at > cutStart && v.id !== cur?.id)
      .sort((a, b) => b.event!.at - a.event!.at)[0]
    if (!ev) return null
    const c = cutOf(ev)
    this.push(c, now)
    return c
  }
}

// ---- how long ------------------------------------------------------------------------------------------------------

export const DWELL_MS: Record<Why, number> = { event: 6000, meeting: 30_000, working: 12_000, wrapping: 12_000, play: 10_000, idle: 6000, establishing: 6000 }
export const MIN_DWELL_REPLAY_MS = 3000

/**
 * how long a cut stays: the table of 10.2; an event lasts until it ends + 2 s (6 s at least, 15 s at most); in the
 * timelapse (#158) divided by the speed, 3 s at least
 */
export function dwellMs(cut: Cut, now: number, speed = 1): number {
  let base = DWELL_MS[cut.why]
  if (cut.why === 'event') base = Math.min(15_000, Math.max(6000, (cut.eventUntil ?? now) + 2000 - now))
  return speed > 1 ? Math.max(MIN_DWELL_REPLAY_MS, base / speed) : base
}

/** a cut whose subject is gone (the circle broke up, the agent went off) ends early, after a short look */
export function leaveEarly(cut: Cut, views: readonly AgentView[], elapsedMs: number): boolean {
  if (cut.type === 'establishing' || elapsedMs < 3000) return false
  return !views.some((v) => v.score > 0 && (cut.type === 'meeting' ? v.id === cut.id : v.agents.includes(cut.id)))
}

// ---- where the camera stands ---------------------------------------------------------------------------------------

export const forward = (ry: number): [number, number] => [-Math.sin(ry), -Math.cos(ry)]
export const rightOf = (ry: number): [number, number] => [Math.cos(ry), -Math.sin(ry)]

/** a place the camera may stand at: inside the room (inset) and clear of every box */
export interface Clearance {
  boxes: readonly Box[]
  margin: number
}
const roomInset = 0.3
export const inRoom = (x: number, z: number) => Math.abs(x) <= ROOM.hx - roomInset && Math.abs(z) <= ROOM.hz - roomInset
export const isClear = (p: V3, c: Clearance) => inRoom(p[0], p[2]) && c.boxes.every((b) => boxDistance(p, b) >= c.margin - 0.03)

/** the first pose (in order) whose camera is clear, else null */
export const firstClear = (poses: readonly Pose[], c: Clearance): Pose | null => poses.find((p) => isClear(p.pos, c)) ?? null

const v3 = (x: number, y: number, z: number): V3 => [x, y, z]

/** the camera height at horizontal distance h that keeps the straight-line distance of (dist, y) to a target at targetY (nearer in the room = higher up, at most 3.4) */
const heightFor = (h: number, dist: number, y: number, targetY: number) => {
  const D2 = dist * dist + (y - targetY) ** 2
  return Math.min(Math.max(y, 3.4), targetY + Math.sqrt(Math.max(D2 - h * h, 0.04)))
}

/** 10.3: a working agent, over the shoulder (back 1.4 m, right 0.8 m, 1.75 m up -> between head and monitor) and the fallbacks */
export const SHOULDER = { back: 2.3, side: 1.1, y: 2.0, aheadTo: 0.45, targetSide: 0.3, targetY: 0.98 }
export function workCandidates(seat: Frame): Pose[] {
  const [fx, fz] = forward(seat.ry)
  const [rx, rz] = rightOf(seat.ry)
  const out: Pose[] = []
  const shoulder = (s: number): Pose => ({
    pos: v3(seat.x - fx * SHOULDER.back + rx * SHOULDER.side * s, SHOULDER.y, seat.z - fz * SHOULDER.back + rz * SHOULDER.side * s),
    target: v3(seat.x + fx * SHOULDER.aheadTo + rx * SHOULDER.targetSide * s, SHOULDER.targetY, seat.z + fz * SHOULDER.aheadTo + rz * SHOULDER.targetSide * s),
  })
  // from the open side and slightly behind, up (the seat at the end of a pod: its face and the pod behind it)
  const head = (s: number): Pose => ({
    pos: v3(seat.x + rx * 1.6 * s - fx * 0.6, 1.8, seat.z + rz * 1.6 * s - fz * 0.6),
    target: v3(seat.x, 1.15, seat.z),
  })
  // beside the desk end, above: the face, the hands and the back of the monitor
  const face = (s: number, y: number): Pose => ({
    pos: v3(seat.x + rx * 1.3 * s + fx * 0.5, y, seat.z + rz * 1.3 * s + fz * 0.5),
    target: v3(seat.x + fx * 0.15, 1.15, seat.z + fz * 0.15),
  })
  out.push(shoulder(1), shoulder(-1), head(1), head(-1), face(1, 2.0), face(-1, 2.0), face(1, 2.3), face(-1, 2.3))
  return out
}

/** the work cut: over the shoulder when that camera spot is clear, else the next that is; never fails (the last resort is the shoulder pose) */
export function workPose(seat: Frame, c: Clearance): Pose {
  const cands = workCandidates(seat)
  return firstClear(cands, c) ?? cands[0]
}

/** from the front of a standing / sitting agent (and then to the sides), 2.2 m away, 1.7 m up: the upper body */
export function standPose(at: Frame, c: Clearance, dist = 2.2, y = 1.7, targetY = 1.0): Pose {
  const [fx, fz] = forward(at.ry)
  const target = v3(at.x, targetY, at.z)
  const angles = [0, 40, -40, 80, -80, 140, -140, 180].map((a) => a * DEG)
  for (const k of [1, 0.8, 0.65]) {
    for (const a of angles) {
      const dx = fx * Math.cos(a) - fz * Math.sin(a)
      const dz = fx * Math.sin(a) + fz * Math.cos(a)
      const pos = v3(at.x + dx * dist * k, heightFor(dist * k, dist, y, targetY), at.z + dz * dist * k)
      if (isClear(pos, c)) return { pos, target }
    }
  }
  const [px, pz] = [at.x + fx * dist * 0.65, at.z + fz * dist * 0.65]
  return { pos: v3(px, y, pz), target }
}

/** across a table: beside its long side (the side the default camera is on first), `dist` away and `y` up, looking at its middle */
export function tablePose(a: { x: number; z: number }, b: { x: number; z: number }, c: Clearance, home: V3, opt: { dist: number; y: number; targetY: number }): Pose {
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
  const perp = { x: -(b.z - a.z) / len, z: (b.x - a.x) / len }
  const toHome = (home[0] - mid.x) * perp.x + (home[2] - mid.z) * perp.z >= 0 ? 1 : -1
  const target = v3(mid.x, opt.targetY, mid.z)
  // the straight side view as far away as the room allows; turned along the table (up to 55 degrees) or nearer when it is in the way
  const cands: { cost: number; pos: V3 }[] = []
  for (const k of [1, 0.92, 0.84, 0.76, 0.68]) {
    for (const turn of [0, 25, -25, 40, -40, 55, -55]) {
      for (const s of [toHome, -toHome]) {
        const a = Math.atan2(perp.z * s, perp.x * s) + turn * DEG
        cands.push({ cost: Math.abs(turn) / 55 + (1 - k) * 1.0 + (s === toHome ? 0 : 0.3), pos: v3(mid.x + Math.cos(a) * opt.dist * k, heightFor(opt.dist * k, opt.dist, opt.y, opt.targetY), mid.z + Math.sin(a) * opt.dist * k) })
      }
    }
  }
  const best = cands.sort((x, y) => x.cost - y.cost).find((q) => isClear(q.pos, c))
  if (best) return { pos: best.pos, target }
  return { pos: v3(mid.x + perp.x * toHome * opt.dist * 0.68, heightFor(opt.dist * 0.68, opt.dist, opt.y, opt.targetY), mid.z + perp.z * toHome * opt.dist * 0.68), target }
}

/** a talk circle: 4.0 m from its middle towards the default camera, 2.6 m up, looking at the middle (1.0 m up) */
export function meetingPose(centre: { x: number; z: number }, c: Clearance, home: V3, dist = 4.0, y = 2.6): Pose {
  const hx = home[0] - centre.x
  const hz = home[2] - centre.z
  const base = Math.atan2(hz, hx)
  const target = v3(centre.x, 1.0, centre.z)
  for (const k of [1, 0.85, 0.7]) {
    for (const off of [0, 25, -25, 50, -50, 90, -90, 135, -135, 180]) {
      const a = base + off * DEG
      const pos = v3(centre.x + Math.cos(a) * dist * k, y, centre.z + Math.sin(a) * dist * k)
      if (isClear(pos, c)) return { pos, target }
    }
  }
  return { pos: v3(centre.x + Math.cos(base) * dist * 0.7, y, centre.z + Math.sin(base) * dist * 0.7), target }
}

/** turn a camera position about the vertical axis through the target */
export function orbitYaw(pos: V3, target: V3, yaw: number): V3 {
  const dx = pos[0] - target[0]
  const dz = pos[2] - target[2]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [target[0] + dx * c + dz * s, pos[1], target[2] - dx * s + dz * c]
}

/** while it stays: 4 degrees sideways over the whole dwell (-2 to +2), the establishing shot +-12 */
export const DRIFT = { deg: 4, establishingDeg: 24 }
export const driftRange = (cut: Cut, reduced: boolean): [number, number] => {
  if (reduced) return [0, 0]
  const w = (cut.type === 'establishing' ? DRIFT.establishingDeg : DRIFT.deg) * DEG
  return [-w / 2, w / 2]
}
/** the yaw offset at k (0..1) of the dwell */
export const driftYaw = (range: [number, number], k: number) => range[0] + (range[1] - range[0]) * Math.min(1, Math.max(0, k))

/** the look-at point follows what it looks at with this lag (s) */
export const FOLLOW_LAG_S = 0.5
export function lag(cur: number, want: number, dt: number, tau = FOLLOW_LAG_S): number {
  return cur + (want - cur) * (1 - Math.exp(-dt / tau))
}

// ---- the way there --------------------------------------------------------------------------------------------------

export const ARC = { ms: 1600, lift: 0.6, fadeMs: 300, stepM: 0.05 }
export const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

/** the camera and the look-at on the way from a to b at k (0..1 of the time): eased, up in an arc (`lift` high in the middle) */
export function arcAt(a: Pose, b: Pose, k: number): Pose {
  const e = easeInOut(Math.min(1, Math.max(0, k)))
  const up = ARC.lift * 4 * e * (1 - e)
  const mix = (p: V3, q: V3, dy = 0): V3 => [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e + dy, p[2] + (q[2] - p[2]) * e]
  return { pos: mix(a.pos, b.pos, up), target: mix(a.target, b.target) }
}

/** the camera positions of the path, at most `stepM` apart */
export function arcPositions(a: Pose, b: Pose, stepM = ARC.stepM): V3[] {
  const chord = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2])
  const n = Math.max(2, Math.ceil((chord + 2 * ARC.lift) / stepM))
  const out: V3[] = []
  for (let i = 0; i <= n; i++) {
    const e = i / n // the shape of the path does not depend on the easing
    out.push([a.pos[0] + (b.pos[0] - a.pos[0]) * e, a.pos[1] + (b.pos[1] - a.pos[1]) * e + ARC.lift * 4 * e * (1 - e), a.pos[2] + (b.pos[2] - a.pos[2]) * e])
  }
  return out
}

/** does the way from a to b stay clear of every box (furniture, robots, walls) by the margin? Else: a 0.3 s fade cut */
export function pathClear(a: Pose, b: Pose, c: Clearance): boolean {
  return arcPositions(a, b).every((p) => c.boxes.every((bx) => boxDistance(p, bx) >= c.margin - 0.03))
}

/** fly (true) or cut with a fade (false): reduced motion always cuts */
export const shouldFly = (a: Pose, b: Pose, c: Clearance, reduced: boolean) => !reduced && pathClear(a, b, c)
