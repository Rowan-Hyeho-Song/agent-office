// Decides where each agent should be and what it does there, from the status source, the play schedule and
// the messages in flight. Pure: no three.js; the rigs report arrivals back through `arrivedAt`.

import { DESK_SIDES } from './nav'
import { blockOf, playAt, PLAYS, soloAt, type PlayKind } from './play'
import { activityLabel, type AgentStatus, type OfficeMessage, type StatusMap } from './status'
import type { Request } from './traffic'
import { actSpot, actU, deckAfter, startAct, stepAct, type ActRun } from './actRun'
import { ACT_LABEL, ACT_PLACE, isAct, type ActKind, type RecordMode } from './lounge'
import { PATH_BLOCKERS, STAND_BLOCKERS, WATER_PLANTS } from './water'
import { holding, placeOf, startWater, stepWater, WATER_LABEL, type WaterRun, type WaterStage } from './waterRun'
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
  /** the watering errand (#228): its stage, the plant, and how long (s) the stage has lasted: the hands are drawn from these, not from where the agent stands */
  water?: { stage: WaterStage; plant: string; u: number }
  /** a lounge act (lounge.ts: the fridge, the dispenser, the turntable): which, how long since the agent reached its stand (s, -1 on the way), the turntable's mode and whether a record was on the platter */
  act?: { kind: ActKind; u: number; mode?: RecordMode; recordOn: boolean }
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

/** the poses that hold a prop in the hand until the play ends, and how long the agent stays to put it back before it walks off */
const PROP_POSES = new Set<Pose>(['coffee', 'books', 'pingpong', 'boardgame'])
const PUT_AWAY_MS = 800

/** the needle has been down at least this long (ms) before the end of the break sends somebody to lift the arm (speaker.ts holds a state 8 s; this is well past it) */
const LIFT_AFTER_MS = 25_000

/** how long a face-to-face talk lasts, how long to wait for both to arrive */
const TALK_MS = 6000
const GATHER_MS = 30000
/**
 * the two talk places (desks.md 2.1.2, #195): the first talk stands in the meeting circle (its talk seats, nav.ts meetSeats), a second one at
 * the same time goes to the two chat spots by the window (one circle never holds two pairs); seats 0 and 1 face each other
 */
const MEET_PAIRS: [string, string][] = [
  ['meet_talk_0', 'meet_talk_1'],
  ['chat_0', 'chat_1'],
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
  /** the watering errands in progress (waterRun.ts; at most one: there is one can) and the block each agent has watered in already */
  private waters: Record<string, WaterRun> = {}
  private waterDone: Record<string, number> = {}
  /** the lounge acts in progress (actRun.ts; the fridge and the dispenser share one bar, the turntable has its own) and the block each agent has acted in already */
  private acts: Record<string, ActRun> = {}
  private actDone: Record<string, number> = {}
  /** the turntable: a record is on the platter, the needle is down (set as the agent's hands get there) */
  private deck = { recordOn: false, needle: false }
  /** when the needle went down (office ms): the arm is not lifted for the break being over until it has been down a while */
  private needleAt = 0
  /** what each agent's goal was last frame, and the departure its goal was held back to (putAway) */
  private lastPose: Record<string, { pose: Pose; spot: string }> = {}
  private leaving: Record<string, { spot: string; depart: number }> = {}
  /** the place (spot, or spot + standing slot) each agent's goal named last frame: a spot is held by whoever has it or is heading to it */
  private lastGoal: Record<string, { spot: string; key: string }> = {}
  /** what each agent shows right now (the name tags, head chips, monitors read this, not the raw status): decided in goals(), nowhere else (#186) */
  shown: Record<string, Shown> = {}
  /** what goals() decided before the meeting's words (#354) */
  private baseShown: Record<string, Shown> = {}
  /** who is at the meeting and the words of the stage it is in (set by the runner after goals(); the next frame's goals() holds their wrap-ups) */
  private meet: Record<string, string> = {}
  /** when a held wrap-up stopped (its clock is shifted by the time away) */
  private heldAt: Record<string, number> = {}
  /** the same statuses alone (the monitors take a StatusMap) */
  shownStatus: StatusMap = {}
  private shownKey = ''
  private shownListeners = new Set<() => void>()
  readonly agents: string[]

  constructor(agents: string[]) {
    this.agents = agents
  }

  /**
   * A meeting is in progress for these agents (#354): their display says the meeting's words for the whole meeting, whatever the
   * schedule, the status or a wrap-up would say, and a wrap-up waits (its stage does not run on to "자리로 돌아가는 중").
   */
  setMeeting(words: Record<string, string>) {
    this.meet = words
    this.setShown(this.patched())
  }

  private patched(): Record<string, Shown> {
    const out = { ...this.baseShown }
    for (const [a, detail] of Object.entries(this.meet)) {
      const sh = out[a]
      if (!sh) continue
      const s = sh.status
      out[a] = { status: s.state === 'off' || s.night ? s : { ...s, state: 'idle' }, detail, kind: 'meet' }
    }
    return out
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

  /** the agent has the can in its hand (or is putting it down): it is not called away from it */
  carries = (a: string) => !!this.waters[a] && holding(this.waters[a])

  /** the turntable as the acts have left it (a record on the platter, the needle down) */
  deckState = () => this.deck

  /** an agent is on its way to put a record on (the needle is not down yet): the break music waits for it (speaker.ts recordComing) */
  recordComing = () => Object.values(this.acts).some((r) => r.kind === 'record' && (r.mode ?? 'put') === 'put' && !this.deck.needle)

  /** the agent that has the fridge door in use, if any (the planner keeps everybody else off the area it sweeps, traffic.ts reserve) */
  fridgeUser = (): string | null => Object.entries(this.acts).find(([, r]) => r.kind === 'fridge')?.[0] ?? null

  /** ?debug=1: send an agent to a lounge act right now */
  forceAct(agent: string, kind: ActKind, now: number, mode?: RecordMode) {
    for (const k of Object.keys(this.acts)) delete this.acts[k]
    delete this.waters[agent]
    this.acts[agent] = startAct(kind, blockOf(Math.floor(now / 60000)), kind === 'record' ? (mode ?? (this.deck.needle ? 'lift' : 'put')) : undefined, this.deck.recordOn)
    this.actDone[agent] = this.acts[agent].block
  }

  clearActs() {
    for (const k of Object.keys(this.acts)) delete this.acts[k]
  }

  clearWater() {
    for (const k of Object.keys(this.waters)) delete this.waters[k]
  }

  /** ?debug=1: send an agent for the can right now (the schedule's own errands start the same way) */
  forceWater(agent: string, plant: string, now: number, reduced = false) {
    this.clearWater()
    delete this.waterDone[agent]
    // it counts as this block's watering: the schedule does not send the agent again right after
    this.waters[agent] = startWater(plant, blockOf(Math.floor(now / 60000)), now, reduced)
  }

  /** start queued talks whose two agents are both free and in the office */
  private startTalks(now: number, status: StatusMap) {
    const waiting: OfficeMessage[] = []
    for (const m of this.queue) {
      const present = (a: string) => status[a] && status[a].state !== 'off'
      if (!present(m.from) || !present(m.to)) continue // nobody to talk to: drop it
      // an agent carrying the can finishes bringing it back first (nothing flies home)
      if (this.inTalk(m.from) || this.inTalk(m.to) || this.carries(m.from) || this.carries(m.to)) {
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
   * @param opts.wantsBreak  the break music is due (speaker.ts musicWantsBreak): somebody goes to put a record on (agent_4 first); `false` with the needle down: somebody lifts the arm
   */
  goals(now: number, minute: number, status: StatusMap, arrivedAt: (a: string) => string | null, opts: { reduced?: boolean; wantsBreak?: boolean } = {}): Record<string, Goal> {
    this.startTalks(now, status)
    this.updateTalks(now, arrivedAt)

    // the wrap-ups first: each is a small state machine (wrap.ts) fed with where the agent is and whether the board is taken
    const rawOf = (a: string): AgentStatus => status[a] ?? { state: 'idle', since: 0 }
    for (const a of this.agents) {
      const s = rawOf(a)
      if (s.state !== 'wrapping') {
        delete this.heldAt[a]
        delete this.runs[a]
        delete this.wrapDone[a]
        continue
      }
      if (this.wrapDone[a] === s.since) continue
      // at a meeting the wrap-up waits where it is; back from it, a stage that needs the desk / the board starts over from the way there
      if (a in this.meet) {
        this.heldAt[a] ??= now
        continue
      }
      const held = this.heldAt[a]
      if (held !== undefined && this.runs[a]) {
        delete this.heldAt[a]
        const r0 = this.runs[a]
        const shift = now - held
        const back = (r0.step === 'write' || r0.step === 'tidy') && arrivedAt(a) !== `work_${deskOf(a)}` ? { step: 'seat' as const } : r0.step === 'post' && arrivedAt(a) !== 'whiteboard' ? { step: 'seat' as const, last: false } : {}
        this.runs[a] = { ...r0, ...back, t0: r0.t0 + shift, waitFrom: r0.waitFrom === null ? null : r0.waitFrom + shift }
      }
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
    let play = playAt(minute, this.agents, busy)

    // the watering errands (waterRun.ts, #228): the schedule's water assignment is an errand, started when nobody has the can and the
    // agent is free, then carried through whatever the schedule says next (the can is always brought back), and the one place that says
    // which stage it is in. There is one can: a second agent assigned to water waits at its desk until it is down.
    const block = blockOf(minute)
    const resting = (a: string) => {
      const s = rawOf(a)
      return !this.inTalk(a) && !this.runs[a] && ((s.state === 'idle' && s.night !== 'duty') || s.state === 'wrapping')
    }
    for (const a of this.agents) {
      const run = this.waters[a]
      if (!run) continue
      // called away before it has the can: nothing to bring back
      if (!resting(a) && !holding(run)) {
        delete this.waters[a]
        continue
      }
      const r = stepWater(run, { now, at: (spot) => arrivedAt(a) === spot })
      if (r.done) {
        this.waterDone[a] = run.block
        delete this.waters[a]
      } else this.waters[a] = r.run
    }
    if (!Object.keys(this.waters).length) {
      const a = this.agents.find((x) => resting(x) && !this.acts[x] && play[x]?.kind === 'water' && this.waterDone[x] !== block)
      if (a) {
        // the scheduled plant, or the next one whose stand is not taken by somebody resting beside it (water.ts STAND_BLOCKERS)
        const names = WATER_PLANTS.map((p) => p.name)
        const first = Math.max(0, names.indexOf(play[a].plant ?? ''))
        const free = (n: string) => ![...(STAND_BLOCKERS[n] ?? []), ...(PATH_BLOCKERS[n] ?? [])].some((spot) => this.agents.some((x) => x !== a && (this.lastGoal[x]?.spot === spot || arrivedAt(x) === spot)))
        const plant = [0, 1, 2].map((k) => names[(first + k) % names.length]).find(free)
        if (plant) this.waters[a] = startWater(plant, block, now, !!opts.reduced)
      }
    }
    // the lounge acts (lounge.ts): started by the schedule or by the music's wish for a break, once the agent is free; called away it simply stops
    for (const a of this.agents) {
      const run = this.acts[a]
      if (!run) continue
      if (!resting(a) || a in this.meet) {
        delete this.acts[a]
        continue
      }
      const r = stepAct(run, { now, arrived: arrivedAt(a) === actSpot(run) })
      if (r.run.t0 !== null && run.kind === 'record') {
        const d = deckAfter(r.run, actU(r.run, now))
        this.deck.recordOn = d.recordOn
        if (d.needle !== null) {
          if (d.needle && !this.deck.needle) this.needleAt = now
          this.deck.needle = d.needle
        }
      }
      if (r.done) delete this.acts[a]
      else this.acts[a] = r.run
    }
    const beginAct = (a: string, kind: ActKind) => {
      const bar = (k: ActKind) => (k === 'record' ? 'record' : 'bar')
      if (Object.values(this.acts).some((r) => bar(r.kind) === bar(kind))) return
      this.acts[a] = startAct(kind, block, kind === 'record' ? (this.deck.needle ? 'lift' : 'put') : undefined, this.deck.recordOn)
      this.actDone[a] = block
    }
    // the break music is due and nobody has put the record on: whoever rests, agent_4 (echo) first; the break is over and the needle is still down: somebody lifts it
    const wishes = opts.wantsBreak === undefined ? null : opts.wantsBreak ? !this.deck.needle : this.deck.needle && now - this.needleAt >= LIFT_AFTER_MS
    if (wishes && !Object.values(this.acts).some((r) => r.kind === 'record')) {
      const free = this.agents.filter((x) => resting(x) && !this.acts[x] && !this.waters[x])
      const a = free.includes('agent_4') ? 'agent_4' : free[0]
      if (a) beginAct(a, 'record')
    }
    for (const a of this.agents) {
      const k = play[a]?.kind
      // the break music is on and the needle is down: the schedule does not send anybody to lift the arm (that is for the end of the break, above)
      if (k === 'record' && opts.wantsBreak && this.deck.needle) continue
      if (k && isAct(k) && resting(a) && !this.acts[a] && !this.waters[a] && this.actDone[a] !== block) beginAct(a, k)
    }
    // whoever is on an errand is not free for the schedule's other plays (a game partner left alone goes to a solo)
    const away = [...Object.keys(this.waters), ...Object.keys(this.acts)]
    if (away.length) play = playAt(minute, this.agents, new Set([...busy, ...away]))
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
      // the watering errand: the stage's own place and hands, whatever the schedule or the status says until the can is down
      const wr = this.waters[a]
      if (wr) {
        const pl = placeOf(wr)
        out[a] = { spot: pl.spot, pose: 'water', face: pl.face, ...standSlot({ stand: pl.stand, face: pl.face }), water: { stage: wr.stage, plant: wr.plant, u: (now - wr.t0) / 1000 }, label: `화분 물 주기 · ${WATER_LABEL[wr.stage]}` }
        const free = (s.state === 'idle' && s.night !== 'duty') || (s.state === 'wrapping' && !this.runs[a])
        shown[a] = free
          ? { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
          : { status: s, kind: s.state === 'working' ? 'work' : s.state === 'wrapping' ? 'wrap' : s.state === 'off' ? 'off' : 'duty', detail: WATER_LABEL[wr.stage], ...(s.state === 'wrapping' ? { step: 'seat' as const } : {}) }
        continue
      }
      // a lounge act: its own place and hands for as long as it lasts
      const ar = this.acts[a]
      if (ar) {
        const pl = ACT_PLACE[ar.kind]
        out[a] = { spot: pl.spot, pose: ar.kind, face: pl.face, ...standSlot({ stand: pl.stand, face: pl.face }), act: { kind: ar.kind, u: actU(ar, now), ...(ar.mode ? { mode: ar.mode } : {}), recordOn: ar.recordOn }, label: ACT_LABEL[ar.kind] }
        shown[a] = { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
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
      // water is an errand (above): an agent assigned to it that has not started waits for the can (or has already watered this block)
      if (p && isAct(p.kind)) {
        out[a] = { ...deskIdle(desk), label: this.actDone[a] === block ? '자리에서 쉬는 중' : `${ACT_LABEL[p.kind]} 차례 기다리는 중` }
        continue
      }
      if (p?.kind === 'water') {
        out[a] = { ...deskIdle(desk), label: this.waterDone[a] === block ? '자리에서 쉬는 중' : '물뿌리개 차례 기다리는 중' }
        continue
      }
      if (p) playing.push(a)
      out[a] = p ? { spot: p.spot, pose: p.kind, face: p.face, ...standSlot(p), label: p.label } : deskIdle(desk)
    }
    this.settle(out, playing, deskIdle)
    this.putAway(now, out)
    this.baseShown = shown
    this.setShown(this.patched())
    return out
  }

  /**
   * One place for one agent (#186, left over from #188): a play spot given to one agent this frame is not given to another.
   * Who gets it: the agent that had it last frame, then roster order; the others take the next free seat of the same
   * activity, or stay at their desk until it is free. Nothing here reads where agents physically are: "arrived" flickers
   * (an agent steps aside for a passer), and rules reading it handed sofa seats back and forth every few frames, each
   * swap a replan (the day simulation went from 18 s to 220 s). An agent leaving a spot does not hold it; the planner keeps
   * the newcomer clear until it has gone. The sofa never has all three seats given out (nobody squeezed in the middle).
   */
  private settle(out: Record<string, Goal>, playing: string[], deskIdle: (desk: number) => Goal) {
    const keyOf = (g: Goal) => (g.slot ? `${g.spot}|${g.slot.x.toFixed(1)},${g.slot.z.toFixed(1)}` : g.spot)
    const claimed = new Map<string, string>()
    for (const a of this.agents) {
      if (playing.includes(a)) continue
      claimed.set(keyOf(out[a]), a)
      // a watering stand another spot is too close to (water.ts STAND_BLOCKERS) is held with it: nobody sits down beside the monstera while it is watered
      for (const spot of STAND_BLOCKERS[out[a].water?.plant ?? ''] ?? []) claimed.set(spot, a)
    }
    // a goal with a standing slot (watering, reading) is its own place; one without takes the whole spot, slot or not
    const same = (k: string, key: string) => (key.includes('|') ? k === key : k.split('|')[0] === key)
    const used = (key: string, a: string) => [...claimed].some(([k, c]) => c !== a && same(k, key))
    const blocked = (g: Goal, a: string) => {
      const key = keyOf(g)
      if (used(key, a)) return true
      // never all three sofa seats (nobody squeezed between two; two sit side by side, sofa_0 + sofa_1 is the schedule's own
      // pair), whichever seat would be the third
      const sofa = ['sofa_0', 'sofa_1', 'sofa_2']
      return sofa.includes(g.spot) && sofa.every((x) => x === g.spot || used(x, a))
    }
    // had it last frame, then roster order: the same answer frame after frame
    const rank = (x: string) => (this.lastGoal[x]?.key === keyOf(out[x]) ? 1 : 0)
    const order = [...playing].sort((x, y) => rank(y) - rank(x) || this.agents.indexOf(x) - this.agents.indexOf(y))
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

  /**
   * A prop goes back by hand (PlayStage.putBack: 0.4 s, then the hand opens): the agent whose play has ended stands where it is for PUT_AWAY_MS
   * before it sets off, so the hand puts it down beside the body and never runs after a body that has walked away (#228).
   */
  private putAway(now: number, out: Record<string, Goal>) {
    for (const a of this.agents) {
      const g = out[a]
      const prev = this.lastPose[a]
      if (prev && PROP_POSES.has(prev.pose) && prev.spot !== g.spot && g.depart === undefined) this.leaving[a] = { spot: g.spot, depart: now + PUT_AWAY_MS }
      const l = this.leaving[a]
      // the same departure for as long as the goal stays (a request that changes is a replan: it must not change again when the time has passed)
      if (l && l.spot === g.spot && g.depart === undefined) g.depart = l.depart
      else if (l && l.spot !== g.spot) delete this.leaving[a]
      this.lastPose[a] = { pose: g.pose, spot: g.spot }
    }
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
