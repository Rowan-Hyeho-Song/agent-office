// Decides where each agent should be and what it does there, from the status source, the play schedule and
// the messages in flight. Pure: no three.js; the rigs report arrivals back through `arrivedAt`.

import { DESK_SIDES } from './nav'
import { playAt, soloAt, type PlayKind } from './play'
import { activityLabel, type OfficeMessage, type StatusMap } from './status'
import type { Request } from './traffic'

export type Pose = 'idle' | 'type' | 'post' | 'talk' | 'listen' | 'leave' | 'doze' | PlayKind

export interface Goal {
  spot: string
  pose: Pose
  /** a floor point to face once there (otherwise the spot's own direction) */
  face?: { x: number; z: number }
  /** an agent to turn the head toward (talking at a desk) */
  lookAt?: string
  /** a standing pose of its own instead of the spot's (meeting formations, #141); `spot` is then only its label */
  slot?: { x: number; z: number; ry: number }
  /** do not set off before this office time, ms (staggered meeting departures) */
  depart?: number
  /** an agent to turn only the head toward (the body keeps the spot's / slot's direction) */
  gaze?: string
  /** a short reaction, started once when `key` changes: a 5° nod, with a slight hand lift (skipped with reduced motion) */
  gesture?: { key: string; hand: boolean }
  /** placeholder speech bubble text (bubble design comes later) */
  bubble?: string
  /** walk clear of the desk sides (the night-duty agent, so it doesn't look like it wakes a sleeper) */
  quiet?: boolean
  /** what it's doing, for the debug panel */
  label: string
}

/** what the traffic planner is asked for a goal: its spot, or its own slot (#141); `notBefore` is the departure in planner seconds */
export const requestOf = (goal: Goal, pace: number, notBefore?: number): Request => ({
  spot: goal.spot,
  ...(goal.slot ? { slot: goal.slot } : {}),
  pace,
  avoid: goal.quiet ? DESK_SIDES : undefined,
  ...(notBefore !== undefined ? { notBefore } : {}),
})

/** how long a face-to-face talk lasts, how long to wait for both to arrive, how long a wrap-up takes */
const TALK_MS = 6000
const GATHER_MS = 30000
const POST_MS = 4000
/** the two talk circles (#147): the floor one by the rug, the board one before the whiteboard; seats 0 and 1 face each other */
const MEET_PAIRS: [string, string][] = [
  ['meet_floor_0', 'meet_floor_1'],
  ['meet_board_0', 'meet_board_1'],
]
// placeholder lines until the bubble design and real message text exist (#2, #4, designer)
export const BUBBLE_ASK = '잠깐 이것 좀 봐 줄래?'
export const BUBBLE_REPLY = '응, 볼게!'

interface Talk {
  msg: OfficeMessage
  /** each participant's spot; a receiver at its desk keeps working there */
  spots: Record<string, string>
  phase: 'gather' | 'talk'
  until: number
}

/** a play assignment's own standing place (watering, reading: next to the thing used), as a goal slot facing what it faces */
export const standSlot = (p: { stand?: { x: number; z: number }; face?: { x: number; z: number } }) =>
  p.stand ? { slot: { x: p.stand.x, z: p.stand.z, ry: Math.atan2(-((p.face?.x ?? p.stand.x) - p.stand.x), -((p.face?.z ?? p.stand.z - 1) - p.stand.z)) } } : {}

export const deskOf = (agent: string) => Number(agent.split('_')[1])

export class Director {
  private queue: OfficeMessage[] = []
  private talks: Talk[] = []
  /** the wrap-up (status `since`) each agent already took to the whiteboard */
  private wrapDone: Record<string, number> = {}
  private postUntil: Record<string, number> = {}
  readonly agents: string[]

  constructor(agents: string[]) {
    this.agents = agents
  }

  receive(m: OfficeMessage) {
    // only talks gather the two agents; a handoff is a paper plane (plane.ts), not a meeting
    if (m.kind === 'talk' && m.from !== m.to) this.queue.push(m)
  }

  private inTalk = (a: string) => this.talks.some((t) => a in t.spots)

  /** start queued talks whose two agents are both free and in the office */
  private startTalks(now: number, status: StatusMap) {
    const waiting: OfficeMessage[] = []
    for (const m of this.queue) {
      const present = (a: string) => status[a] && status[a].state !== 'off'
      if (!present(m.from) || !present(m.to)) continue // nobody to talk to: drop it
      if (this.inTalk(m.from) || this.inTalk(m.to)) {
        waiting.push(m)
        continue
      }
      let spots: Record<string, string> | null = null
      if (status[m.to].state === 'working') {
        // go to the receiver's desk; it keeps its seat and turns its head
        spots = { [m.from]: `desk_side_${deskOf(m.to)}`, [m.to]: `work_${deskOf(m.to)}` }
      } else {
        const used = new Set(this.talks.flatMap((t) => Object.values(t.spots)))
        const pair = MEET_PAIRS.find(([a, b]) => !used.has(a) && !used.has(b))
        if (pair) spots = { [m.from]: pair[0], [m.to]: pair[1] }
      }
      if (spots) this.talks.push({ msg: m, spots, phase: 'gather', until: now + GATHER_MS })
      else waiting.push(m)
    }
    this.queue = waiting
  }

  private updateTalks(now: number, arrivedAt: (a: string) => string | null) {
    this.talks = this.talks.filter((t) => {
      if (t.phase === 'gather') {
        if (Object.entries(t.spots).every(([a, s]) => arrivedAt(a) === s)) {
          t.phase = 'talk'
          t.until = now + TALK_MS
        }
      }
      return now < t.until
    })
  }

  goals(now: number, minute: number, status: StatusMap, arrivedAt: (a: string) => string | null): Record<string, Goal> {
    this.startTalks(now, status)
    this.updateTalks(now, arrivedAt)

    const busy = new Set(this.agents.filter((a) => status[a]?.state === 'working' || status[a]?.state === 'off' || status[a]?.night === 'duty'))
    const play = playAt(minute, this.agents, busy)
    const out: Record<string, Goal> = {}
    let whiteboardTaken = false

    for (const a of this.agents) {
      const s = status[a] ?? { state: 'idle', since: 0 }
      const desk = deskOf(a)
      const talk = this.talks.find((t) => a in t.spots)
      if (talk) {
        const from = talk.msg.from === a
        const other = from ? talk.msg.to : talk.msg.from
        const atDesk = talk.spots[a] === `work_${desk}`
        const talking = talk.phase === 'talk'
        out[a] = {
          spot: talk.spots[a],
          pose: atDesk ? 'listen' : talking ? 'talk' : 'idle',
          lookAt: other,
          bubble: talking ? (from ? BUBBLE_ASK : BUBBLE_REPLY) : undefined,
          label: from ? `${other}에게 가서 대화` : `${other}와 대화`,
        }
        continue
      }
      // #110: nobody leaves. Off at night = dozing at its own desk, or the one awake on night duty; off by day
      // (a source that skipped duty.ts) = resting at the desk. 'leave' stays in the rig but is never chosen.
      if (s.night === 'duty' && s.state === 'idle') {
        const p = soloAt(minute, a)
        out[a] = { spot: p.spot, pose: p.kind, face: p.face, ...standSlot(p), quiet: true, label: `야간 당번 · ${p.label}` }
        continue
      }
      if (s.state === 'off') {
        if (s.night === 'sleep') out[a] = { spot: `work_${desk}`, pose: 'doze', label: '조는 중' }
        else out[a] = { spot: `work_${desk}`, pose: 'idle', label: '자리에서 쉬는 중' }
        continue
      }
      if (s.state === 'working') {
        out[a] = { spot: `work_${desk}`, pose: 'type', label: activityLabel(s.activity) }
        continue
      }
      if (s.state === 'wrapping' && this.wrapDone[a] !== s.since && !whiteboardTaken) {
        // one at a time at the board; anyone else wrapping up plays until it's free
        if (arrivedAt(a) === 'whiteboard') this.postUntil[a] ??= now + POST_MS
        if (now >= (this.postUntil[a] ?? Infinity)) {
          // card posted: back to play in this same frame
          this.wrapDone[a] = s.since
          delete this.postUntil[a]
        } else {
          whiteboardTaken = true
          out[a] = { spot: 'whiteboard', pose: 'post', label: '작업 카드 붙이는 중' }
          continue
        }
      }
      const p = play[a]
      out[a] = p
        ? { spot: p.spot, pose: p.kind, face: p.face, ...standSlot(p), label: p.label }
        : { spot: `work_${desk}`, pose: 'idle', label: '자리에서 쉬는 중' }
    }
    return out
  }

  /** for the debug panel */
  get pending() {
    return { queued: this.queue.length, talks: this.talks.map((t) => `${t.msg.from}→${t.msg.to} ${t.phase}`) }
  }
}
