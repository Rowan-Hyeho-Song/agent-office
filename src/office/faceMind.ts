// What a robot's face is doing, frame by frame (#193 2/2, robots.md 4-5). Pure: the clock and the inputs go in, the parameters of
// faceModel.ts come out. Decides which expression shows (events > talk / meeting > state), hides every change behind a blink (Echo:
// a 120 ms blend), runs the random blinks, the 1-pixel gaze, the talking mouth, Loop's cursor and the redraw budget.

import { ECHO, EVENT_SECONDS, type Expression, EXPRESSIONS, type FaceParams } from './faceModel'
import type { AgentState } from './status'

/** a swap is hidden by a blink: the eyes are closed this long, then half open this long (robots.md 5: 60 ms) */
export const SWAP_CLOSED_S = 0.06
export const HALF_S = 0.04
/** a random blink: 80 ms closed + 40 ms half; one every 3-6 s */
export const BLINK_CLOSED_S = 0.08
export const BLINK_EVERY_S: readonly [number, number] = [3, 6]
export const ECHO_BLEND_S = 0.12
export const MOUTH_HZ = 8
/** the timelapse at x16 shows an event this long only */
export const FAST_EVENT_S = 0.3
/** the red of a failure */
export const RED_S = 1.5
/** a pending approval older than this makes the requester anxious: 1 s of every 4 s */
export const ANXIOUS_AFTER_MS = 30 * 60_000
export const ANXIOUS_PERIOD_S = 4
export const ANXIOUS_ON_S = 1
/** idle this long with nothing happening: bored */
export const BORED_AFTER_MS = 10 * 60_000
/** at most this many canvas redraws in any second */
export const MAX_REDRAWS_PER_S = 12

export interface BaseIn {
  pose: string
  state?: AgentState
  activity?: string
  night?: 'sleep' | 'duty'
  /** how long it has been idle, ms */
  idleMs?: number
  /** the late hour before this agent dozes (duty.ts isLateHour) */
  late?: boolean
  /** the omok thinker's hand at the chin */
  chin?: boolean
}

/** the state expression (the lowest tier) */
export function baseExpression(i: BaseIn): Expression {
  if (i.pose === 'doze' || i.pose === 'sofa') return 'asleep'
  if (i.night === 'sleep') return 'asleep'
  if (i.night === 'duty') return 'sleepy'
  if (i.chin) return 'thinking'
  if (i.state === 'working') {
    if (i.activity === 'think') return 'thinking'
    if (i.activity === 'edit' || i.activity === 'test' || i.activity === 'build') return 'focused'
    return 'neutral'
  }
  if (i.late && i.state !== 'wrapping') return 'sleepy'
  if (i.state === 'idle' && i.pose === 'idle' && (i.idleMs ?? 0) > BORED_AFTER_MS) return 'bored'
  return 'neutral'
}

export interface FaceInput {
  t: number
  reduced: boolean
  /** the timelapse at x16: events only, no blinks, no mouth */
  fast: boolean
  base: Expression
  /** the talk / meeting tier: nodding */
  talk: Expression | null
  /** a look held from outside (aiming a plane): above the talk tier, below an event */
  aim: Expression | null
  /** a bubble of this agent is being typed */
  speaking: boolean
  /** where it looks: -1..1 left / right (the viewer's), up / down */
  gaze: { x: number; y: number }
  /** the sound it hears (Echo), 0..1 */
  voice: number
  /** an approval of this agent has waited over 30 minutes */
  anxious: boolean
}

export const newInput = (): FaceInput => ({ t: 0, reduced: false, fast: false, base: 'neutral', talk: null, aim: null, speaking: false, gaze: { x: 0, y: 0 }, voice: 0, anxious: false })

/** the little animations' rates, steps per second (0 = the picture is still); Echo's waveforms move, the others hardly */
function animHz(agent: number, e: Expression): number {
  if (agent === ECHO) {
    switch (e) {
      case 'neutral': case 'focused': case 'anxious': return 6
      case 'thinking': case 'joy': return 4
      case 'proud': return 2.5
      case 'embarrassed': case 'greeting': return 8
      case 'sleepy': return 3
      default: return 0
    }
  }
  return e === 'proud' || e === 'joy' ? 2.5 : e === 'asleep' ? 1 : 0 // asleep: the z's rise and fall on a 2 s cycle (#326)
}

const idx = (e: Expression | null) => (e ? EXPRESSIONS.indexOf(e) + 1 : 0)

export class FaceMind {
  readonly agent: number
  /** the expression on the screen now */
  shown: Expression = 'neutral'
  private shownAt = 0
  private from: Expression | null = null
  private blendAt = 0
  private blink: 0 | 1 | 2 = 0
  private blinkAt = -1
  private blinkKind: 'none' | 'random' | 'swap' = 'none'
  private nextBlink = -1
  private seed: number
  // timed things
  private event: { expr: Expression; t0: number; dur: number } | null = null
  private hold: { expr: Expression; t0: number; dur: number } | null = null
  private redUntil = -1
  private forced: Expression | null = null
  // outputs
  private gx = 0
  private gy = 0
  private mouth = -1
  private cursor = true
  private amp = 0
  private anim = 0
  private ageQ = 0
  private blendQ = 4
  private red = false

  // the redraw budget: the times of the last draws, a ring
  private drawn = new Float64Array(MAX_REDRAWS_PER_S).fill(-10)
  private drawAt = 0
  private lastKey = -1
  /** frames drawn since the start (tests, the debug counters) */
  draws = 0

  constructor(agent: number) {
    this.agent = agent
    this.seed = (agent * 2654435761 + 12345) >>> 0
  }

  private rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  /** an event expression (robots.md 4): lasts its table duration unless `dur` says otherwise; a newer one replaces the older */
  fire(expr: Expression, t: number, dur?: number) {
    const d = dur ?? EVENT_SECONDS[expr] ?? 1
    this.event = { expr, t0: t, dur: Math.max(0, d) }
  }

  /** a test / build failure: embarrassed for 3 s, painted red for the first 1.5 s */
  fail(t: number) {
    this.fire('embarrassed', t)
    this.redUntil = t + RED_S
  }

  /** a timed nod (the talk tier) */
  nod(t: number, dur: number) {
    this.hold = { expr: 'nodding', t0: t, dur }
  }

  /** debug: force one expression (null = back to the real ones) */
  force(e: Expression | null) {
    this.forced = e
  }

  /** the expression that should show now: debug > event > aim > talk > state */
  private resolve(i: FaceInput): Expression {
    const t = i.t
    if (this.forced) return this.forced
    const ev = this.event
    if (ev) {
      const len = i.fast ? Math.min(ev.dur, FAST_EVENT_S) : ev.dur
      if (t < ev.t0 + len) return ev.expr
      this.event = null
    }
    if (i.fast) return 'neutral'
    if (i.aim) return i.aim
    const h = this.hold
    if (h) {
      if (t >= h.t0 && t < h.t0 + h.dur) return h.expr
      if (t >= h.t0 + h.dur) this.hold = null
    }
    if (i.talk) return i.talk
    // an approval waiting too long: the worry shows one second in four, over the calm states only
    if (i.anxious && (i.base === 'neutral' || i.base === 'focused' || i.base === 'thinking' || i.base === 'bored') && t % ANXIOUS_PERIOD_S < ANXIOUS_ON_S) return 'anxious'
    return i.base
  }

  private setShown(e: Expression, t: number, blend: boolean) {
    if (blend && this.agent === ECHO) {
      this.from = this.shown
      this.blendAt = t
    } else this.from = null
    this.shown = e
    this.shownAt = t
  }

  update(i: FaceInput) {
    const t = i.t
    const target = this.resolve(i)
    const still = i.reduced || i.fast
    this.red = this.redUntil > t
    if (this.nextBlink < 0) this.nextBlink = t + BLINK_EVERY_S[0] + this.rand() * (BLINK_EVERY_S[1] - BLINK_EVERY_S[0])

    if (still) {
      // no blinks, nothing hidden: the expression switches at once
      this.blink = 0
      this.blinkKind = 'none'
      if (target !== this.shown) this.setShown(target, t, false)
    } else if (this.agent === ECHO) {
      this.blink = 0
      if (target !== this.shown) this.setShown(target, t, true)
    } else {
      if (this.blinkKind !== 'none') {
        const e = t - this.blinkAt
        const closed = this.blinkKind === 'swap' ? SWAP_CLOSED_S : BLINK_CLOSED_S
        if (e < closed) this.blink = 2
        else if (e < closed + HALF_S) this.blink = 1
        else {
          this.blink = 0
          this.blinkKind = 'none'
        }
      }
      if (target !== this.shown) {
        if (this.blink === 2) {
          // the eyes are shut right now: the change happens behind them
          this.setShown(target, t, false)
          this.blinkKind = 'swap'
        } else {
          // close the eyes (a blink of its own), and change at once behind the lids
          this.blinkKind = 'swap'
          this.blinkAt = t
          this.blink = 2
          this.setShown(target, t, false)
        }
        this.nextBlink = Math.max(this.nextBlink, t + BLINK_EVERY_S[0])
      } else if (this.blinkKind === 'none' && t >= this.nextBlink) {
        if (this.shown !== 'asleep' && this.shown !== 'sleepy') {
          this.blinkKind = 'random'
          this.blinkAt = t
          this.blink = 2
        }
        this.nextBlink = t + BLINK_EVERY_S[0] + this.rand() * (BLINK_EVERY_S[1] - BLINK_EVERY_S[0])
      }
    }

    // Echo's blend
    if (this.from) {
      const k = (t - this.blendAt) / ECHO_BLEND_S
      if (k >= 1) this.from = null
      this.blendQ = k >= 1 ? 4 : Math.max(0, Math.floor(k * 4))
    } else this.blendQ = 4

    // the eyes' look: 1 pixel at most; none when reduced / x16. The picture of anxious looks left and right
    if (still) {
      this.gx = 0
      this.gy = 0
    } else if (this.shown === 'anxious') {
      this.gx = Math.sin(t * 3.2) > 0 ? 1 : -1
      this.gy = 0
    } else {
      this.gx = i.gaze.x > 0.4 ? 1 : i.gaze.x < -0.4 ? -1 : 0
      this.gy = i.gaze.y > 0.4 ? 1 : i.gaze.y < -0.4 ? -1 : 0
    }

    // the talking mouth and Loop's cursor
    const talking = i.speaking && !still && this.shown !== 'asleep'
    this.mouth = talking ? Math.floor(t * MOUTH_HZ) % 3 : -1
    this.cursor = still ? true : i.speaking ? Math.floor(t * MOUTH_HZ) % 2 === 0 : Math.floor(t * 2) % 2 === 0

    // Echo's amplitude: the sound it hears; while its own bubble types, a voice-like wobble
    let v = i.voice
    if (this.agent === ECHO && talking) v = Math.max(v, 0.35 + 0.45 * ((Math.floor(t * MOUTH_HZ) * 7919) % 100) / 100)
    this.amp = this.agent === ECHO && !i.reduced ? Math.round(Math.min(1, Math.max(0, v)) * 8) / 8 : this.agent === ECHO ? Math.round(Math.min(1, Math.max(0, i.voice)) * 8) / 8 : 0

    const hz = still ? 0 : animHz(this.agent, this.shown)
    this.anim = hz > 0 ? (Math.floor(t * hz) % 4000) + 1 : 0
    this.ageQ = this.agent === ECHO && this.shown === 'surprised' && !still ? Math.min(13, Math.floor((t - this.shownAt) * 10)) : 0
  }

  /** the numbers that change what is drawn, as one value: equal = nothing to redraw */
  key(): number {
    return (
      idx(this.shown) +
      17 * this.blink +
      64 * (this.gx + 1) +
      192 * (this.gy + 1) +
      576 * (this.mouth + 1) +
      2304 * (this.agent === 3 && this.cursor ? 1 : 0) +
      4608 * (this.red ? 1 : 0) +
      9216 * Math.round(this.amp * 8) +
      92160 * this.blendQ +
      460800 * idx(this.from) +
      7372800 * this.anim +
      3e10 * this.ageQ
    )
  }

  /** whether to redraw now at time t: only when something changed, and at most MAX_REDRAWS_PER_S in any second. Call `drawnAt` after drawing */
  dirty(t: number): boolean {
    if (this.key() === this.lastKey) return false
    // the oldest of the last 12 draws must be a second ago
    return t - this.drawn[this.drawAt] >= 1
  }

  drawnAt(t: number) {
    this.drawn[this.drawAt] = t
    this.drawAt = (this.drawAt + 1) % MAX_REDRAWS_PER_S
    this.lastKey = this.key()
    this.draws++
  }

  /** the parameters of the picture now (writes into `p`, allocates nothing) */
  fill(p: FaceParams) {
    p.agent = this.agent
    p.expr = this.shown
    p.blink = this.blink
    p.gx = this.gx
    p.gy = this.gy
    p.mouth = this.mouth
    p.cursor = this.cursor
    p.red = this.red
    p.amp = this.amp
    p.anim = this.anim
    p.age = this.ageQ / 10
    p.from = this.from
    p.blend = this.from ? this.blendQ / 4 : 1
  }
}

/** the owner has just connected: the approvals role went from something else to 'owner' (not when it was already owner when watching began) */
export const ownerConnected = (prev: string | null, next: string) => prev !== null && prev !== 'owner' && next === 'owner'

/** a rest this long (ms) before a prompt makes the prompt a call out of the blue (#314); the same length of non-work re-arms it */
export const CALLED_AFTER_MS = 2 * 60_000

/**
 * "Called suddenly" (#314): an agent that had no work for over 2 minutes gets a user prompt (state working, activity `think`, the hook's
 * UserPromptSubmit). Fires once; it fires again only after the agent has been non-working for over 2 minutes again. Pure: feed it each frame.
 */
export class CallTracker {
  private restSince: number | null = null
  private working = false
  private armed = true
  private seen = false

  /** `working`: working or wrapping; `since` the status's own start (ms); returns true on the frame the call happens */
  step(working: boolean, activity: string | undefined, since: number, nowMs: number): boolean {
    let fire = false
    if (!working) {
      if (this.restSince === null) this.restSince = this.seen ? nowMs : since
      if (nowMs - this.restSince > CALLED_AFTER_MS) this.armed = true
    } else if (!this.working && this.seen) {
      // the frame work begins
      const rested = this.restSince !== null && since - this.restSince > CALLED_AFTER_MS
      if (activity === 'think' && this.armed && rested) {
        fire = true
        this.armed = false
      }
      this.restSince = null
    } else if (!this.seen) this.restSince = null
    this.working = working
    this.seen = true
    return fire
  }
}
