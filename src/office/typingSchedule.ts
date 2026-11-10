// Who presses which key when (#225, docs/design/typing.md). Pure and deterministic: no scene, no clock of its own.
//
// A "chunk" is 12 s of the scene clock (the replay's tau while the timelapse plays) for one agent and one activity. Everything in it is made
// from a seed of (agent, chunk number, activity mode, mouse or not), so seeking the replay, or two visitors, see exactly the same keys.
// Times in a chunk are absolute scene seconds. At a timelapse speed the whole schedule is stretched by `dilation` (the viewer sees a real-time
// rhythm, fewer and longer presses per scene second instead of a flicker, #158).
//
// What a chunk holds:
//  - keys: every press, with the hand and finger that makes it (standard touch-typing fingering, thumbs on the space bar) and its time
//    `t` = the moment the key reaches its actuation point (the 2 mm of 4, typing.md 5; this is the moment the sound plays),
//    `hold` = how long the finger keeps it down (overlapping presses = the next key goes down before this one is released),
//  - mouse: down / up / wheel events of the episodes where the right hand is on the mouse, with the episode windows,
//  - slides: how the hand moves the mouse body in those episodes (cursor moves 1-4 cm in 0.15-0.35 s, a drag while a button is held, back to rest at the end; the wheel rolls with the body still),
//  - events: the above flattened and sorted by time (key, keyUp, mouse) for the input bus (inputEvents.ts).

export type KeyKind = 'char' | 'space' | 'enter' | 'backspace' | 'mod'
export type Hand = 'l' | 'r'
/** 0 = index … 3 = little, 4 = thumb */
export type FingerNo = 0 | 1 | 2 | 3 | 4
export interface Fingering {
  hand: Hand
  finger: FingerNo
}

// ------------------------------------------------------------------------------------------------------------ fingering

const FINGER_KEYS: Record<Hand, Record<FingerNo, string[]>> = {
  l: {
    3: ['Backquote', 'Digit1', 'KeyQ', 'KeyA', 'KeyZ', 'Tab', 'CapsLock', 'ShiftLeft', 'ControlLeft', 'Escape'],
    2: ['Digit2', 'KeyW', 'KeyS', 'KeyX'],
    1: ['Digit3', 'KeyE', 'KeyD', 'KeyC'],
    0: ['Digit4', 'Digit5', 'KeyR', 'KeyT', 'KeyF', 'KeyG', 'KeyV', 'KeyB'],
    4: ['AltLeft', 'MetaLeft'],
  },
  r: {
    3: ['Digit0', 'Minus', 'Equal', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Slash', 'Backspace', 'Enter', 'ShiftRight'],
    2: ['Digit9', 'KeyO', 'KeyL', 'Period'],
    1: ['Digit8', 'KeyI', 'KeyK', 'Comma'],
    0: ['Digit6', 'Digit7', 'KeyY', 'KeyU', 'KeyH', 'KeyJ', 'KeyN', 'KeyM'],
    4: ['Space', 'AltRight', 'MetaRight'],
  },
}

/** the code -> hand and finger table of typing.md 2 */
export const FINGERING: Readonly<Record<string, Fingering>> = (() => {
  const out: Record<string, Fingering> = {}
  for (const hand of ['l', 'r'] as const) for (const f of [0, 1, 2, 3, 4] as const) for (const code of FINGER_KEYS[hand][f]) out[code] = { hand, finger: f }
  return out
})()

/** the home row: where the fingers rest (typing.md 2); the thumbs rest over the space bar */
export const HOME: Record<Hand, Record<0 | 1 | 2 | 3, string>> = {
  l: { 0: 'KeyF', 1: 'KeyD', 2: 'KeyS', 3: 'KeyA' },
  r: { 0: 'KeyJ', 1: 'KeyK', 2: 'KeyL', 3: 'Semicolon' },
}

export const kindOf = (code: string): KeyKind => (code === 'Space' ? 'space' : code === 'Enter' ? 'enter' : code === 'Backspace' ? 'backspace' : code === 'ControlLeft' || code === 'ShiftLeft' || code === 'ShiftRight' || code === 'AltLeft' ? 'mod' : 'char')

// --------------------------------------------------------------------------------------------------------------- random

/** a string as a 32-bit seed (FNV-1a) */
export function seedOf(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
/** mulberry32 */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ------------------------------------------------------------------------------------------------------ people and work

/** how one agent types (typing.md 3, "에이전트 차이") */
export interface Persona {
  /** mean time between two keys of a word, s */
  gap: number
  /** the share of in-word keys that go down before the one before comes up */
  overlap: number
  /** how much longer the thinking pauses are */
  pauseMul: number
  /** the chance a word has a typo to fix */
  typo: number
  /** how much longer its mouse work lasts */
  mouseMul: number
}
const NORMAL: Persona = { gap: 0.23, overlap: 0.3, pauseMul: 1, typo: 0.1, mouseMul: 1 }
export const PERSONAS: Record<string, Persona> = {
  agent_0: NORMAL, // 메모: normal
  agent_1: { gap: 0.25, overlap: 0.25, pauseMul: 1.6, typo: 0.12, mouseMul: 1.7 }, // 메시: slower, longer pauses, 3D work is mostly mouse
  agent_2: { ...NORMAL, typo: 0.22 }, // 휴: normal, rewrites a lot
  agent_3: { gap: 0.17, overlap: 0.45, pauseMul: 0.8, typo: 0.08, mouseMul: 1 }, // 루프: the fast one
  agent_4: { ...NORMAL, pauseMul: 1.5 }, // 에코: normal, long pauses (listening)
}
export const personaOf = (agent: string): Persona => PERSONAS[agent] ?? NORMAL

/** what the work does with the hands (typing.md 4): which segments alternate */
export type Mode = 'edit' | 'read' | 'cmd' | 'think' | 'delegate'
export function modeOf(activity: string | undefined): Mode {
  switch (activity) {
    case 'read':
      return 'read'
    case 'run':
    case 'test':
    case 'build':
    case 'install':
    case 'git':
    case 'other':
      return 'cmd'
    case 'think':
      return 'think'
    case 'delegate':
      return 'delegate'
    default:
      return 'edit'
  }
}

// --------------------------------------------------------------------------------------------------------------- types

export interface KeyPress {
  code: string
  hand: Hand
  finger: FingerNo
  kind: KeyKind
  /** the actuation moment, scene s */
  t: number
  /** how long the key is held (from its actuation to its release), s */
  hold: number
  /** part of a shortcut (Ctrl + a letter) */
  shortcut?: boolean
  /** hand + finger + code: the key of this press in the fit tables (made once, so a frame builds no strings) */
  fid: string
}
export interface MouseAct {
  t: number
  kind: 'down' | 'up' | 'wheel'
  button: 'l' | 'r'
  /** wheel: always 1 (one notch per event); `dir` says which way */
  ticks?: number
  dir?: 1 | -1
}
/**
 * The mouse body moves (#305): a slide of the body across its pad, by (dx, dz) from where it is (metres in the body's rest frame, x right, z
 * toward the typist), `home` = back to where it rests. Not an input event (the bus only knows down / up / wheel): a drag is a `down`, a slide
 * with `drag`, an `up`. The body's real offset is these integrated and clamped to the pad (mouseBody.ts slideTargets).
 */
export interface MouseSlide {
  t0: number
  t1: number
  dx: number
  dz: number
  home?: boolean
  /** made while a button is held */
  drag?: boolean
}
export interface Episode {
  /** the right hand starts for the mouse / is let go, scene s */
  t0: number
  t1: number
  /** the left fingers tap while the right hand waits (a command is running) */
  tap?: boolean
}
export type SchedEvent =
  | { t: number; type: 'key' | 'keyUp'; code: string; kind: KeyKind }
  | { t: number; type: 'mouse'; kind: 'down' | 'up' | 'wheel'; button: 'l' | 'r'; ticks?: number; dir?: 1 | -1 }

export interface Chunk {
  agent: string
  index: number
  mode: Mode
  dilation: number
  /** the chunk's window on the scene clock, s */
  t0: number
  t1: number
  keys: KeyPress[]
  /** each hand's presses by finger (0 … 4), in time order */
  byFinger: Record<Hand, KeyPress[][]>
  mouse: MouseAct[]
  /** the body's slides, in time order; every episode that has any ends with one `home` */
  slides: MouseSlide[]
  episodes: Episode[]
  events: SchedEvent[]
  /** the stops of the typing longer than 1.5 s (a thinking pause, a rest), and what the free hand does in some of them */
  pauses: { t0: number; t1: number }[]
  gestures: Gesture[]
}

/** a think habit (typing.md): a hand to the chin, or a finger tapping the head above the ear; `t0`..`t1` is the whole move (up, held, back) */
export interface Gesture {
  kind: 'chin' | 'tap'
  hand: Hand
  t0: number
  t1: number
}
/** the share of long pauses with a gesture, and each person's chance of the chin rest over the head tap (the rest tap) */
export const GESTURE_RATE = 0.3
export const CHIN_PREFER: Record<string, number> = { agent_0: 0.25, agent_1: 0.75, agent_2: 0.75, agent_3: 0.25, agent_4: 0.75 }
export const GESTURE_MIN_PAUSE_S = 1.5
export const TAP_S = 0.15

export const CHUNK_S = 12

// -------------------------------------------------------------------------------------------------------------- words

/** letter frequencies (English, per mille) */
const LETTERS: [string, number][] = [
  ['e', 127], ['t', 91], ['a', 82], ['o', 75], ['i', 70], ['n', 67], ['s', 63], ['h', 61], ['r', 60], ['d', 43], ['l', 40], ['c', 28], ['u', 28],
  ['m', 24], ['w', 24], ['f', 22], ['g', 20], ['y', 20], ['p', 19], ['b', 15], ['v', 10], ['k', 8], ['x', 2], ['j', 1], ['q', 1], ['z', 1],
]
const LETTER_TOTAL = LETTERS.reduce((a, [, w]) => a + w, 0)
const LEN_W = [0, 0, 0, 22, 22, 20, 15, 10, 7, 4]

function pickLetter(rng: () => number): string {
  let r = rng() * LETTER_TOTAL
  for (const [c, w] of LETTERS) if ((r -= w) <= 0) return `Key${c.toUpperCase()}`
  return 'KeyE'
}
function wordLen(rng: () => number): number {
  let r = rng() * LEN_W.reduce((a, b) => a + b, 0)
  for (let n = 3; n < LEN_W.length; n++) if ((r -= LEN_W[n]) <= 0) return n
  return 4
}
/** a made-up word: no key twice in a row */
export function fakeWord(rng: () => number, n: number): string[] {
  const out: string[] = []
  while (out.length < n) {
    const c = pickLetter(rng)
    if (c !== out[out.length - 1]) out.push(c)
  }
  return out
}
const COMMAND_CHARS = ['Period', 'Minus', 'Slash', 'Digit1', 'Digit2', 'Digit3', 'Digit0']

// ----------------------------------------------------------------------------------------------------------- the maker

const MIN_SAME_FINGER = 0.2
/** the last key of a chunk is down by this, s into it (its release and the finger's way home must fit before the chunk ends) */
const LAST_KEY_AT = 11.2
const LAST_MOUSE_AT = 11.1

interface Builder {
  rng: () => number
  p: Persona
  keys: KeyPress[]
  mouse: MouseAct[]
  episodes: Episode[]
  /** the unit-time cursor, s into the chunk */
  at: number
  /** the last press time of each hand and finger (the same finger is never re-pressed within MIN_SAME_FINGER) */
  last: Record<string, number>
  prev: KeyPress | null
  /** the chunk is full: no more keys */
  over: boolean
  /** words until the next thinking pause / the next line end (kept over the segments of a chunk) */
  pauseIn: number
  pauses: { t0: number; t1: number }[]
  enterIn: number
}

const U = (b: Builder, lo: number, hi: number) => lo + (hi - lo) * b.rng()
const fingerKey = (h: Hand, f: FingerNo) => h + f

/** add one key at the cursor time `b.at + dt` (dt already includes the pause before it); returns the press */
function press(b: Builder, code: string, dt: number, o: { roll?: boolean; hold?: number; shortcut?: boolean } = {}): KeyPress | null {
  const fg = FINGERING[code]
  let t = b.at + dt
  const lastSame = b.last[fingerKey(fg.hand, fg.finger)]
  if (lastSame !== undefined && t < lastSame + MIN_SAME_FINGER) t = lastSame + MIN_SAME_FINGER
  const kp: KeyPress = { code, hand: fg.hand, finger: fg.finger, kind: kindOf(code), t, hold: o.hold ?? U(b, 0.07, 0.12), fid: '', ...(o.shortcut ? { shortcut: true } : {}) }
  // the one before may be held on until this goes down (a roll): only another finger, only inside a run of keys; otherwise it is up before this
  const pv = b.prev
  if (pv && !pv.shortcut) {
    const gap = kp.t - pv.t
    if (o.roll && (pv.finger !== kp.finger || pv.hand !== kp.hand)) pv.hold = gap + U(b, 0.015, 0.05)
    else if (pv.hold > gap - 0.02) pv.hold = Math.max(0.04, gap - 0.02)
  }
  // a key that would land too late for its chunk is never typed (the person stopped)
  if (kp.t > LAST_KEY_AT) {
    b.over = true
    return null
  }
  b.keys.push(kp)
  b.last[fingerKey(fg.hand, fg.finger)] = kp.t
  b.at = kp.t
  b.prev = kp
  return kp
}

/** time to the next key inside a word: the person's pace, +40 ms on the same hand, -30 ms alternating (typing.md 3) */
function keyGap(b: Builder, code: string): number {
  const pv = b.prev
  let g = b.p.gap + 0.015 + (b.rng() - 0.5) * 0.22
  if (pv) g += FINGERING[code].hand === pv.hand ? 0.04 : -0.03
  return Math.min(0.38, Math.max(0.12, g))
}

/** Ctrl + a key: two events, the modifier first and held until the key is down */
function shortcut(b: Builder, code: string, finger?: FingerNo) {
  if (b.at + 1 > LAST_KEY_AT) return
  const ctrl = press(b, 'ControlLeft', U(b, 0.3, 0.5), { hold: 0.4, shortcut: true })
  if (!ctrl) return
  const k = press(b, code, U(b, 0.12, 0.2), { hold: U(b, 0.09, 0.13), shortcut: true })
  if (!k) {
    ctrl.hold = 0.1
    return
  }
  if (finger !== undefined) k.finger = finger
  ctrl.hold = k.t + k.hold + U(b, 0.02, 0.06) - ctrl.t
  b.prev = null
}

/** a run of words; stops at `until` (cursor seconds) or after `words` words */
function typeWords(b: Builder, o: { until: number; words: number; endEnter?: boolean; command?: boolean; shortcuts?: boolean }) {
  const { rng, p } = b
  for (let w = 0; w < o.words && !b.over; w++) {
    const len = o.command ? 2 + Math.floor(rng() * 5) : wordLen(rng)
    // a word that would not fit is not started
    if (b.at + 0.3 > o.until || b.at + 0.3 + (len + 1) * 0.2 > LAST_KEY_AT) break
    const letters = fakeWord(rng, len)
    if (o.command && rng() < 0.25) letters[Math.floor(rng() * letters.length)] = COMMAND_CHARS[Math.floor(rng() * COMMAND_CHARS.length)]
    // a typo: wrong letters, a short look, as many backspaces, then the rest of the word
    const typoAt = !o.command && len >= 4 && rng() < p.typo ? 1 + Math.floor(rng() * (len - 2)) : -1
    // 30% of the keys of a word go down before the one before is up (another finger only); those come closer together
    const next = (code: string, first: boolean, pause: number) => {
      const fg = FINGERING[code]
      const pv = b.prev
      const roll = !first && !!pv && (pv.finger !== fg.finger || pv.hand !== fg.hand) && b.rng() < p.overlap
      press(b, code, first ? pause : roll ? U(b, 0.12, 0.2) : keyGap(b, code), { roll })
    }
    for (let i = 0; i < letters.length; i++) {
      next(letters[i], i === 0, w === 0 ? 0.25 : 0.28)
      if (i === typoAt) {
        const n = 1 + Math.floor(rng() * 3)
        for (let k = 0; k < n; k++) next(pickLetter(rng), false, 0)
        b.at += 0.3 + rng() * 0.2
        for (let k = 0; k < n; k++) press(b, 'Backspace', 0.12 + rng() * 0.08)
      }
    }
    press(b, 'Space', 0.23 + (rng() - 0.5) * 0.12, { roll: !!b.prev && rng() < p.overlap, hold: 0.1 })
    if (o.shortcuts && rng() < 0.05) {
      const pick = ['KeyS', 'KeyC', 'KeyV', 'KeyZ'][Math.floor(rng() * 4)]
      shortcut(b, pick, pick === 'KeyZ' ? 2 : undefined)
    }
    if (!o.command && --b.enterIn <= 0) {
      press(b, 'Enter', 0.3)
      b.at += 0.4
      b.enterIn = 10 + Math.floor(rng() * 11)
    }
    if (--b.pauseIn <= 0) {
      const pause = (0.8 + rng() * 1.7) * p.pauseMul
      // a pause is a thinking stop inside the typing, not the last thing before the hand leaves
      if (b.at + pause + 0.6 < o.until) {
        b.pauses.push({ t0: b.at, t1: b.at + pause + 0.28 })
        b.at += pause
        b.pauseIn = 4 + Math.floor(rng() * 5)
      }
    }
  }
  if (o.endEnter && !b.over) {
    press(b, 'Enter', 0.3)
    b.at += 0.4
  }
  b.prev = null
}


/** one episode on the mouse: the right hand goes over (the stage's approach and closing), acts, lets go */
function mouseEpisode(b: Builder, o: { len: number; clicks: number; wheel: number; drag?: boolean; tap?: boolean; wheelDir?: number }) {
  const { rng } = b
  // the hand leaves the keys a moment after the last one
  const t0 = b.at + 0.25
  let t = t0 + 0.55
  const acts: MouseAct[] = []
  const click = (button: 'l' | 'r', hold: number) => {
    acts.push({ t, kind: 'down', button })
    acts.push({ t: t + hold, kind: 'up', button })
    t += hold + 0.12 + rng() * 0.5
  }
  const scroll = () => {
    const n = 2 + Math.floor(rng() * 3)
    const dir: 1 | -1 = rng() < (o.wheelDir ?? 0.8) ? 1 : -1
    for (let k = 0; k < n; k++) {
      acts.push({ t, kind: 'wheel', button: 'l', ticks: 1, dir })
      t += 0.12 + rng() * 0.05
    }
    t += 0.4 + rng() * 1.0
  }
  const stepsOf: ('c' | 'w')[] = []
  for (let k = 0; k < o.clicks; k++) stepsOf.push('c')
  for (let k = 0; k < o.wheel; k++) stepsOf.push('w')
  // clicks and scrolls in a seeded order
  for (let i = stepsOf.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[stepsOf[i], stepsOf[j]] = [stepsOf[j], stepsOf[i]]
  }
  for (const s of stepsOf) {
    if (t > LAST_MOUSE_AT - 0.3) break
    if (s === 'w') scroll()
    else if (o.drag && rng() < 0.5) click('l', 0.5 + rng() * 0.5)
    else click(rng() < 0.1 ? 'r' : 'l', 0.07 + rng() * 0.06)
  }
  const end = Math.max(t, t0 + o.len)
  const t1 = Math.min(end + 0.2, LAST_MOUSE_AT + 0.3)
  b.mouse.push(...acts.filter((a) => a.t < t1 - 0.2))
  b.episodes.push({ t0, t1, ...(o.tap ? { tap: true } : {}) })
  b.at = t1 + 0.1
}

/** a cursor move's length range, m, and duration range, s */
const SLIDE_LEN = [0.01, 0.04] as const
const SLIDE_S = [0.15, 0.35] as const
/** how far from rest the wandering cursor is pulled back */
const SLIDE_ROAM = 0.05

/**
 * The slides of the episodes, in the chunk's unit time, from their own random stream (so they never move a key or a click): a cursor move in each
 * gap between the acts that is long enough, a drag-slide inside every held button, nothing while the index is on the wheel (the wheel rolls
 * under the finger, the body still), and the last slide of an episode is the way home.
 */
function planSlides(b: Builder, rng: () => number): MouseSlide[] {
  const out: MouseSlide[] = []
  for (const ep of b.episodes) {
    const acts = b.mouse.filter((m) => m.t >= ep.t0 && m.t <= ep.t1)
    const blocked: [number, number][] = []
    const drags: [number, number][] = []
    const wheels = acts.filter((m) => m.kind === 'wheel')
    for (const a of acts) {
      if (a.kind !== 'down') continue
      const up = acts.find((m) => m.kind === 'up' && m.button === a.button && m.t > a.t)
      const end = up ? up.t : a.t + 0.1
      blocked.push([a.t - 0.05, end + 0.05])
      if (end - a.t >= 0.45) drags.push([a.t, end])
    }
    // the index goes to the wheel 0.4 s before its first notch and leaves 0.45 s after the last
    if (wheels.length) blocked.push([wheels[0].t - 0.45, wheels[wheels.length - 1].t + 0.5])
    blocked.sort((p, q) => p[0] - q[0])
    const gaps: [number, number][] = []
    let at = ep.t0 + 0.55
    for (const [s, e] of blocked) {
      if (s > at) gaps.push([at, s])
      at = Math.max(at, e)
    }
    if (ep.t1 - 0.15 > at) gaps.push([at, ep.t1 - 0.15])
    // where the cursor wanders now (rest frame), so it is pulled back toward rest past SLIDE_ROAM
    let px = 0
    let pz = 0
    const make = (t0: number, dur: number, drag: boolean): MouseSlide => {
      let a = rng() * Math.PI * 2
      const len = SLIDE_LEN[0] + (SLIDE_LEN[1] - SLIDE_LEN[0]) * rng()
      if (Math.hypot(px + Math.cos(a) * len, pz + Math.sin(a) * len) > SLIDE_ROAM) a = Math.atan2(-pz, -px) + (rng() - 0.5) * 1.2
      const dx = +(Math.cos(a) * len).toFixed(4)
      const dz = +(Math.sin(a) * len).toFixed(4)
      px += dx
      pz += dz
      return { t0, t1: t0 + dur, dx, dz, ...(drag ? { drag: true } : {}) }
    }
    // the windows first (a drag-slide inside each held button, a cursor move in each long enough gap), then the moves in time order
    const wins: { t0: number; dur: number; drag: boolean }[] = []
    // (a drag ends before the index sets off for the wheel)
    const wheelFrom = wheels.length ? wheels[0].t - 0.45 : Infinity
    for (const [d, u] of drags) {
      const dur = Math.min(SLIDE_S[1], Math.min(u - 0.08, wheelFrom) - (d + 0.12))
      if (dur >= SLIDE_S[0]) wins.push({ t0: d + 0.12, dur, drag: true })
    }
    for (const [g0, g1] of gaps) {
      if (g1 - g0 < SLIDE_S[0] + 0.1) continue
      if (rng() < 0.15) continue
      const dur = Math.min(SLIDE_S[0] + (SLIDE_S[1] - SLIDE_S[0]) * rng(), g1 - g0 - 0.06)
      wins.push({ t0: g0 + 0.03 + rng() * (g1 - g0 - dur - 0.06), dur, drag: false })
    }
    wins.sort((p, q) => p.t0 - q.t0)
    const mine = wins.map((w) => make(w.t0, w.dur, w.drag))
    // the episode ends with the body at rest: a slide home after the last one if there is room before the hand lets go; else the last one itself
    // comes home (when the walk has others); a lone slide with no room to come back is dropped
    while (mine.length) {
      const last = mine[mine.length - 1]
      // the first free moment after it: not while a button is down, not while the index is on the wheel
      let from = last.t1 + 0.03
      for (let k = 0; k < blocked.length; k++) if (from < blocked[k][1] && from + 0.2 > blocked[k][0]) from = blocked[k][1] + 0.01
      const room = ep.t1 - 0.15 - from
      if (room >= 0.2) {
        mine.push({ t0: from, t1: from + Math.min(0.3, room), dx: 0, dz: 0, home: true })
        break
      }
      if (mine.length >= 2) {
        mine[mine.length - 1] = { ...last, home: true }
        break
      }
      mine.pop()
    }
    out.push(...mine)
  }
  return out
}

/** the plan of a chunk in its unit time (typing.md 4) */
function plan(b: Builder, mode: Mode, mouse: boolean) {
  const { rng, p } = b
  const M = p.mouseMul
  const room = () => LAST_KEY_AT - b.at
  b.at = 0.3 + rng() * 0.6
  const rest = (s: number) => {
    b.pauses.push({ t0: b.at, t1: b.at + s })
    b.at += s
  }
  let guard = 0
  while (b.at < LAST_KEY_AT - 1 && guard++ < 20) {
    if (mode === 'edit') {
      typeWords(b, { until: Math.min(LAST_KEY_AT, b.at + U(b, 4.5, 7)), words: 40, shortcuts: true })
      if (b.at > LAST_MOUSE_AT - 1) break
      if (mouse) mouseEpisode(b, { len: U(b, 0.6, 1.2) * M, clicks: rng() < 0.7 ? 1 : 2, wheel: rng() < 0.3 ? 1 : 0, drag: rng() < 0.25 })
      else rest(U(b, 0.6, 1.2))
    } else if (mode === 'read') {
      if (mouse) mouseEpisode(b, { len: U(b, 4.5, 6.5), clicks: rng() < 0.4 ? 1 : 0, wheel: 3 + Math.floor(rng() * 2) })
      else rest(U(b, 3, 5))
      if (b.at > LAST_KEY_AT - 2) break
      // now and then Ctrl+F and a word
      if (rng() < 0.7) {
        shortcut(b, 'KeyF')
        typeWords(b, { until: Math.min(LAST_KEY_AT, b.at + 2), words: 1, endEnter: true })
      }
    } else if (mode === 'cmd') {
      if (room() < 4) break
      typeWords(b, { until: Math.min(LAST_KEY_AT, b.at + 5.5), words: 2 + Math.floor(rng() * 3), command: true, endEnter: true })
      if (b.at > LAST_MOUSE_AT - 1.5) break
      if (mouse) mouseEpisode(b, { len: U(b, 4, 6.5), clicks: 0, wheel: 3, tap: true })
      else rest(U(b, 3, 5))
    } else if (mode === 'think') {
      rest(U(b, 4, 8))
      if (b.at > LAST_MOUSE_AT - 1.5) break
      if (mouse && rng() < 0.7) mouseEpisode(b, { len: U(b, 0.8, 1.4), clicks: 1, wheel: 0 })
    } else {
      // delegate: a short message, then two clicks
      typeWords(b, { until: Math.min(LAST_KEY_AT, b.at + 4), words: 6 + Math.floor(rng() * 4), endEnter: false })
      if (b.at > LAST_MOUSE_AT - 1.5) break
      if (mouse) mouseEpisode(b, { len: U(b, 1.5, 3), clicks: 2, wheel: 0 })
      else rest(U(b, 1, 2))
    }
  }
}

export interface ChunkOpts {
  /** the timelapse stretch: 1 = real time (default), 4 = at x4 ... */
  dilation?: number
  /** the desk has a mouse (desk 2 does not) */
  mouse?: boolean
}

/** the chunk of this number: deterministic in (agent, index, mode, mouse), only the time axis depends on the dilation */
export function makeChunk(agent: string, index: number, activity: string | undefined, o: ChunkOpts = {}): Chunk {
  const d = Math.max(1, o.dilation ?? 1)
  const mouse = o.mouse ?? true
  const mode = modeOf(activity)
  const b: Builder = { rng: rngOf(seedOf(`${agent}|${index}|${mode}|${mouse ? 'm' : 'k'}`)), p: personaOf(agent), keys: [], mouse: [], episodes: [], at: 0, last: {}, prev: null, over: false, pauseIn: 0, enterIn: 0, pauses: [] }
  b.pauseIn = 2 + Math.floor(b.rng() * 6)
  b.enterIn = 1 + Math.floor(b.rng() * 20)
  plan(b, mode, mouse)
  const t0 = index * CHUNK_S * d
  const at = (s: number) => t0 + s * d
  // the gestures: its own random stream, so they never move a key
  const g = rngOf(seedOf(`${agent}|${index}|${mode}|${mouse ? 'm' : 'k'}|gesture`))
  const gestures: Gesture[] = []
  const longPauses = b.pauses.filter((q) => q.t1 - q.t0 >= GESTURE_MIN_PAUSE_S)
  for (const q of longPauses) {
    const hit = g() < GESTURE_RATE
    const chin = g() < (CHIN_PREFER[agent] ?? 0.5)
    let hand: Hand = g() < 0.5 ? 'l' : 'r'
    if (!hit) continue
    const s = q.t0 + 0.15
    const e = q.t1 - 0.4
    const len = chin ? Math.min(e - s, 4) : 0.3 + 2 * TAP_S + 0.3
    if (e - s < (chin ? 1 : len)) continue
    // the right hand may be needed on the mouse: then the left one thinks
    if (b.episodes.some((ep) => ep.t0 < s + len + 0.7 && ep.t1 > s - 0.7)) hand = 'l'
    gestures.push({ kind: chin ? 'chin' : 'tap', hand, t0: at(s), t1: at(s + len) })
  }
  const keys = b.keys.map((k) => ({ ...k, t: at(k.t), hold: k.hold * d, fid: `${k.hand}${k.finger}${k.code}` }))
  const mice = b.mouse.map((m) => ({ ...m, t: at(m.t) }))
  // the body's slides: their own random stream too
  const slides = planSlides(b, rngOf(seedOf(`${agent}|${index}|${mode}|${mouse ? 'm' : 'k'}|slide`))).map((s) => ({ ...s, t0: at(s.t0), t1: at(s.t1) }))
  const episodes = b.episodes.map((e) => ({ ...e, t0: at(e.t0), t1: at(e.t1) }))
  const byFinger: Chunk['byFinger'] = { l: [[], [], [], [], []], r: [[], [], [], [], []] }
  for (const k of keys) byFinger[k.hand][k.finger].push(k)
  const events: SchedEvent[] = []
  for (const k of keys) {
    events.push({ t: k.t, type: 'key', code: k.code, kind: k.kind })
    events.push({ t: k.t + k.hold, type: 'keyUp', code: k.code, kind: k.kind })
  }
  for (const m of mice) events.push({ t: m.t, type: 'mouse', kind: m.kind, button: m.button, ...(m.kind === 'wheel' ? { ticks: m.ticks ?? 1, dir: m.dir ?? 1 } : {}) })
  events.sort((a, c) => a.t - c.t)
  return { agent, index, mode, dilation: d, t0, t1: t0 + CHUNK_S * d, keys, byFinger, mouse: mice, slides, episodes, events, pauses: longPauses.map((q) => ({ t0: at(q.t0), t1: at(q.t1) })), gestures }
}

export const chunkIndexAt = (t: number, dilation = 1) => Math.floor(t / (CHUNK_S * Math.max(1, dilation)))

/** a few chunks kept per agent (the scene asks for the same one every frame) */
export class ChunkCache {
  private m = new Map<string, Chunk>()
  get(agent: string, activity: string | undefined, index: number, o: ChunkOpts = {}): Chunk {
    const key = `${agent}|${index}|${modeOf(activity)}|${o.mouse ?? true}|${Math.max(1, o.dilation ?? 1)}`
    let c = this.m.get(key)
    if (!c) {
      if (this.m.size > 40) this.m.clear()
      c = makeChunk(agent, index, activity, o)
      this.m.set(key, c)
    }
    return c
  }
}

// ------------------------------------------------------------------------------------------------------------ the press

export const PRESS_IN_S = 0.04
export const PRESS_OUT_S = 0.06
/** the keycap's press, 0 (up) .. 1 (down) at time t: in over 40 ms ending 20 ms after the actuation, held, out over 60 ms with a small overshoot (typing.md 5) */
export function pressAt(k: { t: number; hold: number }, t: number, d = 1): number {
  const s = k.t - (PRESS_IN_S / 2) * d
  if (t < s) return 0
  const u = (t - s) / (PRESS_IN_S * d)
  if (u < 1) return u
  const r = k.t + k.hold
  if (t < r) return 1
  const v = (t - r) / (PRESS_OUT_S * d)
  if (v >= 1) return 0
  return 1 - v * v * (3 - 2 * v) - 0.09 * Math.sin(Math.PI * v) * v
}
