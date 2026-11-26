// Decides where each agent should be and what it does there, from the status source, the play schedule and
// the messages in flight. Pure: no three.js; the rigs report arrivals back through `arrivedAt`.

import { dutyOf, dutyStatus } from './duty'
import { DESK_SIDES } from './nav'
import { DOOR_LABEL, DOOR_ROUND, LEVER, doorAgent, doorDue, doorU, stepDoor, type DoorKind, type DoorRun } from './doorRound'
import { nightDuty } from './duty'
import { BROWSE, SHELF_MORE, nextShelf, SHELF_LABEL, SHELF_STAND, shelfTurn, callAway as shelfCallAway, holding as shelfHolding, startShelf, stepShelf, type ShelfRun, type ShelfStage } from './shelfRun'
import { aloneChain, dayPlan, FILL_MIN_MS, fillChain, GAP_LABEL, hallNear, TIDY_SPOT, planDay, playAt, PLAYS, restNear, schedulePose, soloAt, type FillKind, type GapKind, type PlayKind } from './play'
import { gapPace } from './gapMotion'
import type { Expression } from './faceModel'
import { activityLabel, type AgentStatus, type OfficeMessage, type StatusMap } from './status'
import type { Request } from './traffic'
import { actLength, actSpot, actU, deckAfter, startAct, stepAct, type ActRun } from './actRun'
import { ACT_LABEL, ACT_PLACE, grabAt, isAct, type ActKind, type DrinkKind, type RecordMode } from './lounge'
import { drinkPick, drinkView, stepDrink, type Drink, type DrinkView } from './fridgeDrink'
import { isNight } from './kst'
import { NOTE_LABEL, NOTE_READ, noteU, stepNote, stillWaiting, type NoteRun, type NoteWait } from './noteRead'
import { PATH_BLOCKERS, STAND_BLOCKERS, WATER_PLANTS } from './water'
import { callAway, chooseSeat, holding as readHolding, placeOf as readPlace, READ_LABEL, readLen, startRead, stepRead, type ReadRun, type ReadStage } from './readRun'
import { holding, placeOf, startWater, stepWater, WATER_LABEL, type WaterRun, type WaterStage } from './waterRun'
import { other as otherSide, startTidy, stepTidy, tidyPlace, type Side, type TidyRun, type TidyStage } from './tidyRun'
import { habitFor, type HabitKind } from './waterFx'
import { startWrap, stepWrap, viewOf, WALKING_TO_DESK, type BeatKind, type PieceKind, type Shown, type WrapRun, type WrapStep } from './wrap'

/** `write` / `carry` / `cardpost` / `tidy` are the wrap-up's own (#186, wrap.ts) */
export type Pose = 'idle' | 'type' | 'post' | 'talk' | 'listen' | 'leave' | 'doze' | 'write' | 'carry' | 'cardpost' | 'tidy' | 'shelfbook' | PlayKind

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
  /** #718: a face shown once when `key` changes (rig.faceEvent): a watcher puzzled as its game breaks */
  faceCue?: { expr: Expression; key: string; dur: number }
  /** a short reaction, started once when `key` changes: a 5° nod, with a slight hand lift (skipped with reduced motion) */
  gesture?: { key: string; hand: boolean }
  /** placeholder speech bubble text (bubble design comes later) */
  bubble?: string
  /** walk clear of the desk sides (the night-duty agent, so it doesn't look like it wakes a sleeper) */
  quiet?: boolean
  /** the wrap-up (#186): cards still in the left hand, the current beat of the hands, re-reading, standing by the taken board */
  carry?: number
  beat?: { kind: BeatKind; u: number; k: number; piece: PieceKind; v?: number; end?: boolean; n?: number; wait?: number }
  reread?: boolean
  waiting?: boolean
  /** #481 the wrap-up's step while it lasts (the pen laid on the desk stays there until the tidy-up is over) */
  wrapStep?: WrapStep
  /** the watering errand (#228): its stage, the plant, and how long (s) the stage has lasted: the hands are drawn from these, not from where the agent stands */
  water?: { stage: WaterStage; plant: string; u: number; habit?: HabitKind | null }
  /** the reading errand (#280, readRun.ts): its stage, the seat it reads on, and how long (s) the stage has lasted: the hands are drawn from these */
  read?: { stage: ReadStage; seat: number; u: number; /** the seated reading's length, s (readRun.ts readLen, #715) */ len: number }
  /** #718 ②-b the tidy-up of the ping-pong table (tidyRun.ts): its stage, how long it has lasted (s), and the agent's own paddle */
  tidy?: { stage: TidyStage; u: number; own: Side }
  /** a lounge act (lounge.ts: the fridge, the dispenser, the turntable): which, how long since the agent reached its stand (s, -1 on the way), the turntable's mode and whether a record was on the platter */
  act?: { kind: ActKind; u: number; mode?: RecordMode; recordOn: boolean; pick?: DrinkKind }
  /** #457 the drink taken out of the fridge, in the left hand (fridgeDrink.ts): from the moment the hand has it until it has faded out */
  drink?: DrinkView
  /** #451 (doorRound.ts): the morning opening / the night lock-up at the door: which, s since arriving (-1 on the way) */
  door?: { kind: DoorKind; u: number }
  /** #450 (shelfRun.ts): a book from the second bookshelf: its stage, the book, s into the stage, the stay it belongs to (the page turns' seed) */
  shelf?: { stage: ShelfStage; book: string; u: number; block: number }
  /** #450 the stay's rest before the second bookshelf, browsing the spines (the head turns along the rows) */
  browse?: boolean
  /** #4 notes 2b (noteRead.ts): at the cork board for its notes; s since arriving (-1 on the way) */
  note?: { u: number; ids: number[] }
  /** #490 B (play.md 9.2 · 9.3): a gap between two stays (a stretch, a slower stroll, breathing at the window), or the game it watches (a cheer now and then) */
  gap?: GapKind
  watching?: 'pingpong' | 'boardgame'
  /** at the ping-pong table while the partner is still walking there (play.md 9.2, #516): the ball is bounced on the paddle. Not set once both are there (in the timelapse too, where no rally is shown) */
  partnerWait?: boolean
  /** what it's doing, for the debug panel */
  label: string
}

/** what the traffic planner is asked for a goal: its spot, or its own slot (#141); `notBefore` is the departure in planner seconds */
export const requestOf = (goal: Goal, pace: number, notBefore?: number): Request => ({
  spot: goal.spot,
  ...(goal.slot ? { slot: goal.slot } : {}),
  pace: pace * gapPace(goal.gap),
  avoid: goal.quiet ? DESK_SIDES : undefined,
  ...(notBefore !== undefined ? { notBefore } : {}),
})

/** the poses that hold a prop in the hand until the play ends, and how long the agent stays to put it back before it walks off */
const PROP_POSES = new Set<Pose>(['coffee', 'pingpong', 'boardgame'])
const PUT_AWAY_MS = 800
/** an errand / act starts only if the agent's duty (rest, sleep, night shift) stays the same this long (ms) */
const START_LEAD_MS = 20_000
/** #457 what an agent called away with a drink in hand shows on the way (lounge-props.md 5.5) */
export const CARRYING_DRINK = `${ACT_LABEL.fridge} · 들고 가는 중`
/** the KST day an office time falls on (a number: days since the epoch) */
const kstDay = (ms: number) => Math.floor((ms + 9 * 3600_000) / 86_400_000)

/** the needle has been down at least this long (ms) before the end of the break sends somebody to lift the arm (speaker.ts holds a state 8 s; this is well past it) */
const LIFT_AFTER_MS = 25_000
/** #527: and the needle lifted stays up this long before a record goes on again (the break's crowd flickering around two must not send the arm up and down) */
const PUT_AFTER_MS = 25_000

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

/** #718 (play.md 9.7 ③): a lounge act's turn is waited for only this long (s); a longer wait skips the act for that stay */
export const ACT_WAIT_MAX_S = 15
/** an act not started yet: its walk to the stand, guessed (s) */
const ACT_WALK_S = 10

/** #718 ②-b (3D #735): where the ball is picked up by the net on the north side: a stand before it, facing it */
export const TIDY_BALL = { stand: { x: 1.7, z: -0.16 }, face: { x: 1.7, z: 0.27 } } as const

export class Director {
  private queue: OfficeMessage[] = []
  private talks: Talk[] = []
  /** the wrap-up in progress (wrap.ts) and the status `since` each agent already finished */
  private runs: Record<string, WrapRun> = {}
  /** #516: ping-pong stays broken by a partner gone to work: when (office ms), and when the stay ends */
  private brokenPairs = new Map<number, { from: number; until: number }>()
  private wrapDone: Record<string, number> = {}
  /** the watering errands in progress (waterRun.ts; at most one: there is one can) and the block each agent has watered in already */
  private waters: Record<string, WaterRun> = {}
  private waterDone: Record<string, number> = {}
  /** the reading errand in progress (readRun.ts; at most one: there is one book) and the block each agent has read in already */
  private reads: Record<string, ReadRun> = {}
  private readDone: Record<string, number> = {}
  /** #718 ②-b the tidy-ups under way (tidyRun.ts), the stay each agent has tidied in already, and whether the table lies tidied (until a game takes the paddles up) */
  private tidies: Record<string, TidyRun> = {}
  private tidyDone: Record<string, number> = {}
  private tidied = false
  /** the lounge acts in progress (actRun.ts; the fridge and the dispenser share one bar, the turntable has its own) and the block each agent has acted in already */
  private acts: Record<string, ActRun> = {}
  private actDone: Record<string, number> = {}
  /**
   * #718 (play.md 9.7): an errand stay whose errand is over: when that was, and the places the others had then (kept, so the fill chain picks the same
   * thing frame after frame)
   */
  private leftOf: Record<string, { stay: number; from: number; held: string[] }> = {}
  /** #718 ?debug=1: one left at a forced ping-pong game whose partner was sent to work (debugPlay.ts typing.force): play.md 9.2's busy rule from `from` */
  private forcedAlone: { agent: string; from: number; until: number } | null = null
  /** #457 the drink each agent has in hand from the fridge (fridgeDrink.ts), and what it took out on which KST day (not the same one twice a day) */
  private drinks: Record<string, Drink> = {}
  private drank: Record<string, { day: number; kinds: DrinkKind[] }> = {}
  /** #4 notes 2b: the notes each robot has not reacted to yet, the ids ever queued (a note is reacted to once), and the walk to the board under way */
  private noteQueue: Record<string, NoteWait[]> = {}
  private noteKnown = new Set<number>()
  private noteRuns: Record<string, NoteRun> = {}

  /**
   * #4 notes 2b: a note pinned for `agent` at `at` (ms). Its robot goes to read it the next time it rests, within the hour; a note already
   * known, for a robot not in the office, or over an hour old is ignored
   */
  noteArrived(agent: string, id: number, at: number, now: number) {
    if (this.noteKnown.has(id) || !this.agents.includes(agent) || now - at > NOTE_READ.waitMs) return
    this.noteKnown.add(id)
    ;(this.noteQueue[agent] ??= []).push({ id, at })
  }

  /** the notes each robot is still to read (tests, the debug panel) */
  notesWaiting = (agent: string): number[] => (this.noteQueue[agent] ?? []).map((n) => n.id)
  /** the turntable: a record is on the platter, the needle is down (set as the agent's hands get there) */
  private deck = { recordOn: false, needle: false }
  /** #451 the door round under way, and the start of the last one begun (each is begun once) */
  private door: DoorRun | null = null
  private doorBegun = 0
  /** #450 the shelf book being read (one stand, one reader), and the book each agent read last */
  private shelf: ShelfRun | null = null
  private shelfLast: Record<string, string> = {}
  /** #450 the one browsing the spines till its book stay ends */
  private shelfBrowse: { agent: string; block: number; until: number } | null = null
  /** when the needle went down (office ms): the arm is not lifted for the break being over until it has been down a while */
  private needleAt = 0
  /** #527: when the needle last came up (office ms) */
  private liftedAt = -Infinity
  /** what each agent's goal was last frame, and the departure its goal was held back to (putAway) */
  private lastPose: Record<string, { pose: Pose; spot: string }> = {}
  private leaving: Record<string, { spot: string; depart: number }> = {}
  /** the place (spot, or spot + standing slot) each agent's goal named last frame: a spot is held by whoever has it or is heading to it */
  private lastGoal: Record<string, { spot: string; key: string }> = {}
  /** what each agent shows right now (the name tags, head chips, monitors read this, not the raw status): decided in goals(), nowhere else (#186) */
  shown: Record<string, Shown> = {}
  /** #601 (designer, #615) agents a visitor's game holds in this tab while they are called to work: not "자리로 가는 중" (they are not on their way) */
  heldByVisitor: ReadonlySet<string> = new Set()
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

  /** an agent is on its way to put the needle down or lift it (the needle is not that way yet): the music waits for it (speaker.ts recordComing, #492) */
  recordComing = () => Object.values(this.acts).some((r) => r.kind === 'record' && ((r.mode ?? 'put') === 'put' ? !this.deck.needle : this.deck.needle))

  /** the agent that has the fridge door in use, if any (the planner keeps everybody else off the area it sweeps, traffic.ts reserve) */
  fridgeUser = (): string | null => Object.entries(this.acts).find(([, r]) => r.kind === 'fridge')?.[0] ?? null

  /** ?debug=1: send an agent to a lounge act right now. The fridge: `pick` the drink to take (null: only look in), else the schedule's own choice */
  forceAct(agent: string, kind: ActKind, now: number, mode?: RecordMode, pick?: DrinkKind | null) {
    for (const k of Object.keys(this.acts)) delete this.acts[k]
    delete this.waters[agent]
    delete this.drinks[agent]
    const block = this.stayNow(agent, now)
    const drink = kind === 'fridge' ? (pick === undefined ? this.pickFor(agent, block, now) : pick) : null
    this.acts[agent] = startAct(kind, block, kind === 'record' ? (mode ?? (this.deck.needle ? 'lift' : 'put')) : undefined, this.deck.recordOn, drink)
    this.actDone[agent] = this.acts[agent].block
  }

  /** #457 the drink an agent takes at the fridge now (fridgeDrink.ts drinkPick) */
  private pickFor(agent: string, block: number, now: number): DrinkKind | null {
    const d = this.drank[agent]
    const had = d && d.day === kstDay(now) ? d.kinds : []
    const held = Object.entries(this.drinks).filter(([a]) => a !== agent).map(([, x]) => x.kind)
    return drinkPick({ agent, block, night: isNight(now), had, held })
  }

  /** #457 the drink in each agent's hand (tests, the debug panel) */
  drinkOf = (agent: string): Drink | null => this.drinks[agent] ?? null

  clearActs() {
    for (const k of Object.keys(this.acts)) delete this.acts[k]
  }

  clearWater() {
    for (const k of Object.keys(this.waters)) delete this.waters[k]
  }

  clearReads() {
    for (const k of Object.keys(this.reads)) delete this.reads[k]
  }

  /** #718 ②-b the paddles and the ball lie tidied by the net (PlayStage rests them there) until a game at the table takes them up */
  tableTidied() {
    return this.tidied
  }

  /** #718 ?debug=1: `agent` is left alone at the ping-pong table now (its forced partner went to work): the stroll, then the fill chain, for `minutes` */
  forceAlone(agent: string, now: number, minutes = 6) {
    this.forcedAlone = { agent, from: now, until: now + minutes * 60_000 }
  }

  clearAlone() {
    this.forcedAlone = null
  }

  /** ?debug=1: send an agent to read right now, on `seat` (0 when not said); the schedule's own readings take the first free seat */
  forceRead(agent: string, now: number, seat: 0 | 1 = 0) {
    this.clearReads()
    delete this.waters[agent]
    delete this.acts[agent]
    const block = this.stayNow(agent, now)
    this.reads[agent] = startRead(seat, block, now)
    this.readDone[agent] = block
  }

  /** #450 tests and the debug panel: `agent` reads `book` from the second bookshelf now (for `readS` s), whatever its schedule says */
  forceShelf(agent: string, now: number, book?: string, readS?: number) {
    this.clearReads()
    delete this.waters[agent]
    delete this.acts[agent]
    const block = this.stayNow(agent, now)
    const run = startShelf(agent, block, now, this.shelfLast[agent])
    this.shelf = { ...run, ...(book ? { book: book as ShelfRun['book'] } : {}), ...(readS !== undefined ? { readS } : {}) }
    this.readDone[agent] = block
  }

  /** ?debug=1: send an agent for the can right now (the schedule's own errands start the same way) */
  forceWater(agent: string, plant: string, now: number, reduced = false, habit?: HabitKind | null) {
    this.clearWater()
    delete this.waterDone[agent]
    // it counts as this stay's watering: the schedule does not send the agent again right after
    const block = this.stayNow(agent, now)
    this.waters[agent] = startWater(plant, block, now, reduced, habit === undefined ? habitFor(agent, block) : habit)
  }

  /** the agent's stay in the day's plan now (#490: the errands count "done" per stay, not per block); the minute when it has none */
  private stayNow(agent: string, now: number): number {
    return playAt(now, this.agents)[agent]?.stay ?? Math.floor(now / 60000)
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
   * @param opts.gm  the replay's gesture minimum, s (0 live): from 2.4 (x16) the wrap-up leaves out its mixed pieces (wrapup.md 6)
   * @param opts.wantsBreak  the break music is due (speaker.ts musicWantsBreak): somebody goes to put a record on (agent_4 first); `false` with the needle down: somebody lifts the arm
   */
  goals(now: number, minute: number, status: StatusMap, arrivedAt: (a: string) => string | null, opts: { reduced?: boolean; wantsBreak?: boolean; gm?: number } = {}): Record<string, Goal> {
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
      // at a meeting (or in a talk: a stage that lasts a minute is long enough to meet one) the wrap-up waits where it is; back from it, a stage that needs
      // the desk / the board goes back there first (the desk stages go on from where they were, the board's start over)
      if (a in this.meet || this.inTalk(a)) {
        this.heldAt[a] ??= now
        continue
      }
      const held = this.heldAt[a]
      if (held !== undefined && this.runs[a]) {
        delete this.heldAt[a]
        const r0 = this.runs[a]
        const shift = now - held
        const back = (r0.step === 'write' || r0.step === 'tidy') && arrivedAt(a) !== `work_${deskOf(a)}` ? { step: 'seat' as const, last: r0.step === 'tidy', skip: r0.wrote ? 0 : (held - r0.t0) / 1000 } : r0.step === 'post' && arrivedAt(a) !== 'whiteboard' ? { step: 'seat' as const, last: false } : {}
        this.runs[a] = { ...r0, ...back, t0: r0.t0 + shift, waitFrom: r0.waitFrom === null ? null : r0.waitFrom + shift }
      }
      let run = this.runs[a]
      if (!run || run.since !== s.since) run = this.runs[a] = startWrap(a, s.since, now, arrivedAt(a) === `work_${deskOf(a)}`, { reduced: !!opts.reduced, gm: opts.gm })
      const others = this.agents.filter((b) => b !== a)
      const r = stepWrap(run, {
        now,
        atDesk: arrivedAt(a) === `work_${deskOf(a)}`,
        atBoard: arrivedAt(a) === 'whiteboard',
        boardTaken: others.some((b) => this.runs[b]?.step === 'post' || arrivedAt(b) === 'whiteboard'),
        boardBusy: others.some((b) => this.runs[b]?.step === 'walk' || this.runs[b]?.step === 'post'),
        reduced: !!opts.reduced,
        gm: opts.gm,
      })
      if (r.done) {
        // tidy-up over: the display is rest from this very frame, and the play assignment below applies at once
        this.wrapDone[a] = s.since
        delete this.runs[a]
      } else this.runs[a] = r.run
    }

    const busy = new Set(this.agents.filter((a) => status[a]?.state === 'working' || status[a]?.state === 'off' || status[a]?.night === 'duty' || this.runs[a]))
    // #516 (play.md 9.2): a ping-pong game whose partner goes to work is over for both: the one left plays on alone, and the partner, back, too. Kept from
    // the status timeline (when the work began, when it came back: the statuses' own times), so the timelapse and seeking show the same
    for (const [k, b] of this.brokenPairs) if (now < b.from || now >= b.until) this.brokenPairs.delete(k)
    const planned = playAt(now, this.agents)
    for (const a of this.agents) {
      const p = planned[a]
      // ping-pong for the players (play.md 9.2); the board too, for its watcher (#517: it leaves a game broken by work)
      if ((p?.kind !== 'pingpong' && p?.kind !== 'boardgame') || !p.partner || p.pairAt === undefined || now < p.pairAt || this.brokenPairs.has(p.stay) || !busy.has(p.partner)) continue
      this.brokenPairs.set(p.stay, { from: Math.max(p.pairAt, Math.min(now, status[p.partner]?.since ?? now)), until: p.until })
    }
    const alone = {
      broken: new Map([...this.brokenPairs].map(([k, b]) => [k, b.from] as const)),
      back: Object.fromEntries(this.agents.filter((a) => !busy.has(a) && status[a]).map((a) => [a, status[a]!.since])),
    }
    let play = playAt(now, this.agents, busy, alone)
    // #715 · #718 (play.md 9.1 · 9.7): an errand over a minute or more before its stay ends: the rest of the stay is the fill chain, as its own stay (so the
    // errand's done mark does not cover a reading in it). A record placed alone is left out: the hologram board is laid out from the plan (play/session.ts)
    const fillLeft = () => {
      for (const a of this.agents) {
        const p = play[a]
        if (!p) continue
        const done = (p.kind === 'water' && this.waterDone[a] === p.stay) || (isAct(p.kind) && this.actDone[a] === p.stay) || (p.kind === 'books' && this.readDone[a] === p.stay)
        if (!done || this.waters[a] || this.acts[a] || this.reads[a] || this.shelf?.agent === a || this.shelfBrowse?.agent === a) continue
        let left = this.leftOf[a]
        if (left?.stay !== p.stay) {
          const held = this.agents.filter((x) => x !== a).flatMap((x) => [play[x]?.spot, this.lastGoal[x]?.spot]).filter((x): x is string => !!x)
          left = this.leftOf[a] = { stay: p.stay, from: now, held }
        }
        if (p.until - left.from < FILL_MIN_MS) continue
        const exclude: FillKind[] = p.kind === 'books' ? ['boardgame_solo', 'books'] : ['boardgame_solo']
        const held = new Set(left.held)
        play[a] = fillChain(dayPlan(planDay(now).day, [...this.agents].sort()), now, left.from, p.until, { agent: a, own: p.stay, stay: p.stay * 10 + 1, exclude, skip: (x) => held.has(x) })
      }
    }
    fillLeft()
    // #718 ?debug=1: the one left at a forced ping-pong game: the stroll, then the fill chain, as the schedule's own (play.ts aloneChain)
    const fa = this.forcedAlone
    const alonePlay = () => {
      if (fa && now >= fa.from && now < fa.until && play[fa.agent]) play[fa.agent] = aloneChain(now, this.agents, fa.agent, fa.from, fa.until)
    }
    if (fa && now >= fa.until) this.forcedAlone = null
    alonePlay()
    // #718: the plan's face cues, kept before an errand takes its agent out of the schedule below
    const cues = Object.fromEntries(this.agents.map((a) => [a, play[a]?.cue] as const))
    // #490: no blocks; each agent's errands count "done" per stay of its own plan (play.ts), the minute when it has none
    const stayOf = (a: string) => play[a]?.stay ?? minute

    // the watering errands (waterRun.ts, #228): the schedule's water assignment is an errand, started when nobody has the can and the
    // agent is free, then carried through whatever the schedule says next (the can is always brought back), and the one place that says
    // which stage it is in. There is one can: a second agent assigned to water waits at its desk until it is down.
    const resting = (a: string) => {
      const s = rawOf(a)
      return !this.inTalk(a) && !this.runs[a] && ((s.state === 'idle' && s.night !== 'duty') || s.state === 'wrapping')
    }
    // an errand or act is not started when the agent's night is about to change under it (bedtime, the night shift): it would be called away a few seconds in
    // (the day sim: five errands abandoned 1-5 s into the fetch walk, all by this). Only a start waits; one under way is never held back
    const steady = (a: string) => {
      const base: AgentStatus = { state: 'idle', since: rawOf(a).since }
      const here = dutyOf(dutyStatus(base, a, this.agents, now))
      // wrapping at night: when the wrap-up ends it is asleep (or on the night shift), which calls an errand away; so none starts
      if (rawOf(a).state === 'wrapping' && here !== 'rest') return false
      return here === dutyOf(dutyStatus(base, a, this.agents, now + START_LEAD_MS))
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
      const a = this.agents.find((x) => play[x]?.kind === 'water' && this.waterDone[x] !== stayOf(x) && !this.acts[x] && !this.reads[x] && resting(x) && steady(x))
      if (a) {
        // the scheduled plant, or the next one whose stand is not taken by somebody resting beside it (water.ts STAND_BLOCKERS)
        const names = WATER_PLANTS.map((p) => p.name)
        const first = Math.max(0, names.indexOf(play[a].plant ?? ''))
        const free = (n: string) => ![...(STAND_BLOCKERS[n] ?? []), ...(PATH_BLOCKERS[n] ?? [])].some((spot) => this.agents.some((x) => x !== a && (this.lastGoal[x]?.spot === spot || arrivedAt(x) === spot)))
        const plant = [0, 1, 2].map((k) => names[(first + k) % names.length]).find(free)
        if (plant) this.waters[a] = startWater(plant, stayOf(a), now, !!opts.reduced, habitFor(a, stayOf(a)))
      }
    }
    // the reading errand (readRun.ts, #280): the schedule's books assignment is an errand like the watering: the book is taken from the low table, read on sofa seat 0
    // (seat 1 when somebody has it), and put back. One book, so one reader; called away before it has the book nothing is left to bring back, called away
    // with it the agent first brings it back
    for (const a of this.agents) {
      const run = this.reads[a]
      if (!run) continue
      let cur = run
      if (!resting(a) || a in this.meet) {
        if (!readHolding(run)) {
          delete this.reads[a]
          // #715: not read yet: back in the same stay, it reads (the stay is not over because a call came on the way)
          delete this.readDone[a]
          continue
        }
        cur = callAway(run, now)
      }
      const r = stepRead(cur, { now, at: (spot) => arrivedAt(a) === spot })
      if (r.done) {
        // #715: a reading cut short by a call (the book brought back before its end) is read again back in the same stay
        if (!resting(a) || a in this.meet) delete this.readDone[a]
        else this.readDone[a] = run.block
        delete this.reads[a]
      } else this.reads[a] = r.run
    }
    if (!Object.keys(this.reads).length) {
      const a = this.agents.find((x) => play[x]?.kind === 'books' && this.readDone[x] !== stayOf(x) && this.shelf?.agent !== x && this.shelfBrowse?.agent !== x && !this.acts[x] && !this.waters[x] && resting(x) && steady(x))
      if (a) {
        this.readDone[a] = stayOf(a)
        // #450: a book stay is read at the second bookshelf (one stand, one reader) or at the low table, by the stay's seed
        if (!this.shelf && shelfTurn(a, stayOf(a))) this.shelf = startShelf(a, stayOf(a), now, this.shelfLast[a])
        else {
          // seat 0 when nobody rests on it or is heading for it, else seat 1, else the second bookshelf (#715), else this reading is skipped (the stay counts as read)
          const seat = chooseSeat((spot) => this.agents.some((x) => x !== a && (this.lastGoal[x]?.spot === spot || arrivedAt(x) === spot)))
          if (seat !== null) this.reads[a] = startRead(seat, stayOf(a), now, play[a]?.until)
          // #715: both seats taken: the second bookshelf when nobody is at it, rather than no reading at all and the whole stay standing about
          else if (!this.shelf && !this.shelfBrowse) this.shelf = startShelf(a, stayOf(a), now, this.shelfLast[a])
        }
      }
    }
    // #718 ②-b (play.md 9.7 ①, tidyRun.ts): the one left at a broken ping-pong game tidies the table; called away, it simply stops (the paddles go home)
    const tidySpot = (run: TidyRun, place: ReturnType<typeof tidyPlace>) => (place === 'own' ? `pingpong_${run.own}` : place === 'partner' ? `pingpong_${otherSide(run.own)}` : TIDY_SPOT)
    for (const a of this.agents) {
      const p = play[a]
      if (p?.gap === 'tidy' && p.paddle && this.tidyDone[a] !== p.stay && !this.tidies[a] && resting(a)) {
        this.tidies[a] = startTidy(p.paddle, p.stay, now)
        this.tidyDone[a] = p.stay
      }
      const run = this.tidies[a]
      if (!run) continue
      if (!resting(a) || a in this.meet) {
        delete this.tidies[a]
        continue
      }
      const r = stepTidy(run, { now, arrived: (place) => arrivedAt(a) === tidySpot(run, place) })
      if (r.done) {
        delete this.tidies[a]
        this.tidied = true
      } else this.tidies[a] = r.run
    }
    // a game at the table takes the tidied paddles up again
    if (this.agents.some((a) => play[a]?.kind === 'pingpong' && !!play[a]?.partner && play[a]?.pairAt !== undefined && now >= play[a]!.pairAt!)) this.tidied = false
    // #450 (lounge-props.md 6): the book from the second bookshelf, read standing before it and put back in its slot. Called away with it out, it is put
    // back first; on the way, nothing is out
    if (this.shelf) {
      let cur = this.shelf
      const a = cur.agent
      if (!resting(a) || a in this.meet) {
        if (!shelfHolding(cur)) cur = null as unknown as ShelfRun
        else cur = shelfCallAway(cur, now)
      }
      if (!cur) {
        this.shelf = null
        // #715: nothing taken yet: back in the same stay, it reads
        delete this.readDone[a]
      }
      else {
        const r = stepShelf(cur, { now, arrived: arrivedAt(a) === SHELF_STAND.spot })
        if (r.done) {
          this.shelfLast[a] = cur.book
          this.shelf = null
          // #715: put back because of a call: back in the same stay, it reads again
          if (!resting(a) || a in this.meet) delete this.readDone[a]
          // #450 (designer): the stay goes on: another book, or the spines browsed till it ends
          const p = play[a]
          const left = r.run.stage === 'put' && p?.kind === 'books' && p.stay === cur.block && resting(a) && !(a in this.meet) ? (p.until - now) / 1000 : 0
          if (left >= SHELF_MORE.minLeftS && cur.n < SHELF_MORE.max) this.shelf = nextShelf(cur, now, left)
          else if (left > 0 && p) this.shelfBrowse = { agent: a, block: cur.block, until: p.until }
        } else this.shelf = r.run
      }
    }
    if (this.shelfBrowse) {
      const b = this.shelfBrowse
      if (now >= b.until || !resting(b.agent) || b.agent in this.meet || play[b.agent]?.stay !== b.block) this.shelfBrowse = null
    }
    // #538 (hologram.md 4.3) the hologram board has no bowls: the white bowl's errand (#137 ①, bowlRun) is gone, a record placed alone starts at once
    // the lounge acts (lounge.ts): started by the schedule or by the music's wish for a break, once the agent is free; called away it simply stops
    for (const a of this.agents) {
      const run = this.acts[a]
      if (!run) continue
      if (!resting(a) || a in this.meet) {
        delete this.acts[a]
        continue
      }
      const r = stepAct(run, { now, arrived: arrivedAt(a) === actSpot(run) })
      // #457 the fridge: once the left hand has the drink it is the agent's (called away from here on, it takes it along)
      if (r.run.t0 !== null && r.run.pick && !r.run.taken && actU(r.run, now) >= grabAt(!!opts.reduced)) {
        r.run = { ...r.run, taken: true }
        this.drinks[a] = { kind: r.run.pick!, at: r.run.t0! + grabAt(!!opts.reduced) * 1000, stay: null, fadeAt: null }
        const day = kstDay(now)
        const had = this.drank[a]?.day === day ? this.drank[a].kinds : []
        this.drank[a] = { day, kinds: [...had, r.run.pick!] }
      }
      if (r.run.t0 !== null && run.kind === 'record') {
        const d = deckAfter(r.run, actU(r.run, now))
        this.deck.recordOn = d.recordOn
        if (d.needle !== null) {
          if (d.needle && !this.deck.needle) this.needleAt = now
          if (!d.needle && this.deck.needle) this.liftedAt = now
          this.deck.needle = d.needle
        }
      }
      if (r.done) delete this.acts[a]
      else this.acts[a] = r.run
    }
    const beginAct = (a: string, kind: ActKind) => {
      const bar = (k: ActKind) => (k === 'record' ? 'record' : 'bar')
      if (Object.values(this.acts).some((r) => bar(r.kind) === bar(kind))) return
      this.acts[a] = startAct(kind, stayOf(a), kind === 'record' ? (this.deck.needle ? 'lift' : 'put') : undefined, this.deck.recordOn, kind === 'fridge' ? this.pickFor(a, stayOf(a), now) : null)
      this.actDone[a] = stayOf(a)
    }
    // the break music is due and nobody has put the record on: whoever rests, agent_4 (echo) first; the break is over and the needle is still down: somebody lifts it
    // either way only after the last swap has had its time (#527: lifted, then put back on 9 s later by the same agent, again and again)
    const wishes = opts.wantsBreak === undefined ? null : opts.wantsBreak ? !this.deck.needle && (now - this.liftedAt >= PUT_AFTER_MS || now < this.liftedAt) : this.deck.needle && now - this.needleAt >= LIFT_AFTER_MS
    if (wishes && !Object.values(this.acts).some((r) => r.kind === 'record')) {
      const free = this.agents.filter((x) => !this.acts[x] && !this.waters[x] && !this.reads[x] && resting(x) && steady(x))
      const a = free.includes('agent_4') ? 'agent_4' : free[0]
      if (a) beginAct(a, 'record')
    }
    for (const a of this.agents) {
      const k = play[a]?.kind
      // the break music is on and the needle is down: the schedule does not send anybody to lift the arm (that is for the end of the break, above)
      // #718 (play.md 9.7 ③): nobody is sent while the break music plays, and a turn more than ACT_WAIT_MAX_S off is not waited for: this stay skips its act
      // (marked done: the fill chain takes the rest)
      if (k && isAct(k) && this.actDone[a] !== stayOf(a) && !this.acts[a] && resting(a)) {
        const hold = k === 'record' && opts.wantsBreak && this.deck.needle
        const ahead = Object.values(this.acts).find((r) => (r.kind === 'record') === (k === 'record'))
        const wait = hold ? Infinity : ahead ? (ahead.t0 === null ? actLength(ahead) + ACT_WALK_S : actLength(ahead) - actU(ahead, now)) : 0
        if (wait > ACT_WAIT_MAX_S) {
          this.actDone[a] = stayOf(a)
          continue
        }
      }
      if (k === 'record' && opts.wantsBreak && this.deck.needle) continue
      if (k && isAct(k) && this.actDone[a] !== stayOf(a) && !this.acts[a] && !this.waters[a] && !this.reads[a] && resting(a) && steady(a)) beginAct(a, k)
    }
    // #4 notes 2b (noteRead.ts): a robot with a note waiting walks to the cork board the next time it rests, one at a time. Called away on the
    // way it tries again later; an hour after the note was pinned it lets it go
    for (const a of this.agents) {
      const q = stillWaiting(this.noteQueue[a] ?? [], now)
      if (q.length) this.noteQueue[a] = q
      else delete this.noteQueue[a]
      const run = this.noteRuns[a]
      if (!run) continue
      if (!resting(a) || a in this.meet || this.waters[a] || this.reads[a] || this.acts[a]) {
        delete this.noteRuns[a]
        continue
      }
      const r = stepNote(run, { now, arrived: arrivedAt(a) === NOTE_READ.spot })
      if (r.done) {
        this.noteQueue[a] = (this.noteQueue[a] ?? []).filter((n) => !run.ids.includes(n.id))
        delete this.noteRuns[a]
      } else if (r.giveUp) delete this.noteRuns[a]
      else this.noteRuns[a] = r.run
    }
    if (!Object.keys(this.noteRuns).length) {
      const a = this.agents.find((x) => this.noteQueue[x]?.length && !this.acts[x] && !this.waters[x] && !this.reads[x] && !(x in this.meet) && resting(x) && steady(x))
      if (a) this.noteRuns[a] = { ids: this.noteQueue[a].map((n) => n.id), since: now, t0: null }
    }
    // #451 (lounge-props.md 7): at 09:00 one opens the office, at 23:00 one locks up: walks to the door, presses the lever, goes back to what it does
    const due = doorDue(now)
    const busyNow = (x: string) => status[x]?.state === 'working' || status[x]?.state === 'wrapping'
    if (!this.door && due && this.doorBegun !== due.at) {
      this.doorBegun = due.at
      const a = doorAgent(due.kind, this.agents, busyNow, nightDuty(this.agents, now))
      if (a) this.door = { agent: a, kind: due.kind, at: now, arrived: null }
    }
    if (this.door) {
      const d = this.door
      // called to work (or into a talk) on the way: the round is dropped (the lever can wait for tomorrow)
      if (busyNow(d.agent) || d.agent in this.meet) this.door = null
      else {
        const r = stepDoor(d, { now, arrived: arrivedAt(d.agent) === DOOR_ROUND.spot, minS: opts.gm ?? 0 })
        this.door = r.done || r.giveUp ? null : r.run
      }
    }
    // whoever is on an errand is not free for the schedule's other plays (a game partner left alone goes to a solo)
    const away = [...Object.keys(this.waters), ...Object.keys(this.acts), ...Object.keys(this.reads), ...Object.keys(this.tidies), ...Object.keys(this.noteRuns), ...(this.door ? [this.door.agent] : []), ...(this.shelf ? [this.shelf.agent] : []), ...(this.shelfBrowse ? [this.shelfBrowse.agent] : [])]
    if (away.length) {
      play = playAt(now, this.agents, new Set([...busy, ...away]), alone)
      fillLeft()
      alonePlay()
    }
    const out: Record<string, Goal> = {}
    const shown: Record<string, Shown> = {}
    const playing: string[] = []
    const deskIdle = (desk: number): Goal => ({ spot: `work_${desk}`, pose: 'idle', label: '자리에서 쉬는 중' })

    for (const a of this.agents) {
      const s = rawOf(a)
      const desk = deskOf(a)
      const atDesk = arrivedAt(a) === `work_${desk}`
      // #451 the door round: to the stand on the mat, the lever pressed (loungeActs.ts), at night a nod to the door after letting go
      const dr = this.door?.agent === a ? this.door : null
      if (dr) {
        const u = doorU(dr, now)
        const nodAt = LEVER.grab + LEVER.pressS + DOOR_ROUND.holdS.night + LEVER.releaseS
        out[a] = {
          spot: DOOR_ROUND.spot,
          pose: 'idle',
          door: { kind: dr.kind, u },
          ...(dr.kind === 'night' && u >= nodAt ? { gesture: { key: `door:${dr.at}`, hand: false } } : {}),
          label: DOOR_LABEL[dr.kind],
        }
        // as the other errands: resting it shows as rest; off (asleep) or on night duty, the round's words
        const free = (s.state === 'idle' && s.night !== 'duty') || s.state === 'wrapping'
        shown[a] = free ? { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' } : { status: s, kind: s.state === 'off' ? 'off' : 'duty', detail: DOOR_LABEL[dr.kind] }
        continue
      }
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
        out[a] = { spot: pl.spot, pose: 'water', face: pl.face, ...standSlot({ stand: pl.stand, face: pl.face }), water: { stage: wr.stage, plant: wr.plant, u: (now - wr.t0) / 1000, habit: wr.habit }, label: `화분 물 주기 · ${WATER_LABEL[wr.stage]}` }
        const free = (s.state === 'idle' && s.night !== 'duty') || (s.state === 'wrapping' && !this.runs[a])
        shown[a] = free
          ? { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
          : { status: s, kind: s.state === 'working' ? 'work' : s.state === 'wrapping' ? 'wrap' : s.state === 'off' ? 'off' : 'duty', detail: WATER_LABEL[wr.stage], ...(s.state === 'wrapping' ? { step: 'seat' as const } : {}) }
        continue
      }
      // #718 ②-b the tidy-up: the stage's place (its end, the ball by the net, the partner's end, pp_side), the hands drawn from the stage
      const tr = this.tidies[a]
      if (tr) {
        const place = tidyPlace(tr)
        out[a] = { spot: tidySpot(tr, place), pose: 'idle', ...(place === 'ball' ? { face: TIDY_BALL.face, ...standSlot(TIDY_BALL) } : {}), tidy: { stage: tr.stage, u: (now - tr.t0) / 1000, own: tr.own }, label: GAP_LABEL.tidy }
        const free = (s.state === 'idle' && s.night !== 'duty') || (s.state === 'wrapping' && !this.runs[a])
        shown[a] = free ? { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' } : { status: s, kind: s.state === 'working' ? 'work' : s.state === 'wrapping' ? 'wrap' : s.state === 'off' ? 'off' : 'duty', detail: GAP_LABEL.tidy }
        continue
      }
      // the reading errand: the stage's own place (the stand beside the table, or the sofa seat) and hands, until the book is back where it was taken from
      const rr = this.reads[a]
      if (rr) {
        const pl = readPlace(rr)
        out[a] = { spot: pl.spot, pose: 'books', ...(pl.stand ? { face: pl.face, ...standSlot({ stand: pl.stand, face: pl.face }) } : {}), read: { stage: rr.stage, seat: rr.seat, u: (now - rr.t0) / 1000, len: readLen(rr) }, label: `책 읽기 · ${READ_LABEL[rr.stage]}` }
        const free = (s.state === 'idle' && s.night !== 'duty') || (s.state === 'wrapping' && !this.runs[a])
        shown[a] = free
          ? { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
          : { status: s, kind: s.state === 'working' ? 'work' : s.state === 'wrapping' ? 'wrap' : s.state === 'off' ? 'off' : 'duty', detail: READ_LABEL[rr.stage], ...(s.state === 'wrapping' ? { step: 'seat' as const } : {}) }
        continue
      }
      // #450 the shelf book: the stand before the second bookshelf, the hands and the book drawn from the stage
      const sr = this.shelf?.agent === a ? this.shelf : null
      if (sr) {
        out[a] = {
          spot: SHELF_STAND.spot,
          pose: 'shelfbook',
          face: SHELF_STAND.face,
          ...standSlot(SHELF_STAND),
          shelf: { stage: sr.stage, book: sr.book, u: (now - sr.t0) / 1000, block: sr.block },
          label: SHELF_LABEL[sr.stage],
        }
        const free = (s.state === 'idle' && s.night !== 'duty') || (s.state === 'wrapping' && !this.runs[a])
        shown[a] = free
          ? { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
          : { status: s, kind: s.state === 'working' ? 'work' : s.state === 'wrapping' ? 'wrap' : s.state === 'off' ? 'off' : 'duty', detail: SHELF_LABEL[sr.stage], ...(s.state === 'wrapping' ? { step: 'seat' as const } : {}) }
        continue
      }
      if (this.shelfBrowse?.agent === a) {
        out[a] = { spot: SHELF_STAND.spot, pose: 'idle', face: SHELF_STAND.face, ...standSlot(SHELF_STAND), browse: true, label: BROWSE.label }
        shown[a] = { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
        continue
      }
      // a lounge act: its own place and hands for as long as it lasts
      const ar = this.acts[a]
      if (ar) {
        const pl = ACT_PLACE[ar.kind]
        out[a] = { spot: pl.spot, pose: ar.kind, face: pl.face, ...standSlot({ stand: pl.stand, face: pl.face }), act: { kind: ar.kind, u: actU(ar, now), ...(ar.mode ? { mode: ar.mode } : {}), recordOn: ar.recordOn, ...(ar.pick ? { pick: ar.pick } : {}) }, label: ACT_LABEL[ar.kind] }
        shown[a] = { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
        continue
      }
      // #4 notes 2b: at the cork board, looking at its note(s), then the nod (Goal.gesture) and the thanks (Goal.note, the scene's bubble)
      const nr = this.noteRuns[a]
      if (nr) {
        const u = noteU(nr, now)
        out[a] = {
          spot: NOTE_READ.spot,
          pose: 'idle',
          face: NOTE_READ.face,
          note: { u, ids: nr.ids },
          ...(u >= NOTE_READ.lookS ? { gesture: { key: `note:${nr.ids.join(',')}`, hand: false } } : {}),
          label: u < 0 ? NOTE_LABEL.walk : NOTE_LABEL.read,
        }
        shown[a] = { status: s.state === 'wrapping' ? { ...s, state: 'idle' } : s, kind: 'rest' }
        continue
      }
      // #110: nobody leaves. Off at night = dozing at its own desk, or the one awake on night duty; off by day
      // (a source that skipped duty.ts) = resting at the desk. 'leave' stays in the rig but is never chosen.
      if (s.night === 'duty' && s.state === 'idle') {
        const p = soloAt(now, a)
        out[a] = { spot: p.spot, pose: schedulePose(p.kind), face: p.face, ...standSlot(p), quiet: true, label: `야간 당번 · ${p.label}` }
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
        shown[a] = { status: s, kind: 'work', ...(atDesk || this.heldByVisitor.has(a) ? {} : { detail: WALKING_TO_DESK }) }
        continue
      }
      const run = this.runs[a]
      if (s.state === 'wrapping' && run) {
        const others = this.agents.filter((b) => b !== a)
        const boardTaken = others.some((b) => this.runs[b]?.step === 'post' || arrivedAt(b) === 'whiteboard')
        const v = viewOf(run, { now, boardTaken, gm: opts.gm })
        const base = { carry: v.carry, beat: v.beat, reread: v.reread, waiting: v.waiting, wrapStep: v.step, label: `정리 중 · ${v.label}` }
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
      // #517 (play.md 9.1): an errand waiting its turn (the can, the book, the bar or the turntable taken), or already done in this stay, does not send the agent
      // to sit at its desk: it rests near the errand's place, gaps by turns (play.ts restNear); the words say it waits its turn, or which gap it is
      const rest = (done: boolean, waiting: string, face?: { x: number; z: number }) => {
        // #718: what is left here is short (a wait of ACT_WAIT_MAX_S at most, or under a minute after the errand: fillLeft takes longer ones)
        const r = restNear(now, this.agents, p!)
        playing.push(a)
        const at = !done && face ? face : r.face
        out[a] = { spot: r.spot, pose: 'idle', gap: r.gap, ...(at ? { face: at } : {}), label: done ? r.label : waiting }
      }
      // water is an errand (above): an agent assigned to it that has not started waits for the can (or has already watered in this stay)
      if (p && isAct(p.kind)) {
        rest(this.actDone[a] === stayOf(a), `${ACT_LABEL[p.kind]} 차례 기다리는 중`, ACT_PLACE[p.kind].face)
        continue
      }
      if (p?.kind === 'water') {
        rest(this.waterDone[a] === stayOf(a), '물뿌리개 차례 기다리는 중')
        continue
      }
      // reading is an errand too (above): one book, so an agent assigned to it waits for its turn, or finds both seats taken and skips this stay's reading
      if (p?.kind === 'books') {
        rest(this.readDone[a] === stayOf(a), '책 차례 기다리는 중')
        continue
      }
      if (p) playing.push(a)
      // a gap between two stays (a stretch where it was, a stroll, the window) and watching a game stand still: the label says which (#490)
      out[a] = p ? { spot: p.spot, pose: schedulePose(p.kind), face: p.face, ...standSlot(p), ...(p.gap ? { gap: p.gap } : {}), ...(p.gap === 'spines' ? { browse: true } : {}), ...(p.watch ? { watching: p.watch } : {}), ...(p.kind === 'pingpong' && p.partner && arrivedAt(p.partner) !== play[p.partner]?.spot ? { partnerWait: true } : {}), label: p.label } : deskIdle(desk)
    }
    this.settle(out, playing, deskIdle)
    // #718 (play.md 9.7 ②): a face cue of the plan (a watcher whose game broke: 의문) whatever its fill is run as (an errand builds its own goal)
    for (const a of this.agents) {
      const cue = cues[a] ?? play[a]?.cue
      if (cue && out[a]) out[a] = { ...out[a], faceCue: cue }
    }
    this.putAway(now, out)
    this.drinkStep(now, out, shown, arrivedAt, !!opts.reduced)
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
        // #517: a gap on a taken hall spot takes the nearest free one (never the desk)
        const hall = !alt && g.gap ? hallNear(g.spot, (s) => blocked({ ...g, spot: s, slot: undefined, face: undefined }, a)) : null
        g = alt ? { spot: alt, pose: g.pose, label: g.label } : hall ? { ...g, spot: hall, gap: 'wander', face: undefined } : deskIdle(deskOf(a))
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

  /**
   * #457 the drinks after the fridge (fridgeDrink.ts): kept in the left hand while the act runs; then carried to where the agent stays next,
   * sipped there, faded out after a while or when the hands are wanted (an errand, a pose that uses them). Called away to work with it, the
   * agent shows it is carrying it on the way (lounge-props.md 5.5, as the can and the book).
   */
  private drinkStep(now: number, out: Record<string, Goal>, shown: Record<string, Shown>, arrivedAt: (a: string) => string | null, reduced: boolean) {
    for (const a of this.agents) {
      const d = this.drinks[a]
      if (!d) continue
      const g = out[a]
      const inAct = this.acts[a]?.kind === 'fridge'
      const next = inAct ? d : stepDrink(d, { now, spot: g.spot, pose: g.pose, arrived: arrivedAt(a) === g.spot, errand: !!(g.water || g.read || g.act) })
      if (!next) {
        delete this.drinks[a]
        continue
      }
      this.drinks[a] = next
      g.drink = drinkView(next, { now, spot: g.spot, reduced })
      const s = shown[a]
      if (!inAct && next.fadeAt === null && arrivedAt(a) !== g.spot && s && s.kind !== 'rest') shown[a] = { ...s, detail: CARRYING_DRINK }
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
