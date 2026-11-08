// Plays a meeting script in the office (plan.md 6.4): the agents leave what they were doing and gather at the talk
// spots, the lines play (frameAt), the planner pins the decision on the whiteboard, whoever owns a follow-up walks to
// their seat, then the meeting is over (the bookshelf shows the new binder). It only decides goals and frames: no three.js, no DOM.
//
//   const run = new MeetingRunner()
//   run.start(script, now, status)            // false if nobody is there to meet
//   run.apply(now, arrivedAt, goals, door)    // each frame, after the director: overrides the participants' goals
//   run.view(now)                             // each frame: { script, frame } while the lines play, else null
//   run.onDecisionPinned(cb)                  // the whiteboard (#66) subscribes: the card appears now
//   run.onEnd(cb)

import type { Goal } from './director'
import { frameAt, meetSpot, trimScript, type MeetingFrame, type MeetingScript } from './meeting'
import type { StatusMap } from './status'

/** how long to wait for everyone to arrive, how long the pin takes at the board, how long the follow-ups walk */
export const GATHER_MS = 25_000
export const PIN_MS = 3_500
export const BOARD_MS = 20_000
export const FOLLOW_MS = 3_500
const MAX_QUEUE = 3

export interface DecisionPinned {
  script: MeetingScript
  /** the decision's sentence (black blocks when the minutes are SECRET) */
  text: string
}

export interface StartOptions {
  /** an idle replay leaves working agents alone (they are not at the meeting); a new meeting calls everyone in */
  skipWorking?: boolean
}

type Phase = 'gather' | 'lines' | 'decide' | 'follow'

const id = (seat: number) => `agent_${seat}`
const PLANNER = 0

export class MeetingRunner {
  private cur: { script: MeetingScript; phase: Phase; since: number; t0: number; postAt: number | null } | null = null
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
    this.cur = { script: trimmed, phase: 'gather', since: now, t0: now, postAt: null }
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

  /**
   * Each frame, after the director: set the goals of the participants. `door` is where to turn for the owner's line.
   * Moves the meeting along its phases (gather -> lines -> decide -> follow -> end).
   */
  apply(now: number, arrivedAt: (agent: string) => string | null, goals: Record<string, Goal>, door?: { x: number; z: number }): void {
    const c = this.cur
    if (!c) return
    const { script } = c
    const spots = new Map(script.seats.map((s, i) => [s, meetSpot(i)]))
    const planner = this.status[id(PLANNER)] && this.status[id(PLANNER)].state !== 'off' ? PLANNER : null

    if (c.phase === 'gather') {
      if ([...spots].every(([s, spot]) => arrivedAt(id(s)) === spot) || now - c.since > GATHER_MS) this.go('lines', now)
    }
    if (c.phase === 'lines' && now - c.t0 >= script.linesMs) {
      if (script.decision && planner !== null) this.go('decide', now)
      else if (script.followUps.length) this.go('follow', now)
      else return this.finish(now)
    }
    if (c.phase === 'decide' && planner !== null) {
      if (arrivedAt(id(planner)) === 'whiteboard') c.postAt ??= now
      if ((c.postAt !== null && now - c.postAt >= PIN_MS) || now - c.since > BOARD_MS) {
        for (const cb of this.pinned) cb({ script, text: script.decision ?? '' })
        if (script.followUps.length) this.go('follow', now)
        else return this.finish(now)
      }
    }
    if (c.phase === 'follow' && now - c.since >= FOLLOW_MS) return this.finish(now)

    const frame = c.phase === 'lines' ? frameAt(script, now - c.t0) : null
    for (const [seat, spot] of spots) {
      const me = id(seat)
      if (c.phase === 'gather') goals[me] = { spot, pose: 'idle', label: '회의하러 가는 중' }
      else if (c.phase === 'lines' && frame) {
        const toward = frame.speaker === seat ? frame.addressee : (frame.speaker ?? frame.addressee)
        goals[me] = {
          spot,
          pose: 'talk',
          ...(frame.door && door ? { face: door } : toward !== null && toward !== seat ? { lookAt: id(toward) } : {}),
          label: frame.speaker === seat ? '회의: 말하는 중' : '회의: 듣는 중',
        }
      } else if (c.phase === 'decide' && seat !== planner) {
        goals[me] = { spot, pose: 'talk', ...(planner !== null ? { lookAt: id(planner) } : {}), label: '회의: 결정 지켜보는 중' }
      }
    }
    if (c.phase === 'decide' && planner !== null) goals[id(planner)] = { spot: 'whiteboard', pose: 'post', label: '결정을 화이트보드에 붙이는 중' }
    if (c.phase === 'follow') {
      for (const seat of script.followUps) goals[id(seat)] = { spot: `work_${seat}`, pose: 'idle', label: '후속 일하러 자리로' }
    }
  }

  private go(phase: Phase, now: number) {
    if (!this.cur) return
    this.cur.phase = phase
    this.cur.since = now
    if (phase === 'lines') this.cur.t0 = now
  }

  private finish(now: number) {
    const done = this.cur?.script
    this.cur = null
    if (done) for (const cb of this.ended) cb(done)
    const next = this.queue.shift()
    if (next) this.start(next.script, now, this.status, next.opts)
  }
}
