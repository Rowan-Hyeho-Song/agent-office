// #370 A (docs/design/desk-props.md 4, grips.md): a hand on a thing of its own desk, for a moment. Pure: the desk props (props.ts) and who sits at
// their desk in, the touch under way per seat and what the desk shows out (the lamp, the calendar's day, the hourglass, the turntable, the ring
// light's knob follow the hand, not the status, while it touches them). PlayStage draws the hand, DeskLive the thing.
//   루프 신호등 톡: the light turns green (a pass) while it sits at its desk.
//   휴 스탠드 스위치: the designer comes on (off → in) or goes off at its desk: the lamp changes as the switch is pressed.
//   메시 턴테이블: while it bakes, 3 an hour: the button pressed, the platter pushed 90° round by its rim (0.8 s).
//   메시 링 조명 노브: while it works, 1 an hour: the knob pinched and turned 20° (back and forth, one way each time).
//   메모 달력: the first time it sits at its desk awake on a new day, a page turned over; the new day shows as it lifts.
//   메모 모래시계: an approval starts waiting while it sits there: pinched at the pillar, lifted 5 cm, turned 180° between the fingers, put down (once).
// A seat does one touch at a time; the same habit is not done again within 2 minutes (desk-props.md 4).

import { hash } from './play'
import type { DeskProps } from './props'

export type TouchKind = 'signal' | 'lamp' | 'turntable' | 'knob' | 'calendar' | 'hourglass' | 'duck' | 'keycap' | 'shape'

export const TOUCH_SEAT: Record<TouchKind, number> = { signal: 3, lamp: 2, turntable: 1, knob: 1, calendar: 0, hourglass: 0, duck: 3, keycap: 3, shape: 1 }

/**
 * Each touch's times, s from its start: `len` the whole (the hand back at its end), `at` when its effect happens (the press, the page let go, the
 * hourglass set down), `back` when the hand lets go (it goes back over the rest). The press of a button is at 0.5 s (PlayStage.button).
 */
export const TOUCH_S: Record<TouchKind, { len: number; at: number; back: number }> = {
  signal: { len: 1.2, at: 0.5, back: 0.65 },
  // the switch is at the lamp's foot across the desk, the hand comes from the tablet pen: 0.4 s more to get there
  lamp: { len: 1.6, at: 0.9, back: 1.1 },
  // the button at 0.5 s, the rim from 1.0 s, pushed 1.1–1.9 s
  turntable: { len: 2.4, at: 0.5, back: 1.95 },
  // pinched by 0.6 s, turned 0.6–1.1 s
  knob: { len: 1.6, at: 0.6, back: 1.15 },
  // the page's corner taken at 0.6 s and lifted to 1.0 s, then it falls over by itself
  calendar: { len: 1.6, at: 0.6, back: 1.0 },
  // pinched by 0.6 s; lifted 0.3 s, turned 0.5 s, put down 0.3 s (designer: 0.3 · 0.5 · 0.3)
  hourglass: { len: 2.1, at: 0.6, back: 1.7 },
  // #370 B: taken from the desk, held, put back exactly where it rests (from back - 0.4 s), let go at back
  // the duck before the face from 1.0 s, talked to (the bubble 1.0–3.6 s), squeezed once at 3.65 s (0.15 s)
  duck: { len: 4.7, at: 3.65, back: 4.25 },
  // the keycap rolled between the fingers before the chest (±15°, 0.5 s a roll) from 0.9 s
  keycap: { len: 4.0, at: 0.5, back: 3.6 },
  // the shape at eye height, the left hand under it, turned 30° slowly (2 s) from 1.0 s
  shape: { len: 4.4, at: 0.5, back: 4.0 },
}

/** #370 B the props taken (their nodes) */
export const TOUCH_PROP: Partial<Record<TouchKind, string>> = { duck: 'prop_duck', keycap: 'prop_keycap_0', shape: 'prop_shape_1' }
/** #370 B (designer): what 루프 says to its duck, one picked by the failure's time, never the same twice running */
export const DUCK_LINES = ['오리 씨, 한 줄씩 볼게요.', '여기까진 맞죠? 그럼 여기서…', '이 값이 왜 비어 있을까요.', '다시 돌려 볼게요. 지켜봐 주세요.', '아, 말하다 보니 알겠네요.']
export const DUCK_BUBBLE = { from: 1.0, to: 3.6 }
export const KEYCAP_ROLL = { from: 0.9, to: 3.2, deg: 15, periodS: 0.5 }
export const SHAPE_TURN = { from: 1.0, s: 2, deg: 30, under: 0.01 }

/** the turntable's push and the knob's turn (grips.md) */
export const TURNTABLE_PUSH = { from: 1.1, s: 0.8, deg: 90 }
export const KNOB_TURN = { from: 0.6, s: 0.5, deg: 20 }
/** the hourglass between the fingers: lifted, turned, put down (s from the touch's start), 5 cm */
export const HOURGLASS_FLIP = { from: 0.6, lift: 0.3, turn: 0.5, down: 0.3, m: 0.05 }
/** the calendar page: lifted by the finger to `liftDeg` over `s`, then over by itself to its baked flip_deg in `fallS` */
export const CALENDAR_FLIP = { from: 0.6, s: 0.4, liftDeg: 110, fallS: 0.45 }

/** habits: times an hour while working and while resting at its desk (desk-props.md 4), and not again within NO_REPEAT_S */
export const HABIT_PER_HOUR: Partial<Record<TouchKind, { work: number; rest: number }>> = {
  turntable: { work: 3, rest: 0 },
  knob: { work: 1, rest: 0 },
  keycap: { work: 2, rest: 3 },
  shape: { work: 2, rest: 3 },
}
export const NO_REPEAT_S = 120

export interface TouchIn {
  /** the hands' clock, s */
  t: number
  /** the office clock, ms (the habits' hours) */
  now: number
  desk: DeskProps
  /** the agent of this seat sits at its own desk now */
  seated: (seat: number) => boolean
  /** its status is not off */
  awake: (seat: number) => boolean
  /** it is working */
  working: (seat: number) => boolean
}

export interface Touch {
  kind: TouchKind
  /** s since it began (the hands' clock) */
  u: number
}

/** what the desk shows of the touches (DeskLive) */
export interface TouchShown {
  /** the hourglass's turn, rad about its own x (k * π per flip), and its lift, m */
  hourglassTurn: number
  hourglassLift: number
  /** the turntable pushed round by hand, rad (on top of its spin) */
  turntablePush: number
  /** the ring light's knob, rad about its own x */
  knobTurn: number
  /** the calendar page turning over: degrees of its flip, or null (hidden at rest) */
  calendarPage: number | null
}

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k))
const dayKey = (c: DeskProps['calendar']) => `${c.year}-${c.month}-${c.day}`

export class DeskTouches {
  private prev: DeskProps | null = null
  private prevNow = 0
  private cur = new Map<number, { kind: TouchKind; t0: number }>()
  private lastStart = new Map<TouchKind, number>()
  /** what is shown: the lamp, the calendar's day; the hourglass's flips and the turntable's pushes done, the knob's last turn's direction */
  private lamp: boolean | null = null
  private calendar: DeskProps['calendar'] | null = null
  private flips = 0
  private pushes = 0
  private knobAt = 0
  private knobDir = 1
  /** the duck's line now (DUCK_LINES), and the hands' clock last stepped (the bubble) */
  private duckLine = -1
  private lastT = 0

  /** a seek: forget the edges (nothing is touched for what was jumped over) */
  reset() {
    this.prev = null
    this.cur.clear()
    this.lamp = null
    this.calendar = null
  }

  step(i: TouchIn) {
    const { t, desk } = i
    // the touches over: what they did stays
    for (const [seat, c] of [...this.cur]) {
      const u = t - c.t0
      if (u < TOUCH_S[c.kind].len && u >= 0) continue
      this.settle(c.kind, desk)
      this.cur.delete(seat)
    }
    const prev = this.prev
    if (this.lamp === null || !prev) this.lamp = desk.lamp
    if (this.calendar === null) this.calendar = desk.calendar
    const free = (seat: number) => !this.cur.has(seat) && i.seated(seat)
    const start = (kind: TouchKind) => {
      this.cur.set(TOUCH_SEAT[kind], { kind, t0: t })
      this.lastStart.set(kind, t)
    }
    if (prev) {
      if (desk.signal === 'green' && prev.signal !== 'green' && free(3)) start('signal')
      // a failure: the duck, picked up and talked to
      if (desk.signal === 'red' && prev.signal !== 'red' && free(3)) {
        start('duck')
        let k = hash(`duck|${i.now}`) % DUCK_LINES.length
        if (k === this.duckLine) k = (k + 1) % DUCK_LINES.length
        this.duckLine = k
      }
      if (desk.lamp !== prev.lamp && free(2)) start('lamp')
      if (desk.hourglass && !prev.hourglass && free(0)) start('hourglass')
    }
    // the lamp, untouched: as the status says (the switch pressed: from the press on)
    if (this.cur.get(2)?.kind !== 'lamp') this.lamp = desk.lamp
    // a new day: shown once the planner has turned the page (it is not turned for it)
    if (dayKey(desk.calendar) !== dayKey(this.calendar) && free(0) && i.awake(0)) start('calendar')
    // the habits at their seeded times this hour
    const hourMs = 3_600_000
    for (const kind of ['turntable', 'knob', 'keycap', 'shape'] as const) {
      const seat = TOUCH_SEAT[kind]
      const working = i.working(seat)
      // the turntable while it bakes; the knob and the shape while it works and does not bake; the keycap and the shape while it rests awake too
      const on = kind === 'turntable' ? desk.turntable : kind === 'knob' ? working && !desk.turntable : kind === 'shape' ? i.awake(seat) && !desk.turntable : i.awake(seat)
      if (!on || !free(seat) || !(i.now > this.prevNow)) continue
      const last = this.lastStart.get(kind)
      if (last !== undefined && t - last < NO_REPEAT_S) continue
      const h = Math.floor(i.now / hourMs)
      const due = habitTimes(kind, h, working || kind === 'turntable' ? 'work' : 'rest').some((at) => at > this.prevNow && at <= i.now)
      if (due && i.now - this.prevNow < 60_000) start(kind)
    }
    // effects at their moment
    for (const c of this.cur.values()) {
      const u = t - c.t0
      if (c.kind === 'lamp' && u >= TOUCH_S.lamp.at) this.lamp = desk.lamp
      if (c.kind === 'calendar' && u >= TOUCH_S.calendar.at) this.calendar = desk.calendar
    }
    this.prev = desk
    this.prevNow = i.now
    this.lastT = t
  }

  /** #370 B the bubble of an agent's touch now (루프 talking to its duck), or undefined */
  bubble(agent: string): string | undefined {
    const c = this.cur.get(TOUCH_SEAT.duck)
    if (agent !== `agent_${TOUCH_SEAT.duck}` || c?.kind !== 'duck') return undefined
    const u = this.lastT - c.t0
    return u >= DUCK_BUBBLE.from && u < DUCK_BUBBLE.to ? DUCK_LINES[Math.max(0, this.duckLine)] : undefined
  }

  /** a touch done: what it did is kept */
  private settle(kind: TouchKind, desk: DeskProps) {
    if (kind === 'hourglass') this.flips++
    if (kind === 'turntable') this.pushes++
    if (kind === 'knob') {
      this.knobAt += this.knobDir * KNOB_TURN.deg
      this.knobDir = -this.knobDir
    }
    if (kind === 'lamp') this.lamp = desk.lamp
    if (kind === 'calendar') this.calendar = desk.calendar
  }

  /** start a touch now (tests, the debug panel): its seat's touch under way is dropped */
  begin(kind: TouchKind, t: number) {
    this.cur.set(TOUCH_SEAT[kind], { kind, t0: t })
    this.lastStart.set(kind, t)
  }

  /** the touch of a seat under way at `t`, or null */
  of(seat: number, t: number): Touch | null {
    const c = this.cur.get(seat)
    return c ? { kind: c.kind, u: t - c.t0 } : null
  }

  /** every touch under way, by agent */
  all(t: number): Record<string, Touch> {
    const out: Record<string, Touch> = {}
    for (const [seat, c] of this.cur) out[`agent_${seat}`] = { kind: c.kind, u: t - c.t0 }
    return out
  }

  /** the desk as shown: the lamp and the calendar as the hands left them */
  desk(desk: DeskProps): DeskProps {
    return { ...desk, lamp: this.lamp ?? desk.lamp, calendar: this.calendar ?? desk.calendar }
  }

  /** what the hands move on the desk now */
  shown(t: number, reduced: boolean): TouchShown {
    const u = (kind: TouchKind) => {
      const c = this.cur.get(TOUCH_SEAT[kind])
      return c && c.kind === kind ? t - c.t0 : null
    }
    const D = Math.PI / 180
    // the hourglass: turned between the fingers while lifted
    const hg = hourglassAt(u('hourglass'), reduced)
    const tu = u('turntable')
    const push = tu === null ? 0 : reduced ? (tu >= TURNTABLE_PUSH.from ? 1 : 0) : ease((tu - TURNTABLE_PUSH.from) / TURNTABLE_PUSH.s)
    const ku = u('knob')
    const knob = ku === null ? 0 : reduced ? (ku >= KNOB_TURN.from ? 1 : 0) : ease((ku - KNOB_TURN.from) / KNOB_TURN.s)
    return {
      hourglassTurn: (this.flips + hg.turn) * Math.PI,
      hourglassLift: hg.lift,
      turntablePush: (this.pushes + push) * TURNTABLE_PUSH.deg * D,
      knobTurn: (this.knobAt + this.knobDir * KNOB_TURN.deg * knob) * D,
      calendarPage: calendarPage(u('calendar'), reduced),
    }
  }
}

/** the hourglass at `u` s of its touch: the part of its half turn done (0..1) and its lift, m (null: not touched) */
export function hourglassAt(u: number | null, reduced: boolean): { turn: number; lift: number } {
  if (u === null) return { turn: 0, lift: 0 }
  const F = HOURGLASS_FLIP
  const s = u - F.from
  if (reduced) return { turn: u >= TOUCH_S.hourglass.at ? 1 : 0, lift: 0 }
  const turn = ease((s - F.lift) / F.turn)
  const lift = s < 0 ? 0 : s < F.lift ? ease(s / F.lift) : s < F.lift + F.turn ? 1 : 1 - ease((s - F.lift - F.turn) / F.down)
  return { turn, lift: Math.max(0, lift) * F.m }
}

/** the calendar page's flip at `u` s of the touch (degrees of its baked flip_deg), or null when it is not shown */
export function calendarPage(u: number | null, reduced: boolean, flipDeg = 321.4): number | null {
  if (u === null || reduced) return null
  const C = CALENDAR_FLIP
  const s = u - C.from
  if (s < 0) return null
  if (s < C.s) return C.liftDeg * ease(s / C.s)
  const f = (s - C.s) / C.fallS
  return f >= 1 ? null : C.liftDeg + (flipDeg - C.liftDeg) * ease(f)
}

/** a habit's seeded times in the office hour `h` (ms), `HABIT_PER_HOUR` of them (working / resting), at least NO_REPEAT_S apart */
export function habitTimes(kind: TouchKind, h: number, mode: 'work' | 'rest' = 'work'): number[] {
  const n = HABIT_PER_HOUR[kind]?.[mode] ?? 0
  if (n === 0) return []
  const slot = 3_600_000 / Math.max(1, n)
  const out: number[] = []
  for (let k = 0; k < n; k++) out.push(h * 3_600_000 + k * slot + (hash(`${kind}|${mode}|${h}|${k}`) % Math.floor(slot - NO_REPEAT_S * 1000)))
  return out
}
