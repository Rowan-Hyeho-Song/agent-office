// The wrap-up (#186) as real work: write the cards at the desk, carry them to the board, post them, tidy up, then rest.
// Pure and deterministic: a small state machine fed with the clock, who is where, and whether the board is taken, and
// the one place that says what the agent is doing now (the display reads `view`, never the raw status).
// The design: issue #186 "정리 단계 순서 · 시간 · 손".

import type { AgentStatus } from './status'

export type WrapStep = 'seat' | 'write' | 'walk' | 'post' | 'tidy'

/** what each step shows after "정리 중 › #n · " */
export const WRAP_LABEL: Record<WrapStep, string> = {
  seat: '자리로 돌아가는 중',
  write: '카드 쓰는 중',
  walk: '카드 붙이러 가는 중',
  post: '카드 붙이는 중',
  tidy: '자리 정돈 중',
}
export const REREAD_LABEL = '카드 다시 읽는 중'

export const WRAP = {
  /** cards per wrap-up: 1..3 */
  maxCards: 3,
  /** s of writing per card, the last PUSH of it pushing the card onto the left stack */
  card: 2.5,
  push: 0.3,
  /** posting: pick the top card, put it to its place, press the centre with the thumb base, let go (1.2 s), and the gap */
  pick: 0.3,
  place: 0.55,
  press: 0.2,
  release: 0.15,
  gap: 0.3,
  look: 0.4,
  /** tidying: gather the papers, tap them (each), push the keyboard in, lean back (1.6 s with two taps) */
  gather: 0.3,
  tap: 0.25,
  keys: 0.3,
  lean: 0.5,
  /** waiting beside a taken board this long sends the agent back to its desk */
  waitMs: 20000,
  /** the re-read loop, s */
  reread: 2,
} as const

export type BeatKind = 'write' | 'push' | 'reread' | 'pick' | 'place' | 'press' | 'release' | 'gap' | 'look' | 'gather' | 'tap' | 'keys' | 'lean'
export interface Beat {
  kind: BeatKind
  /** the card it is about (0-based) */
  k: number
  dur: number
}

/** cards to write: 1..3, fixed by the wrap-up's own start */
export const wrapCards = (agent: string, since: number): number => {
  let h = 2166136261
  for (const c of `${agent}|${since}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return 1 + ((h >>> 0) % WRAP.maxCards)
}

/**
 * The beats of a step. `gm` is the replay's gesture minimum (s of scene time, 0 live): a gesture shorter than it is played
 * that long, and at x16 (gm >= 2.4) the tidy-up taps once (#158).
 */
export function beatsOf(step: 'write' | 'post' | 'tidy', n: number, gm = 0): Beat[] {
  const g = (d: number) => Math.max(d, gm)
  const out: Beat[] = []
  if (step === 'write') {
    for (let k = 0; k < n; k++) out.push({ kind: 'write', k, dur: WRAP.card - WRAP.push }, { kind: 'push', k, dur: g(WRAP.push) })
  } else if (step === 'post') {
    for (let k = 0; k < n; k++) {
      if (k > 0) out.push({ kind: 'gap', k, dur: WRAP.gap })
      out.push({ kind: 'pick', k, dur: g(WRAP.pick) }, { kind: 'place', k, dur: g(WRAP.place) }, { kind: 'press', k, dur: g(WRAP.press) }, { kind: 'release', k, dur: g(WRAP.release) })
    }
    out.push({ kind: 'look', k: n - 1, dur: g(WRAP.look) })
  } else {
    out.push({ kind: 'gather', k: 0, dur: WRAP.gather })
    const taps = gm >= 2.4 ? 1 : 2
    for (let i = 0; i < taps; i++) out.push({ kind: 'tap', k: i, dur: g(WRAP.tap) })
    out.push({ kind: 'keys', k: 0, dur: g(WRAP.keys) }, { kind: 'lean', k: 0, dur: g(WRAP.lean) })
  }
  return out
}
export const totalOf = (beats: Beat[]) => beats.reduce((a, b) => a + b.dur, 0)

/** the beat at `e` s into the step, and how far into it (0..1); past the end it is the last beat at 1 */
export function beatAt(beats: Beat[], e: number): { beat: Beat; u: number } {
  let t = Math.max(0, e)
  for (const b of beats) {
    if (t < b.dur) return { beat: b, u: b.dur > 0 ? t / b.dur : 1 }
    t -= b.dur
  }
  return { beat: beats[beats.length - 1], u: 1 }
}

export interface WrapRun {
  /** the status' `since` this run belongs to */
  since: number
  n: number
  step: WrapStep
  /** office ms the step began */
  t0: number
  /** true once the cards are written: back at the desk (waited out) it re-reads them and goes again when the board is free */
  wrote: boolean
  /** the way back to the desk is the last leg (cards posted) */
  last: boolean
  /** office ms the wait beside a taken board began */
  waitFrom: number | null
}

export interface WrapInput {
  now: number
  atDesk: boolean
  atBoard: boolean
  /** another agent is posting at the board */
  boardTaken: boolean
  /** another agent is walking to or posting at the board (a retry waits for a free turn) */
  boardBusy: boolean
  reduced: boolean
  /** replay gesture minimum, s */
  gm?: number
}

export const startWrap = (agent: string, since: number, now: number, atDesk: boolean): WrapRun => ({
  since,
  n: wrapCards(agent, since),
  step: atDesk ? 'write' : 'seat',
  t0: now,
  wrote: false,
  last: false,
  waitFrom: null,
})

/** advance one frame; `done` when the tidy-up has ended (the display switches to rest in that very frame) */
export function stepWrap(run: WrapRun, inp: WrapInput): { run: WrapRun; done: boolean } {
  const r = { ...run }
  const gm = inp.gm ?? 0
  for (let guard = 0; guard < 8; guard++) {
    const el = (inp.now - r.t0) / 1000
    if (r.step === 'seat') {
      if (!inp.atDesk) break
      r.step = r.last ? 'tidy' : 'write'
      r.t0 = inp.now
    } else if (r.step === 'write') {
      if (!r.wrote) {
        if (el < totalOf(beatsOf('write', r.n, gm))) break
        r.wrote = true
        r.t0 = inp.now
        continue
      }
      // written: reduced motion tidies in place; otherwise go once the board is free (and, after a retry, nobody else is on the way)
      if (inp.reduced) {
        r.step = 'tidy'
        r.last = true
        r.t0 = inp.now
      } else if (!inp.boardTaken && !inp.boardBusy) {
        r.step = 'walk'
        r.t0 = inp.now
        r.waitFrom = null
      } else break
    } else if (r.step === 'walk') {
      if (inp.atBoard && !inp.boardTaken) {
        r.step = 'post'
        r.t0 = inp.now
        r.waitFrom = null
      } else if (inp.boardTaken) {
        r.waitFrom ??= inp.now
        if (inp.now - r.waitFrom >= WRAP.waitMs) {
          r.step = 'seat'
          r.last = false
          r.t0 = inp.now
          r.waitFrom = null
          continue
        }
        break
      } else {
        r.waitFrom = null
        break
      }
    } else if (r.step === 'post') {
      if (el < totalOf(beatsOf('post', r.n, gm))) break
      r.step = 'seat'
      r.last = true
      r.t0 = inp.now
    } else {
      if (el < totalOf(beatsOf('tidy', r.n, gm))) break
      return { run: r, done: true }
    }
  }
  return { run: r, done: false }
}

/** what the body does, from a run: the goal's pieces and the display's words */
export interface WrapView {
  step: WrapStep
  /** shown after "정리 중 › #n · " */
  label: string
  /** the cards still in the left hand while carrying / posting / (walking back after a wait) */
  carry: number
  /** the current beat (write / post / tidy), with how far into it */
  beat?: { kind: BeatKind; u: number; k: number }
  /** writing again what is already written: pen on the card, head ±3° */
  reread: boolean
  /** waiting beside a taken board with the stack */
  waiting: boolean
}

export function viewOf(run: WrapRun, inp: Pick<WrapInput, 'now' | 'gm' | 'boardTaken'>): WrapView {
  const gm = inp.gm ?? 0
  const el = (inp.now - run.t0) / 1000
  const reread = run.step === 'write' && run.wrote
  const base = { step: run.step, reread, waiting: run.step === 'walk' && inp.boardTaken }
  if (run.step === 'write') {
    const w = beatAt(beatsOf('write', run.n, gm), el)
    const beat = reread ? { kind: 'reread' as const, u: (el % WRAP.reread) / WRAP.reread, k: 0 } : { kind: w.beat.kind, u: w.u, k: w.beat.k }
    return { ...base, label: reread ? REREAD_LABEL : WRAP_LABEL.write, carry: reread ? run.n : w.beat.k + 1, beat }
  }
  if (run.step === 'post' || run.step === 'tidy') {
    const { beat, u } = beatAt(beatsOf(run.step, run.n, gm), el)
    // the stack gets thinner by one card each time a card is released
    const pressed = run.step === 'post' ? beat.k + (beat.kind === 'release' && u >= 1 ? 1 : 0) : run.n
    return { ...base, label: WRAP_LABEL[run.step], carry: run.step === 'post' ? Math.max(0, run.n - pressed) : 0, beat: { kind: beat.kind, u, k: beat.k } }
  }
  return { ...base, label: WRAP_LABEL[run.step], carry: run.step === 'walk' || (run.step === 'seat' && !run.last) ? run.n : 0 }
}

// ---- what the display shows -----------------------------------------------------------------------------------------

/**
 * What one agent shows right now (the name tag, the head chip, the monitor): its status with `state` replaced by what the
 * body is doing, and `detail` replacing the words when the body is not doing what the status names (walking to the desk).
 */
export interface Shown {
  status: AgentStatus
  /** replaces the activity / state words ("카드 쓰는 중", "자리로 가는 중") */
  detail?: string
  step?: WrapStep
  /** the kind of behaviour this display was decided with (tests compare it with the goal) */
  kind: 'work' | 'wrap' | 'rest' | 'off' | 'duty' | 'talk' | 'meet'
}

export const WALKING_TO_DESK = '자리로 가는 중'
