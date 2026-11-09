// The hands of play (#135, agents.md 2.10 / play.md): pure timelines. The omok place sequence of a stone (pick, carry,
// think, pause, place, withdraw) and the ping-pong swing. Numbers only: PlayStage turns them into world poses.

import { personalityOf } from './omok'

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const ease = (x: number) => {
  const k = clamp01(x)
  return k * k * (3 - 2 * k)
}

/** the sequence's anchors, ms since the move began (agents.md 2.10, with the thinking inserted before the placing) */
export const SEQ = {
  /** reach the bowl, lower in, close on the stone; the stone is the hand's from the end of the pick */
  pick: 350,
  /** the hand leaves its rest pose within this */
  reach: 200,
  /** the arc to above the intersection ends here */
  carry: 800,
  /** the arc's height over a straight line, m */
  arc: 0.08,
  /** the stone's bottom this high over the board for the pause, m */
  pauseH: 0.015,
  /** ms: easing down to the pause before it, the pause, the drop */
  settle: 150,
  pause: 50,
  drop: 50,
  /** after the stone lands: the hand springs 0.4 cm up (80 ms) */
  bounceM: 0.004,
  bounceMs: 80,
  /** from the landing: the hand withdraws, the middle finger first */
  withdraw: 420,
} as const

/** how an agent hesitates (agents.md 2.10 "생각할 때 버릇") */
export type Habit = 'circle' | 'chin' | 'roll' | 'tap'
export const HABITS: Record<string, Habit> = { agent_0: 'circle', agent_1: 'chin', agent_2: 'roll', agent_3: 'tap' }
export const habitOf = (agent: string): Habit => HABITS[agent] ?? 'circle'
/** where the stone waits while its player thinks, m above the board */
const HOVER_H: Record<Habit, number> = { circle: 0.1, chin: 0.06, roll: 0.06, tap: 0.04 }

export type Stage = 'rest' | 'pick' | 'carry' | 'think' | 'pause' | 'drop' | 'bounce' | 'withdraw'

export interface Place {
  stage: Stage
  /** the hand's place: 0 = its pose, 1 = on the stone's path */
  w: number
  /** along the way from the bowl (0) to the intersection (1) */
  u: number
  /** the stone's bottom above the straight line from the bowl's contact point to the board's resting height, m */
  h: number
  /** where it hovers sideways of the intersection (the circling hand), m */
  dx: number
  dz: number
  /** the hand's roll about its fingers, rad (the rolling stone) */
  roll: number
  /** the hand's extra rise (the bounce after the stone lands), m */
  lift: number
  /** the wrist lays flat over the intersection (0 = carrying pitch, 1 = flat), the middle finger's press on the stone (0..1), the hand's rise away after letting go (m) */
  flat: number
  press: number
  rise: number
  /** the stone belongs to the hand */
  attached: boolean
  /** the stone lies on the board (from the landing) */
  landed: boolean
  /** the fingers close on the stone (0 open … 1 closed), and how far the middle finger / the rest have let go (0 held … 1 free) */
  close: number
  freeIndex: number
  freeMiddle: number
  /** the re-grip from the pick's thumb + index pinch into the go grip, 0 → 1 over the first 0.2 s of the arc */
  regrip: number
  /** the stone slides in from this far behind the intersection (toward the body), m; after the landing the hand returns toward the body by `retreat` */
  back: number
  retreat: number
  freeRest: number
  /** the thinking habit, for the other hand and the head */
  habit: Habit
  /** thinking: the other hand goes to the chin and drums its fingers (메시) */
  chin: boolean
}

/**
 * The hand's place at `sinceMs` into a move that thinks for `thinkMs`. The stone lands at thinkMs + 900 (hand window 0.9 s of
 * 1.4 s, omok.ts PLACE_AT) and the move ends at thinkMs + 1400.
 */
export function placeSequence(sinceMs: number, thinkMs: number, habit: Habit): Place {
  const s = sinceMs
  const P = thinkMs + SEQ.carry // the nominal place time (0.8 s into the hand window)
  const land = P + SEQ.pause + SEQ.drop + 0 // the stone lands here
  const end = land + SEQ.bounceMs + SEQ.withdraw
  const hb = HOVER_H[habit]
  const base: Place = { stage: 'rest', w: 0, u: 0, h: 0, dx: 0, dz: 0, roll: 0, lift: 0, flat: 0, press: 0, rise: 0, attached: false, landed: false, close: 0, freeIndex: 0, regrip: 0, back: 0, retreat: 0, freeMiddle: 0, freeRest: 0, habit, chin: false }
  if (s < 0 || s >= end) return { ...base, landed: s >= land }
  const w = ease(s / SEQ.reach) * (s >= land ? 1 - ease((s - land - SEQ.bounceMs) / SEQ.withdraw) : 1)
  const out: Place = { ...base, w }
  if (s < SEQ.pick) {
    // over the bowl, down into it, the fingers close at the end
    out.stage = 'pick'
    out.h = 0.04 * (1 - ease(s / (SEQ.pick - 100)))
    out.close = ease((s - (SEQ.pick - 100)) / 100)
    out.attached = s >= SEQ.pick
    return out
  }
  out.attached = s < land
  out.close = 1
  out.chin = habit === 'chin' && s < P
  if (s < SEQ.carry) {
    const k = (s - SEQ.pick) / (SEQ.carry - SEQ.pick)
    out.stage = 'carry'
    out.regrip = ease((s - SEQ.pick) / 200)
    out.back = 0.02 * ease(k)
    out.u = ease(k)
    out.h = hb * ease(k) + SEQ.arc * Math.sin(Math.PI * k)
    return out
  }
  out.u = 1
  const settleAt = P - SEQ.settle
  if (s < P) {
    out.stage = 'think'
    out.regrip = 1
    out.back = 0.02 * (1 - ease((s - (P - 100)) / 150))
    out.flat = ease((s - SEQ.carry) / 250)
    const th = s - SEQ.carry
    let h = hb
    if (s >= settleAt) h = hb + (SEQ.pauseH - hb) * ease((s - settleAt) / SEQ.settle)
    else if (habit === 'circle') {
      const f = ease(th / 100) * ease((settleAt - s) / 100)
      const phi = (2 * Math.PI * th) / 1200
      out.dx = 0.02 * Math.cos(phi) * f
      out.dz = 0.02 * Math.sin(phi) * f
    } else if (habit === 'roll') out.roll = ((10 * Math.PI) / 180) * Math.sin((2 * Math.PI * th) / 500) * ease(th / 100)
    else if (habit === 'tap' && s >= P - 450) {
      // two quick 1 cm taps just above the board (루프)
      const x = (s - (P - 450)) / 150
      h = SEQ.pauseH + 0.01 * (0.5 + 0.5 * Math.cos(2 * Math.PI * x))
    }
    out.h = h
    return out
  }
  if (s < P + SEQ.pause) {
    out.stage = 'pause'
    out.regrip = 1
    out.back = 0.02 * (1 - ease((s - (P - 100)) / 150))
    out.flat = 1
    out.h = SEQ.pauseH
    return out
  }
  if (s < land) {
    out.stage = 'drop'
    out.regrip = 1
    out.back = 0.02 * (1 - ease((s - (P - 100)) / 150))
    out.flat = 1
    out.press = ease((s - P - SEQ.pause) / SEQ.drop)
    out.h = SEQ.pauseH * (1 - ease((s - P - SEQ.pause) / SEQ.drop))
    return out
  }
  out.landed = true
  out.h = 0
  const since = s - land
  out.stage = since < SEQ.bounceMs ? 'bounce' : 'withdraw'
  out.lift = SEQ.bounceM * Math.sin(Math.PI * clamp01(since / SEQ.bounceMs))
  // the middle finger is first out from under the stone, then the others
  out.flat = 1
  out.press = 1 - ease(since / 60)
  // then the hand lifts away upward (agents.md 2.10 / the designer: release, then up and off the board)
  out.rise = 0.07 * ease((since - SEQ.bounceMs) / SEQ.withdraw)
  // the index finger withdraws first, then the middle one that pressed, then the rest; the hand returns on a curve up and toward the body
  out.regrip = 1
  out.retreat = 0.06 * ease((since - SEQ.bounceMs) / SEQ.withdraw)
  out.freeIndex = ease(since / 100)
  out.freeMiddle = ease((since - 50) / 180)
  out.freeRest = ease((since - 50) / 260)
  out.close = 1
  return out
}

/** the move's own length: thinkMs + HAND_MS (omok.ts) */
export const moveLengthMs = (thinkMs: number) => thinkMs + SEQ.carry + SEQ.pause + SEQ.drop + SEQ.bounceMs + SEQ.withdraw

/** think time of a personality is only for tests that want a plausible value */
export const sampleThink = (agent: string) => personalityOf(agent).think[0]

// ---- ping-pong ---------------------------------------------------------------------------------------------------------

/** the paddle's travel along the hit direction at swing phase t01 (0..1, contact at 0.5): pulled back, through the ball, followed through; m, + = toward the net */
export const SWING_M = 0.12
export function swingTravel(t01: number): number {
  const k = clamp01(t01)
  return -SWING_M * Math.sin(2 * Math.PI * k)
}
/** the face's tilt (rad) over the swing: closed a little coming through (the designer's 30° back, 45° through, trimmed to what a wrist of this size shows) */
export function swingTilt(t01: number): number {
  const k = clamp01(t01)
  return (0.5 * Math.PI) / 4 * Math.sin(2 * Math.PI * k)
}
/** how close the paddle follows the ball: 0 = at its ready place, 1 = on the ball, from the ball's distance to the hitting plane, m */
export function followWeight(distToPlane: number, from = 0.9): number {
  return ease(1 - distToPlane / from)
}
