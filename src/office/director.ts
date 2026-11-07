// Decides where each agent should be and what it does there, from the status source, the play schedule and
// the messages in flight. Pure: no three.js; the rigs report arrivals back through `arrivedAt`.

import { playAt, type PlayKind } from './play'
import type { OfficeMessage, StatusMap } from './status'

export type Pose = 'idle' | 'type' | 'post' | 'talk' | 'listen' | 'leave' | PlayKind

export interface Goal {
  spot: string
  pose: Pose
  /** a floor point to face once there (otherwise the spot's own direction) */
  face?: { x: number; z: number }
  /** an agent to turn the head toward (talking at a desk) */
  lookAt?: string
  /** placeholder speech bubble text (bubble design comes later) */
  bubble?: string
  /** what it's doing, for the debug panel */
  label: string
}

/** how long a face-to-face talk lasts, how long to wait for both to arrive, how long a wrap-up takes */
const TALK_MS = 6000
const GATHER_MS = 30000
const POST_MS = 4000
const MEET_PAIRS: [string, string][] = [
  ['meet_a', 'meet_b'],
  ['meet_c', 'meet_d'],
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
    if (m.from !== m.to) this.queue.push(m)
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

    const busy = new Set(this.agents.filter((a) => status[a]?.state === 'working' || status[a]?.state === 'off'))
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
      if (s.state === 'off') {
        out[a] = { spot: 'door', pose: 'leave', label: '퇴근' }
        continue
      }
      if (s.state === 'working') {
        out[a] = { spot: `work_${desk}`, pose: 'type', label: s.activity ?? '작업 중' }
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
        ? { spot: p.spot, pose: p.kind, face: p.face, label: p.label }
        : { spot: `work_${desk}`, pose: 'idle', label: '자리에서 쉬는 중' }
    }
    return out
  }

  /** for the debug panel */
  get pending() {
    return { queued: this.queue.length, talks: this.talks.map((t) => `${t.msg.from}→${t.msg.to} ${t.phase}`) }
  }
}
