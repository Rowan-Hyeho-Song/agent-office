// The tour (#207, docs/design/office-ui.md 10): which agent the camera shows next, for how long, from where, and the
// way there. Pure: no three.js, no React. TourRig.tsx drives the camera from these decisions, tourAdapter.ts reads the
// office into the observations below.
//
// Framings are relative to the agent's seat frame (the nav spot work_<n>: x, z and the heading ry the agent faces at the
// desk), not to compass words, so they keep working when the pods are rotated (#195 / #206) and for a fifth seat (#193).

import { ROOM } from './room'
import { boxDistance, occlusionSegment, segmentHitsBox, type Box } from './view'

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
    if (!o.visible) continue
    // off / dozing is score 0, but not with something happening at it (a plane on a sleeper's desk, a result at night):
    // the designer's check at night saw no event cut because everyone but the night shift was off (#223)
    const happening = !!o.event && now - o.event.at <= TOUR.eventWindowMs
    if (!happening && (o.state === 'off' || o.pose === 'doze')) continue
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
  /**
   * the furniture the line of sight must not cross (#253: furniture no longer fades, so the app picks a camera that sees
   * its subject). Not walls (the cutaway handles them), not robots (they move and are not what hid things; the subject
   * itself is one). Absent = no sight check.
   */
  sight?: readonly Box[]
  /** what the picture must show (heads, the monitor of a work cut) and what may stand in front of it; absent = no such rules */
  shot?: Shot
}
const roomInset = 0.3
export const inRoom = (x: number, z: number) => Math.abs(x) <= ROOM.hx - roomInset && Math.abs(z) <= ROOM.hz - roomInset
export const isClear = (p: V3, c: Clearance) => inRoom(p[0], p[2]) && c.boxes.every((b) => boxDistance(p, b) >= c.margin - 0.03)

// ---- what the picture shows (#270) ----------------------------------------------------------------------------------

/** the monitor of a seat (screen_work_i in the glb: 0.57 x 0.33 m, centre 0.678 m ahead of the seat, 1.1 m up), as a box */
export const SCREEN = { ahead: 0.678, y: 1.1, w: 0.57, h: 0.33 }
export function screenBox(seat: Frame): Box {
  const [fx, fz] = forward(seat.ry)
  const [rx, rz] = rightOf(seat.ry)
  const cx = seat.x + fx * SCREEN.ahead
  const cz = seat.z + fz * SCREEN.ahead
  const hx = Math.abs(rx) * (SCREEN.w / 2) + 0.01
  const hz = Math.abs(rz) * (SCREEN.w / 2) + 0.01
  return { min: [cx - hx, SCREEN.y - SCREEN.h / 2, cz - hz], max: [cx + hx, SCREEN.y + SCREEN.h / 2, cz + hz] }
}

/** the picture's rules: the subject's head(s), the robots that stay at their places (not the passing ones) and the camera optics */
export interface Shot {
  /** the heads of the subject(s) */
  heads: readonly Box[]
  /** the boxes of the other robots that are parked at a place (work, sofa, meeting, play) */
  blockers: readonly Box[]
  /** vertical field of view (rad) and width / height of the picture */
  fovY: number
  aspect: number
  /** a work cut: the seat (its monitor must be in the picture, or the face seen) */
  work?: Frame
}
export const SHOT = {
  /** the blockers may cover at most this share of the subject (head + monitor) as seen from the camera */
  maxCover: 0.35,
  /** a work cut: the monitor must be this much inside the picture ... */
  minScreenIn: 0.7,
  /** ... or the camera stands within this angle (deg) of the seat's facing direction (the face is seen from the front, 3/4 view included) */
  faceCone: 60,
  /** ... and the screen is seen from within this angle (deg) of its normal (not edge-on) */
  screenCone: 70,
}

const corners = (b: Box): V3[] => {
  const o: V3[] = []
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) o.push([x, y, z])
  return o
}
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * the box as a rectangle in the picture (-1..1 both ways = in view) seen from pos towards target; null when any of it is behind
 * the camera, except with `clip` (a blocker reaching past the camera: its near corners are pushed to the near plane)
 */
export function projectBox(b: Box, pos: V3, target: V3, fovY: number, aspect: number, clip = false): { x0: number; y0: number; x1: number; y1: number; depth: number; near: number } | null {
  const f = unit(sub(target, pos))
  let r = cross(f, [0, 1, 0])
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = [1, 0, 0]
  r = unit(r)
  const u = cross(r, f)
  const t = Math.tan(fovY / 2)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let near = Infinity
  for (const p of corners(b)) {
    const d = sub(p, pos)
    let z = dot(d, f)
    if (z < 0.05) {
      if (!clip) return null
      z = 0.05
    }
    near = Math.min(near, z)
    const x = dot(d, r) / (z * t * aspect)
    const y = dot(d, u) / (z * t)
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const c = b.min.map((v, i) => (v + b.max[i]) / 2)
  return { x0, y0, x1, y1, depth: dot(sub(c, pos), f), near }
}

/** the share of the boxes' pictures (sampled) that the blockers in front of them cover; a subject behind the camera counts as covered */
export function coverShare(subjects: readonly Box[], blockers: readonly Box[], pos: V3, target: V3, fovY: number, aspect: number): number {
  const N = 8
  let n = 0
  let hit = 0
  for (const s of subjects) {
    const rs = projectBox(s, pos, target, fovY, aspect)
    if (!rs) {
      n += N * N
      hit += N * N
      continue
    }
    const front = blockers.map((b) => projectBox(b, pos, target, fovY, aspect, true)).filter((r): r is NonNullable<typeof r> => !!r && r.near < rs.depth)
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const x = rs.x0 + ((rs.x1 - rs.x0) * (i + 0.5)) / N
        const y = rs.y0 + ((rs.y1 - rs.y0) * (j + 0.5)) / N
        n++
        if (front.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) hit++
      }
  }
  return n ? hit / n : 0
}

/** how much of the box's picture is inside the frame (0..1); 0 when it is behind the camera */
export function inFrameShare(b: Box, pos: V3, target: V3, fovY: number, aspect: number): number {
  const r = projectBox(b, pos, target, fovY, aspect)
  if (!r) return 0
  const area = (r.x1 - r.x0) * (r.y1 - r.y0)
  const ix = Math.max(0, Math.min(1, r.x1) - Math.max(-1, r.x0))
  const iy = Math.max(0, Math.min(1, r.y1) - Math.max(-1, r.y0))
  return area > 0 ? (ix * iy) / area : 0
}

/** the angle (deg) between the seat's facing direction and the direction from the seat to the camera (ground plane) */
export function angleFromFront(seat: Frame, pos: V3): number {
  const [fx, fz] = forward(seat.ry)
  const dx = pos[0] - seat.x
  const dz = pos[2] - seat.z
  const l = Math.hypot(dx, dz) || 1
  return Math.acos(Math.min(1, Math.max(-1, (dx * fx + dz * fz) / l))) / DEG
}

/**
 * the picture's rules: (1) the robots parked at a place cover at most SHOT.maxCover of the subject (heads + the monitor of a
 * work cut) as seen from the camera; (2) a work cut shows the monitor (>= 70 % in the picture and seen within 70 degrees of its front) or the face
 * (the camera within 60 degrees of the seat's facing direction, i.e. in front of it)
 */
export function shotOk(pos: V3, target: V3, shot: Shot | undefined): boolean {
  if (!shot) return true
  const screen = shot.work ? screenBox(shot.work) : null
  if (shot.blockers.length > 0) {
    const subjects = screen ? [...shot.heads, screen] : shot.heads
    if (subjects.length && coverShare(subjects, shot.blockers, pos, target, shot.fovY, shot.aspect) > SHOT.maxCover) return false
  }
  if (shot.work && screen) {
    const [fx, fz] = forward(shot.work.ry)
    const dx = pos[0] - (shot.work.x + fx * SCREEN.ahead)
    const dz = pos[2] - (shot.work.z + fz * SCREEN.ahead)
    const fromNormal = Math.acos(Math.min(1, Math.max(-1, (dx * -fx + dz * -fz) / (Math.hypot(dx, dz) || 1)))) / DEG
    const seesScreen = fromNormal <= SHOT.screenCone && inFrameShare(screen, pos, target, shot.fovY, shot.aspect) >= SHOT.minScreenIn
    return seesScreen || angleFromFront(shot.work, pos) <= SHOT.faceCone
  }
  return true
}

/** a robot that stays at a place (its goal spot: a seat, the sofa, a circle, a game); one walking past is not */
export const isParked = (r: { visible: boolean; arrived: string | null }, goalSpot?: string) => r.visible && !!r.arrived && goalSpot === r.arrived

/** is the line from the camera to the target (stopping VIEW.near.targetSkip short of it) free of furniture? */
export function sightClear(pos: V3, target: V3, c: Clearance): boolean {
  if (!c.sight || c.sight.length === 0) return true
  const [a, b] = occlusionSegment(pos, target)
  return !c.sight.some((bx) => segmentHitsBox(a, b, bx))
}

/** a camera the app may use: clear of everything, and it sees the target */
export const usable = (pos: V3, target: V3, c: Clearance) => isClear(pos, c) && sightClear(pos, target, c) && shotOk(pos, target, c.shot)

/** the first pose (in order) whose camera is usable (clear and it sees its target), else null */
export const firstClear = (poses: readonly Pose[], c: Clearance): Pose | null => poses.find((p) => usable(p.pos, p.target, c)) ?? null

/** camera heights tried after the preferred one (m up, looking down) */
export const RAISE_STEPS = [0.4, 0.8] as const
/** distances tried after the preferred one (fraction of it, pulled towards the target) */
export const PULL_STEPS = [0.85, 0.7, 0.55] as const
const MAX_CAM_Y = 3.6

/** the milder changes first: as is, a bit higher, a bit nearer, higher still, nearer still, nearer and higher */
const ALTERNATIVES: readonly { k: number; dy: number }[] = [
  { k: 1, dy: 0 },
  { k: 1, dy: RAISE_STEPS[0] },
  { k: PULL_STEPS[0], dy: 0 },
  { k: 1, dy: RAISE_STEPS[1] },
  { k: PULL_STEPS[1], dy: 0 },
  { k: PULL_STEPS[2], dy: 0 },
  { k: PULL_STEPS[1], dy: RAISE_STEPS[0] },
]
/** the pose with its camera pulled towards the target by k and raised by dy */
export const adjusted = (p: Pose, k: number, dy: number): Pose => ({
  pos: [p.target[0] + (p.pos[0] - p.target[0]) * k, Math.min(MAX_CAM_Y, p.target[1] + (p.pos[1] - p.target[1]) * k + dy), p.target[2] + (p.pos[2] - p.target[2]) * k],
  target: p.target,
})
/** the first usable pose of the candidates (in order), trying each alternative (pull / raise) over all of them before the next; null when none */
export function firstUsable(cands: readonly Pose[], c: Clearance): Pose | null {
  for (const { k, dy } of ALTERNATIVES) {
    const poses = cands.map((q) => (k === 1 && dy === 0 ? q : adjusted(q, k, dy)))
    const p = firstClear(poses, c)
    if (p) {
      lastPick.work = { index: poses.indexOf(p), k, dy }
      return p
    }
  }
  lastPick.work = null
  return null
}
/** debug: which candidate (index in workCandidates) and alternative (pull k, raise dy) the last work pose took */
export const lastPick: { work: { index: number; k: number; dy: number } | null } = { work: null }

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

/** the work cut: over the shoulder when that camera spot is clear and sees the seat, else the next that does (nearer / higher / the other side); null = skip the cut */
export function workPose(seat: Frame, c: Clearance): Pose | null {
  return firstUsable(workCandidates(seat), c)
}

/** from the front of a standing / sitting agent (and then to the sides), 2.2 m away, 1.7 m up: the upper body */
export function standPose(at: Frame, c: Clearance, dist = 2.2, y = 1.7, targetY = 1.0): Pose | null {
  const [fx, fz] = forward(at.ry)
  const target = v3(at.x, targetY, at.z)
  const angles = [0, 40, -40, 80, -80, 140, -140, 180].map((a) => a * DEG)
  for (const dy of [0, ...RAISE_STEPS]) {
    for (const k of [1, 0.8, 0.65, 0.5]) {
      for (const a of angles) {
        const dx = fx * Math.cos(a) - fz * Math.sin(a)
        const dz = fx * Math.sin(a) + fz * Math.cos(a)
        const pos = v3(at.x + dx * dist * k, Math.min(MAX_CAM_Y, heightFor(dist * k, dist, y, targetY) + dy), at.z + dz * dist * k)
        if (usable(pos, target, c)) return { pos, target }
      }
    }
  }
  return null
}

/** across a table: beside its long side (the side the default camera is on first), `dist` away and `y` up, looking at its middle */
export function tablePose(a: { x: number; z: number }, b: { x: number; z: number }, c: Clearance, home: V3, opt: { dist: number; y: number; targetY: number }): Pose | null {
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
  cands.sort((x, y) => x.cost - y.cost)
  for (const dy of [0, ...RAISE_STEPS]) {
    const up = (q: V3): V3 => v3(q[0], Math.min(MAX_CAM_Y, q[1] + dy), q[2])
    const best = cands.find((q) => usable(up(q.pos), target, c))
    if (best) return { pos: up(best.pos), target }
  }
  return null
}

/** a talk circle: 4.0 m from its middle towards the default camera, 2.6 m up, looking at the middle (1.0 m up) */
export function meetingPose(centre: { x: number; z: number }, c: Clearance, home: V3, dist = 4.0, y = 2.6): Pose | null {
  const hx = home[0] - centre.x
  const hz = home[2] - centre.z
  const base = Math.atan2(hz, hx)
  const target = v3(centre.x, 1.0, centre.z)
  for (const dy of [0, ...RAISE_STEPS]) {
    for (const k of [1, 0.85, 0.7, 0.55]) {
      for (const off of [0, 25, -25, 50, -50, 90, -90, 135, -135, 180]) {
        const a = base + off * DEG
        const pos = v3(centre.x + Math.cos(a) * dist * k, Math.min(MAX_CAM_Y, y + dy), centre.z + Math.sin(a) * dist * k)
        if (usable(pos, target, c)) return { pos, target }
      }
    }
  }
  return null
}

/** turn a camera position about the vertical axis through the target */
export function orbitYaw(pos: V3, target: V3, yaw: number): V3 {
  const dx = pos[0] - target[0]
  const dz = pos[2] - target[2]
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [target[0] + dx * c + dz * s, pos[1], target[2] - dx * s + dz * c]
}

/** does the sideways drift keep the line of sight clear at both ends? Else the cut stands still */
export const driftSightClear = (base: Pose, range: [number, number], c: Clearance) => range.every((y) => sightClear(orbitYaw(base.pos, base.target, y), base.target, c))

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
