// Plays a meeting script in the office (plan.md 6.4): the agents leave what they were doing and gather in ONE circle
// (formation.ts), the lines play (frameAt), the planner pins the decision on the whiteboard, whoever owns a follow-up
// walks to their seat, the rest disperse, then the meeting is over (the bookshelf shows the new binder). The whole
// choreography is #141 (agents.md 2.9): staggered departures, listeners' nods, a stepped-back dispersal; all of it
// seeded from the script / line keys, so every visitor and the timelapse see the same scene.
// It only decides goals and frames: no three.js, no DOM.
//
//   const run = new MeetingRunner()
//   run.start(script, now, status)                 // false if nobody is there to meet
//   run.apply(now, arrivedAt, goals, door, place)  // each frame, after the director: overrides the participants' goals
//   run.view(now)                                  // each frame: { script, frame } while the lines play, else null
//   run.onDecisionPinned(cb)                       // the whiteboard (#66) subscribes: the card appears now
//   run.onEnd(cb)

import type { Goal } from './director'
import { formation, stepBack, turnToward, type Slot } from './formation'
import { frameAt, trimScript, type MeetingFrame, type MeetingScript, type ScriptLine } from './meeting'
import { hash, rng } from './play'
import type { StatusMap } from './status'

/** how long to wait for everyone to arrive, how long the pin takes at the board, how long the follow-ups walk */
export const GATHER_MS = 25_000
export const PIN_MS = 3_500
export const BOARD_MS = 20_000
export const FOLLOW_MS = 3_500
const MAX_QUEUE = 3

/** the choreography's timings (agents.md 2.9), ms unless said */
export const CHOREO = {
  /** gap between two departures, farthest first: [min, max) */
  gatherGapMs: [300, 800],
  /** someone who was playing puts the props down first */
  playDelayMs: 600,
  /** when the last one to arrive is this close (m), everyone turns to the centre */
  turnWithinM: 1,
  /** a nod starts this long before its line ends, so it reads as the answer to it */
  nodLeadMs: 350,
  /** the nod after the pin, before they disperse */
  pinNodMs: 600,
  /** the follow-up owners leave this far apart; the others this far (seeded) */
  followGapMs: 300,
  restGapMs: [500, 1000],
  /** the step back before leaving: how far (m) and how long */
  stepBackM: 0.3,
  stepMs: 400,
  /** the turn toward the board of those who watch the pin (degrees) */
  boardTurnDeg: 15,
}

export interface DecisionPinned {
  script: MeetingScript
  /** the decision's sentence (black blocks when the minutes are SECRET) */
  text: string
}

export interface StartOptions {
  /** an idle replay leaves working agents alone (they are not at the meeting); a new meeting calls everyone in */
  skipWorking?: boolean
}

/** where things are, for the formation and the choreography (the scene supplies it; the runner copes without) */
export interface Place {
  /** an agent's floor position */
  at(agent: string): { x: number; z: number } | null
  /** a nav spot's floor position */
  spot(id: string): { x: number; z: number } | null
}

type Phase = 'gather' | 'lines' | 'decide' | 'follow'

const id = (seat: number) => `agent_${seat}`
/** the label a seat of the formation reports as `arrived` (the planner's slot name) */
export const seatLabel = (seat: number) => `meet_seat_${seat}`
const PLANNER = 0
/** poses that are not a play kind: anyone else was playing and puts its props down before leaving */
const NOT_PLAY = new Set(['idle', 'type', 'post', 'talk', 'listen', 'leave', 'doze', 'write', 'carry', 'cardpost', 'tidy'])

/** a listener's reaction to the end of `line`: the addressee always nods (and lifts a hand), the others half of the time, decided by the line key */
export function reaction(scriptId: string, line: ScriptLine, seat: number): { key: string; hand: boolean } | null {
  if (line.from === 'owner' || line.from === seat) return null
  const addressed = line.to.includes(seat)
  const key = `${scriptId}:${line.key}`
  return addressed || rng(hash(`${key}|${seat}`))() < 0.5 ? { key, hand: addressed } : null
}

/** a seeded gap in [lo, hi) ms */
const gap = (r: () => number, [lo, hi]: number[]) => lo + r() * (hi - lo)

interface Plan {
  centre: { x: number; z: number }
  slots: Map<number, Slot>
  /** when each one sets off, office ms */
  depart: Map<number, number>
  /** everyone has turned to the centre */
  turned: boolean
}

interface Cur {
  script: MeetingScript
  phase: Phase
  since: number
  t0: number
  postAt: number | null
  /** the decision was pinned (the nod before they disperse) */
  pinnedAt: number | null
  plan: Plan | null
  /** when each one leaves the circle, office ms, and when the meeting is over */
  leave: Map<number, number>
  end: number
}

export class MeetingRunner {
  private cur: Cur | null = null
  private queue: { script: MeetingScript; opts: StartOptions }[] = []
  private pinned = new Set<(d: DecisionPinned) => void>()
  private ended = new Set<(s: MeetingScript) => void>()
  private status: StatusMap = {}

  get busy() {
    return this.cur !== null || this.queue.length > 0
  }
  get script() {
    return this.cur?.script ?? null
  }
  get phase(): Phase | null {
    return this.cur?.phase ?? null
  }

  onDecisionPinned(cb: (d: DecisionPinned) => void) {
    this.pinned.add(cb)
    return () => void this.pinned.delete(cb)
  }
  onEnd(cb: (s: MeetingScript) => void) {
    this.ended.add(cb)
    return () => void this.ended.delete(cb)
  }

  /** begin a meeting now, or queue it behind the one in progress; false if there is nobody to meet */
  start(script: MeetingScript, now: number, status: StatusMap, opts: StartOptions = {}): boolean {
    this.status = status
    if (this.cur) {
      if (this.queue.length >= MAX_QUEUE) return false
      this.queue.push({ script, opts })
      return true
    }
    const here = (seat: number) => !!status[id(seat)] && status[id(seat)].state !== 'off' && !(opts.skipWorking && status[id(seat)].state === 'working')
    const trimmed = trimScript(script, script.seats.filter(here))
    const owner = trimmed.lines.some((l) => l.from === 'owner')
    if (!trimmed.lines.length || trimmed.seats.length + (owner ? 1 : 0) < 2 || trimmed.seats.length < 1) return false
    this.cur = { script: trimmed, phase: 'gather', since: now, t0: now, postAt: null, pinnedAt: null, plan: null, leave: new Map(), end: Infinity }
    return true
  }

  stop() {
    this.cur = null
    this.queue = []
  }

  /** the lines on screen (null before them and after) */
  view(now: number): { script: MeetingScript; frame: MeetingFrame } | null {
    const c = this.cur
    if (!c || c.phase !== 'lines') return null
    return { script: c.script, frame: frameAt(c.script, now - c.t0) }
  }

  /** the formation and the staggered departures, planned once when the gathering starts */
  private planOf(c: Cur, goals: Record<string, Goal>, place?: Place): Plan {
    if (c.plan) return c.plan
    const { script } = c
    const centre = place?.spot(script.decision ? 'meet_center_board' : 'meet_center_floor') ?? { x: 0, z: 0 }
    // with a decision the planner takes the first seat, an end of the open arc: it walks out through the gap to the board
    // (the others stand at least 0.72 m from the gap's axis, so from an inner seat it could not get out)
    const first = script.decision && script.seats.includes(PLANNER) && this.status[id(PLANNER)]?.state !== 'off' ? [PLANNER] : []
    const seated = [...first, ...script.seats.filter((x) => !first.includes(x))]
    const slots = new Map(formation(centre, seated.length, !!script.decision).map((s, i) => [seated[i], s] as const))
    // farthest first (distance when the gathering starts), so the arrivals line up. Measured from where the schedule
    // puts the agent (its goal spot: the same for every visitor and in the timelapse), the rig only as a fallback
    const far = (seat: number) => {
      const g = goals[id(seat)]
      const p = (g && place?.spot(g.spot)) ?? place?.at(id(seat))
      const s = slots.get(seat)!
      return p ? Math.hypot(p.x - s.x, p.z - s.z) : 0
    }
    const order = [...script.seats].sort((a, b) => far(b) - far(a) || a - b)
    const r = rng(hash(`${script.id}|gather`))
    const depart = new Map<number, number>()
    let t = 0
    for (const seat of order) {
      const playing = !!goals[id(seat)] && !NOT_PLAY.has(goals[id(seat)].pose)
      depart.set(seat, c.since + t + (playing ? CHOREO.playDelayMs : 0))
      if (!script.reduced) t += gap(r, CHOREO.gatherGapMs)
    }
    return (c.plan = { centre, slots, depart, turned: false })
  }

  /** who leaves when: the follow-up owners first (last-line order), then the rest, seeded; reduced motion: all at once */
  private dispersal(c: Cur, now: number) {
    const { script } = c
    const lastLine = (seat: number) => script.lines.reduce((k, l, i) => (l.from === seat ? i : k), -1)
    const owners = [...script.followUps].sort((a, b) => lastLine(a) - lastLine(b))
    const r = rng(hash(`${script.id}|disperse`))
    const calm = script.reduced
    owners.forEach((seat, k) => c.leave.set(seat, now + (calm ? 0 : k * CHOREO.followGapMs)))
    let t = owners.length && !calm ? (owners.length - 1) * CHOREO.followGapMs : 0
    for (const seat of script.seats) {
      if (owners.includes(seat)) continue
      if (!calm) t += gap(r, CHOREO.restGapMs)
      c.leave.set(seat, now + t)
    }
    c.end = Math.max(now, ...c.leave.values()) + CHOREO.stepMs + (owners.length ? FOLLOW_MS : 0)
  }

  /**
   * Each frame, after the director: set the goals of the participants. `door` is where to turn for the owner's line,
   * `place` where things are (the formation centre, who is how far away).
   * Moves the meeting along its phases (gather -> lines -> decide -> follow -> end).
   */
  apply(now: number, arrivedAt: (agent: string) => string | null, goals: Record<string, Goal>, door?: { x: number; z: number }, place?: Place): void {
    const c = this.cur
    if (!c) return
    const { script } = c
    const plan = this.planOf(c, goals, place)
    const planner = this.status[id(PLANNER)] && this.status[id(PLANNER)].state !== 'off' ? PLANNER : null
    const there = (seat: number) => arrivedAt(id(seat)) === seatLabel(seat)

    if (c.phase === 'gather' && (script.seats.every(there) || now - c.since > GATHER_MS)) this.go('lines', now)
    if (c.phase === 'lines' && now - c.t0 >= script.linesMs) this.go(script.decision && planner !== null ? 'decide' : 'follow', now)
    if (c.phase === 'decide' && planner !== null) {
      if (arrivedAt(id(planner)) === 'whiteboard') c.postAt ??= now
      if (c.pinnedAt === null && ((c.postAt !== null && now - c.postAt >= PIN_MS) || now - c.since > BOARD_MS)) {
        for (const cb of this.pinned) cb({ script, text: script.decision ?? '' })
        c.pinnedAt = now
      }
      // they all nod once when it is pinned, then disperse
      if (c.pinnedAt !== null && now - c.pinnedAt >= (script.reduced ? 0 : CHOREO.pinNodMs)) this.go('follow', now)
    }
    if (c.phase === 'follow' && now >= c.end) return this.finish(now)

    const frame = c.phase === 'lines' ? frameAt(script, now - c.t0) : null
    const waiting = script.seats.filter((s) => !there(s))
    // the last one to come is close: everyone turns to the centre (latched)
    if (c.phase === 'gather' && !plan.turned) {
      const last = waiting.length === 1 ? waiting[0] : null
      const p = last === null ? null : place?.at(id(last))
      const s = last === null ? null : plan.slots.get(last)!
      if (waiting.length === 0 || (p && s && Math.hypot(p.x - s.x, p.z - s.z) < CHOREO.turnWithinM)) plan.turned = true
    }
    // the line that is about to end (the listeners' nod answers it)
    const t = now - c.t0
    const ending = c.phase === 'lines' && !script.reduced ? script.lines.reduce((k, l, i) => (l.startMs + l.typeMs + l.holdMs - CHOREO.nodLeadMs <= t ? i : k), -1) : -1

    for (const seat of script.seats) {
      const me = id(seat)
      const slot = plan.slots.get(seat)!
      const own = { spot: seatLabel(seat), slot }
      if (c.phase === 'gather') {
        // early arrivers look at whoever is still on the way (the nearest to their seat)
        let lookAt: string | undefined
        if (there(seat) && !plan.turned) {
          const dist = (w: number) => {
            const p = place?.at(id(w))
            return p ? Math.hypot(p.x - slot.x, p.z - slot.z) : 0
          }
          const next = waiting.filter((w) => now >= (plan.depart.get(w) ?? 0)).sort((a, b) => dist(a) - dist(b))[0]
          if (next !== undefined) lookAt = id(next)
        }
        goals[me] = { ...own, pose: 'idle', depart: plan.depart.get(seat), ...(lookAt ? { lookAt } : {}), label: '회의하러 가는 중' }
      } else if (c.phase === 'lines' && frame) {
        // the body faces the centre; only the head turns: the speaker to its addressee, the listeners to the speaker
        const toward = frame.speaker === seat ? frame.addressee : frame.speaker
        const react = ending >= 0 ? reaction(script.id, script.lines[ending], seat) : null
        goals[me] = {
          ...own,
          pose: 'talk',
          ...(frame.door && door ? { face: door } : toward !== null && toward !== seat ? { gaze: id(toward) } : {}),
          ...(react ? { gesture: react } : {}),
          label: frame.speaker === seat ? '회의: 말하는 중' : '회의: 듣는 중',
        }
      } else if (c.phase === 'decide' && seat !== planner) {
        // stay on the seat, turn a little toward the board and watch the poster's hand; all nod when it is pinned
        const board = place?.spot('whiteboard')
        goals[me] = {
          spot: own.spot,
          slot: board ? turnToward(slot, board, CHOREO.boardTurnDeg) : slot,
          pose: 'talk',
          ...(planner !== null ? { gaze: id(planner) } : {}),
          ...(c.pinnedAt !== null && !script.reduced ? { gesture: { key: `${script.id}:pin`, hand: false } } : {}),
          label: '회의: 결정 지켜보는 중',
        }
      } else if (c.phase === 'follow') {
        const at = c.leave.get(seat) ?? now
        const posted = seat === planner && c.postAt !== null
        const goTo = script.followUps.includes(seat) ? `work_${seat}` : null
        if (now < at) {
          // the planner stays at the board; the others keep the circle until their turn
          goals[me] = posted ? { spot: 'whiteboard', pose: 'idle', label: '결정을 붙이고 정리하는 중' } : { ...own, pose: 'talk', label: '회의 정리하는 중' }
        } else if (now < at + CHOREO.stepMs && !posted) {
          // a step back and a turn toward where it is going, so nobody spins on the spot
          const to = goTo ? place?.spot(goTo) : place?.spot(goals[me]?.spot ?? '')
          goals[me] = { spot: `meet_step_${seat}`, slot: stepBack(plan.centre, slot, CHOREO.stepBackM, to ?? null), pose: 'idle', label: '회의 끝, 자리를 뜨는 중' }
        } else if (goTo) goals[me] = { spot: goTo, pose: 'idle', label: '후속 일하러 자리로' }
      }
    }
    if (c.phase === 'decide' && planner !== null) goals[id(planner)] = { spot: 'whiteboard', pose: 'post', label: '결정을 화이트보드에 붙이는 중' }
    // a follow-up owner who was not at the meeting still goes to its seat
    if (c.phase === 'follow') for (const seat of script.followUps) if (!script.seats.includes(seat) && now >= (c.leave.get(seat) ?? now)) goals[id(seat)] = { spot: `work_${seat}`, pose: 'idle', label: '후속 일하러 자리로' }
  }

  private go(phase: Phase, now: number) {
    if (!this.cur) return
    this.cur.phase = phase
    this.cur.since = now
    if (phase === 'lines') this.cur.t0 = now
    if (phase === 'follow') this.dispersal(this.cur, now)
  }

  private finish(now: number) {
    const done = this.cur?.script
    this.cur = null
    if (done) for (const cb of this.ended) cb(done)
    const next = this.queue.shift()
    if (next) this.start(next.script, now, this.status, next.opts)
  }
}
