// Deterministic traffic (#138): agents never pass through each other. A pure planner turns the agents' requests
// (go to spot / slot X) into time-parameterized trajectories over the walkable grid (grid.ts) with a reservation
// table over cells and time:
//   - priority = who asked first (request time), tie -> lower agent index; the higher priority plans first and is
//     never disturbed, everyone else plans around its reserved trajectory (cooperative prioritized A* on cells x time:
//     8 directions, wait = a state too, fixed neighbour order as the tie-break);
//   - a walker prefers a lane 0.3 m to the right of its route, so two agents meeting in open space both keep right;
//     where the floor is too narrow for two bodies the search simply has to wait: the loser stands aside, in the
//     nearest free cell, until the corridor is free;
//   - waiting > 3 s in a row -> the stretch is replanned with the cells ahead blocked (another route);
//   - destination occupied -> wait beside it (0.66-0.9 m) until it is free (a replan follows any goal change);
//   - the sofa's knee row (sofaRow.ts, optional): one standing body at a time (a reservation over the row's cells like any other,
//     the others wait outside its mouth), slow, facing the sofa; an entering body comes from the entrance nearest its seat;
//   - the cell path is smoothed in time (moving average) so the walk is round, and the result is verified against
//     everyone ahead and the furniture (the raw stair-step path is the fallback).
// Time is the caller's simulation clock (seconds), never frame dependent. Pure: no three.js, no Date.

import { cellAt, centre, distanceField, findPath, nearestWalkable, step, type Grid } from './grid'
import { SEAT_R } from './formation'
import { DESK_SIDES, dist, type NavGraph, type NavSpot } from './nav'
import { inSofaRow, rowApproach, rowLocal, seatedPair, SOFA_ROW, type RowApproach, type SofaRow } from './sofaRow'

/** how near its goal a walker is allowed the relaxed clearance to a neighbour resting on a designed pair spot (m): the arrival zone (0.45 m, the day sim's own) plus half a grid cell. It was 0.75; with the sofa against the south wall and the fig beside it (#280) a walker coming from the north-west cut in to 0.39 m from the sleeper from that far out */
const EXEMPT_ZONE = 0.5
/** how many points of the next SOFA_ROW.turnLeadS are checked for the sofa row (0.1 s apart): a body turns to the sofa before it steps in */
const LEAD_STEPS = 10
/**
 * The agents' cruising walk, m/s (#329: 0.75 -> 1.0, the user found them slow). The one number for the planner (TRAFFIC.cruise) and the
 * rig (rig.ts SPEED, and its acceleration, corner speed and turn rate, which scale with it).
 */
export const CRUISE = 1.0
/** what the walk was tuned at; the rig scales its acceleration / corner / turn numbers by CRUISE / this */
export const CRUISE_TUNED = 0.75

/** the inner half of the meeting circle (its ring is SEAT_R): a body not bound for the centre stays out of it (#355) */
export const MEET_INNER_R = SEAT_R / 2
/** the circle's reach: its ring (SEAT_R) and the step back out of it */
const MEET_RING_R = SEAT_R + 0.4
/** round its own goal the ban leaves cells open: a talk seat (MEET_SEAT_R 0.5 m) is a cell or two inside it */
const MEET_GOAL_OPEN = 0.25
/** ... and round where it stands: about a grid cell */
const MEET_START_OPEN = 0.16

export const TRAFFIC = {
  /** body radius, m: two agents are never closer than 2 x this */
  bodyR: 0.3,
  /** the search keeps this much more than 2R (the smoothing moves a path by a few cm) */
  planGap: 0.12,
  /** the finished trajectories are verified against 2R plus this */
  verifyGap: 0.02,
  cruise: CRUISE,
  /** A* time grid, s (closed-list resolution) and stored trajectory grid, s */
  tick: 0.1,
  sampleDt: 0.05,
  horizonS: 25,
  maxExpand: 14000,
  /** moving average over this many s, and the blend that joins a replan to where the agent is */
  smoothS: 0.5,
  blendS: 0.5,
  /** the lane a walker keeps, m to the right of its route, and the pull towards it (s per m) */
  lane: 0.3,
  lanePull: 0.004,
  /** the same for agents whose free routes come close to someone else's (they should pass on the right) */
  lanePullMeeting: 0.05,
  /** free routes closer than this to another agent's mark both as meeting */
  meetingM: 1.6,
  /** a stretch of waiting this long is replanned around what blocks it ... */
  rerouteAfterS: 3,
  /** ... and takes the other way if that gets it there at most this much later than waiting would */
  rerouteSlackS: 10,
  /** waiting beside an occupied destination: distance band, m */
  besideMin: 0.66,
  besideMax: 0.9,
  /** an agent starting closer than the clearance (a sofa pair) may not get closer, and must be clear again after this long (s) */
  startEaseS: 1.0,
  /** a lower-priority agent standing in the way of a higher one counts as an obstacle for this long (s) */
  ghostS: 1.5,
  /** retry a plan that could not reach its destination (occupied) every this many s */
  retryS: 2,
  /** replans happen on this grid of the clock, so the outcome does not depend on the frame that noticed the change */
  planGridS: 0.1,
  /** the closest approach of two agents within this counts as a "pass" for the gestures */
  passRangeM: 1.3,
  /** designer's yield timings (agents.md 2.8), s and degrees; the rig turns them into head / hand motion */
  cue: {
    yieldS: 1.2,
    stepAsideS: 0.3,
    nodFromS: 0.3,
    nodToS: 0.9,
    followFromS: 0.9,
    yieldHeadDeg: 25,
    nodDeg: 5,
    handForwardM: 0.15,
    handSweepM: 0.12,
    /** the same pair meeting again within this skips the hand gesture */
    repeatS: 30,
    passHeadDeg: 10,
    passS: 0.4,
    wideHeadDeg: 10,
    wideS: 0.4,
    tiltDeg: 12,
    tiltS: 0.4,
    destTapEveryS: 1.5,
    destTapCurl: 0.15,
  },
}

/** sorted, overlapping spans joined */
function mergeSpans(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (const s of [...spans].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1]
    if (last && s[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], s[1])
    else out.push([s[0], s[1]])
  }
  return out
}

export type CueKind = 'yield' | 'pass' | 'wide' | 'tilt' | 'dest'

export interface Cue {
  kind: CueKind
  t0: number
  t1: number
  target: string | null
  /** yield only: false = step aside + head turn only (met this pair recently) */
  gesture: boolean
}

export interface Request {
  /** a nav spot id, or (with `slot`) the label the agent reports as `arrived` */
  spot: string
  /** an arbitrary standing pose instead of a nav spot (formations, #141) */
  slot?: { x: number; z: number; ry: number }
  /** do not walk through the desk sides (night duty) */
  avoid?: ReadonlySet<string>
  /** walking pace scale (the replay walks faster) */
  pace: number
  /** do not start before this clock time (staggered choreography); only honoured when the agent stands still */
  notBefore?: number
}

export interface Sample {
  x: number
  z: number
  /** direction of travel as an ry, or null while standing */
  heading: number | null
  speed: number
  moving: boolean
  /** the spot it stands on, at rest (null while walking or waiting beside) */
  arrived: string | null
  cue: { kind: CueKind; age: number; dur: number; gesture: boolean; toward: { x: number; z: number } | null } | null
}

// ---- trajectories ------------------------------------------------------------------------------------------------

interface Traj {
  t0: number
  n: number
  x: Float64Array
  z: Float64Array
  /** the spot index it stands on at rest at that sample, else -1 */
  at: Int16Array
  /** it stands still from here on */
  endT: number
  reached: boolean
  /** the spot / slot it ends on (reached) */
  finAt: string | null
  /** a replan inserted its "blocked 3 s" beat here */
  rerouteAt?: number
  /** the planned cell path, for the debug overlay */
  path: { t: number; x: number; z: number }[]
  /** a lower-priority agent's own motion for the next moments: an obstacle that is gone afterwards */
  ghost?: boolean
}

interface AgentRec {
  id: string
  index: number
  req: Request | null
  reqT: number
  traj: Traj
  cues: Cue[]
  nextRetry: number
}

interface Way {
  t: number
  x: number
  z: number
  c: number
}

interface Ctx {
  V: number
  field: Float64Array
  extra: Uint8Array | undefined
  reserved: Traj[]
  goalCell: number
  gx: number
  gz: number
  goalIdx: number
  near: boolean
  ref: { ax: number; az: number; bx: number; bz: number }[]
  lanePull: number
  /** an agent that starts closer to someone than the planning clearance (a sofa pair) may leave: no closer than it starts */
  startLim?: Map<Traj, { lim: number; from: number }>
  /** the sofa row (#341): the times somebody else stands in it (padded); the row's cells are unsafe then */
  rowBusy?: [number, number][]
}

interface SNode {
  c: number
  /** index of the safe interval of the cell it is in (-1 = the root) and when that interval ends */
  iv: number
  end: number
  /** arrival time, and when it left its parent's cell */
  t: number
  dep: number
  g: number
  f: number
  par: SNode | null
  seq: number
}

const KEY = 4096

export class TrafficPlanner {
  private spots: Record<string, NavSpot>
  private agents = new Map<string, AgentRec>()
  private names: string[] = []
  private idx = new Map<string, number>()
  private exempt = new Map<number, number>()
  private met = new Map<string, number>()
  private fields = new Map<string, Float64Array>()
  private avoidCells = new Map<string, Uint8Array>()
  private unions = new Map<string, Uint8Array>()
  private centreBans = new Map<string, Uint8Array>()
  private dirty = false
  private thr = 2 * TRAFFIC.bodyR + TRAFFIC.planGap
  private thrV = 2 * TRAFFIC.bodyR + TRAFFIC.verifyGap
  /** spot pairs designed closer than 2R (sofa seats): resting there side by side is allowed */
  readonly exemptPairs: [string, string][] = []
  /** how many searches ran / expanded (for the timing report) */
  stats = { searches: 0, expanded: 0 }
  /** the sofa's knee row (#341), if the scene has one: its cells, the slow stretch round it, the seat spots, a way in per seat */
  private row?: { zone: SofaRow; cells: number[]; slow: Uint8Array; seats: NavSpot[]; entrances: NavSpot[]; approach: RowApproach; bans: Map<string, { key: string; set: Uint8Array } | null> }

  constructor(
    readonly grid: Grid,
    graph: NavGraph,
  ) {
    this.spots = { ...graph.spots }
    if (grid.zone) this.row = this.buildRow(grid, grid.zone, graph)
    const ids = Object.keys(this.spots).sort()
    ids.forEach((id) => this.name(id))
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = this.spots[ids[i]]
        const b = this.spots[ids[j]]
        // only destinations: aisle points and talk-circle centres are never stood on
        const pass = (k: string) => k === 'hall' || k === 'meet_center'
        if (pass(a.kind) || pass(b.kind)) continue
        const d = dist(a, b)
        // designed neighbours: closer than two bodies (the sofa seats) or than the resting clearance 2R + planGap (coffee /
        // shelf, 0.63 m: without this one standing at either kept the other unreachable, agents waited beside forever)
        if (d < 2 * TRAFFIC.bodyR + TRAFFIC.planGap) {
          this.exemptPairs.push([ids[i], ids[j]])
          this.exempt.set(this.idx.get(ids[i])! * KEY + this.idx.get(ids[j])!, d)
          this.exempt.set(this.idx.get(ids[j])! * KEY + this.idx.get(ids[i])!, d)
        }
      }
    }
  }

  private buildRow(g: Grid, zone: SofaRow, graph: NavGraph) {
    const cells: number[] = []
    const slow = new Uint8Array(g.w * g.h)
    for (let c = 0; c < slow.length; c++) {
      const p = centre(g, c)
      if (inSofaRow(zone, p.x, p.z, SOFA_ROW.approachM)) slow[c] = 1
      if (inSofaRow(zone, p.x, p.z) && !g.blocked[c]) cells.push(c)
    }
    const all = Object.values(graph.spots).sort((a, b) => (a.id < b.id ? -1 : 1))
    const seats = all.filter((s) => s.kind === 'sofa')
    const entrances = all.filter((s) => s.kind === 'sofa_in')
    return { zone, cells, slow, seats, entrances, approach: rowApproach(zone, entrances, seats), bans: new Map<string, { key: string; set: Uint8Array } | null>() }
  }

  private name(id: string): number {
    let i = this.idx.get(id)
    if (i === undefined) {
      i = this.names.length
      this.names.push(id)
      this.idx.set(id, i)
    }
    return i
  }

  // ---- public API ----

  /** stand on a spot at once (first frame, replay seeks) */
  place(id: string, req: Request, now: number, index = this.agents.size) {
    const t = this.snap(now)
    this.addSlot(req)
    const p = this.pointOf(req)
    const traj = this.restTraj(t, p.x, p.z, req.spot)
    const a = this.agents.get(id)
    if (a) {
      a.req = req
      a.reqT = t
      a.traj = traj
      a.cues = []
    } else this.agents.set(id, { id, index, req, reqT: t, traj, cues: [], nextRetry: Infinity })
    this.dirty = true
  }

  /** ask to go somewhere; a no-op when it is the same request */
  request(id: string, req: Request, now: number, index?: number) {
    const a = this.agents.get(id)
    if (!a) return this.place(id, req, now, index)
    const r = a.req
    const sameSpot = !!r && r.spot === req.spot && r.slot?.x === req.slot?.x && r.slot?.z === req.slot?.z
    if (sameSpot && !!r!.avoid === !!req.avoid && r!.pace === req.pace && r!.notBefore === req.notBefore) return
    if (!sameSpot) a.reqT = this.snap(now)
    a.req = req
    this.addSlot(req)
    this.dirty = true
  }

  /** replan if anything was requested (or a blocked destination is due a retry); true when it did */
  update(now: number): boolean {
    const t = this.snap(now)
    let retry = false
    for (const a of this.agents.values()) if (a.nextRetry <= t) retry = true
    if (!this.dirty && !retry) return false
    this.dirty = false
    this.replanAll(t)
    return true
  }

  has(id: string) {
    return this.agents.has(id)
  }

  sample(id: string, now: number): Sample {
    const a = this.agents.get(id)!
    const tr = a.traj
    const d = TRAFFIC.sampleDt
    const p = this.px(tr, now)
    const p2 = this.px(tr, now + d)
    const p1 = this.px(tr, now - d)
    const vx = (p2.x - p1.x) / (2 * d)
    const vz = (p2.z - p1.z) / (2 * d)
    const speed = Math.hypot(vx, vz)
    const atI = tr.at[Math.max(0, Math.min(tr.n - 1, Math.round((now - tr.t0) / d)))]
    const arrived = now >= tr.endT && tr.reached ? tr.finAt : atI >= 0 && speed < 0.02 ? this.names[atI] : null
    const cue = a.cues.find((c) => now >= c.t0 && now < c.t1)
    let toward: { x: number; z: number } | null = null
    if (cue?.target) {
      const o = this.agents.get(cue.target)
      if (o) toward = this.px(o.traj, now)
    }
    return {
      x: p.x,
      z: p.z,
      heading: speed > 0.05 ? (this.facesSofa(tr, now, p) ? this.row!.zone.face : Math.atan2(-vx, -vz)) : null,
      speed,
      moving: speed > 0.02,
      arrived,
      cue: cue ? { kind: cue.kind, age: now - cue.t0, dur: cue.t1 - cue.t0, gesture: cue.gesture, toward } : null,
    }
  }

  /** in the sofa row, or about to enter it: the body side-steps facing the sofa instead of along its way (the turn is done at the edge) */
  private facesSofa(tr: Traj, now: number, p: { x: number; z: number }): boolean {
    const row = this.row
    if (!row) return false
    if (inSofaRow(row.zone, p.x, p.z)) return true
    // anywhere in the next turnLeadS, not only its end: at 1.0 m/s (#337) the point 1 s ahead was already past the row on the seat, and the
    // body turned only as it stepped in (20° off the sofa for the first steps)
    for (let k = 1; k <= LEAD_STEPS; k++) {
      const ahead = this.px(tr, now + (SOFA_ROW.turnLeadS * k) / LEAD_STEPS)
      if (inSofaRow(row.zone, ahead.x, ahead.z)) return true
    }
    return false
  }

  /** the planned position at a time (any time; before / after the stored span it clamps) */
  position(id: string, t: number): { x: number; z: number } {
    return this.px(this.agents.get(id)!.traj, t)
  }

  /** the time the agent stands still at its final place (Infinity if it never gets there) */
  settledAt(id: string): number {
    const a = this.agents.get(id)!
    return a.traj.reached ? a.traj.endT : Infinity
  }

  /** the rest of the planned route (every ~0.5 s), for the debug overlay */
  routePoints(id: string, now: number): { x: number; z: number }[] {
    const tr = this.agents.get(id)!.traj
    const out = [this.px(tr, now)]
    for (let t = Math.ceil(now / 0.5) * 0.5; t < tr.endT; t += 0.5) out.push(this.px(tr, t))
    out.push(this.px(tr, tr.endT))
    return out
  }

  // ---- internals ----

  private snap(t: number) {
    return Math.floor(t / TRAFFIC.planGridS + 1e-9) * TRAFFIC.planGridS
  }

  private pointOf(req: Request): { x: number; z: number } {
    return req.slot ?? this.spots[req.spot]
  }

  private addSlot(req: Request) {
    if (!req.slot) return
    this.spots[req.spot] = { id: req.spot, x: req.slot.x, z: req.slot.z, ry: req.slot.ry, kind: 'stand' }
    this.name(req.spot)
  }

  private px(tr: Traj, t: number, out?: { x: number; z: number }): { x: number; z: number } {
    const o = out ?? { x: 0, z: 0 }
    const f = (t - tr.t0) / TRAFFIC.sampleDt
    if (f <= 0) {
      o.x = tr.x[0]
      o.z = tr.z[0]
    } else if (f >= tr.n - 1) {
      o.x = tr.x[tr.n - 1]
      o.z = tr.z[tr.n - 1]
    } else {
      const i = Math.floor(f)
      const u = f - i
      o.x = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * u
      o.z = tr.z[i] + (tr.z[i + 1] - tr.z[i]) * u
    }
    return o
  }

  private restTraj(t: number, x: number, z: number, at: string): Traj {
    const i = this.name(at)
    return { t0: t, n: 2, x: new Float64Array([x, x]), z: new Float64Array([z, z]), at: new Int16Array([i, i]), endT: t, reached: true, finAt: at, path: [] }
  }

  private replanAll(t: number) {
    const order = [...this.agents.values()].sort((a, b) => a.reqT - b.reqT || a.index - b.index)
    // pass 1: free-flow routes tell which agents will meet; those keep to their right all the way
    const free = order.map((a) => this.planAgent(a, t, [], TRAFFIC.lanePull))
    const meeting = new Set<string>()
    const tmpA = { x: 0, z: 0 }
    const tmpB = { x: 0, z: 0 }
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const end = Math.min(free[i].endT, free[j].endT) + 1
        for (let tt = t; tt < end; tt += 0.1) {
          this.px(free[i], tt, tmpA)
          this.px(free[j], tt, tmpB)
          if (Math.hypot(tmpA.x - tmpB.x, tmpA.z - tmpB.z) < TRAFFIC.meetingM) {
            meeting.add(order[i].id)
            meeting.add(order[j].id)
            break
          }
        }
      }
    }
    const olds = new Map(order.map((o) => [o.id, o.traj] as const))
    const ghosts = new Map(order.map((o) => [o.id, this.ghostOf(o.traj, t)] as const))
    let seq = order
    for (let attempt = 0; ; attempt++) {
      for (const o of order) o.traj = olds.get(o.id)!
      const reserved: Traj[] = []
      for (const o of seq) {
        // everyone ahead as planned, everyone behind as a short-lived obstacle where they stand now
        const behind = seq.slice(seq.indexOf(o) + 1).map((q) => ghosts.get(q.id)!)
        o.traj = this.planAgent(o, t, [...reserved, ...behind], meeting.has(o.id) ? TRAFFIC.lanePullMeeting : TRAFFIC.lanePull)
        reserved.push(o.traj)
      }
      // a plan that could not keep clear of someone ahead (a stuck agent that had to stand still): that agent goes first instead
      const bad = attempt < 3 ? this.firstClash(seq, t, olds) : null
      if (!bad) break
      seq = [...seq.filter((o) => o !== bad.late)]
      seq.splice(seq.indexOf(bad.early), 0, bad.late)
    }
    for (const o of order) o.nextRetry = o.req && !o.traj.reached ? t + TRAFFIC.retryS : Infinity
    this.buildCues(t, order)
  }

  /** the first pair (in planning order) that comes closer than 2R, apart from a designed pair or a start that was already that close */
  private firstClash(seq: AgentRec[], t: number, olds: Map<string, Traj>): { early: AgentRec; late: AgentRec } | null {
    const A = { x: 0, z: 0 }
    const B = { x: 0, z: 0 }
    for (let j = 1; j < seq.length; j++) {
      for (let i = 0; i < j; i++) {
        const ta = seq[i].traj
        const tb = seq[j].traj
        const oa = this.px(olds.get(seq[i].id)!, t, A)
        const ob = this.px(olds.get(seq[j].id)!, t, B)
        const d0 = Math.hypot(oa.x - ob.x, oa.z - ob.z)
        const end = Math.min(Math.max(ta.endT, tb.endT) + 0.5, t + 20)
        // the planner lets an agent come close to a designed neighbour of its own destination (limit(): a sofa seat beside the next); this check
        // must allow the same approach, or it flags the plan the search was right to make and reorders the pair for ever (#193)
        const goalA = seq[i].req && this.spots[seq[i].req!.spot] ? { idx: this.idx.get(seq[i].req!.spot) ?? -1, ...this.pointOf(seq[i].req!) } : null
        const goalB = seq[j].req && this.spots[seq[j].req!.spot] ? { idx: this.idx.get(seq[j].req!.spot) ?? -1, ...this.pointOf(seq[j].req!) } : null
        for (let tt = t; tt < end; tt += 0.1) {
          this.px(ta, tt, A)
          this.px(tb, tt, B)
          const d = Math.hypot(A.x - B.x, A.z - B.z)
          // one standing body in the sofa row at a time (#341)
          if (this.row && this.standsInRow(A.x, A.z) && this.standsInRow(B.x, B.z)) return { early: seq[i], late: seq[j] }
          let lim = 2 * TRAFFIC.bodyR
          if (this.row && seatedPair(this.row.approach, A.x, A.z, B.x, B.z)) lim = SOFA_ROW.seatedM - 0.03
          if (d0 < lim && tt < t + 1.5) lim = d0 - 0.05
          if (d >= lim) continue
          const ia = Math.max(0, Math.min(ta.n - 1, Math.round((tt - ta.t0) / TRAFFIC.sampleDt)))
          const ib = Math.max(0, Math.min(tb.n - 1, Math.round((tt - tb.t0) / TRAFFIC.sampleDt)))
          if (ta.at[ia] >= 0 && tb.at[ib] >= 0 && this.exempt.has(ta.at[ia] * KEY + tb.at[ib])) continue
          // B walking in beside A resting at a spot next to B's destination, or A beside B's
          const approach = (g: { idx: number; x: number; z: number } | null, p: { x: number; z: number }, other: Traj, oi: number) =>
            g !== null && g.idx >= 0 && other.at[oi] >= 0 && d >= this.limit({ goalIdx: g.idx, gx: g.x, gz: g.z } as Ctx, p.x, p.z, other, oi, TRAFFIC.planGap) ? true : false
          if (approach(goalB, B, ta, ia) || approach(goalA, A, tb, ib)) continue
          return { early: seq[i], late: seq[j] }
        }
      }
    }
    return null
  }

  private easeLim(sl: { lim: number; from: number }, t: number) {
    return sl.lim + (this.thr - sl.lim) * Math.max(0, Math.min(1, (t - sl.from) / TRAFFIC.startEaseS))
  }

  private ghostOf(old: Traj, t: number): Traj {
    const n = Math.round(TRAFFIC.ghostS / TRAFFIC.sampleDt) + 1
    const x = new Float64Array(n)
    const z = new Float64Array(n)
    const tmp = { x: 0, z: 0 }
    for (let i = 0; i < n; i++) {
      this.px(old, t + i * TRAFFIC.sampleDt, tmp)
      x[i] = tmp.x
      z[i] = tmp.z
    }
    return { t0: t, n, x, z, at: new Int16Array(n).fill(-1), endT: t + TRAFFIC.ghostS, reached: false, finAt: null, path: [], ghost: true }
  }

  private fieldFor(goalCell: number, avoid: boolean, own = '', ban: { key: string; set: Uint8Array } | null = null): Float64Array {
    const key = `${goalCell}|${avoid ? 1 : 0}|${own}|${ban?.key ?? ''}`
    let f = this.fields.get(key)
    if (!f) {
      f = distanceField(this.grid, goalCell, this.blockedFor(avoid, own, ban))
      if (this.fields.size > 64) this.fields.clear()
      this.fields.set(key, f)
    }
    return f
  }

  /** the cells a route may not use: the desk sides (night duty) and the row's far end (the entrance rule) */
  private blockedFor(avoid: boolean, own: string, ban: { key: string; set: Uint8Array } | null): Uint8Array | undefined {
    const base = avoid ? this.avoidSet(own) : undefined
    if (!ban) return base
    if (!base) return ban.set
    const key = `${own}|${ban.key}`
    let u = this.unions.get(key)
    if (!u) {
      u = new Uint8Array(base.length)
      for (let c = 0; c < u.length; c++) u[c] = base[c] | ban.set[c]
      this.unions.set(key, u)
    }
    return u
  }

  /**
   * The entrance rule (#341): a body goes in to a seat of the row by the entrance nearest that seat, and a body getting up from one goes out
   * by it. So the cells beyond the seat (further from the entrance than the seat plus a little) are shut for its route: the row itself and
   * the strip of sofa floor on the far side of it (else the way round along the seats would be the shortcut to the far end). None for a slide
   * from seat to seat, for goals / starts that have nothing to do with a seat of the row, and when the entrance is not at one end of the row.
   */
  private entranceBan(spot: string, here: { x: number; z: number }): { key: string; set: Uint8Array } | null {
    const row = this.row
    const goal = this.spots[spot]
    if (!row || !goal || !row.entrances.length) return null
    const from = row.seats.find((q) => Math.hypot(q.x - here.x, q.z - here.z) < 0.3)
    let seat: NavSpot
    if (goal.kind === 'sofa') {
      // in: from outside the row only
      if (from || inSofaRow(row.zone, here.x, here.z, SOFA_ROW.approachM)) return null
      seat = goal
    } else if (from) seat = from
    else return null
    let ban = row.bans.get(seat.id)
    if (ban !== undefined) return ban
    ban = null
    const z = row.zone
    const sl = rowLocal(z, seat.x, seat.z)
    // a seat along the sofa side of this row, not the chaise or a beanbag somewhere else
    if (Math.abs(sl.u) <= z.sizeX / 2 + 0.2 && Math.abs(sl.v) <= z.sizeZ / 2 + SOFA_ROW.stripM) {
      let best: NavSpot | null = null
      for (const e of row.entrances) if (!best || dist(e, seat) < dist(best, seat) - 1e-9) best = e
      const du = sl.u - rowLocal(z, best!.x, best!.z).u
      if (Math.abs(du) > SOFA_ROW.overshootM) {
        const set = new Uint8Array(this.grid.w * this.grid.h)
        for (let c = 0; c < set.length; c++) {
          const p = centre(this.grid, c)
          const q = rowLocal(z, p.x, p.z)
          // the row, and the sofa-side strip (the seats' docks run along it)
          const inRow = Math.abs(q.u) <= z.sizeX / 2 && Math.abs(q.v) <= z.sizeZ / 2
          const strip = Math.abs(q.u) <= z.sizeX / 2 + SOFA_ROW.stripM && q.v > z.sizeZ / 2 && q.v <= z.sizeZ / 2 + SOFA_ROW.stripM && Math.sign(sl.v) === 1
          if ((inRow || strip) && Math.sign(du) * (q.u - sl.u) > SOFA_ROW.overshootM) set[c] = 1
        }
        ban = { key: seat.id, set }
      }
    }
    row.bans.set(seat.id, ban)
    return ban
  }

  /**
   * The inner half of the meeting circle is nobody's way (#355): a body that is not going to the centre keeps out of the cells within
   * MEET_INNER_R of it, so leaving a seat (or a talk seat) it goes out by the nearest side instead of across the middle, and one coming
   * in comes from outside. Left open round its own goal (a seat of the circle's own is a cell or two from the ban) and for a body that
   * is inside already (it must be able to get out).
   */
  private centreBan(req: Request, here: { x: number; z: number }, goal: { x: number; z: number }): { key: string; set: Uint8Array } | null {
    if (this.spots[req.spot]?.kind === 'meet_center') return null
    const centres = Object.values(this.spots).filter((s) => s.kind === 'meet_center')
    if (!centres.length) return null
    // only a body that sets off from the circle or is bound for it (its seats, the step back): the aisle through the middle stays everyone else's way
    // (a body standing at another destination within the ring's reach, the whiteboard, is not leaving the circle)
    const atOther = Object.values(this.spots).some((s) => s.kind !== 'meet_center' && s.kind !== 'hall' && !s.id.startsWith('meet_') && dist(s, here) < 0.2)
    const ring = centres.filter((c) => (!atOther && dist(c, here) < MEET_RING_R) || (req.spot.startsWith('meet_') && dist(c, goal) < MEET_RING_R))
    if (!ring.length || ring.some((c) => dist(c, here) < MEET_INNER_R)) return null
    // the cell it stands in is open (the seat's own cell may lie inside the ban: it must be able to step out of it)
    const g = this.grid
    const own = cellAt(g, here.x, here.z)
    const key = `centre|${ring.map((c) => c.id).join()}|${goal.x.toFixed(2)},${goal.z.toFixed(2)}|${own}`
    let set = this.centreBans.get(key)
    if (!set) {
      set = new Uint8Array(g.w * g.h)
      for (let c = 0; c < set.length; c++) {
        const p = centre(g, c)
        if (ring.some((m) => dist(m, p) < MEET_INNER_R) && Math.hypot(p.x - goal.x, p.z - goal.z) > MEET_GOAL_OPEN && Math.hypot(p.x - here.x, p.z - here.z) > MEET_START_OPEN) set[c] = 1
      }
      if (this.centreBans.size > 64) this.centreBans.clear()
      this.centreBans.set(key, set)
    }
    return { key, set }
  }

  private mergeBans(a: { key: string; set: Uint8Array } | null, b: { key: string; set: Uint8Array } | null): { key: string; set: Uint8Array } | null {
    if (!a || !b) return a ?? b
    const key = `${a.key}+${b.key}`
    let set = this.unions.get(key)
    if (!set) {
      set = new Uint8Array(a.set.length)
      for (let c = 0; c < set.length; c++) set[c] = a.set[c] | b.set[c]
      this.unions.set(key, set)
    }
    return { key, set }
  }

  /** a body standing (not resting on a seat) in the row */
  private standsInRow(x: number, z: number): boolean {
    const row = this.row
    return !!row && inSofaRow(row.zone, x, z) && !row.seats.some((s) => Math.hypot(s.x - x, s.z - z) < SOFA_ROW.seatEps)
  }

  /** the times (padded by gapS, merged) somebody ahead stands in the row: the row's cells are shut then (one body at a time) */
  private rowBusyOf(reserved: Traj[]): [number, number][] {
    if (!this.row) return []
    const gap = SOFA_ROW.gapS
    const raw: [number, number][] = []
    const tmp = { x: 0, z: 0 }
    for (const r of reserved) {
      for (let tt = r.t0; tt <= r.endT + 1e-9; tt += 0.1) {
        this.px(r, tt, tmp)
        if (this.standsInRow(tmp.x, tmp.z)) raw.push([tt - 0.05 - gap, tt + 0.05 + gap])
      }
      // resting for good in the row (a ghost is gone afterwards)
      this.px(r, r.endT, tmp)
      if (!r.ghost && this.standsInRow(tmp.x, tmp.z)) raw.push([r.endT - gap, Infinity])
    }
    return mergeSpans(raw)
  }

  /**
   * Cells near the desk sides, for the night-duty agent. `own` = a side the agent stands at right now (it came for a talk, #193): that one is left
   * out, or the agent would start inside the avoided ground and never find a way out.
   */
  private avoidSet(own = ''): Uint8Array {
    const have = this.avoidCells.get(own)
    if (have) return have
    const g = this.grid
    const a = new Uint8Array(g.w * g.h)
    for (const id of DESK_SIDES) {
      const s = this.spots[id]
      if (!s || id === own) continue
      for (let c = 0; c < a.length; c++) {
        const p = centre(g, c)
        if (Math.hypot(p.x - s.x, p.z - s.z) < 0.6) a[c] = 1
      }
    }
    this.avoidCells.set(own, a)
    return a
  }

  private planAgent(a: AgentRec, t: number, reserved: Traj[], lanePull: number): Traj {
    const req = a.req
    const old = a.traj
    const here = this.px(old, t)
    if (!req || !this.spots[req.spot]) return old
    const goal = this.pointOf(req)
    const g = this.grid
    let startCell = cellAt(g, here.x, here.z)
    if (startCell < 0 || g.blocked[startCell]) startCell = nearestWalkable(g, here.x, here.z)
    let goalCell = cellAt(g, goal.x, goal.z)
    if (goalCell < 0 || g.blocked[goalCell]) goalCell = nearestWalkable(g, goal.x, goal.z)
    const avoid = !!req.avoid
    // standing at a desk side (a night talk at a working desk): that side is not avoided for the way out
    const own = avoid ? ([...DESK_SIDES].find((id) => this.spots[id] && Math.hypot(here.x - this.spots[id].x, here.z - this.spots[id].z) < 0.6) ?? '') : ''
    const ban = this.mergeBans(this.entranceBan(req.spot, here), this.centreBan(req, here, goal))
    const field = this.fieldFor(goalCell, avoid, own, ban)
    const extra = this.blockedFor(avoid, own, ban)
    const V = TRAFFIC.cruise * req.pace
    let t0 = t
    let pre: Way | null = null
    if (req.notBefore !== undefined && req.notBefore > t && old.reached && this.speedAt(old, t) < 0.02) {
      pre = { t, x: here.x, z: here.z, c: startCell }
      t0 = this.snap(req.notBefore)
    }
    const ref = this.refRoute(here, goal, extra)
    const goalIdx = this.idx.get(req.spot) ?? -1
    const startLim = new Map<Traj, { lim: number; from: number }>()
    for (const r of reserved) {
      const q = this.px(r, t)
      const d = Math.hypot(q.x - here.x, q.z - here.z)
      if (d < this.thr) startLim.set(r, { lim: d - 0.02, from: t })
    }
    const ctx: Ctx = { V, field, extra, reserved, goalCell, gx: goal.x, gz: goal.z, goalIdx, near: false, ref, lanePull, startLim, rowBusy: this.rowBusyOf(reserved) }
    // the destination is held for good by someone resting on it: go straight to waiting beside it
    const blockedForever = !this.restClear(goal.x, goal.z, 1e12, ctx)
    let ways: Way[] | null = null
    let reached = true
    if (!blockedForever) ways = this.search(ctx, { t: t0, x: here.x, z: here.z, c: startCell })
    if (!ways) {
      reached = false
      ways = this.search({ ...ctx, near: true }, { t: t0, x: here.x, z: here.z, c: startCell })
    }
    if (!ways) return this.holdTraj(t, here)
    // already standing where it should (or beside the occupied destination): nothing to plan. A departure held back (notBefore) changes nothing
    // here: there is nowhere to set off to, and a stand-then-step plan would leave it unlabelled (arrived null) until that time, facing the
    // way it walked in instead of the spot's ry (#333)
    if (ways.length === 1 && this.speedAt(old, t) < 0.02 && (!reached || Math.hypot(goal.x - here.x, goal.z - here.z) < 0.02)) {
      return reached ? this.restTraj(t, goal.x, goal.z, req.spot) : this.holdTraj(t, here)
    }
    let rerouteAt: number | undefined
    if (reached) {
      const alt = this.rerouteLongWait(ctx, ways)
      if (alt) {
        ways = alt.ways
        rerouteAt = alt.at
      }
    }
    // the last stretch into the exact spot
    if (reached) {
      const last = ways[ways.length - 1]
      const d = Math.hypot(goal.x - last.x, goal.z - last.z)
      if (d > 1e-6) ways.push({ t: last.t + d / (V * this.speedScale(goalCell)), x: goal.x, z: goal.z, c: goalCell })
    }
    if (pre) ways.unshift(pre)
    return this.bake(a, t, here, ways, reached, reached ? req.spot : null, rerouteAt, goal, reserved)
  }

  /** the free-flow route (string-pulled) the lane is measured from */
  private refRoute(from: { x: number; z: number }, to: { x: number; z: number }, extra?: Uint8Array) {
    const p = findPath(this.grid, from, to, extra)
    const ref: Ctx['ref'] = []
    if (p) for (let i = 1; i < p.length; i++) ref.push({ ax: p[i - 1].x, az: p[i - 1].z, bx: p[i].x, bz: p[i].z })
    return ref
  }

  /** signed distance of a point to the route, right of travel positive */
  private lateral(ref: Ctx['ref'], x: number, z: number): number {
    let best = Infinity
    let sign = 0
    for (const s of ref) {
      const dx = s.bx - s.ax
      const dz = s.bz - s.az
      const len2 = dx * dx + dz * dz || 1
      const u = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / len2))
      const qx = s.ax + dx * u
      const qz = s.az + dz * u
      const d = Math.hypot(x - qx, z - qz)
      if (d < best) {
        best = d
        // right of the direction (dx, dz) is (-dz, dx)
        sign = (x - qx) * -dz + (z - qz) * dx >= 0 ? 1 : -1
      }
    }
    return best === Infinity ? 0 : best * sign
  }

  // ---- collision rules ----

  /** the clearance two agents need now: 2R, relaxed only for a goal spot designed next to the other's resting spot */
  private limit(ctx: Ctx, x: number, z: number, o: Traj, i: number, gap: number): number {
    const base = this.limitBase(ctx, x, z, o, i, gap)
    // a seated body of the sofa row and one in its approach area: seatedM (less the grid's rounding while searching, as the designed pair below)
    if (this.row && seatedPair(this.row.approach, x, z, o.x[i], o.z[i])) return Math.min(base, SOFA_ROW.seatedM - (gap > 0.05 ? 0.05 : 0.03))
    return base
  }

  private limitBase(ctx: Ctx, x: number, z: number, o: Traj, i: number, gap: number): number {
    if (ctx.goalIdx >= 0) {
      const oa = o.at[i]
      if (oa >= 0) {
        const e = this.exempt.get(ctx.goalIdx * KEY + oa)
        if (e !== undefined && Math.hypot(x - ctx.gx, z - ctx.gz) < EXEMPT_ZONE) {
          // a pair at least two bodies apart gives up the extra gap and the grid's rounding (the search tests cell centres, up
          // to half a cell diagonal, 0.11 m, from the spot; the agent stands on the spot itself, e apart)
          if (e >= 2 * TRAFFIC.bodyR) return Math.min(2 * TRAFFIC.bodyR + gap, e - 0.12)
          return e - (gap > 0.05 ? 0.2 : 0.05)
        }
      }
    }
    return 2 * TRAFFIC.bodyR + gap
  }

  /** one of the two rests on a seat of the sofa row and the other is in its approach area (sofaRow.ts): the pair that may be SOFA_ROW.seatedM apart */
  isSeatedPair(x1: number, z1: number, x2: number, z2: number): boolean {
    return !!this.row && seatedPair(this.row.approach, x1, z1, x2, z2)
  }

  /** the share of its cruise a body keeps on this cell: slow in the sofa row and on its approach (#341) */
  private speedScale(c: number): number {
    return this.row?.slow[c] ? SOFA_ROW.speedScale : 1
  }

  private pairOk(ctx: Ctx, x: number, z: number, t: number, tmp: { x: number; z: number }): boolean {
    if (ctx.rowBusy?.length && this.row && inSofaRow(this.row.zone, x, z) && ctx.rowBusy.some(([a, b]) => t >= a && t <= b)) return false
    for (const r of ctx.reserved) {
      if (r.ghost && t > r.endT) continue
      this.px(r, t, tmp)
      const d = Math.hypot(tmp.x - x, tmp.z - z)
      if (d >= this.thr) continue
      const sl = ctx.startLim?.get(r)
      if (sl && t < sl.from + TRAFFIC.startEaseS) {
        if (d < this.easeLim(sl, t)) return false
        continue
      }
      const i = Math.max(0, Math.min(r.n - 1, Math.round((t - r.t0) / TRAFFIC.sampleDt)))
      if (d < this.limit(ctx, x, z, r, i, TRAFFIC.planGap)) return false
    }
    return true
  }

  /** standing at (x, z) from t on stays clear of everyone's remaining plan and their final resting place */
  private restClear(x: number, z: number, t: number, ctx: Ctx): boolean {
    const tmp = { x: 0, z: 0 }
    for (const r of ctx.reserved) {
      for (let tt = t; tt < r.endT; tt += 0.1) {
        this.px(r, tt, tmp)
        const d = Math.hypot(tmp.x - x, tmp.z - z)
        if (d >= this.thr) continue
        const i = Math.max(0, Math.min(r.n - 1, Math.round((tt - r.t0) / TRAFFIC.sampleDt)))
        if (d < this.limit(ctx, x, z, r, i, TRAFFIC.planGap)) return false
      }
      if (r.ghost) continue
      this.px(r, Math.max(t, r.endT), tmp)
      const d = Math.hypot(tmp.x - x, tmp.z - z)
      if (d < this.thr && d < this.limit(ctx, x, z, r, r.n - 1, TRAFFIC.planGap)) return false
    }
    return true
  }

  // ---- the search: safe intervals of cells x time ----

  /** for every cell, the time ranges when someone ahead (planned, or resting for good) is within 2R + gap of its centre */
  private unsafeCells(ctx: Ctx, t0: number): Map<number, [number, number][]> {
    const g = this.grid
    const map = new Map<number, [number, number][]>()
    const reach = Math.ceil(this.thr / g.cell) + 1
    const mark = (c: number, a: number, b: number) => {
      let l = map.get(c)
      if (!l) map.set(c, (l = []))
      // joined (and sorted) once all are in: a span that starts before the last one listed (another trajectory's) must not be folded into it
      const last = l[l.length - 1]
      if (last && a >= last[0] && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b)
      else l.push([a, b])
    }
    const tmp = { x: 0, z: 0 }
    for (const r of ctx.reserved) {
      const end = Math.max(r.endT, t0)
      const sl = ctx.startLim?.get(r)
      const sample = (tt: number, from: number, to: number, i: number) => {
        this.px(r, tt, tmp)
        const ci = Math.floor((tmp.x - g.minX) / g.cell)
        const cj = Math.floor((tmp.z - g.minZ) / g.cell)
        const oa = r.at[i]
        const ex = ctx.goalIdx >= 0 && oa >= 0 ? this.exempt.get(ctx.goalIdx * KEY + oa) : undefined
        for (let j = Math.max(0, cj - reach); j <= Math.min(g.h - 1, cj + reach); j++) {
          for (let k = Math.max(0, ci - reach); k <= Math.min(g.w - 1, ci + reach); k++) {
            const c = j * g.w + k
            if (g.blocked[c]) continue
            const p = centre(g, c)
            let lim = this.thr
            if (sl && tt < sl.from + TRAFFIC.startEaseS) lim = this.easeLim(sl, tt)
            else if (ex !== undefined && Math.hypot(p.x - ctx.gx, p.z - ctx.gz) < EXEMPT_ZONE) lim = ex - 0.2
            if (this.row && seatedPair(this.row.approach, p.x, p.z, tmp.x, tmp.z)) lim = Math.min(lim, SOFA_ROW.seatedM - 0.05)
            if (Math.hypot(p.x - tmp.x, p.z - tmp.z) < lim) mark(c, from, to)
          }
        }
      }
      for (let tt = Math.floor(t0 / 0.1) * 0.1; tt < end; tt += 0.1) sample(tt, tt - 0.05, tt + 0.05, Math.max(0, Math.min(r.n - 1, Math.round((tt - r.t0) / TRAFFIC.sampleDt))))
      // resting for good from here on
      if (!r.ghost) sample(end, end - 0.05, Infinity, r.n - 1)
    }
    // the sofa row holds one standing body at a time: its cells are shut for whoever else would be in it then
    if (this.row && ctx.rowBusy?.length) {
      for (const c of this.row.cells) {
        const l = map.get(c) ?? []
        for (const [a, b] of ctx.rowBusy) if (b > t0) l.push([a, b])
        map.set(c, l)
      }
    }
    // every reserved trajectory marked its own spans in time order, so a cell's list is only sorted per trajectory: the safe intervals
    // (search) read it in order, and a span that starts before the last one listed was folded into it, so a body could wait through
    // someone else's pass (#341, the 0.9 m west gap)
    for (const [c, l] of map) map.set(c, mergeSpans(l))
    return map
  }

  private search(ctx: Ctx, s: { t: number; x: number; z: number; c: number }): Way[] | null {
    const T = TRAFFIC
    const g = this.grid
    const { V, field } = ctx
    this.stats.searches++
    if (!Number.isFinite(field[s.c])) return null
    const unsafe = this.unsafeCells(ctx, s.t)
    const ivCache = new Map<number, [number, number][]>()
    const safeOf = (c: number): [number, number][] => {
      let v = ivCache.get(c)
      if (v) return v
      v = []
      let from = s.t
      for (const [a, b] of unsafe.get(c) ?? []) {
        if (a > from + 1e-9) v.push([from, a])
        from = Math.max(from, b)
      }
      v.push([from, Infinity])
      ivCache.set(c, v)
      return v
    }
    const open: SNode[] = []
    let seq = 0
    const less = (p: SNode, q: SNode) => p.f < q.f || (p.f === q.f && p.seq < q.seq)
    const push = (n: SNode) => {
      open.push(n)
      let i = open.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (less(open[p], n)) break
        open[i] = open[p]
        i = p
      }
      open[i] = n
    }
    const pop = (): SNode => {
      const top = open[0]
      const last = open.pop()!
      if (open.length) {
        let i = 0
        for (;;) {
          let c = 2 * i + 1
          if (c >= open.length) break
          if (c + 1 < open.length && less(open[c + 1], open[c])) c++
          if (less(last, open[c])) break
          open[i] = open[c]
          i = c
        }
        open[i] = last
      }
      return top
    }
    const tmp = { x: 0, z: 0 }
    const limitT = s.t + T.horizonS * 2
    // the root: its own cell may be unsafe right now (someone walked up to it): it may stay for one tick and move
    let rootEnd = Infinity
    for (const [a, b] of unsafe.get(s.c) ?? []) {
      if (a <= s.t + 1e-9 && b > s.t) rootEnd = s.t + T.tick
      else if (a > s.t) {
        rootEnd = Math.min(rootEnd, a)
        break
      }
    }
    const root: SNode = { c: s.c, iv: -1, end: rootEnd, t: s.t, dep: s.t, g: s.t, f: s.t + field[s.c] / V, par: null, seq: seq++ }
    push(root)
    const seen = new Set<number>()
    let expanded = 0
    while (open.length) {
      const n = pop()
      const key = n.c * 64 + n.iv + 1
      if (seen.has(key)) continue
      seen.add(key)
      if (++expanded > T.maxExpand) break
      const cc = centre(g, n.c)
      let isGoal: boolean
      if (ctx.near) {
        const d = Math.hypot(cc.x - ctx.gx, cc.z - ctx.gz)
        isGoal = d >= T.besideMin && d <= T.besideMax
      } else isGoal = n.c === ctx.goalCell
      if (isGoal && n.end === Infinity) {
        this.stats.expanded += expanded
        const out: Way[] = []
        for (let q: SNode | null = n; q; q = q.par) {
          const c = centre(g, q.c)
          out.unshift({ t: q.t, x: q === root ? s.x : c.x, z: q === root ? s.z : c.z, c: q.c })
          // it left its parent's cell at q.dep, after waiting there from the parent's arrival
          if (q.par && q.dep > q.par.t + 1e-9) {
            const pc = centre(g, q.par.c)
            out.unshift({ t: q.dep, x: q.par === root ? s.x : pc.x, z: q.par === root ? s.z : pc.z, c: q.par.c })
          }
        }
        return out
      }
      const px = n === root ? s.x : cc.x
      const pz = n === root ? s.z : cc.z
      for (let d = 0; d < 8; d++) {
        const nc = step(g, n.c, d, ctx.extra)
        if (nc < 0 || !Number.isFinite(field[nc])) continue
        const q = centre(g, nc)
        const len = d < 4 ? g.cell : g.cell * Math.SQRT2
        const dur = len / (V * Math.min(this.speedScale(n.c), this.speedScale(nc)))
        const lat = this.lateral(ctx.ref, q.x, q.z)
        const pen = ctx.lanePull * Math.abs(lat - T.lane) * (len / g.cell)
        const ivs = safeOf(nc)
        for (let j = 0; j < ivs.length; j++) {
          const [sj, ej] = ivs[j]
          if (ej <= n.t + dur) continue
          let a = Math.max(n.t + dur, sj)
          const latest = Math.min(ej - 0.05, n.end + dur)
          // an explicit check of the move itself (the cell centres alone miss two agents crossing between them)
          let ok = false
          for (; a <= latest + 1e-9 && a < limitT; a += T.tick) {
            const dep = a - dur
            const steps = Math.max(1, Math.ceil(dur / 0.05))
            ok = true
            for (let k = 1; k <= steps && ok; k++) {
              const u = k / steps
              ok = this.pairOk(ctx, px + (q.x - px) * u, pz + (q.z - pz) * u, dep + dur * u, tmp)
            }
            if (ok) break
          }
          if (!ok) continue
          const gg = a + n.g - n.t + pen
          push({ c: nc, iv: j, end: ej, t: a, dep: a - dur, g: gg, f: gg + field[nc] / V, par: n, seq: seq++ })
        }
      }
    }
    this.stats.expanded += expanded
    return null
  }

  /** a stretch of waiting longer than 3 s: wait it out as a "blocked" beat, then plan on with the cells ahead blocked */
  private rerouteLongWait(ctx: Ctx, ways: Way[]): { ways: Way[]; at: number } | null {
    let i = 0
    while (i < ways.length - 1) {
      let j = i
      while (j + 1 < ways.length && ways[j + 1].c === ways[i].c) j++
      if (j < ways.length - 1 && ways[j].t - ways[i].t > TRAFFIC.rerouteAfterS) {
        const ban = new Uint8Array(this.grid.w * this.grid.h)
        if (ctx.extra) ban.set(ctx.extra)
        // the cells it was about to walk into after waiting
        for (let k = j + 1; k < Math.min(ways.length, j + 8); k++) if (ways[k].c !== ways[i].c) ban[ways[k].c] = 1
        const tBlock = ways[i].t + TRAFFIC.rerouteAfterS
        const here = ways[i]
        const alt = this.search({ ...ctx, extra: ban, field: distanceField(this.grid, ctx.goalCell, ban) }, { t: tBlock, x: here.x, z: here.z, c: here.c })
        const orig = ways[ways.length - 1].t
        if (alt && alt[alt.length - 1].t < orig + TRAFFIC.rerouteSlackS) {
          return { ways: [...ways.slice(0, i + 1), { ...here, t: tBlock }, ...alt.slice(1)], at: tBlock }
        }
        return null
      }
      i = j + 1
    }
    return null
  }

  private holdTraj(t: number, here: { x: number; z: number }): Traj {
    return { t0: t, n: 2, x: new Float64Array([here.x, here.x]), z: new Float64Array([here.z, here.z]), at: new Int16Array([-1, -1]), endT: t, reached: false, finAt: null, path: [] }
  }

  /** waypoints -> the stored trajectory: sampled, smoothed in time, joined to the agent's own motion, verified */
  private bake(
    a: AgentRec,
    t: number,
    here: { x: number; z: number },
    ways: Way[],
    reached: boolean,
    finAt: string | null,
    rerouteAt: number | undefined,
    goal: { x: number; z: number },
    reserved: Traj[],
  ): Traj {
    const T = TRAFFIC
    const dt = T.sampleDt
    const old = a.traj
    const endMove = ways[ways.length - 1].t
    const half = Math.round(T.smoothS / 2 / dt)
    const nOut = Math.max(2, Math.ceil((endMove - t) / dt) + half + 2)
    // raw samples from t - half*dt (the old trajectory) to the end + padding
    const raw = new Float64Array((nOut + 2 * half + 1) * 2)
    let wi = 0
    const tmp = { x: 0, z: 0 }
    for (let k = -half; k < nOut + half; k++) {
      const tt = t + k * dt
      let x: number
      let z: number
      if (k < 0) {
        this.px(old, tt, tmp)
        x = tmp.x
        z = tmp.z
      } else if (tt <= ways[0].t) {
        x = here.x
        z = here.z
      } else {
        while (wi < ways.length - 2 && tt > ways[wi + 1].t) wi++
        const w0 = ways[wi]
        const w1 = ways[wi + 1] ?? w0
        const span = w1.t - w0.t
        const u = span > 1e-9 ? Math.max(0, Math.min(1, (tt - w0.t) / span)) : 1
        x = w0.x + (w1.x - w0.x) * u
        z = w0.z + (w1.z - w0.z) * u
      }
      raw[(k + half) * 2] = x
      raw[(k + half) * 2 + 1] = z
    }
    const smooth = (useFilter: boolean) => {
      const xs = new Float64Array(nOut)
      const zs = new Float64Array(nOut)
      for (let i = 0; i < nOut; i++) {
        let sx = 0
        let sz = 0
        if (useFilter) {
          for (let k = -half; k <= half; k++) {
            sx += raw[(i + half + k) * 2]
            sz += raw[(i + half + k) * 2 + 1]
          }
          sx /= 2 * half + 1
          sz /= 2 * half + 1
        } else {
          sx = raw[(i + half) * 2]
          sz = raw[(i + half) * 2 + 1]
        }
        xs[i] = sx
        zs[i] = sz
      }
      // join to where the agent is: no jump, no teleport
      const ex = here.x - xs[0]
      const ez = here.z - zs[0]
      for (let i = 0; i < nOut; i++) {
        const u = Math.min(1, (i * dt) / T.blendS)
        const w = 1 - u * u * (3 - 2 * u)
        xs[i] += ex * w
        zs[i] += ez * w
      }
      return { xs, zs }
    }
    const goalIdx = this.idx.get(a.req!.spot) ?? -1
    const vctx: Ctx = { V: 1, field: new Float64Array(0), extra: undefined, reserved, goalCell: -1, gx: goal.x, gz: goal.z, goalIdx, near: false, ref: [], lanePull: 0 }
    const verify = (xs: Float64Array, zs: Float64Array) => {
      for (let i = 0; i < nOut; i++) {
        const tt = t + i * dt
        for (const r of reserved) {
          if (r.ghost && tt > r.endT) continue
          this.px(r, tt, tmp)
          const d = Math.hypot(tmp.x - xs[i], tmp.z - zs[i])
          if (d >= this.thrV) continue
          const ri = Math.max(0, Math.min(r.n - 1, Math.round((tt - r.t0) / dt)))
          if (d < this.limit(vctx, xs[i], zs[i], r, ri, T.verifyGap)) return false
        }
        const c = cellAt(this.grid, xs[i], zs[i])
        if (c < 0) return false
        // only a dock (the lane into a seat) may be blocked ground: close to where it starts or ends
        if (this.grid.blocked[c] && Math.hypot(xs[i] - goal.x, zs[i] - goal.z) > 0.8 && Math.hypot(xs[i] - here.x, zs[i] - here.z) > 0.8) return false
      }
      return true
    }
    let { xs, zs } = smooth(true)
    if (!verify(xs, zs)) ({ xs, zs } = smooth(false))
    const at = new Int16Array(nOut).fill(-1)
    const settle = Math.min(nOut - 1, Math.max(0, Math.ceil((endMove - t) / dt) + half))
    if (reached && finAt) {
      const fi = this.name(finAt)
      for (let i = settle; i < nOut; i++) {
        at[i] = fi
        xs[i] = goal.x
        zs[i] = goal.z
      }
    }
    const endT = t + (reached ? settle : nOut - 1) * dt
    return { t0: t, n: nOut, x: xs, z: zs, at, endT, reached, finAt, rerouteAt, path: ways.map((w) => ({ t: w.t, x: w.x, z: w.z })) }
  }

  // ---- gestures ----

  private speedAt(tr: Traj, t: number) {
    const d = TRAFFIC.sampleDt
    const p = this.px(tr, t - d)
    const q = this.px(tr, t + d)
    return Math.hypot(q.x - p.x, q.z - p.z) / (2 * d)
  }

  private buildCues(now: number, order: AgentRec[]) {
    const C = TRAFFIC.cue
    const dt = TRAFFIC.sampleDt
    for (const a of order) {
      const keep = a.cues.filter((c) => c.t0 <= now && now < c.t1)
      const gen: Cue[] = []
      const tr = a.traj
      if (tr.rerouteAt !== undefined && tr.rerouteAt + C.tiltS > now) gen.push({ kind: 'tilt', t0: tr.rerouteAt, t1: tr.rerouteAt + C.tiltS, target: null, gesture: false })
      // waiting beside an occupied destination
      if (a.req && !tr.reached) {
        const goal = this.pointOf(a.req)
        const p = this.px(tr, tr.endT)
        if (goal && Math.hypot(p.x - goal.x, p.z - goal.z) < TRAFFIC.besideMax + 0.1) {
          let who: string | null = null
          let bd = 1.2
          for (const b of order) {
            if (b === a) continue
            const q = this.px(b.traj, tr.endT)
            const d = Math.hypot(q.x - goal.x, q.z - goal.z)
            if (d < bd) {
              bd = d
              who = b.id
            }
          }
          if (who) gen.push({ kind: 'dest', t0: tr.endT, t1: Infinity, target: who, gesture: true })
        }
      }
      // passes: closest approaches within range
      for (const b of order) {
        if (b === a) continue
        const end = Math.max(tr.endT, b.traj.endT)
        let prevD = Infinity
        let prevPrevD = Infinity
        let tPrev = now
        for (let t = now; t <= end + dt; t += dt) {
          const pa = this.px(tr, t)
          const pb = this.px(b.traj, t)
          const d = Math.hypot(pa.x - pb.x, pa.z - pb.z)
          if (prevD < prevPrevD && prevD <= d && prevD < TRAFFIC.passRangeM && tPrev > now) {
            const sa = this.speedAt(tr, tPrev)
            const sb = this.speedAt(b.traj, tPrev)
            if (sa > 0.1 && sb > 0.1) gen.push({ kind: 'wide', t0: tPrev - C.wideS / 2, t1: tPrev + C.wideS / 2, target: b.id, gesture: false })
            else if (sa > 0.1 && sb <= 0.1 && this.movedAside(b.traj, tPrev)) gen.push({ kind: 'pass', t0: tPrev - C.passS / 2, t1: tPrev + C.passS / 2, target: b.id, gesture: false })
            else if (sa <= 0.1 && sb > 0.1 && this.movedAside(tr, tPrev)) {
              const t0 = this.stoppedSince(tr, tPrev)
              const key = [a.id, b.id].sort().join('|')
              const last = this.met.get(key)
              let gesture: boolean
              if (last !== undefined && Math.abs(last - t0) < 0.5) gesture = true
              else if (last === undefined || t0 - last >= C.repeatS) {
                this.met.set(key, t0)
                gesture = true
              } else gesture = false
              gen.push({ kind: 'yield', t0, t1: t0 + C.yieldS, target: b.id, gesture })
            }
          }
          prevPrevD = prevD
          prevD = d
          tPrev = t
        }
      }
      const out = [...keep]
      for (const c of gen) if (c.t1 > now && !out.some((k) => k.kind === c.kind && k.target === c.target && c.t0 < k.t1 + 0.5)) out.push(c)
      a.cues = out.sort((p, q) => p.t0 - q.t0)
    }
  }

  /** it moved at least 0.25 m in the 2.5 s before t (it stepped aside, rather than just standing there) */
  private movedAside(tr: Traj, t: number): boolean {
    const p = this.px(tr, t)
    const q = this.px(tr, Math.max(tr.t0, t - 2.5))
    return Math.hypot(p.x - q.x, p.z - q.z) > 0.25
  }

  private stoppedSince(tr: Traj, t: number): number {
    let tt = t
    while (tt > tr.t0 && this.speedAt(tr, tt) <= 0.1) tt -= TRAFFIC.sampleDt
    return Math.max(tr.t0, tt)
  }
}
