// Looking before throwing, turning to catch (#224, designer: "바라보고 던지기 · 받기").
// A robot is a floating head and two hands, so "upper body → feet" is: the head first (agent_i_head), then the whole
// root's rotation (the seat's floor pad never turns). This file is only the schedule: pure functions of the time since
// the gesture began, the angle to the one it looks at, and whether the agent sits at a desk. rig.ts applies it.
//
// Angles are radians, measured from the agent's rest heading; positive = to its left (the same sign as the root's yaw).
//
// throw (seconds from the start)         catch (seconds from the plane's take-off, flight F, held H)
//   0 – .25   head turns, ≤ 60° vs body    0 – .2     eyes → head toward the plane, ≤ 60°
//   .15 – .55 root turns (seated ≤ 90°)    .2 – .6    root turns if > 60° (seated ≤ 90°)
//   .55 – .85 aim hold, hand up, 2° nod    .2F – .5F  the catching hand rises, palm open
//   .85 – 1.0 the throw (release at 1.0)   F          pinch on arrival
//   1.0 – 1.6 follow the plane, head ±30°  F + H      the plane is put down; head → body back (0.6 s)
//   1.6 – 2.2 head → body back (0.6 s)
// reduced motion: the head only, ±60°, no hold / follow. A fast replay (x16, gestureMin): no hold or follow, the head
// and the body turn each in gestureMin (≥ 0.15 s).

const D = Math.PI / 180
export const HEAD_MAX = 60 * D
export const SEATED_BODY_MAX = 90 * D
export const FOLLOW_HEAD_MAX = 30 * D
/** the eyes get there this long before the head */
export const EYE_LEAD_S = 0.08
/** the seated body + head together reach this far; the rest is the hand's reach */
export const SEATED_REACH = SEATED_BODY_MAX + HEAD_MAX
export const NOD = 2 * D
/** the catching hand reaches at most this far around the body, to the side */
export const HAND_MAX = 100 * D
const EYE_FULL = 25 * D

export interface AimOpts {
  /** at a desk (or any seat): the root turns at most 90° */
  seated: boolean
  reduced: boolean
  /** the timelapse at x16: no aim hold, no follow */
  fast: boolean
  /** gestureMin, scene seconds: the shortest a turn lasts when fast */
  minTurn: number
  /** false while walking: only the head turns */
  bodyOk: boolean
  /** catch: the plane's flight and how long it is held (scene s) */
  flyFor?: number
  holdS?: number
}

export interface Times {
  headEnd: number
  bodyStart: number
  bodyEnd: number
  /** throw: the aim hold ends and the throw starts; catch: the hand is up */
  holdEnd: number
  /** throw: the plane leaves the hand */
  release: number
  /** the look follows the plane until here, then everything goes back */
  followEnd: number
  retHeadEnd: number
  retBodyStart: number
  end: number
}

export interface Plan {
  kind: 'throw' | 'catch'
  theta: number
  /** the root's turn once done */
  body: number
  opts: AimOpts
  times: Times
}

const smooth = (u: number) => {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}
const clamp = (x: number, lim: number) => Math.min(lim, Math.max(-lim, x))
const ramp = (t: number, a: number, b: number) => smooth(b > a ? (t - a) / (b - a) : t >= b ? 1 : 0)

/** the root's turn for an angle: none within the head's reach, else all of it (seated: at most 90°) */
export function bodyTarget(theta: number, o: Pick<AimOpts, 'seated' | 'reduced' | 'bodyOk'>) {
  if (o.reduced || !o.bodyOk || Math.abs(theta) <= HEAD_MAX) return 0
  return Math.sign(theta) * Math.min(Math.abs(theta), o.seated ? SEATED_BODY_MAX : Math.PI)
}

/** how far a hand has to reach past the head's side when the body and the head together don't get there */
export function reachNeeded(theta: number, body: number, head = HEAD_MAX) {
  return Math.max(0, Math.abs(theta - body) - head)
}

export function planGesture(kind: 'throw' | 'catch', theta: number, o: AimOpts): Plan {
  const body = bodyTarget(theta, o)
  const turns = body !== 0
  const m = Math.max(0.15, o.minTurn)
  let times: Times
  if (o.reduced) {
    const hold = kind === 'catch' ? 1.5 : 0.8
    times = { headEnd: 0.2, bodyStart: 0.2, bodyEnd: 0.2, holdEnd: hold, release: 0.2, followEnd: hold, retHeadEnd: hold + 0.3, retBodyStart: hold + 0.3, end: hold + 0.3 }
  } else if (kind === 'throw') {
    if (o.fast) {
      const bodyStart = 0.6 * m
      const bodyEnd = turns ? bodyStart + m : m
      const release = bodyEnd + 0.1
      times = { headEnd: m, bodyStart, bodyEnd, holdEnd: bodyEnd, release, followEnd: release, retHeadEnd: release + m, retBodyStart: release + 0.5 * m, end: turns ? release + 1.5 * m : release + m }
    } else times = { headEnd: 0.25, bodyStart: 0.15, bodyEnd: 0.55, holdEnd: 0.85, release: 1.0, followEnd: 1.6, retHeadEnd: 2.0, retBodyStart: 1.8, end: 2.2 }
  } else {
    const F = o.flyFor ?? 1
    const H = o.holdS ?? 1.2
    const arrive = F + H
    if (o.fast) {
      const bodyStart = 0.6 * m
      times = { headEnd: m, bodyStart, bodyEnd: turns ? bodyStart + m : m, holdEnd: F * 0.5, release: F, followEnd: arrive, retHeadEnd: arrive + m, retBodyStart: arrive + 0.5 * m, end: turns ? arrive + 1.5 * m : arrive + m }
    } else times = { headEnd: 0.2, bodyStart: 0.2, bodyEnd: 0.6, holdEnd: F * 0.5, release: F, followEnd: arrive, retHeadEnd: arrive + 0.4, retBodyStart: arrive + 0.2, end: arrive + 0.6 }
  }
  return { kind, theta, body, opts: o, times }
}

export interface AimPose {
  /** the root's turn on top of its heading */
  body: number
  /** the head's yaw against the (turned) body */
  head: number
  /** how much of the live pitch toward the target the head takes (0 → 1) */
  pitchW: number
  /** the eyes' sideways lead of the head: −1 … 1, positive = toward the agent's left; 0 once the head has caught up */
  eyes: number
  /** the throwing / catching arm: raised (0 → 1) */
  arm: number
  /** the throw stroke (0 → 1 at the release) */
  stroke: number
  /** the head's dip while aiming, rad */
  nod: number
  /** where the hand points, against the body (it reaches sideways when the head can't turn that far) */
  handAngle: number
  phase: 'turn' | 'aim' | 'throw' | 'follow' | 'back' | 'done'
  /** the face: narrowed eyes while aiming, wide eyes for the first 0.4 s of a catch */
  mood: 'focus' | 'wide' | null
}

function bodyAt(p: Plan, t: number) {
  const T = p.times
  if (t < T.retBodyStart) return p.body * ramp(t, T.bodyStart, T.bodyEnd)
  return p.body * (1 - ramp(t, T.retBodyStart, T.end))
}

/** the head's yaw against the body; `thetaLive` is the angle to what it looks at right now */
function headAt(p: Plan, t: number, thetaLive: number) {
  const T = p.times
  const o = p.opts
  const slow = !o.reduced && !o.fast
  // a thrower follows the plane within ±30° of the body; a catcher keeps the full ±60° to the plane
  const follows = p.kind === 'throw' && slow
  const lim = follows ? HEAD_MAX + (FOLLOW_HEAD_MAX - HEAD_MAX) * ramp(t, T.release, T.release + 0.15) : HEAD_MAX
  const turned = bodyAt(p, t)
  let head: number
  if (t < T.followEnd) head = clamp(thetaLive - turned, lim) * ramp(t, 0, T.headEnd)
  else {
    // back: the head (against the desk) first, then the body follows
    const abs0 = p.body + clamp(thetaLive - p.body, lim)
    head = abs0 * (1 - ramp(t, T.followEnd, T.retHeadEnd)) - turned
  }
  return clamp(head, HEAD_MAX)
}

export function aimPose(p: Plan, t: number, thetaLive: number): AimPose {
  const T = p.times
  const o = p.opts
  if (t >= T.end) return { body: 0, head: 0, pitchW: 0, eyes: 0, arm: 0, stroke: 0, nod: 0, handAngle: 0, phase: 'done', mood: null }
  const body = bodyAt(p, t)
  const head = headAt(p, t, thetaLive)
  // the eyes are on the target before the head is: they see it as the head was EYE_LEAD_S ago
  const t0 = Math.max(0, t - EYE_LEAD_S)
  const lag = bodyAt(p, t0) + headAt(p, t0, thetaLive)
  const eyeOff = t < T.followEnd ? 1 : 1 - ramp(t, T.followEnd, T.followEnd + 0.15)
  const eyes = clamp((thetaLive - lag) / EYE_FULL, 1) * eyeOff
  const back = t >= T.followEnd
  const pitchW = back ? 1 - ramp(t, T.followEnd, T.retHeadEnd) : ramp(t, 0, T.headEnd)
  let arm = 0
  let stroke = 0
  let nod = 0
  if (!o.reduced) {
    if (p.kind === 'throw') {
      const up = ramp(t, T.bodyStart, T.bodyEnd)
      const down = ramp(t, T.release + 0.2 * (o.fast ? 0.25 : 1), T.release + (o.fast ? Math.max(0.15, o.minTurn) : 0.7))
      arm = up * (1 - down)
      stroke = ramp(t, T.holdEnd, T.release)
      if (!o.fast && t >= T.bodyEnd && t < T.holdEnd) nod = Math.sin(((t - T.bodyEnd) / (T.holdEnd - T.bodyEnd)) * Math.PI) * NOD
    } else {
      const lower = o.fast ? Math.max(0.15, o.minTurn) : 0.4
      arm = ramp(t, (o.flyFor ?? 1) * 0.2, T.holdEnd) * (1 - ramp(t, T.followEnd, T.followEnd + lower))
    }
  }
  // the hand keeps to the way the gesture began (the live angle would chase the plane held in this very hand)
  const handAngle = clamp(p.theta - body, HAND_MAX)
  const phase: AimPose['phase'] = t >= T.followEnd ? 'back' : p.kind === 'throw' ? (t >= T.release ? 'follow' : t >= T.holdEnd ? 'throw' : t >= T.bodyEnd ? 'aim' : 'turn') : 'turn'
  const mood: AimPose['mood'] = p.kind === 'throw' ? (t >= T.bodyEnd && t < T.release ? 'focus' : null) : t < 0.4 ? 'wide' : null
  return { body, head, pitchW, eyes, arm, stroke, nod, handAngle, phase, mood }
}
