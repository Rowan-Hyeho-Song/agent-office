// #604 (hologram.md 11.4 · 11.6, #650) agents playing chess at the hologram table: the games of a session, deterministic from its seed, as a
// timeline the stage reads at any time. Like omok's gameAt, but a chess AI move is costly (normal ≈ 13 ms, strong ≈ 48 ms), so a session's games
// are computed a few half-moves per call and cached: jumping into the middle of a session (the timelapse, a seek) catches up over a few frames
// instead of stopping one. Whatever the budget, the same seed and time give the same position (only how soon it is reached differs).
//
//   a half-move: the mover thinks (0.6–1.6 s, longer with more moves to choose from), then its hand takes the piece (the pick at 0.37 s), carries
//   it and puts it down at 0.92 s, back at 1.25 s; the next half-move begins then
//   a game ends by the rules, or at 120 moves (240 half-moves, our limit: '무승부 · 수 제한 · 120수'); the result shows, the board is wiped, and the
//   next game begins with the colours swapped

import { hash } from '../office/play'
import type { Level, Outcome, Side } from './boardGame'
import { aiMove, fromOf, KING, legalMoves, outcome, PAWN, play, promoOf, startPosition, toOf, inCheck, type ChessMove, type ChessState } from './chess'

/** the hand's sequence after the thinking, ms (hologram.md 11.4): the piece taken, put down, the hand back */
export const CHESS_HAND = { pick: 370, land: 920, end: 1250 } as const
export const CHESS_THINK = { min: 600, max: 1600, perMove: 25 } as const
/** our limit (hologram.md 11.6, #650): an agents' game ends in a draw past 120 moves */
export const CHESS_LIMIT_PLIES = 240
/** after the last move: the result shows (the winner's pieces bright for 2 s), then the board is wiped (0.4 s) and a short gap */
export const CHESS_RESULT_MS = 2500
export const CHESS_RESET_MS = 600
/** half-moves computed at most per call (each is one AI move): a seek catches up over frames, never stopping one */
export const CHESS_PLIES_PER_CALL = 2

/** the agents' levels at the table (their personalities: the planner and the coder play steadier), the strong level is the visitor's choice only */
export const CHESS_LEVEL: Record<string, Level> = { agent_0: 'normal', agent_1: 'easy', agent_2: 'easy', agent_3: 'normal', agent_4: 'easy' }
const levelOf = (agent: string): Level => CHESS_LEVEL[agent] ?? 'easy'

export interface ChessPly {
  move: ChessMove
  /** ms since the game began that this half-move begins (its thinking), and how long it thinks */
  start: number
  think: number
  /** the position after it */
  after: ChessState
  /** what it took (the captured piece's kind, 0 = nothing), and where it stood (en passant: not the destination) */
  capture: number
  captureAt: number
  /** castling: the rook's squares; the promotion's new kind (0 = none); whether it gives check */
  castle: { from: number; to: number } | null
  promo: number
  check: boolean
}

export interface ChessGame {
  /** which player (index into the session's players) has white */
  white: 0 | 1
  /** ms since the session began that this game begins */
  start: number
  plies: ChessPly[]
  /** decided once its last half-move is computed */
  end: (Outcome & { plies: number }) | null
}

interface Run {
  seed: number
  players: [string, string]
  games: ChessGame[]
}

const cache = new Map<string, Run>()

const thinkOf = (s: ChessState) => Math.min(CHESS_THINK.max, CHESS_THINK.min + legalMoves(s).length * CHESS_THINK.perMove)
const plyLength = (p: ChessPly) => p.think + CHESS_HAND.end
/** ms since the game began that it ends (its last move back, the result, the wipe) */
export const gameLength = (g: ChessGame) => {
  const last = g.plies[g.plies.length - 1]
  return (last ? last.start + plyLength(last) : 0) + CHESS_RESULT_MS + CHESS_RESET_MS
}
/** where the game stands after its plies (the start position when none) */
const stateOf = (g: ChessGame) => g.plies[g.plies.length - 1]?.after ?? startPosition()

/** the outcome with our limit */
function endOf(s: ChessState, plies: number): (Outcome & { plies: number }) | null {
  const o = outcome(s)
  if (o.kind !== 'playing') return { ...o, plies }
  return plies >= CHESS_LIMIT_PLIES ? { kind: 'draw', reason: 'limit', plies } : null
}

/** one more half-move of the run (or the next game); false when the run cannot go on (never: games follow one another) */
function step(run: Run) {
  let g = run.games[run.games.length - 1]
  if (g.end) {
    g = { white: (1 - g.white) as 0 | 1, start: g.start + gameLength(g), plies: [], end: null }
    run.games.push(g)
  }
  const s = stateOf(g)
  const n = g.plies.length
  const end = endOf(s, n)
  if (end) {
    g.end = end
    return
  }
  // the side to move is white (0) or black (1); the player holding it
  const mover = s.side === 0 ? g.white : ((1 - g.white) as 0 | 1)
  const move = aiMove(s, levelOf(run.players[mover]), hash(`${run.seed}|chess|${run.games.length - 1}|${n}`))
  const after = play(s, move)!
  const from = fromOf(move)
  const to = toOf(move)
  const piece = Math.abs(s.board[from])
  let capture = Math.abs(s.board[to])
  let captureAt = capture ? to : -1
  // en passant: a pawn moving diagonally onto the empty en passant square takes the pawn beside it
  if (piece === PAWN && !capture && (from & 7) !== (to & 7)) {
    captureAt = to + (s.side === 0 ? -8 : 8)
    capture = PAWN
  }
  const castle = piece === KING && Math.abs(to - from) === 2 ? (to > from ? { from: to + 1, to: to - 1 } : { from: to - 2, to: to + 1 }) : null
  const prev = g.plies[n - 1]
  const start = prev ? prev.start + plyLength(prev) : 0
  g.plies.push({ move, start, think: thinkOf(s), after, capture, captureAt, castle, promo: promoOf(move), check: inCheck(after) })
}

/** the run of a session's games, computed at least to `tMs` (ms since the session began) or by `budget` more half-moves */
function runTo(seed: number, players: [string, string], tMs: number, budget: number): { run: Run; reached: boolean } {
  const key = `${seed}|${players[0]}|${players[1]}`
  let run = cache.get(key)
  if (!run) {
    if (cache.size >= 32) cache.delete(cache.keys().next().value!)
    // the first game: the player at the first spot has white
    run = { seed, players, games: [{ white: 0, start: 0, plies: [], end: null }] }
    cache.set(key, run)
  }
  const known = () => {
    const g = run!.games[run!.games.length - 1]
    if (g.end) return g.start + gameLength(g)
    const last = g.plies[g.plies.length - 1]
    // a half-move is known once it is computed: up to its end
    return g.start + (last ? last.start + plyLength(last) : 0)
  }
  for (let k = 0; k < budget && known() <= tMs; k++) step(run)
  return { run, reached: known() > tMs }
}

export interface ChessMoveView {
  /** the player moving (index into players) and its colour */
  mover: 0 | 1
  side: Side
  from: number
  to: number
  /** the moving piece's kind, what it takes (0 = nothing) and where, the castling rook, the promotion */
  kind: number
  capture: number
  captureAt: number
  castle: { from: number; to: number } | null
  promo: number
  check: boolean
  /** ms since the half-move began, and its thinking */
  sinceMs: number
  thinkMs: number
}

export interface ChessView {
  game: number
  /** which player has white this game */
  white: 0 | 1
  /** the position on the board: after the last half-move that has landed */
  board: Int8Array
  toMove: Side
  lastMove: { from: number; to: number } | null
  /** the king in check now (its square), or null */
  check: number | null
  /** pieces taken so far: by white (black ones), by black (white ones), in order */
  takenByWhite: number[]
  takenByBlack: number[]
  /** half-moves landed this game */
  moveIndex: number
  phase: 'thinking' | 'pick' | 'place' | 'result' | 'reset' | 'catching'
  /** the half-move in progress (thinking, the hand on its way, back), null between games */
  move: ChessMoveView | null
  /** the game's end once it has come (and ms since its last move landed) */
  end: (Outcome & { plies: number; sinceMs: number }) | null
}

function viewOf(g: ChessGame, game: number, tGame: number): ChessView {
  // the half-moves landed by now, and the one in progress
  let landed = 0
  let cur: ChessPly | null = null
  for (const p of g.plies) {
    if (tGame >= p.start + p.think + CHESS_HAND.land) landed++
    if (tGame >= p.start && tGame < p.start + plyLength(p)) cur = p
  }
  const last = landed ? g.plies[landed - 1] : null
  const state = last?.after ?? startPosition()
  const takenByWhite: number[] = []
  const takenByBlack: number[] = []
  g.plies.slice(0, landed).forEach((p, i) => {
    if (!p.capture) return
    // the first half-move of a game is white's
    ;(i % 2 === 0 ? takenByWhite : takenByBlack).push(p.capture)
  })
  const kingSq = state.board.findIndex((v) => v === (state.side === 0 ? KING : -KING))
  const lastPly = g.plies[g.plies.length - 1]
  const endAt = lastPly ? lastPly.start + lastPly.think + CHESS_HAND.land : 0
  const end = g.end && tGame >= endAt && landed === g.plies.length ? { ...g.end, sinceMs: tGame - endAt } : null
  let phase: ChessView['phase'] = 'thinking'
  let move: ChessMoveView | null = null
  if (cur) {
    const i = g.plies.indexOf(cur)
    const before = i ? g.plies[i - 1].after : startPosition()
    const side = before.side
    const since = tGame - cur.start
    move = {
      mover: side === 0 ? g.white : ((1 - g.white) as 0 | 1),
      side,
      from: fromOf(cur.move),
      to: toOf(cur.move),
      kind: Math.abs(before.board[fromOf(cur.move)]),
      capture: cur.capture,
      captureAt: cur.captureAt,
      castle: cur.castle,
      promo: cur.promo,
      check: cur.check,
      sinceMs: since,
      thinkMs: cur.think,
    }
    phase = since < cur.think + CHESS_HAND.pick ? 'thinking' : since < cur.think + CHESS_HAND.land ? 'pick' : 'place'
  } else if (end) phase = end.sinceMs < CHESS_RESULT_MS ? 'result' : 'reset'
  return {
    game,
    white: g.white,
    board: state.board.slice(),
    toMove: state.side,
    lastMove: last ? { from: fromOf(last.move), to: toOf(last.move) } : null,
    check: inCheck(state) && kingSq >= 0 ? kingSq : null,
    takenByWhite,
    takenByBlack,
    moveIndex: landed,
    phase,
    move,
    end,
  }
}

/**
 * The agents' chess at `tMs` (ms since the session's start, its settling over). `budget`: half-moves it may compute now; when the games are not
 * computed that far yet, the view is the last computed moment with phase 'catching' (no hand: the board as it was), and a later call goes on.
 */
export function chessAt(seed: number, players: [string, string], tMs: number, budget = CHESS_PLIES_PER_CALL): ChessView {
  const { run, reached } = runTo(seed, players, Math.max(0, tMs), budget)
  if (!reached) {
    const gi = run.games.length - 1
    const g = run.games[gi]
    const last = g.plies[g.plies.length - 1]
    const v = viewOf(g, gi, last ? last.start + last.think + CHESS_HAND.land : 0)
    return { ...v, phase: 'catching', move: null }
  }
  let gi = 0
  for (let i = run.games.length - 1; i >= 0; i--)
    if (run.games[i].start <= tMs) {
      gi = i
      break
    }
  const g = run.games[gi]
  return viewOf(g, gi, Math.max(0, tMs) - g.start)
}

/** tests: forget the cached runs */
export const resetChessCache = () => cache.clear()
