// #137 ③ the visitor holds one paddle against an agent (play.md 3 · 5.4 · 7 · 8). Pure: the match as a value, stepped by the frame's time and
// the paddle where the visitor holds it; the rig (PingpongVisitRig.tsx) draws it, the stage (playStage.ts) moves the agent from its contacts.
//
// The same rally model as the agents' (pingpong.ts nextShot): the visitor is side 0 (the -x end; the camera stands 2.2 m behind its end line),
// the agent side 1. The match clock runs at the chosen speed (0.5 / 0.7 / 0.9 of real time): the ball flies the agents' arcs, slower.
// A ball to the visitor is never decided beforehand: it is hit if it crosses the visitor's hitting plane within REACH of the paddle's middle
// (pulled 30% toward it), or (easy mode) if Space comes within ±0.25 s of the crossing. The agent's returns roll its skill as with the agents.
// Three points win; the serve changes every point.

import { ballAt, initialState, nextShot, DEFAULT_DIMS, G, GAP_MS, TOSS_MS, type Dims, type RallyState, type Rally, type Shot, type V3 } from './pingpong'
import type { Contact } from './stroke'

export type Speed = 'slow' | 'normal' | 'fast'
export const SPEEDS: readonly Speed[] = ['slow', 'normal', 'fast']
export const SPEED_NAME: Record<Speed, string> = { slow: '느리게', normal: '보통', fast: '빠르게' }

export const VISITOR_PP = {
  /** the ball's speed against the agents' own (play.md 5.4) */
  mul: { slow: 0.5, normal: 0.7, fast: 0.9 } as Record<Speed, number>,
  /** a hit: the ball within this of the paddle's middle as it crosses the hitting plane (m), at any speed */
  reachM: 0.18,
  /** the ball pulled this far toward the paddle's middle as it is hit */
  pull: 0.3,
  /** easy mode: Space this close to the crossing (real seconds) */
  easyS: 0.25,
  /** the landing ring this long (real seconds) before the ball lands on the visitor's half; earlier when slow */
  ringLeadS: { slow: 0.6, normal: 0.4, fast: 0.4 } as Record<Speed, number>,
  winPoints: 3,
  /** the paddle: across the table's width plus this either side (m); its height above the floor (m) */
  sideM: 0.3,
  heightM: [0.8, 1.2] as const,
  /** the paddle tilts with its sideways speed, up to this (deg) */
  tiltDeg: 25,
  /** the serve is tossed from this far over the paddle's middle (m) */
  serveLiftM: 0.1,
} as const

/** the visitor's paddle in table-local metres: y = the ball centre's height over the table top at its middle, z across; vz its speed (m/s) */
export interface Paddle {
  y: number
  z: number
  vz: number
}

export type PPEvent =
  | { kind: 'hit'; side: 0 | 1; at: V3 }
  | { kind: 'point'; winner: 0 | 1; score: [number, number] }
  | { kind: 'over'; winner: 0 | 1; score: [number, number] }

export interface VisitorPP {
  agent: string
  seed: number
  speed: Speed
  easy: boolean
  /** match clock (ms) */
  t: number
  /** the rally engine's state (human = 0) */
  st: RallyState
  /** the ball now (or the agent's serve about to be hit, t0 in the future) */
  shot: Shot | null
  /** the ball to the visitor has crossed its plane unhit: it flies on as a miss; easy mode may still hit it until lateUntil */
  late: { until: number } | null
  /** easy mode: Space pressed at this match time, waiting for the crossing */
  armedAt: number | null
  /** both sides' contacts, for the agent's timetable (play.md 7) */
  contacts: Contact[]
  /** [visitor, agent] */
  score: [number, number]
  server: 0 | 1
  phase: 'serve' | 'toss' | 'flight' | 'gap' | 'over'
  /** when the phase began (match ms) */
  phaseAt: number
  /** a point decided: when the next one starts (match ms) */
  nextAt: number
  /** the point's winner, once decided */
  decided: 0 | 1 | null
}

const dims = (d?: Dims) => ({ ...DEFAULT_DIMS, ...d })
/** the visitor's hitting plane (table-local x) */
export const visitorPlaneX = (d: Dims = DEFAULT_DIMS) => -(dims(d).L / 2 + dims(d).reach)

/** a new match: the visitor serves first */
export function startVisitorPP(agent: string, seed: number, speed: Speed = 'normal', easy = false, d?: Dims): VisitorPP {
  const st: RallyState = { ...initialState(seed, ['visitor', agent], dims(d), 0), hitter: 0, first: 0, server: 0 }
  return { agent, seed, speed, easy, t: 0, st, shot: null, late: null, armedAt: null, contacts: [], score: [0, 0], server: 0, phase: 'serve', phaseAt: 0, nextAt: 0, decided: null }
}

/** the paddle's middle as a table-local point on the visitor's plane */
export const paddlePoint = (p: Paddle, d?: Dims): V3 => [visitorPlaneX(d), dims(d).ballR + p.y, p.z]

const keep = (c: Contact[], t: number) => c.filter((x) => x.t > t - 3000)

/** a hit by the visitor at `at` (the ball as it crosses), with the paddle where it is */
function visitorHits(g: VisitorPP, at: V3, p: Paddle): { g: VisitorPP; events: PPEvent[] } {
  const R = VISITOR_PP.reachM
  const pp = paddlePoint(p, g.st.dims)
  const off = Math.hypot(at[1] - pp[1], at[2] - pp[2])
  // pulled toward the paddle's middle (forgiving); the place it met and the paddle's sideways speed choose where it goes
  const from: V3 = [at[0], at[1] + (pp[1] - at[1]) * VISITOR_PP.pull, at[2] + (pp[2] - at[2]) * VISITOR_PP.pull]
  const aimZ = Math.max(-1, Math.min(1, (at[2] - pp[2]) / R + p.vz * 0.6))
  const quality = Math.max(0.3, 1 - 0.6 * Math.min(1, off / R))
  const st: RallyState = { ...g.st, t: g.t, hitter: 0, from }
  const { shot } = nextShot(st, { quality, aimZ })
  const contacts = keep(g.contacts, g.t)
  contacts.push({ side: 0, t: g.t, at: from, miss: false, from: g.shot?.t0 ?? g.t })
  // the agent reads the ball as it leaves the paddle (play.md 7): where and when it will meet it
  if (shot.outcome === 'good' || shot.outcome === 'miss') contacts.push({ side: 1, t: shot.t0 + shot.tPlaneS * 1000, at: ballAt(shot, g.st.dims, shot.tPlaneS)!, miss: shot.outcome === 'miss', from: shot.t0 })
  return { g: { ...g, st, shot, late: null, armedAt: null, contacts, phase: 'flight', phaseAt: g.t, decided: null }, events: [{ kind: 'hit', side: 0, at: from }] }
}

/** the agent's shot (its serve after the toss, or its return): the ball from its side */
function agentShot(g: VisitorPP, st: RallyState, from: number): VisitorPP {
  const { shot } = nextShot(st)
  const contacts = keep(g.contacts, g.t)
  // a return was read when the visitor hit it (visitorHits): the same contact is not added twice
  if (!contacts.some((c) => c.side === 1 && Math.abs(c.t - shot.t0) < 1)) contacts.push({ side: 1, t: shot.t0, at: shot.p0, miss: false, from })
  return { ...g, st: { ...st, incoming: shot, n: st.n + 1, hitter: 0, from: shot.outcome === 'good' ? ballAt(shot, g.st.dims, shot.tEndS)! : st.from }, shot, late: null, contacts, phase: g.phase === 'toss' ? 'toss' : 'flight' }
}

/** the point is decided: the score, then the gap, then the next serve (every point) or the end */
function point(g: VisitorPP, winner: 0 | 1, endsAt: number): { g: VisitorPP; events: PPEvent[] } {
  const score: [number, number] = [g.score[0], g.score[1]]
  score[winner]++
  const events: PPEvent[] = [{ kind: 'point', winner, score }]
  return { g: { ...g, score, decided: winner, nextAt: Math.max(g.t, endsAt) + GAP_MS }, events }
}

/** the next point: the other side serves */
function nextPoint(g: VisitorPP): { g: VisitorPP; events: PPEvent[] } {
  if (g.score[0] >= VISITOR_PP.winPoints || g.score[1] >= VISITOR_PP.winPoints) {
    const winner = (g.score[0] > g.score[1] ? 0 : 1) as 0 | 1
    return { g: { ...g, phase: 'over', phaseAt: g.t, shot: null }, events: [{ kind: 'over', winner, score: g.score }] }
  }
  const server = (1 - g.server) as 0 | 1
  const st: RallyState = { ...g.st, point: g.st.point + 1, n: 0, hitter: server, server, incoming: null }
  const base: VisitorPP = { ...g, st, server, shot: null, late: null, armedAt: null, decided: null, phaseAt: g.t }
  if (server === 0) return { g: { ...base, phase: 'serve' }, events: [] }
  // the agent tosses now and hits at the toss's end: its shot is known from the start (its timetable reads it)
  return { g: agentShot({ ...base, phase: 'toss' }, { ...st, t: g.t + TOSS_MS }, g.t), events: [] }
}

/** the visitor serves (a click, a tap, Space) from where the paddle is; only on their serve */
export function serveVisitorPP(g: VisitorPP, p: Paddle): { g: VisitorPP; events: PPEvent[] } | null {
  if (g.phase !== 'serve') return null
  const pp = paddlePoint(p, g.st.dims)
  const from: V3 = [pp[0], pp[1] + VISITOR_PP.serveLiftM, pp[2]]
  const st: RallyState = { ...g.st, t: g.t, hitter: 0, n: 0 }
  const { shot } = nextShot(st, { quality: 1, aimZ: Math.max(-1, Math.min(1, p.vz * 0.6 + pp[2] / dims(g.st.dims).W)), from })
  const contacts = keep(g.contacts, g.t)
  contacts.push({ side: 0, t: g.t, at: from, miss: false, from: g.phaseAt })
  if (shot.outcome === 'good' || shot.outcome === 'miss') contacts.push({ side: 1, t: shot.t0 + shot.tPlaneS * 1000, at: ballAt(shot, g.st.dims, shot.tPlaneS)!, miss: shot.outcome === 'miss', from: shot.t0 })
  return { g: { ...g, st: { ...st, n: 1, incoming: shot }, shot, contacts, phase: 'flight', phaseAt: g.t }, events: [{ kind: 'hit', side: 0, at: from }] }
}

/** easy mode: Space (the hit's timing); a serve on the visitor's serve */
export function spaceVisitorPP(g: VisitorPP, p: Paddle): { g: VisitorPP; events: PPEvent[] } | null {
  if (g.phase === 'serve') return serveVisitorPP(g, p)
  if (!g.easy || g.phase !== 'flight' || !g.shot || g.shot.hitter !== 1 || g.decided !== null) return null
  // late (just past the plane): hit it where it is
  if (g.late && g.t <= g.late.until) return visitorHits(g, ballAt(g.shot, g.st.dims, (g.t - g.shot.t0) / 1000) ?? paddlePoint(p, g.st.dims), p)
  return { g: { ...g, armedAt: g.t }, events: [] }
}

/** the easy mode's paddle: it follows where the ball will cross (or the table's middle line) */
export function followPaddle(g: VisitorPP, p: Paddle): Paddle {
  const s = g.shot
  if (!s || s.hitter !== 1 || g.phase !== 'flight') return { ...p, y: p.y + (0.2 - p.y) * 0.1, z: p.z * 0.9, vz: 0 }
  const at = ballAt(s, g.st.dims, s.tPlaneS) ?? ballAt(s, g.st.dims, s.T1)
  return at ? { y: at[1] - dims(g.st.dims).ballR, z: at[2], vz: 0 } : p
}

/**
 * The match `dtS` real seconds later, the paddle where it is now. The ball to the visitor is judged as it crosses the plane; a point is
 * decided when the ball's life says so; the next point starts after the gap.
 */
export function stepVisitorPP(g0: VisitorPP, dtS: number, p: Paddle): { g: VisitorPP; events: PPEvent[] } {
  const mul = VISITOR_PP.mul[g0.speed]
  let g: VisitorPP = { ...g0, t: g0.t + Math.max(0, dtS) * 1000 * mul }
  const events: PPEvent[] = []
  const take = (r: { g: VisitorPP; events: PPEvent[] }) => {
    g = r.g
    events.push(...r.events)
  }
  if (g.phase === 'over' || g.phase === 'serve') return { g, events }
  if (g.decided !== null) {
    if (g.t >= g.nextAt) take(nextPoint(g))
    return { g, events }
  }
  const s = g.shot
  if (!s) return { g, events }
  if (g.phase === 'toss' && g.t >= s.t0) g = { ...g, phase: 'flight', phaseAt: s.t0 }
  if (g.phase !== 'flight') return { g, events }
  const u = (g.t - s.t0) / 1000
  const d = g.st.dims
  if (s.hitter === 1) {
    // the agent's ball: a fault decides at once; a good one comes to the visitor's plane
    if (s.outcome === 'net' || s.outcome === 'long') {
      if (u >= s.tDecideS) take(point(g, 0, s.t0 + s.tEndS * 1000))
      return { g, events }
    }
    if (!g.late && u >= s.tPlaneS) {
      const at = ballAt(s, d, s.tPlaneS)!
      const pp = paddlePoint(p, d)
      const near = Math.hypot(at[1] - pp[1], at[2] - pp[2]) <= VISITOR_PP.reachM
      const armed = g.armedAt !== null && g.t - g.armedAt <= VISITOR_PP.easyS * 1000 * mul
      if (g.easy ? armed : near) {
        take(visitorHits(g, at, p))
        return { g, events }
      }
      // missed (or not yet pressed): the ball flies on past; easy mode may still hit it a moment late
      const fall = (s.vy1 + Math.sqrt(s.vy1 * s.vy1 + 2 * G * -d.floorY)) / G
      const miss: Shot = { ...s, outcome: 'miss', tEndS: s.T1 + fall }
      g = { ...g, shot: miss, late: { until: s.t0 + s.tPlaneS * 1000 + (g.easy ? VISITOR_PP.easyS * 1000 * mul : 0) }, armedAt: null }
    }
    if (g.late && g.t > g.late.until) take(point(g, 1, g.shot!.t0 + g.shot!.tEndS * 1000))
    return { g, events }
  }
  // the visitor's ball: out, in the net, or past the agent; else the agent returns it as it reaches its plane
  if (s.outcome === 'net' || s.outcome === 'long' || s.outcome === 'miss') {
    if (u >= s.tDecideS) take(point(g, s.outcome === 'miss' ? 0 : 1, s.t0 + s.tEndS * 1000))
    return { g, events }
  }
  if (u >= s.tEndS) {
    const st: RallyState = { ...g.st, t: s.t0 + s.tEndS * 1000, hitter: 1, from: ballAt(s, d, s.tEndS)!, incoming: s, n: g.st.n + 1 }
    g = agentShot(g, st, s.t0)
    events.push({ kind: 'hit', side: 1, at: st.from })
  }
  return { g, events }
}

export const setSpeed = (g: VisitorPP, speed: Speed): VisitorPP => ({ ...g, speed })
export const setEasy = (g: VisitorPP, easy: boolean): VisitorPP => ({ ...g, easy, armedAt: null })

/** where the ball is now (table-local), or null (between points it is in the server's hand; on the visitor's serve over the paddle) */
export function ballOf(g: VisitorPP, p: Paddle): V3 | null {
  const d = g.st.dims
  if (g.phase === 'serve') {
    const pp = paddlePoint(p, d)
    return [pp[0], pp[1] + VISITOR_PP.serveLiftM, pp[2]]
  }
  const s = g.shot
  if (!s || g.phase === 'over') return null
  if (g.t < s.t0) {
    // the agent's toss
    const f = Math.min(1, Math.max(0, 1 - (s.t0 - g.t) / TOSS_MS))
    return [s.p0[0], s.p0[1] + 0.14 * Math.sin(Math.PI * f), s.p0[2]]
  }
  return ballAt(s, d, (g.t - s.t0) / 1000)
}

/** where and when (real seconds from now) the ball will land on the visitor's half, if it is coming: for the ring (play.md 3.2) */
export function landing(g: VisitorPP): { at: V3; inS: number } | null {
  const s = g.shot
  if (!s || s.hitter !== 1 || g.phase !== 'flight' || g.decided !== null || s.outcome !== 'good') return null
  const inS = (s.t0 + s.T1 * 1000 - g.t) / 1000 / VISITOR_PP.mul[g.speed]
  if (inS < 0) return null
  return { at: [s.xb, 0, s.zb], inS }
}

/** the match as the stage draws an agents' rally: the ball, the contacts for the agent's timetable, the agent's swing (its hit's sound) */
export function rallyOf(g: VisitorPP, p: Paddle): Rally {
  const ballPos = ballOf(g, p)
  let swing: Rally['swing'] = null
  for (const c of g.contacts) {
    if (c.side !== 1 || c.miss) continue
    const t01 = (g.t - (c.t - 150)) / 300
    if (t01 >= 0 && t01 <= 1) swing = { side: 1, t01, at: c.at }
  }
  return {
    ballPos,
    phase: g.phase === 'toss' ? 'serve' : ballPos && g.phase === 'flight' ? 'flight' : 'dead',
    hitter: g.shot?.hitter ?? g.server,
    swing,
    contacts: g.contacts,
    score: [g.score[0], g.score[1]],
    server: g.server,
    game: 0,
  }
}
