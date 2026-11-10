// The wrap-up (#186) as real work: write the cards at the desk, carry them to the board, post them, tidy up, then rest.
// Pure and deterministic: a small state machine fed with the clock, who is where, and whether the board is taken, and
// the one place that says what the agent is doing now (the display reads `view`, never the raw status).
// The design: issue #186 "정리 단계 순서 · 시간 · 손". Lengthened and enriched by #229 (docs/design/wrapup.md).

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
/** at the board, once every card is posted: the pieces that touch the cards (#229) */
export const TOUCH_LABEL = '카드 정리 중'
/** at the desk with the board taken: the cards are written and the desk pieces go round (the same words as before #229) */
export const REREAD_LABEL = '카드 다시 읽는 중'

/** docs/design/wrapup.md section 7 (#229) */
export const WRAP = {
  /** cards written at the desk: 2..5 (as many as the desk's share of the time holds) */
  cardsMin: 2,
  cardsMax: 5,
  /** desk pieces, s: a line (range), a new line, tapping the pen, striking out and writing again, reading the card held up, pushing the done card to the stack and drawing a new one */
  line: [1.6, 2.4],
  newline: 0.3,
  tapPen: 0.8,
  strike: 1.4,
  readUp: 1.8,
  next: 0.6,
  /** lines on a card, and the flourishes (tap / strike / read up) among them */
  lines: [3, 5],
  flourishes: [1, 2],
  /** board pieces, s: stepping back, thinking (range), coming back, moving one card, swapping two, straightening one, one point (2..4 of them), the last look */
  back: 0.6,
  think: [2.5, 4],
  forth: 0.6,
  move: 1.4,
  swap: 2.4,
  straighten: 0.7,
  point: 0.5,
  points: [2, 4],
  final: 0.8,
  /** posting: pick the top card, put it to its place, press the centre with the thumb base, let go (1.2 s), and the gap */
  pick: 0.3,
  place: 0.55,
  press: 0.2,
  release: 0.15,
  gap: 0.3,
  /** tidying: gather the papers, tap them (each), push the keyboard in, lean back (1.6 s with two taps) */
  gather: 0.3,
  tap: 0.25,
  keys: 0.3,
  lean: 0.5,
  /** the wrap-up aims to end this long (s) before the `wrapping` display does (the break starts, then the walk to the play) */
  fillBefore: 6,
  /** the desk's share of the time that is left after the walks and the tidy-up */
  deskShare: 0.45,
  /** a walk to / from the board, s, until a real one is known */
  walkEst: 8,
  /** a habit piece is not chosen when the same one is among the last this many pieces */
  noRepeat: 3,
  /** the think habits (chin, arms, tilt) are not repeated within one wrap-up */
  maxThinks: 3,
  /** the replay's gesture minimum from which only posting and tidying are left (#158, x16) */
  fastGm: 2.4,
  /** waiting beside a taken board this long sends the agent back to its desk */
  waitMs: 20000,
  /** how far a step back is, m (the body is drawn this far from the board; the planner does not see it) */
  backM: 0.45,
} as const

/** how long the `wrapping` display lasts (liveStatus.ts WRAPPING_FOR), ms */
export const WRAP_SPAN_MS = 2 * 60_000

export type PieceKind = 'line' | 'newline' | 'tapPen' | 'strike' | 'readUp' | 'next' | 'post' | 'think' | 'move' | 'swap' | 'straighten' | 'point' | 'final'
export type BeatKind =
  | 'line' | 'newline' | 'tapPen' | 'strike' | 'readUp' | 'next'
  | 'pick' | 'place' | 'press' | 'release' | 'gap'
  | 'back' | 'think' | 'forth' | 'move' | 'swap' | 'straighten' | 'point' | 'final'
  | 'gather' | 'tap' | 'keys' | 'lean'
export interface Beat {
  kind: BeatKind
  /** the card it is about (0-based; at the desk: the card being written) */
  k: number
  dur: number
  /** the piece it belongs to (a piece is one or more beats) */
  piece: PieceKind
  /** desk: the line being written (0-based; 'next': the line count); think: the habit (0 chin, 1 arms, 2 tilt); post: 1 = posted crooked; point: which of its points */
  v?: number
  /** point: the last of its run (the hand goes back to rest after it) */
  end?: boolean
}

export const HABITS = ['chin', 'arms', 'tilt'] as const

const DESK_HABIT: readonly PieceKind[] = ['tapPen', 'strike', 'readUp']
const BOARD_HABIT: readonly PieceKind[] = ['think', 'move', 'swap', 'straighten']

/** each agent's character (wrapup.md 4): the pieces it chooses twice as often, and the think habit it prefers */
const PERSONA: Record<string, { desk: PieceKind[]; board: PieceKind[]; habit?: number }> = {
  agent_0: { desk: ['line', 'next'], board: ['point', 'final'] },
  agent_1: { desk: ['readUp'], board: ['think', 'straighten'], habit: 0 },
  agent_2: { desk: ['strike'], board: ['swap', 'straighten'] },
  agent_3: { desk: ['tapPen'], board: ['move'] },
  agent_4: { desk: ['readUp'], board: ['think'], habit: 2 },
}

function seedOf(s: string): () => number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (r: () => number, range: readonly number[]) => Math.round((range[0] + r() * (range[1] - range[0])) * 10) / 10
const intBetween = (r: () => number, range: readonly number[]) => range[0] + Math.floor(r() * (range[1] - range[0] + 1))
function weighted<T>(r: () => number, items: readonly T[], w: (t: T) => number): T {
  const ws = items.map(w)
  let x = r() * ws.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) {
    x -= ws[i]
    if (x < 0) return items[i]
  }
  return items[items.length - 1]
}

/** the sum of the durations */
export const totalOf = (beats: Beat[]) => beats.reduce((a, b) => a + b.dur, 0)

/** the pieces in order: a post, a think and the points are runs of beats; a line, a new line and a point are each their own */
export const piecesOf = (beats: Beat[]): PieceKind[] => {
  const out: PieceKind[] = []
  let prev: Beat | null = null
  for (const b of beats) {
    const same = prev && prev.piece === b.piece && !['line', 'newline', 'pick'].includes(b.kind) && !(b.piece === 'think' && b.kind === 'back') && !(b.piece === 'next' && b.k !== prev.k)
    if (!same) out.push(b.piece)
    prev = b
  }
  return out
}

export interface DeskPlan {
  beats: Beat[]
  /** cards written */
  cards: number
}

/**
 * The desk pieces (wrapup.md 2, 4): cards of 3..5 lines with 1..2 flourishes among them, one after the other while the next card still fits
 * in `budget` s (at least `cardsMin`; at most `cap` cards, no limit when null). Deterministic from the agent and the wrap-up's own start.
 */
export function planDesk(agent: string, since: number, budget: number, cap: number | null = WRAP.cardsMax, gm = 0): DeskPlan {
  const r = seedOf(`${agent}|${since}|desk`)
  const who = PERSONA[agent] ?? { desk: [], board: [] }
  const beats: Beat[] = []
  const seq: PieceKind[] = []
  const quick = who.desk.includes('line') ? 0.85 : 1
  let t = 0
  let cards = 0
  while (cap === null || cards < cap) {
    const one: Beat[] = []
    const local: PieceKind[] = []
    const add = (kind: BeatKind, dur: number, v: number) => {
      one.push({ kind, k: cards, dur, piece: kind as PieceKind, v })
      local.push(kind as PieceKind)
    }
    const lines = intBetween(r, WRAP.lines)
    const flourishes = new Set<number>()
    const want = Math.min(lines, intBetween(r, WRAP.flourishes))
    for (let guard = 0; flourishes.size < want && guard < 20; guard++) flourishes.add(Math.floor(r() * lines))
    for (let i = 0; i < lines; i++) {
      add('line', Math.round(between(r, WRAP.line) * quick * 10) / 10, i)
      if (flourishes.has(i) && gm < WRAP.fastGm) {
        const recent = [...seq, ...local].slice(-WRAP.noRepeat)
        const ok = DESK_HABIT.filter((p) => !recent.includes(p))
        if (ok.length) {
          const p = weighted(r, ok, (x) => (who.desk.includes(x) ? 2 : 1))
          add(p as BeatKind, p === 'tapPen' ? WRAP.tapPen : p === 'strike' ? WRAP.strike : WRAP.readUp, i)
        }
      }
      if (i < lines - 1) add('newline', WRAP.newline, i)
    }
    add('next', WRAP.next, lines)
    const d = totalOf(one)
    if (cards >= WRAP.cardsMin && t + d > budget) break
    beats.push(...one)
    seq.push(...local)
    t += d
    cards++
  }
  return { beats, cards }
}

/** where a posted card sits on the board's grid of cells: 3 columns, rows downward; the board pieces touch these */
export const cellOf = (k: number) => ({ col: k % 3, row: Math.floor(k / 3) })

/**
 * The board pieces (wrapup.md 3, 4): post every card (one or two of them crooked), then mix the pieces that touch the cards until `budget` s
 * is used (none repeating within the last three, each think habit once), then the last look. At the fast replay (gm >= fastGm) only
 * posting and the look are left.
 */
export function planBoard(agent: string, since: number, n: number, budget: number, gm = 0): Beat[] {
  const r = seedOf(`${agent}|${since}|board`)
  const who = PERSONA[agent] ?? { desk: [], board: [] }
  const g = (d: number) => Math.max(d, gm)
  const beats: Beat[] = []
  const crooked = new Set<number>()
  const nCrooked = Math.min(n, intBetween(r, [1, 2]))
  for (let guard = 0; crooked.size < nCrooked && guard < 20; guard++) crooked.add(Math.floor(r() * n))
  const seq: PieceKind[] = []
  for (let k = 0; k < n; k++) {
    if (k > 0) beats.push({ kind: 'gap', k, dur: WRAP.gap, piece: 'post' })
    const v = crooked.has(k) ? 1 : 0
    beats.push(
      { kind: 'pick', k, dur: g(WRAP.pick), piece: 'post', v },
      { kind: 'place', k, dur: g(WRAP.place), piece: 'post', v },
      { kind: 'press', k, dur: g(WRAP.press), piece: 'post', v },
      { kind: 'release', k, dur: g(WRAP.release), piece: 'post', v },
    )
    seq.push('post')
  }
  const fin: Beat = { kind: 'final', k: Math.max(0, n - 1), dur: g(WRAP.final), piece: 'final' }
  let t = totalOf(beats) + fin.dur
  if (gm < WRAP.fastGm) {
    const used = { think: 0, straighten: 0, habits: new Set<number>() }
    const thinkMean = WRAP.back + (WRAP.think[0] + WRAP.think[1]) / 2 + WRAP.forth
    for (let guard = 0; guard < 80; guard++) {
      const room = budget - t
      const cost: Record<string, number> = { think: thinkMean, move: WRAP.move, swap: WRAP.swap, straighten: WRAP.straighten, point: WRAP.points[0] * WRAP.point }
      // none of the last three; when the time is not used up and nothing else is left the window narrows (two, then one) rather than leave the board idle
      let options: PieceKind[] = []
      for (let win = WRAP.noRepeat; win >= 1 && !options.length; win--) {
        const recent = seq.slice(-win)
        options = (['think', 'move', 'swap', 'straighten', 'point'] as PieceKind[]).filter((p) => {
          if (BOARD_HABIT.includes(p) && recent.includes(p)) return false
          if (p === 'point' && recent.at(-1) === 'point') return false
          if (p === 'think' && used.think >= WRAP.maxThinks) return false
          if (p === 'swap' && n < 2) return false
          if (p === 'straighten' && used.straighten >= crooked.size) return false
          return cost[p] <= room
        })
      }
      if (!options.length) break
      const p = weighted(r, options, (x) => (who.board.includes(x) ? 2 : 1))
      const k = Math.floor(r() * n)
      if (p === 'think') {
        const free = [0, 1, 2].filter((h) => !used.habits.has(h))
        const h = who.habit !== undefined && free.includes(who.habit) && used.think === 0 ? who.habit : free[Math.floor(r() * free.length)]
        const think = Math.min(between(r, WRAP.think), Math.max(WRAP.think[0], room - WRAP.back - WRAP.forth))
        used.habits.add(h)
        used.think++
        beats.push({ kind: 'back', k, dur: WRAP.back, piece: 'think', v: h }, { kind: 'think', k, dur: think, piece: 'think', v: h }, { kind: 'forth', k, dur: WRAP.forth, piece: 'think', v: h })
        t += WRAP.back + think + WRAP.forth
      } else if (p === 'point') {
        const cnt = Math.min(intBetween(r, WRAP.points), Math.max(WRAP.points[0], Math.floor(room / WRAP.point)))
        for (let i = 0; i < cnt; i++) beats.push({ kind: 'point', k: i % n, dur: WRAP.point, piece: 'point', v: i, end: i === cnt - 1 })
        t += cnt * WRAP.point
      } else if (p === 'straighten') {
        const at = [...crooked][used.straighten++]
        beats.push({ kind: 'straighten', k: at, dur: WRAP.straighten, piece: p })
        t += WRAP.straighten
      } else {
        beats.push({ kind: p as BeatKind, k, dur: cost[p], piece: p, ...(p === 'swap' ? { v: (k + 1) % n } : {}) })
        t += cost[p]
      }
      seq.push(p)
    }
  }
  beats.push(fin)
  return beats
}

/** the tidy-up's beats: gather, tap (twice, once at the fast replay), push the keyboard in, lean back */
export function tidyBeats(gm = 0): Beat[] {
  const g = (d: number) => Math.max(d, gm)
  const out: Beat[] = [{ kind: 'gather', k: 0, dur: WRAP.gather, piece: 'next' }]
  const taps = gm >= WRAP.fastGm ? 1 : 2
  for (let i = 0; i < taps; i++) out.push({ kind: 'tap', k: i, dur: g(WRAP.tap), piece: 'next' })
  out.push({ kind: 'keys', k: 0, dur: g(WRAP.keys), piece: 'next' }, { kind: 'lean', k: 0, dur: g(WRAP.lean), piece: 'next' })
  return out
}

/** the beat at `e` s into a list, and how far into it (0..1); past the end it is the last beat at 1 */
export function beatAt(beats: Beat[], e: number): { beat: Beat; u: number } {
  let t = Math.max(0, e)
  for (const b of beats) {
    if (t < b.dur) return { beat: b, u: b.dur > 0 ? t / b.dur : 1 }
    t -= b.dur
  }
  return { beat: beats[beats.length - 1], u: 1 }
}

export interface WrapPlan {
  /** the desk pieces and the cards they write */
  desk: Beat[]
  cards: number
  /** the board pieces, made when the agent gets to the board (the time left is only known then) */
  board: Beat[] | null
}

export interface WrapRun {
  /** whose wrap-up (the pieces are chosen by character) */
  agent: string
  /** the status' `since` this run belongs to */
  since: number
  /** cards in the hand when it sets off (at most cardsMax) */
  n: number
  step: WrapStep
  /** office ms the step began */
  t0: number
  /** true once the cards are written: back at the desk (waited out) it goes on with the desk pieces and goes again when the board is free */
  wrote: boolean
  /** the way back to the desk is the last leg (cards posted) */
  last: boolean
  /** office ms the wait beside a taken board began */
  waitFrom: number | null
  /** the pieces (made at the start / at the board) */
  plan: WrapPlan
  /** office ms the plan aims to be done by */
  until: number
  /** s of the desk step already done when it was held away from the desk: it goes on from there (0 otherwise) */
  skip?: number
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

/** how long the whole wrap-up is meant to last from `now`, s: to the display's end less fillBefore */
export const wrapTarget = (since: number, now: number) => Math.max(0, (since + WRAP_SPAN_MS - now) / 1000 - WRAP.fillBefore)

export function startWrap(agent: string, since: number, now: number, atDesk: boolean, opts: { reduced?: boolean; gm?: number } = {}): WrapRun {
  const gm = opts.gm ?? 0
  const T = wrapTarget(since, now)
  const tidy = totalOf(tidyBeats(gm))
  // the desk's share of what is left after the walks (none in reduced motion) and the tidy-up
  const budget = opts.reduced ? Math.max(0, T - tidy) : Math.max(0, WRAP.deskShare * (T - 2 * WRAP.walkEst - tidy))
  const d = planDesk(agent, since, budget, opts.reduced ? null : WRAP.cardsMax, gm)
  return {
    agent,
    since,
    n: Math.min(d.cards, WRAP.cardsMax),
    step: atDesk ? 'write' : 'seat',
    t0: now,
    wrote: false,
    last: false,
    waitFrom: null,
    plan: { desk: d.beats, cards: d.cards, board: null },
    until: since + WRAP_SPAN_MS - WRAP.fillBefore * 1000,
  }
}

/** the desk pieces of the waiting loop (cards written, board taken): a plan of its own, played round and round */
const waitCache = new Map<string, Beat[]>()
function waitBeats(agent: string, since: number): Beat[] {
  const key = `${agent}|${since}`
  let b = waitCache.get(key)
  if (!b) {
    if (waitCache.size > 64) waitCache.clear()
    b = planDesk(agent, since + 0.5, 30, null).beats
    waitCache.set(key, b)
  }
  return b
}

/** the beats of a step of a run */
export function beatsOf(run: WrapRun, step: 'write' | 'post' | 'tidy', gm = 0): Beat[] {
  if (step === 'write') return run.plan.desk
  if (step === 'post') return run.plan.board ?? planBoard(run.agent, run.since, run.n, 0, gm)
  return tidyBeats(gm)
}

/** advance one frame; `done` when the tidy-up has ended (the display switches to rest in that very frame) */
export function stepWrap(run: WrapRun, inp: WrapInput): { run: WrapRun; done: boolean } {
  const r = { ...run }
  const gm = inp.gm ?? 0
  for (let guard = 0; guard < 8; guard++) {
    const el = (inp.now - r.t0) / 1000
    if (r.step === 'seat') {
      if (!inp.atDesk) break
      r.step = r.last ? 'tidy' : 'write'
      r.t0 = inp.now - (r.skip ?? 0) * 1000
      r.skip = 0
    } else if (r.step === 'write') {
      if (!r.wrote) {
        if (el < totalOf(r.plan.desk)) break
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
        // the time left is split: the way back and the tidy-up are kept, the rest is the board's
        const walked = Math.min(el, 2 * WRAP.walkEst)
        const left = (r.until - inp.now) / 1000 - walked - totalOf(tidyBeats(gm))
        r.plan = { ...r.plan, board: planBoard(r.agent, r.since, r.n, Math.max(0, left), gm) }
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
      if (el < totalOf(beatsOf(r, 'post', gm))) break
      r.step = 'seat'
      r.last = true
      r.t0 = inp.now
    } else {
      if (el < totalOf(tidyBeats(gm))) break
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
  beat?: { kind: BeatKind; u: number; k: number; piece: PieceKind; v?: number; end?: boolean }
  /** the cards are written and the desk pieces go round while the board is taken */
  reread: boolean
  /** waiting beside a taken board with the stack */
  waiting: boolean
}

export function viewOf(run: WrapRun, inp: Pick<WrapInput, 'now' | 'gm' | 'boardTaken'>): WrapView {
  const gm = inp.gm ?? 0
  const el = (inp.now - run.t0) / 1000
  const reread = run.step === 'write' && run.wrote
  const base = { step: run.step, reread, waiting: run.step === 'walk' && inp.boardTaken }
  const out = (b: Beat, u: number) => ({ kind: b.kind, u, k: b.k, piece: b.piece, v: b.v, end: b.end })
  if (run.step === 'write') {
    if (reread) {
      const loop = waitBeats(run.agent, run.since)
      const w = beatAt(loop, el % totalOf(loop))
      return { ...base, label: REREAD_LABEL, carry: run.n, beat: out(w.beat, w.u) }
    }
    const w = beatAt(run.plan.desk, el)
    return { ...base, label: WRAP_LABEL.write, carry: Math.min(WRAP.cardsMax, w.beat.k + 1), beat: out(w.beat, w.u) }
  }
  if (run.step === 'post' || run.step === 'tidy') {
    const { beat, u } = beatAt(beatsOf(run, run.step, gm), el)
    const posting = run.step === 'post' && beat.piece === 'post'
    // the stack gets thinner by one card each time a card is released
    const pressed = beat.k + (beat.kind === 'release' && u >= 1 ? 1 : 0)
    const label = run.step === 'post' && !posting ? TOUCH_LABEL : WRAP_LABEL[run.step]
    return { ...base, label, carry: posting ? Math.max(0, run.n - pressed) : 0, beat: out(beat, u) }
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
