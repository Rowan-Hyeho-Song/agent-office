// Omok (gomoku) engine (#135): 15x15, black first, FREESTYLE rules (five or more in a row wins, no renju bans),
// draw when the board fills. Pure: a heuristic AI per agent personality, and `gameAt(seed, players, t)` that plays a whole
// game from the seed with think times and hand animation timing, reproducible at any t (#137 reuses play / aiMove).
// Board cells are y * 15 + x; 0 empty, 1 black, 2 white.

import { hash, rng } from '../office/play'

export const N = 15
export type Color = 1 | 2
export const EMPTY = 0

export interface OmokState {
  board: Uint8Array
  /** the colour to move */
  toMove: Color
  /** stones on the board */
  moveIndex: number
  lastMove: number
  result: 'playing' | 'black' | 'white' | 'draw'
  /** the winning five (or more) cells */
  line: number[] | null
}

export const newGame = (): OmokState => ({ board: new Uint8Array(N * N), toMove: 1, moveIndex: 0, lastMove: -1, result: 'playing', line: null })

const DIRS: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]]

/** the winning run through `cell` for `color` (>= 5 in a row), or null */
function runThrough(board: Uint8Array, cell: number, color: Color): number[] | null {
  const cx = cell % N
  const cy = (cell / N) | 0
  for (const [dx, dy] of DIRS) {
    const line = [cell]
    for (const sg of [1, -1]) {
      let x = cx + dx * sg
      let y = cy + dy * sg
      while (x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === color) {
        line.push(y * N + x)
        x += dx * sg
        y += dy * sg
      }
    }
    if (line.length >= 5) return line
  }
  return null
}

export function legalMoves(s: OmokState): number[] {
  if (s.result !== 'playing') return []
  const out: number[] = []
  for (let i = 0; i < N * N; i++) if (s.board[i] === EMPTY) out.push(i)
  return out
}

/** place a stone for the side to move; null when the move is illegal (occupied, off board, game over) */
export function play(s: OmokState, move: number): OmokState | null {
  if (s.result !== 'playing' || !Number.isInteger(move) || move < 0 || move >= N * N || s.board[move] !== EMPTY) return null
  const board = s.board.slice()
  board[move] = s.toMove
  const line = runThrough(board, move, s.toMove)
  const moveIndex = s.moveIndex + 1
  const result = line ? (s.toMove === 1 ? 'black' : 'white') : moveIndex === N * N ? 'draw' : 'playing'
  return { board, toMove: s.toMove === 1 ? 2 : 1, moveIndex, lastMove: move, result, line }
}

export function winner(s: OmokState): { winner: Color; line: number[] } | { winner: 0; draw: boolean } {
  if (s.result === 'black' || s.result === 'white') return { winner: s.result === 'black' ? 1 : 2, line: s.line! }
  return { winner: 0, draw: s.result === 'draw' }
}

// ---- AI --------------------------------------------------------------------------------------------------------------

export interface Personality {
  name: string
  /** weight of building own lines */
  aggr: number
  /** weight of blocking the opponent's */
  defn: number
  /** relative random jitter on every candidate's score */
  noise: number
  /** chance to pick among the best few instead of the best (never when winning or blocking a five) */
  slip: number
  /** think time range per move (ms) */
  think: [number, number]
}

export const PERSONALITIES: Record<string, Personality> = {
  agent_0: { name: '메모', aggr: 1, defn: 1, noise: 0.08, slip: 0.06, think: [900, 2200] }, // balanced
  agent_1: { name: '메시', aggr: 1, defn: 1.1, noise: 0.1, slip: 0.04, think: [900, 2200] }, // defensive
  agent_2: { name: '휴', aggr: 1, defn: 0.9, noise: 0.6, slip: 0.25, think: [900, 2200] }, // creative, random-ish
  agent_3: { name: '루프', aggr: 1.35, defn: 0.8, noise: 0.1, slip: 0.08, think: [600, 1400] }, // aggressive, quick
  agent_4: { name: '에코', aggr: 0.95, defn: 1, noise: 0.1, slip: 0.06, think: [900, 2000] }, // listens for the stone's click: average, steady
}
/** think time of the AI against a visitor (#137): not bound by the agent-vs-agent clock */
export const VISITOR_THINK: [number, number] = [600, 1400]
export const DEFAULT_PERSONALITY = PERSONALITIES.agent_0
export const personalityOf = (agent: string) => PERSONALITIES[agent] ?? DEFAULT_PERSONALITY

/** pattern value of placing `color` at `cell`: contiguous runs by length and open ends, summed over the 4 axes */
function patternScore(board: Uint8Array, cell: number, color: Color): number {
  const cx = cell % N
  const cy = (cell / N) | 0
  let total = 0
  for (const [dx, dy] of DIRS) {
    let count = 1
    let open = 0
    for (const sg of [1, -1]) {
      let x = cx + dx * sg
      let y = cy + dy * sg
      while (x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === color) {
        count++
        x += dx * sg
        y += dy * sg
      }
      if (x >= 0 && x < N && y >= 0 && y < N && board[y * N + x] === EMPTY) open++
    }
    if (count >= 5) total += 100000
    else if (count === 4) total += open === 2 ? 10000 : open === 1 ? 1500 : 0
    else if (count === 3) total += open === 2 ? 1200 : open === 1 ? 200 : 0
    else if (count === 2) total += open === 2 ? 100 : open === 1 ? 20 : 0
    else total += open === 2 ? 4 : 1
  }
  return total
}

const near = (board: Uint8Array, cell: number) => {
  const cx = cell % N
  const cy = (cell / N) | 0
  for (let y = Math.max(0, cy - 2); y <= Math.min(N - 1, cy + 2); y++)
    for (let x = Math.max(0, cx - 2); x <= Math.min(N - 1, cx + 2); x++) if (board[y * N + x] !== EMPTY) return true
  return false
}

/**
 * The AI's move for the side to move. Deterministic given (state, personality, seed): take a win, block a five,
 * otherwise score points near stones for attack and defence, add seeded jitter, pick the best (rarely a runner-up).
 */
export function aiMove(s: OmokState, p: Personality, seed: number): number {
  if (s.result !== 'playing') return -1
  const me = s.toMove
  const you: Color = me === 1 ? 2 : 1
  if (s.moveIndex === 0) return 7 * N + 7
  // games get bolder as they drag on, so they end
  const push = 1 + Math.max(0, s.moveIndex - 16) * 0.06
  const cands: { cell: number; score: number }[] = []
  let win = -1
  let block = -1
  for (let c = 0; c < N * N; c++) {
    if (s.board[c] !== EMPTY || !near(s.board, c)) continue
    const att = patternScore(s.board, c, me)
    const def = patternScore(s.board, c, you)
    if (att >= 100000) win = win < 0 ? c : win
    if (def >= 100000) block = block < 0 ? c : block
    const centre = 3 - (Math.abs((c % N) - 7) + Math.abs(((c / N) | 0) - 7)) * 0.1
    const jitter = 1 + p.noise * (((hash(`${seed}|${s.moveIndex}|${c}`) / 4294967296) * 2) - 1)
    cands.push({ cell: c, score: (att * p.aggr * push + def * p.defn * 0.7 + centre) * jitter })
  }
  if (win >= 0) return win
  if (block >= 0) return block
  cands.sort((a, b) => b.score - a.score || a.cell - b.cell)
  const rand = rng(hash(`${seed}|slip|${s.moveIndex}`))
  if (rand() < p.slip && cands.length > 1) return cands[1 + Math.floor(rand() * Math.min(3, cands.length - 1))].cell
  return cands[0].cell
}

// ---- a whole game on the clock ---------------------------------------------------------------------------------------

/** the hand takes this long to pick a stone, carry it and place it */
export const HAND_MS = 1400
/** the board shows the stone once the hand reaches this progress: 0.9 s of the 1.4 s place sequence (agents.md 2.10: the stone lands, the hand bounces after) */
export const PLACE_AT = 0.9 / 1.4
export const WIN_MS = 4000
export const RESET_MS = 2500

interface Game {
  seed: number
  /** which of the two players has black */
  black: 0 | 1
  moves: number[]
  /** stones already on the board when the block starts ("a game in progress"); the timed moves follow */
  openN: number
  /** start of each move's thinking, relative to the game start; one extra entry = when the last hand finished */
  starts: number[]
  thinks: number[]
  /** the game's own duration including win reaction and reset */
  length: number
  tHandsDone: number
  finalState: OmokState
  /** where the game begins on the session clock */
  at: number
}
interface Run { games: Game[] }
const cache = new Map<string, Run>()

function buildGame(seed: number, players: [string, string], black: 0 | 1, at: number, first: boolean): Game {
  const roles: [string, string] = black === 0 ? players : [players[1], players[0]] // [black, white]
  let s = newGame()
  const moves: number[] = []
  // seeded opening of the block's first game: 6-10 stones by AI self-play (with the personalities), shown from the start, never already won
  const openN = first ? 6 + (hash(`${seed}|open`) % 5) : 0 // later games in the block start from an empty board
  while (s.moveIndex < openN && s.result === 'playing') {
    const mv = aiMove(s, personalityOf(roles[s.toMove === 1 ? 0 : 1]), hash(`${seed}|open`))
    moves.push(mv)
    s = play(s, mv)!
  }
  if (s.result !== 'playing') {
    moves.pop() // an opening must not be decided
    s = newGame()
    for (const m of moves) s = play(s, m)!
  }
  const opened = moves.length
  const starts: number[] = []
  const thinks: number[] = []
  let t = 0
  while (s.result === 'playing') {
    const who = personalityOf(roles[s.toMove === 1 ? 0 : 1])
    const mv = aiMove(s, who, seed)
    const rand = rng(hash(`${seed}|think|${s.moveIndex}`))
    const th = who.think[0] + rand() * (who.think[1] - who.think[0])
    starts.push(t)
    thinks.push(th)
    moves.push(mv)
    t += th + HAND_MS
    s = play(s, mv)!
  }
  return { seed, black, moves, openN: opened, starts, thinks, length: t + WIN_MS + RESET_MS, tHandsDone: t, finalState: s, at }
}

export interface OmokView {
  /** a fresh copy: the stones currently on the board */
  board: Uint8Array
  /** game number (0 based) and which player index (into `players`) holds black */
  game: number
  black: 0 | 1
  lastMove: number
  toMove: Color
  /** stones on the board */
  moveIndex: number
  phase: 'thinking' | 'pick' | 'place' | 'won' | 'reset'
  /** hand progress 0..1 while picking/placing (reach bowl, carry, release; the stone shows from PLACE_AT) */
  handT01: number
  /** the point and colour the hand is going for */
  pending: { move: number; color: Color } | null
  winner?: Color
  draw?: boolean
  line?: number[]
  /** 0..1 while the stones go back to the bowls */
  resetT01: number
  /** ms since the win reaction began (phase 'won'), else 0 */
  wonMs: number
  /** the move in progress (thinking, picking, placing, withdrawing): who plays it (index into `players`), the cell, ms since its thinking began, how long it thinks */
  move: { mover: 0 | 1; cell: number; sinceMs: number; thinkMs: number } | null
}

const place = (board: Uint8Array, moves: number[], count: number) => {
  for (let i = 0; i < count; i++) board[moves[i]] = i % 2 === 0 ? 1 : 2
}

/**
 * The game at `tMs` (ms since the session start): games follow one another; each seat keeps its colour (the player at the first spot is black, next to the black bowl: #184). Cheap at any
 * t (games are built once per seed). `discrete` (reduced motion): the board only (stones appear, no hand, the board
 * is empty during the reset), phase kept.
 */
export function gameAt(seed: number, players: [string, string], tMs: number, discrete = false): OmokView {
  const key = `${seed}|${players[0]}|${players[1]}`
  let run = cache.get(key)
  if (!run) {
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    run = { games: [] }
    cache.set(key, run)
  }
  const t = Math.max(0, tMs)
  const g = run.games
  while (g.length === 0 || g[g.length - 1].at + g[g.length - 1].length <= t) {
    const i = g.length
    const at = i === 0 ? 0 : g[i - 1].at + g[i - 1].length
    g.push(buildGame(hash(`${seed}|game|${i}`), players, 0, at, i === 0))
  }
  let lo = 0
  let hi = g.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (g[mid].at <= t) lo = mid
    else hi = mid - 1
  }
  const game = g[lo]
  const u = t - game.at
  const board = new Uint8Array(N * N)
  const base = { game: lo, black: game.black, handT01: 0, pending: null as OmokView['pending'], resetT01: 0, wonMs: 0, move: null as OmokView['move'] }

  if (u >= game.tHandsDone) {
    const f = game.finalState
    const w = winner(f)
    const won = u < game.tHandsDone + WIN_MS
    const resetT01 = won ? 0 : (u - game.tHandsDone - WIN_MS) / RESET_MS
    if (won || !discrete) place(board, game.moves, game.moves.length)
    return {
      ...base, board, lastMove: f.lastMove, toMove: f.toMove, moveIndex: f.moveIndex,
      phase: won ? 'won' : 'reset', resetT01: discrete ? 0 : resetT01, wonMs: won ? u - game.tHandsDone : 0,
      ...(w.winner ? { winner: w.winner, line: (w as { line: number[] }).line } : { draw: true }),
    }
  }
  // the move whose think/hand window holds u
  let a = 0
  let b = game.starts.length - 1
  while (a < b) {
    const mid = (a + b + 1) >> 1
    if (game.starts[mid] <= u) a = mid
    else b = mid - 1
  }
  const th = game.thinks[a]
  const since = u - game.starts[a]
  const hand = since < th ? 0 : Math.min(1, (since - th) / HAND_MS)
  const placed = since >= th && hand >= PLACE_AT ? a + 1 : a
  const o = game.openN
  place(board, game.moves, o + placed)
  const color: Color = (o + a) % 2 === 0 ? 1 : 2
  const phase: OmokView['phase'] = since < th ? 'thinking' : hand < 0.5 ? 'pick' : 'place'
  const mover = (color === 1 ? game.black : 1 - game.black) as 0 | 1
  return {
    ...base, board, lastMove: o + placed > 0 ? game.moves[o + placed - 1] : -1,
    toMove: ((o + placed) % 2 === 0 ? 1 : 2) as Color, moveIndex: o + placed, phase,
    move: discrete ? null : { mover, cell: game.moves[o + a], sinceMs: since, thinkMs: th },
    handT01: discrete ? 0 : hand, pending: !discrete && since >= th && placed === a ? { move: game.moves[o + a], color } : null,
  }
}
