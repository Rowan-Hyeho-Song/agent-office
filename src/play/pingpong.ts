// Ping-pong rally engine (#135): a pure function of (seed, players, t). Table-local coordinates, metres:
// x along the table length (net at x=0), z across, y up with the table top at y=0. Player 0 stands at -x, player 1 at +x.
// Ball positions are the ball CENTRE (it rests on the table at y = ballR).
//
// Model (AI and human share it): a shot leaves the hitter's contact point, flies a parabola (g = 9.81) to one bounce on
// the receiver's half (restitution 0.85, horizontal speed x0.92), then rises to the receiver's hitting plane
// x = +-(L/2 + reach), where the receiver makes contact. Times come from distances and speeds, never from frames.
// A shot is good, or ends the point: 'net' (hits the net), 'long' (lands past the end), 'miss' (receiver whiffs).
// Odds come from skill (LIKES.pingpong: 메시/메모 0.4 weak, 루프 3 strong). No spin; the serve has no own-half bounce.
// Games run to 11, win by 2, serve changes every 2 points (every point at deuce). After a game: a hold, then a new
// game (the other player serves first), so the schedule is endless.
//
// Human control (#137): `nextShot(state, aim?)` is the one step function. AI hitter: omit `aim`. Human hitter: pass
// aim = { quality 0..1 (timing/position; fault odds shrink with it), aimZ -1..1 (target across the table) }; quality 0
// is a whiff: the returned shot is the incoming ball continuing as a miss (`whiff: true`). Set `state.human` so balls
// to the human are never pre-decided as 'miss'; the AI side keeps rolling its skill on the same model.

import type { Contact } from './stroke'
import { LIKES, hash, rng } from '../office/play'

export type V3 = [number, number, number]
export interface Dims {
  /** table length (x) */
  L: number
  /** table width (z) */
  W: number
  /** net height above the table top */
  netH: number
  ballR?: number
  /** how far beyond the table end the hitting plane is */
  reach?: number
  /** y of the floor (negative): where a lost ball ends */
  floorY?: number
}
export const DEFAULT_DIMS: Required<Dims> = { L: 2.74, W: 1.525, netH: 0.1525, ballR: 0.02, reach: 0.25, floorY: -0.76 }
const full = (d: Dims): Required<Dims> => ({ ...DEFAULT_DIMS, ...d })

export const G = 9.81
const E = 0.85
const FRIC = 0.92
export const TOSS_MS = 700
export const GAP_MS = 1300
export const HOLD_MS = 6000
export const SWING_LEAD_MS = 150
/** the swing runs [contact - 150, contact + 150]: contact at t01 = 0.5 */
export const SWING_MS = 300
const BOUNCE_MS = 120

export type Outcome = 'good' | 'net' | 'long' | 'miss'
export interface Shot {
  hitter: 0 | 1
  /** contact time (ms, match clock) */
  t0: number
  /** contact point; y is the ball centre */
  p0: V3
  outcome: Outcome
  /** direction along x: +1 when player 0 hits */
  d: 1 | -1
  vs: number
  vz: number
  vy0: number
  /** seconds to the bounce (to the landing level for 'long') */
  T1: number
  xb: number
  zb: number
  vy1: number
  T2: number
  /** contact height of the ball centre above its resting height */
  h0: number
  /** seconds from contact to the end of the ball's life */
  tEndS: number
  /** seconds from contact until the point is decided (outcomes other than good) */
  tDecideS: number
  /** seconds from contact to the receiver's hitting plane (good / miss) */
  tPlaneS: number
  pointWinner: 0 | 1 | null
  whiff?: boolean
}

export interface RallyState {
  seed: number
  players: [string, string]
  dims: Required<Dims>
  /** the human-controlled side, if any */
  human?: 0 | 1
  /** contact time of the next shot (ms) */
  t: number
  game: number
  point: number
  /** shot number within the point */
  n: number
  hitter: 0 | 1
  from: V3
  score: [number, number]
  /** who served the game's first point */
  first: 0 | 1
  server: 0 | 1
  incoming: Shot | null
}

export const skillOf = (agent: string) => {
  const l = LIKES[agent]?.pingpong ?? 1
  return l / (l + 1)
}

export const gameWon = (a: number, b: number) => (a >= 11 || b >= 11) && Math.abs(a - b) >= 2
/** who serves when the score is a:b; `first` served the game's first point */
export function serverFor(first: 0 | 1, a: number, b: number): 0 | 1 {
  const total = a + b
  if (a >= 10 && b >= 10) return ((first + total) % 2) as 0 | 1
  return (first ^ (Math.floor(total / 2) % 2)) as 0 | 1
}

export function initialState(seed: number, players: [string, string], dims: Dims, human?: 0 | 1): RallyState {
  const first = (seed & 1) as 0 | 1
  return {
    seed, players, dims: full(dims), human, t: TOSS_MS, game: 0, point: 0, n: 0, hitter: first,
    from: [0, 0, 0], score: [0, 0], first, server: first, incoming: null,
  }
}

interface Solved { vy0: number; T1: number; vy1: number; T2: number; hn: number; hh: number }
function solve(x0: number, h0: number, vs: number, xb: number, xh: number): Solved {
  const T1 = Math.abs(xb - x0) / vs
  const vy0 = (0.5 * G * T1 * T1 - h0) / T1
  const tn = Math.abs(x0) / vs
  const hn = h0 + vy0 * tn - 0.5 * G * tn * tn
  const vy1 = -E * (vy0 - G * T1)
  const T2 = Math.abs(xh - xb) / (vs * FRIC)
  return { vy0, T1, vy1, T2, hn, hh: vy1 * T2 - 0.5 * G * T2 * T2 }
}

/** the ball centre u seconds after contact, or null once its life is over */
export function ballAt(s: Shot, dims: Required<Dims>, u: number): V3 | null {
  if (u < 0 || u > s.tEndS + 1e-9) return null
  const r = dims.ballR
  const x0 = s.p0[0]
  const z0 = s.p0[2]
  const arc = (): V3 => [x0 + s.d * s.vs * u, r + s.h0 + s.vy0 * u - 0.5 * G * u * u, z0 + s.vz * u]
  if (s.outcome === 'long') return arc()
  if (s.outcome === 'net') {
    const tn = Math.abs(x0) / s.vs
    if (u <= tn) return arc()
    const tau = u - tn
    const hn = s.h0 + s.vy0 * tn - 0.5 * G * tn * tn
    return [-s.d * 0.25 * s.vs * tau, r + Math.max(0, hn - 0.5 * G * tau * tau), z0 + s.vz * tn]
  }
  if (u <= s.T1) return arc()
  const v = u - s.T1
  return [s.xb + s.d * s.vs * FRIC * v, r + s.vy1 * v - 0.5 * G * v * v, s.zb + s.vz * FRIC * v]
}

const opp = (h: 0 | 1) => (1 - h) as 0 | 1

export interface Aim {
  quality: number
  aimZ?: number
}

/**
 * The next shot of the rally and the state after it. Pure: same (state, aim) -> same result.
 */
export function nextShot(state: RallyState, aim?: Aim): { shot: Shot; state: RallyState } {
  const { dims, hitter } = state
  const { L, W, netH, ballR: r, reach, floorY } = dims
  const d = (hitter === 0 ? 1 : -1) as 1 | -1
  const humanHits = state.human === hitter

  // a human whiff turns the incoming ball into a miss
  if (humanHits && aim && aim.quality <= 0 && state.incoming) {
    const inc = state.incoming
    const shot = finishMiss({ ...inc, outcome: 'miss', pointWinner: inc.hitter, whiff: true }, dims)
    return { shot, state: afterPoint(state, shot) }
  }

  const rand = rng(hash(`${state.seed}|${state.game}|${state.point}|${state.n}`))
  const serve = state.n === 0
  const x0 = -d * (L / 2 + reach)
  const xh = d * (L / 2 + reach)
  const from: V3 = serve ? [x0, r + 0.3, (rand() * 2 - 1) * W * 0.15] : state.from
  const h0 = from[1] - r
  const sk = skillOf(state.players[hitter])
  const skR = skillOf(state.players[opp(hitter)])
  const aimZ = Math.max(-1, Math.min(1, aim?.aimZ ?? rand() * 2 - 1))
  const zb = aimZ * W * 0.38
  const vs0 = 3.2 + rand() * 1.6
  const want = 0.15 + rand() * 0.2
  const rFault = rand()
  const rKind = rand()
  const rMiss = rand()
  const rLand = rand()

  let pFault = humanHits ? 0.12 - 0.1 * (aim?.quality ?? 0.5) : 0.12 - 0.1 * sk
  if (serve) pFault *= 0.5
  let pMiss = 0.2 - 0.15 * skR
  if (aim && humanHits) pMiss += 0.15 * Math.abs(aimZ)
  const receiverHuman = state.human === opp(hitter)
  const outcome: Outcome = rFault < pFault ? (rKind < 0.5 ? 'net' : 'long') : !receiverHuman && rMiss < pMiss ? 'miss' : 'good'

  const base = { hitter, t0: state.t, p0: from, d, h0 }
  let shot: Shot
  if (outcome === 'long') {
    const vs = vs0 * 1.3
    const xl = d * (L / 2 + 0.25 + 0.3 * rLand)
    const T1 = Math.abs(xl - x0) / vs
    const vy0 = (0.5 * G * T1 * T1 - h0) / T1
    const tEndS = (vy0 + Math.sqrt(vy0 * vy0 + 2 * G * (h0 - floorY))) / G
    shot = { ...base, outcome, vs, vz: (zb - from[2]) / T1, vy0, T1, xb: xl, zb, vy1: 0, T2: 0, tEndS, tDecideS: T1, tPlaneS: 0, pointWinner: opp(hitter) }
  } else if (outcome === 'net') {
    const tn = Math.abs(x0) / vs0
    const hn = netH * 0.55
    const vy0 = (hn - h0 + 0.5 * G * tn * tn) / tn
    shot = { ...base, outcome, vs: vs0, vz: (zb * 0.3 - from[2]) / tn, vy0, T1: tn, xb: 0, zb, vy1: 0, T2: 0, tEndS: tn + Math.sqrt((2 * hn) / G), tDecideS: tn, tPlaneS: 0, pointWinner: opp(hitter) }
  } else {
    // search the bounce point (distance from the net on the receiver's half) and speed for a clean, net-clearing shot
    let best: { c: number; vs: number; xb: number; s: Solved } | null = null
    for (const m of [1, 0.8, 1.25]) {
      const vs = vs0 * m
      for (let k = 0; k <= 16; k++) {
        const xb = d * (0.12 + (0.34 * k) / 16) * L
        const s = solve(x0, h0, vs, xb, xh)
        const c = Math.max(0, netH + 0.03 - s.hn) * 100 + Math.max(0, 0.08 - s.hh) * 100 + Math.max(0, s.hh - 0.55) * 100 + Math.abs(s.hh - want) + (m === 1 ? 0 : 0.02)
        if (!best || c < best.c) best = { c, vs, xb, s }
      }
    }
    const { vs, xb, s } = best!
    shot = { ...base, outcome, vs, vz: (zb - from[2]) / s.T1, vy0: s.vy0, T1: s.T1, xb, zb, vy1: s.vy1, T2: s.T2, tEndS: s.T1 + s.T2, tDecideS: s.T1 + s.T2, tPlaneS: s.T1 + s.T2, pointWinner: null }
    if (outcome === 'miss') shot = finishMiss({ ...shot, pointWinner: hitter }, dims)
  }

  if (outcome === 'good') {
    const p = ballAt(shot, dims, shot.tEndS)!
    return { shot, state: { ...state, t: state.t + shot.tEndS * 1000, n: state.n + 1, hitter: opp(hitter), from: p, incoming: shot } }
  }
  return { shot, state: afterPoint(state, shot) }
}

/** a miss: the ball flies on past the receiver's plane and falls to the floor */
function finishMiss(s: Shot, dims: Required<Dims>): Shot {
  const D = -dims.floorY
  const u = (s.vy1 + Math.sqrt(s.vy1 * s.vy1 + 2 * G * D)) / G
  return { ...s, tEndS: s.T1 + u, tDecideS: s.T1 + s.T2 }
}

function afterPoint(state: RallyState, shot: Shot): RallyState {
  const score: [number, number] = [state.score[0], state.score[1]]
  score[shot.pointWinner!]++
  const tEnd = shot.t0 + shot.tEndS * 1000
  if (gameWon(score[0], score[1])) {
    const first = opp(state.first)
    return { ...state, t: tEnd + HOLD_MS + TOSS_MS, game: state.game + 1, point: 0, n: 0, hitter: first, first, server: first, score: [0, 0], incoming: null }
  }
  const server = serverFor(state.first, score[0], score[1])
  return { ...state, t: tEnd + GAP_MS + TOSS_MS, point: state.point + 1, n: 0, hitter: server, server, score, incoming: null }
}

// ---- the lazily built match schedule ---------------------------------------------------------------------------------

interface Rec {
  shot: Shot
  tStart: number
  tEnd: number
  tDecide: number
  game: number
  scoreBefore: [number, number]
  /** the score once this shot's point is decided (the final score when the game ends) */
  scoreAfter: [number, number]
  /** the server of this point, and of the next one */
  server: 0 | 1
  serverAfter: 0 | 1
  gameOver: boolean
}
interface Match { recs: Rec[]; state: RallyState }
const cache = new Map<string, Match>()

function extend(m: Match, t: number) {
  while ((m.recs.length === 0 || m.recs[m.recs.length - 1].tStart <= t) && m.recs.length < 100000) {
    const before = m.state
    const { shot, state: after } = nextShot(before)
    const ends = shot.pointWinner !== null
    const scoreAfter: [number, number] = [before.score[0], before.score[1]]
    if (ends) scoreAfter[shot.pointWinner!]++
    m.recs.push({
      shot,
      tStart: before.n === 0 ? shot.t0 - TOSS_MS : shot.t0,
      tEnd: shot.t0 + shot.tEndS * 1000,
      tDecide: shot.t0 + shot.tDecideS * 1000,
      game: before.game,
      scoreBefore: before.score,
      scoreAfter,
      server: before.server,
      serverAfter: ends && after.game === before.game ? after.server : before.server,
      gameOver: ends && after.game !== before.game,
    })
    m.state = after
  }
}

export interface Rally {
  /** ball centre, table-local; null between points (or in discrete mode) */
  ballPos: V3 | null
  phase: 'serve' | 'flight' | 'bounce' | 'dead'
  hitter: 0 | 1
  /** paddle swing of `side` (t01 0..1, contact at 0.5) and the ball position at contact; a miss swings late */
  swing: { side: 0 | 1; t01: number; at: V3 } | null
  score: [number, number]
  server: 0 | 1
  gameOver?: boolean
  winner?: 0 | 1
  /** index of the game being played (0 based) */
  game: number
  /**
   * the contacts around now, both sides (#416 ③, play.md 7): the last one before now and the next ones, each with the time its
   * player may start moving for it (the opponent's hit it answers, or the serve's toss). A ball that wins the point is
   * whiffed at the moment it crosses the receiver's hitting plane. Empty in discrete mode.
   */
  contacts: Contact[]
}

/**
 * The rally at `tMs` (ms since the session start). Cheap at any t: the schedule is built lazily, cached by seed, and
 * seeked by binary search. `discrete` (reduced motion): state only (score, phase, server), no ball and no swing.
 */
export function rallyAt(seed: number, players: [string, string], tMs: number, dims: Dims = DEFAULT_DIMS, discrete = false): Rally {
  const dm = full(dims)
  const key = `${seed}|${players[0]}|${players[1]}|${dm.L},${dm.W},${dm.netH},${dm.ballR},${dm.reach},${dm.floorY}`
  let m = cache.get(key)
  if (!m) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    m = { recs: [], state: initialState(seed, players, dm) }
    cache.set(key, m)
  }
  const t = Math.max(tMs, 0)
  extend(m, t)
  const recs = m.recs
  let lo = 0
  let hi = recs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (recs[mid].tStart <= t) lo = mid
    else hi = mid - 1
  }
  const rec = recs[lo]
  const s = rec.shot
  const decided = s.pointWinner !== null && t >= rec.tDecide
  const score = decided ? rec.scoreAfter : rec.scoreBefore

  let phase: Rally['phase'] = 'dead'
  let ballPos: V3 | null = null
  if (tMs >= 0 && t < s.t0) {
    phase = 'serve'
    const f = Math.min(1, (t - rec.tStart) / TOSS_MS)
    ballPos = [s.p0[0], s.p0[1] + 0.14 * Math.sin(Math.PI * f), s.p0[2]]
  } else if (tMs >= 0 && t <= rec.tEnd) {
    const u = (t - s.t0) / 1000
    ballPos = ballAt(s, dm, u)
    phase = (s.outcome === 'good' || s.outcome === 'miss') && u >= s.T1 && u < s.T1 + BOUNCE_MS / 1000 ? 'bounce' : 'flight'
  }

  let swing: Rally['swing'] = null
  let hitter = s.hitter
  if (!discrete && tMs >= 0) {
    let bestD = Infinity
    for (let k = Math.max(0, lo - 1); k <= Math.min(recs.length - 1, lo + 1); k++) {
      const sh = recs[k].shot
      const cands: [number, 0 | 1, V3][] = [[sh.t0, sh.hitter, sh.p0]]
      if (sh.outcome === 'miss') cands.push([sh.t0 + sh.tPlaneS * 1000 + 100, opp(sh.hitter), ballAt(sh, dm, sh.tPlaneS)!])
      for (const [c, side, at] of cands) {
        const dist = Math.abs(t - c)
        if (dist <= SWING_MS / 2 && dist < bestD) {
          bestD = dist
          swing = { side, t01: (t - (c - SWING_LEAD_MS)) / SWING_MS, at }
        }
      }
    }
    if (swing) hitter = swing.side
  }

  const contacts: Contact[] = []
  if (!discrete && tMs >= 0) {
    for (let k = Math.max(0, lo - 1); k <= Math.min(recs.length - 1, lo + 1); k++) {
      const r = recs[k]
      const sh = r.shot
      // a serve: from the start of its toss; a return: from the opponent's hit before it (the previous record of the point)
      const from = r.tStart < sh.t0 ? r.tStart : k > 0 ? recs[k - 1].shot.t0 : sh.t0 - 1000
      contacts.push({ side: sh.hitter, t: sh.t0, at: sh.p0, miss: false, from })
      const plane = sh.outcome === 'miss' ? ballAt(sh, dm, sh.tPlaneS) : null
      if (plane) contacts.push({ side: opp(sh.hitter), t: sh.t0 + sh.tPlaneS * 1000, at: plane, miss: true, from: sh.t0 })
    }
  }

  const out: Rally = {
    ballPos: discrete ? null : ballPos,
    phase,
    hitter,
    swing,
    contacts,
    score: [score[0], score[1]],
    server: decided ? rec.serverAfter : rec.server,
    game: rec.game,
  }
  if (rec.gameOver && decided) {
    out.gameOver = true
    out.winner = score[0] > score[1] ? 0 : 1
  }
  return out
}
