// #605 (hologram.md 12.4 · 12.6) agents flicking alkkagi at the hologram table: the games of a session, deterministic from its seed, as a timeline
// the stage reads at any time. As chess (chessTimeline.ts): an AI flick is costly (it simulates its candidates), so a session's games are computed
// one flick per call and cached, and a seek catches up over frames; the stones' paths are not kept but simulated again when a flick is shown
// (the engine is deterministic: the same flick from the same position gives the same path).
//
//   a flick: the player thinks (0.6–1.2 s, the hand over the chosen stone), then its hand comes behind the stone (0.3 s), aims (0.3–0.55 s, the
//   dotted line grows), cocks the index on the thumb (0.55–0.75 s) and flicks: the nail meets the stone at 0.81 s and the physics starts there
//   (alkkagi.flick). The next flick begins 0.4 s after every stone has stopped
//   a game ends when a side has no stone left, or after 80 flicks (the engine's rule); the result shows, the board is wiped, the next game swaps
//   who flicks first

import { hash } from '../office/play'
import type { Level, Outcome, Side } from './boardGame'
import { ALK, aiFlick, outcome, simulate, startPosition, type AlkEvent, type AlkkagiState, type Flick, type Trace } from './alkkagi'

/** the hand after the thinking, ms (hologram.md 12.4): behind the stone, aiming, cocked, the nail on the stone (the physics starts), back */
export const ALK_HAND = { reach: 300, aim: 550, cock: 750, flick: 810, end: 1400 } as const
export const ALK_THINK = { min: 600, max: 1200 } as const
/** after the stones stop, before the next flick */
export const ALK_SETTLE_MS = 400
/** after the last flick's stones stop: the result (the winner's stones bright 2 s), then the wipe */
export const ALK_RESULT_MS = 2500
export const ALK_RESET_MS = 600
/** flicks computed at most per call (each is one AI choice, which simulates its candidates) */
export const ALK_FLICKS_PER_CALL = 1
/** the frames of a shown path: one every this many engine steps (1/60 s) */
export const ALK_EVERY = 4

/** the agents' levels at the table (as chess) */
export const ALK_LEVEL: Record<string, Level> = { agent_0: 'normal', agent_1: 'easy', agent_2: 'easy', agent_3: 'normal', agent_4: 'easy' }
const levelOf = (agent: string): Level => ALK_LEVEL[agent] ?? 'easy'

export interface AlkTurn {
  flick: Flick
  /** the position it is flicked from, and the one after (all stones at rest) */
  before: AlkkagiState
  after: AlkkagiState
  /** ms since the game began: its thinking begins, how long it thinks, the stones' motion (engine steps × dt) */
  start: number
  think: number
  motionMs: number
}

export interface AlkGame {
  /** which player (index into the session's players) flicks first (engine side 0) */
  first: 0 | 1
  start: number
  turns: AlkTurn[]
  end: Outcome | null
}

interface Run {
  seed: number
  players: [string, string]
  games: AlkGame[]
}

const cache = new Map<string, Run>()
const traces = new Map<string, Trace>()

const thinkOf = (seed: number, game: number, n: number) => ALK_THINK.min + (hash(`${seed}|alk-think|${game}|${n}`) % (ALK_THINK.max - ALK_THINK.min + 1))
const turnLength = (t: AlkTurn) => t.think + ALK_HAND.flick + t.motionMs + ALK_SETTLE_MS
export const alkGameLength = (g: AlkGame) => {
  const last = g.turns[g.turns.length - 1]
  return (last ? last.start + turnLength(last) : 0) + ALK_RESULT_MS + ALK_RESET_MS
}
const stateOf = (g: AlkGame) => g.turns[g.turns.length - 1]?.after ?? startPosition()

/** the path of a flick (cached: the most recent few) */
function traceOf(key: string, t: AlkTurn): Trace {
  let tr = traces.get(key)
  if (!tr) {
    if (traces.size >= 8) traces.delete(traces.keys().next().value!)
    tr = simulate(t.before, t.flick, ALK_EVERY)
    traces.set(key, tr)
  }
  return tr
}

function step(run: Run) {
  let g = run.games[run.games.length - 1]
  if (g.end) {
    g = { first: (1 - g.first) as 0 | 1, start: g.start + alkGameLength(g), turns: [], end: null }
    run.games.push(g)
  }
  const s = stateOf(g)
  const o = outcome(s)
  if (o.kind !== 'playing') {
    g.end = o
    return
  }
  const gi = run.games.length - 1
  const n = g.turns.length
  const mover = s.toMove === 0 ? g.first : ((1 - g.first) as 0 | 1)
  const flick = aiFlick(s, levelOf(run.players[mover]), hash(`${run.seed}|alk|${gi}|${n}`))
  const tr = simulate(s, flick, 1 << 30)
  const prev = g.turns[n - 1]
  g.turns.push({ flick, before: s, after: tr.end, start: prev ? prev.start + turnLength(prev) : 0, think: thinkOf(run.seed, gi, n), motionMs: Math.round(tr.steps * ALK.dt * 1000) })
}

function runTo(seed: number, players: [string, string], tMs: number, budget: number): { run: Run; reached: boolean } {
  const key = `${seed}|${players[0]}|${players[1]}`
  let run = cache.get(key)
  if (!run) {
    if (cache.size >= 16) cache.delete(cache.keys().next().value!)
    run = { seed, players, games: [{ first: 0, start: 0, turns: [], end: null }] }
    cache.set(key, run)
  }
  const known = () => {
    const g = run!.games[run!.games.length - 1]
    if (g.end) return g.start + alkGameLength(g)
    const last = g.turns[g.turns.length - 1]
    return g.start + (last ? last.start + turnLength(last) : 0)
  }
  for (let k = 0; k < budget && known() <= tMs; k++) step(run)
  return { run, reached: known() > tMs }
}

export interface AlkFlickView {
  /** the player flicking (index into players), its side, the flick */
  mover: 0 | 1
  side: Side
  flick: Flick
  /** ms since the turn began, its thinking, and (from the nail meeting the stone) ms of the stones' motion so far */
  sinceMs: number
  thinkMs: number
  motionMs: number
  motionTotalMs: number
}

export interface AlkView {
  game: number
  /** which player flicks first (engine side 0) this game */
  first: 0 | 1
  /** the stones now (engine coordinates; moving while a flick plays) */
  stones: { x: number; y: number; side: Side; out: boolean }[]
  toMove: Side
  turn: number
  phase: 'thinking' | 'aim' | 'moving' | 'settle' | 'result' | 'reset' | 'catching'
  /** the turn in progress */
  flick: AlkFlickView | null
  /** this flick's events so far, with their ms since the nail met the stone */
  events: (AlkEvent & { atMs: number })[]
  end: (Outcome & { sinceMs: number }) | null
}

function viewOf(run: Run, gi: number, tGame: number): AlkView {
  const g = run.games[gi]
  let cur: AlkTurn | null = null
  let ti = -1
  g.turns.forEach((t, i) => {
    if (tGame >= t.start && tGame < t.start + turnLength(t)) {
      cur = t
      ti = i
    }
  })
  // the rest position: after the last turn whose motion is over
  let rest = startPosition()
  for (const t of g.turns) if (tGame >= t.start + t.think + ALK_HAND.flick + t.motionMs) rest = t.after
  const last = g.turns[g.turns.length - 1]
  const endAt = last ? last.start + turnLength(last) : 0
  const end = g.end && tGame >= endAt ? { ...g.end, sinceMs: tGame - endAt } : null
  const base = { game: gi, first: g.first, toMove: rest.toMove, turn: rest.turn }
  if (!cur) {
    const phase: AlkView['phase'] = end ? (end.sinceMs < ALK_RESULT_MS ? 'result' : 'reset') : 'thinking'
    return { ...base, stones: rest.stones.map((s) => ({ ...s })), phase, flick: null, events: [], end }
  }
  const t: AlkTurn = cur
  const since = tGame - t.start
  const fromNail = since - t.think - ALK_HAND.flick
  const flick: AlkFlickView = {
    mover: t.before.toMove === 0 ? g.first : ((1 - g.first) as 0 | 1),
    side: t.before.toMove,
    flick: t.flick,
    sinceMs: since,
    thinkMs: t.think,
    motionMs: Math.max(0, Math.min(t.motionMs, fromNail)),
    motionTotalMs: t.motionMs,
  }
  if (fromNail < 0) {
    const phase = since < t.think + ALK_HAND.reach ? 'thinking' : 'aim'
    return { ...base, toMove: t.before.toMove, turn: t.before.turn, stones: t.before.stones.map((s) => ({ ...s })), phase, flick, events: [], end: null }
  }
  if (fromNail >= t.motionMs) return { ...base, stones: t.after.stones.map((s) => ({ ...s })), phase: 'settle', flick, events: [], end: null }
  // the stones in motion: the path's frame at this moment
  const tr = traceOf(`${run.seed}|${run.players.join('|')}|${gi}|${ti}`, t)
  const frameMs = ALK.dt * ALK_EVERY * 1000
  const fr = tr.frames[Math.min(tr.frames.length - 1, Math.floor(fromNail / frameMs))]
  const stones = fr.map((p, i) => ({ x: p.x, y: p.y, side: t.before.stones[i].side, out: p.out }))
  const events = tr.events.map((e) => ({ ...e, atMs: e.step * ALK.dt * 1000 })).filter((e) => e.atMs <= fromNail)
  return { ...base, toMove: t.before.toMove, turn: t.before.turn, stones, phase: 'moving', flick, events, end: null }
}

/**
 * The agents' alkkagi at `tMs` (ms since the session's start, its settling over). `budget`: flicks it may compute now; when the games are not
 * computed that far yet, the view is the last computed moment at rest with phase 'catching'
 */
export function alkkagiAt(seed: number, players: [string, string], tMs: number, budget = ALK_FLICKS_PER_CALL): AlkView {
  const { run, reached } = runTo(seed, players, Math.max(0, tMs), budget)
  if (!reached) {
    const gi = run.games.length - 1
    const g = run.games[gi]
    const s = stateOf(g)
    return { game: gi, first: g.first, stones: s.stones.map((x) => ({ ...x })), toMove: s.toMove, turn: s.turn, phase: 'catching', flick: null, events: [], end: null }
  }
  let gi = 0
  for (let i = run.games.length - 1; i >= 0; i--)
    if (run.games[i].start <= tMs) {
      gi = i
      break
    }
  return viewOf(run, gi, Math.max(0, tMs) - run.games[gi].start)
}

/** tests: forget the cached runs and paths */
export const resetAlkkagiCache = () => {
  cache.clear()
  traces.clear()
}
