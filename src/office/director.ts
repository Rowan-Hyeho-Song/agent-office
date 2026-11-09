// Decides where each agent should be and what it does there, from the status source, the play schedule and
// the messages in flight. Pure: no three.js; the rigs report arrivals back through `arrivedAt`.

import { DESK_SIDES } from './nav'
import { playAt, PLAYS, soloAt, type PlayKind } from './play'
import { activityLabel, type AgentStatus, type OfficeMessage, type StatusMap } from './status'
import type { Request } from './traffic'
import { startWrap, stepWrap, viewOf, WALKING_TO_DESK, type BeatKind, type Shown, type WrapRun } from './wrap'

/** `write` / `carry` / `cardpost` / `tidy` are the wrap-up's own (#186, wrap.ts) */
export type Pose = 'idle' | 'type' | 'post' | 'talk' | 'listen' | 'leave' | 'doze' | 'write' | 'carry' | 'cardpost' | 'tidy' | PlayKind

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
  /** the wrap-up (#186): cards still in the left hand, the current beat of the hands, re-reading, standing by the taken board */
  carry?: number
  beat?: { kind: BeatKind; u: number; k: number }
  reread?: boolean
  waiting?: boolean
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

/** how long a face-to-face talk lasts, how long to wait for both to arrive */
const TALK_MS = 6000
const GATHER_MS = 30000
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
  /** the wrap-up in progress (wrap.ts) and the status `since` each agent already finished */
  private runs: Record<string, WrapRun> = {}
  private wrapDone: Record<string, number> = {}
  /** the place (spot, or spot + standing slot) each agent's goal named last frame: a spot is held by whoever has it or is heading to it */
  private lastGoal: Record<string, { spot: string; key: string }> = {}
  /** what each agent shows right now (the name tags, head chips, monitors read this, not the raw status): decided in goals(), nowhere else (#186) */
  shown: Record<string, Shown> = {}
  /** the same statuses alone (the monitors take a StatusMap) */
  shownStatus: StatusMap = {}
  private shownKey = ''
  private shownListeners = new Set<() => void>()
  readonly agents: string[]

  constructor(agents: string[]) {
    this.agents = agents
  }

  getShown = () => this.shown
  subscribeShown = (l: () => void) => {
    this.shownListeners.add(l)
    return () => void this.shownListeners.delete(l)
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

  /**
   * @param opts.reduced  reduced motion: the wrap-up does not walk (writes, tidies in place)
   */
  goals(now: number, minute: number, status: StatusMap, arrivedAt: (a: string) => string | null, opts: { reduced?: boolean } = {}): Record<string, Goal> {
    this.startTalks(now, status)
    this.updateTalks(now, arrivedAt)

    // the wrap-ups first: each is a small state machine (wrap.ts) fed with where the agent is and whether the board is taken
    const rawOf = (a: string): AgentStatus => status[a] ?? { state: 'idle', since: 0 }
    for (const a of this.agents) {
      const s = rawOf(a)
      if (s.state !== 'wrapping') {
        delete this.runs[a]
        delete this.wrapDone[a]
        continue
      }
      if (this.wrapDone[a] === s.since) continue
      let run = this.runs[a]
      if (!run || run.since !== s.since) run = this.runs[a] = startWrap(a, s.since, now, arrivedAt(a) === `work_${deskOf(a)}`)
      const others = this.agents.filter((b) => b !== a)
      const r = stepWrap(run, {
        now,
        atDesk: arrivedAt(a) === `work_${deskOf(a)}`,
        atBoard: arrivedAt(a) === 'whiteboard',
        boardTaken: others.some((b) => this.runs[b]?.step === 'post' || arrivedAt(b) === 'whiteboard'),
        boardBusy: others.some((b) => this.runs[b]?.step === 'walk' || this.runs[b]?.step === 'post'),
        reduced: !!opts.reduced,
      })
      if (r.done) {
        // tidy-up over: the display is rest from this very frame, and the play assignment below applies at once
        this.wrapDone[a] = s.since
        delete this.runs[a]
      } else this.runs[a] = r.run
    }

    const busy = new Set(this.agents.filter((a) => status[a]?.state === 'working' || status[a]?.state === 'off' || status[a]?.night === 'duty' || this.runs[a]))
    const play = playAt(minute, this.agents, busy)
    const out: Record<string, Goal> = {}
    const shown: Record<string, Shown> = {}
    const playing: string[] = []
    const deskIdle = (desk: number): Goal => ({ spot: `work_${desk}`, pose: 'idle', label: '자리에서 쉬는 중' })

    for (const a of this.agents) {
      const s = rawOf(a)
      const desk = deskOf(a)
      const atDesk = arrivedAt(a) === `work_${desk}`
      const talk = this.talks.find((t) => a in t.spots)
      if (talk) {
        const from = talk.msg.from === a
        const other = from ? talk.msg.to : talk.msg.from
        const atTalkDesk = talk.spots[a] === `work_${desk}`
        const talking = talk.phase === 'talk'
        out[a] = {
          spot: talk.spots[a],
          pose: atTalkDesk ? 'listen' : talking ? 'talk' : 'idle',
          lookAt: other,
          bubble: talking ? (from ? BUBBLE_ASK : BUBBLE_REPLY) : undefined,
          label: from ? `${other}에게 가서 대화` : `${other}와 대화`,
        }
        // a talk is free time: only a working receiver at its own desk keeps showing its work
        shown[a] = s.state === 'working' && atTalkDesk ? { status: s, kind: 'work' } : { status: { ...s, state: s.state === 'off' || s.night ? s.state : 'idle' }, kind: 'talk' }
        continue
      }
      // #110: nobody leaves. Off at night = dozing at its own desk, or the one awake on night duty; off by day
      // (a source that skipped duty.ts) = resting at the desk. 'leave' stays in the rig but is never chosen.
      if (s.night === 'duty' && s.state === 'idle') {
        const p = soloAt(minute, a)
        out[a] = { spot: p.spot, pose: p.kind, face: p.face, ...standSlot(p), quiet: true, label: `야간 당번 · ${p.label}` }
        shown[a] = { status: s, kind: 'duty' }
        continue
      }
      if (s.state === 'off') {
        if (s.night === 'sleep') out[a] = { spot: `work_${desk}`, pose: 'doze', label: '조는 중' }
        else out[a] = { spot: `work_${desk}`, pose: 'idle', label: '자리에서 쉬는 중' }
        shown[a] = { status: s, kind: 'off', ...(s.night === 'sleep' && !atDesk ? { detail: WALKING_TO_DESK } : {}) }
        continue
      }
      if (s.state === 'working') {
        out[a] = { spot: `work_${desk}`, pose: 'type', label: activityLabel(s.activity) }
        shown[a] = { status: s, kind: 'work', ...(atDesk ? {} : { detail: WALKING_TO_DESK }) }
        continue
      }
      const run = this.runs[a]
      if (s.state === 'wrapping' && run) {
        const others = this.agents.filter((b) => b !== a)
        const boardTaken = others.some((b) => this.runs[b]?.step === 'post' || arrivedAt(b) === 'whiteboard')
        const v = viewOf(run, { now, boardTaken })
        const base = { carry: v.carry, beat: v.beat, reread: v.reread, waiting: v.waiting, label: `정리 중 · ${v.label}` }
        out[a] =
          v.step === 'write' ? { spot: `work_${desk}`, pose: 'write', ...base }
          : v.step === 'walk' ? { spot: 'whiteboard', pose: 'carry', ...base }
          : v.step === 'post' ? { spot: 'whiteboard', pose: 'cardpost', ...base }
          : v.step === 'tidy' ? { spot: `work_${desk}`, pose: 'tidy', ...base }
          : { spot: `work_${desk}`, pose: 'idle', ...base }
        shown[a] = { status: s, detail: v.label, step: v.step, kind: 'wrap' }
        continue
      }
      // idle, or a wrap-up that is over: rest, i.e. whatever the play schedule says
      shown[a] = { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
      const p = play[a]
      if (p) playing.push(a)
      out[a] = p ? { spot: p.spot, pose: p.kind, face: p.face, ...standSlot(p), label: p.label } : deskIdle(desk)
    }
    this.settle(out, playing, arrivedAt, deskIdle)
    this.setShown(shown)
    return out
  }

  /**
   * One place for one agent (#186, left over from #188): a play spot another agent holds or is heading to is not given out.
   * The agent that already has it keeps it; the others take the next free seat of the same activity, or stay at their desk
   * until it is free. The sofa's middle seat is not given out between two seated agents, and a side seat waits while someone
   * is still on the way to the middle.
   */
  private settle(out: Record<string, Goal>, playing: string[], arrivedAt: (a: string) => string | null, deskIdle: (desk: number) => Goal) {
    const keyOf = (g: Goal) => (g.slot ? `${g.spot}|${g.slot.x.toFixed(1)},${g.slot.z.toFixed(1)}` : g.spot)
    const holdKey = (b: string) => {
      const at = arrivedAt(b)
      const last = this.lastGoal[b]
      return at ? (last && last.spot === at ? last.key : at) : null
    }
    const claimed = new Map<string, string>()
    for (const a of this.agents) if (!playing.includes(a)) claimed.set(keyOf(out[a]), a)
    // a goal with a standing slot (watering, reading) is its own place; one without takes the whole spot, slot or not
    const same = (k: string, key: string) => (key.includes('|') ? k === key : k.split('|')[0] === key)
    const used = (key: string, a: string) =>
      [...claimed].some(([k, c]) => c !== a && same(k, key)) || this.agents.some((b) => b !== a && !!holdKey(b) && same(holdKey(b)!, key))
    const blocked = (g: Goal, a: string) => {
      const key = keyOf(g)
      if (used(key, a)) return true
      if (g.spot === 'sofa_1') return used('sofa_0', a) || used('sofa_2', a)
      if (g.spot === 'sofa_0' || g.spot === 'sofa_2') {
        const mid = claimed.get('sofa_1')
        return !!mid && mid !== a && arrivedAt(mid) !== 'sofa_1'
      }
      return false
    }
    // agents that already have their place first, then in roster order
    const had = (x: string) => Number(this.lastGoal[x]?.key === keyOf(out[x]))
    const order = [...playing].sort((x, y) => had(y) - had(x) || this.agents.indexOf(x) - this.agents.indexOf(y))
    for (const a of order) {
      let g = out[a]
      if (blocked(g, a)) {
        const def = PLAYS.find((p) => p.kind === g.pose && !p.pair)
        const alt = def?.spots.find((s) => s !== g.spot && !blocked({ ...g, spot: s, slot: undefined }, a))
        g = alt ? { spot: alt, pose: g.pose, label: g.label } : deskIdle(deskOf(a))
        out[a] = g
      }
      claimed.set(keyOf(g), a)
    }
    for (const a of this.agents) this.lastGoal[a] = { spot: out[a].spot, key: keyOf(out[a]) }
  }

  private setShown(next: Record<string, Shown>) {
    const key = JSON.stringify(next)
    if (key === this.shownKey) return
    this.shownKey = key
    this.shown = next
    this.shownStatus = Object.fromEntries(Object.entries(next).map(([id, x]) => [id, x.status]))
    for (const l of this.shownListeners) l()
  }

  /** for the debug panel */
  get pending() {
    return { queued: this.queue.length, talks: this.talks.map((t) => `${t.msg.from}→${t.msg.to} ${t.phase}`) }
  }
}
