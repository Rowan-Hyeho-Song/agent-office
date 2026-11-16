// #604 chess, apart from any drawing (the hologram table, #538): the full rules and a deterministic AI, behind the game frame (boardGame.ts).
//
// The board is 64 cells, a1 = 0, b1 = 1, ..., h8 = 63 (rank * 8 + file). A cell holds 0 (empty) or a piece: + for white, - for black,
// 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king.
//
// Rules: castling (rights, empty and unattacked squares), en passant, promotion (any of N B R Q; the HUD offers the queen first), check,
// checkmate, stalemate, and three draws that end the game by themselves (no claim at a table of agents): fifty moves (100 half-moves
// without a pawn move or a capture), the same position a third time (same side to move, castling rights and en passant chance), and
// material that cannot mate (K v K, K+N v K, K+B v K, bishops all on one colour).
//
// The AI: iterative deepening alpha-beta (captures searched out to a quiet position) over material and piece-square tables, with a
// node budget instead of a clock (a clock would make the move depend on the machine): the deepest finished search wins. Each level
// adds a small seeded jitter to the root moves' scores so agents differ and the same seed always plays the same game.

import { hash } from '../office/play'
import type { BoardGame, Level, Outcome, Side } from './boardGame'

export const PAWN = 1
export const KNIGHT = 2
export const BISHOP = 3
export const ROOK = 4
export const QUEEN = 5
export const KING = 6

/** a move: from | to << 6 | promotion piece << 12 (0 = none) */
export type ChessMove = number
export const mv = (from: number, to: number, promo = 0): ChessMove => from | (to << 6) | (promo << 12)
export const fromOf = (m: ChessMove) => m & 63
export const toOf = (m: ChessMove) => (m >> 6) & 63
export const promoOf = (m: ChessMove) => (m >> 12) & 7

/** castling rights: white king side, white queen side, black king side, black queen side */
const WK = 1
const WQ = 2
const BK = 4
const BQ = 8

export interface ChessState {
  readonly board: Int8Array
  readonly side: Side
  readonly castle: number
  /** the en passant target cell (behind a pawn that just moved two), or -1 */
  readonly ep: number
  /** half-moves since the last pawn move or capture (the fifty-move rule) */
  readonly half: number
  /** the move number (FEN's, from 1, up after black moves) */
  readonly full: number
  /** the positions since the last pawn move or capture, this one last (repetition) */
  readonly keys: readonly string[]
}

const FILES = 'abcdefgh'
const LETTERS = ' pnbrqk'
const fileOf = (sq: number) => sq & 7
const rankOf = (sq: number) => sq >> 3
const sign = (side: Side) => (side === 0 ? 1 : -1)
export const squareName = (sq: number) => `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`
export const squareAt = (name: string) => {
  const f = FILES.indexOf(name[0])
  const r = Number(name[1]) - 1
  return name.length === 2 && f >= 0 && r >= 0 && r < 8 ? r * 8 + f : -1
}

const KNIGHT_STEPS: readonly [number, number][] = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
const KING_STEPS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const DIAG: readonly [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]]
const ORTH: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** the cell a step away, or -1 off the board */
const step = (sq: number, df: number, dr: number) => {
  const f = fileOf(sq) + df
  const r = rankOf(sq) + dr
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1
}

/** is `sq` attacked by `by`'s pieces */
export function attacked(board: Int8Array, sq: number, by: Side): boolean {
  const s = sign(by)
  // pawns: a white pawn attacks up the board, so it stands a rank below
  for (const df of [-1, 1]) {
    const p = step(sq, df, -s)
    if (p >= 0 && board[p] === s * PAWN) return true
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    const p = step(sq, df, dr)
    if (p >= 0 && board[p] === s * KNIGHT) return true
  }
  for (const [df, dr] of KING_STEPS) {
    const p = step(sq, df, dr)
    if (p >= 0 && board[p] === s * KING) return true
  }
  for (const [dirs, a, b] of [[DIAG, BISHOP, QUEEN], [ORTH, ROOK, QUEEN]] as const) {
    for (const [df, dr] of dirs) {
      let p = step(sq, df, dr)
      while (p >= 0) {
        const q = board[p]
        if (q) {
          if (q === s * a || q === s * b) return true
          break
        }
        p = step(p, df, dr)
      }
    }
  }
  return false
}

const kingAt = (board: Int8Array, side: Side) => board.indexOf(sign(side) * KING)
export const inCheck = (s: ChessState) => attacked(s.board, kingAt(s.board, s.side), (1 - s.side) as Side)

/** the moves by the piece rules, the king's safety not yet checked (castling through check is) */
function pseudoMoves(s: ChessState, capturesOnly = false): ChessMove[] {
  const out: ChessMove[] = []
  const { board, side } = s
  const me = sign(side)
  const them = (1 - side) as Side
  const promoRank = side === 0 ? 7 : 0
  for (let from = 0; from < 64; from++) {
    const pc = board[from] * me
    if (pc <= 0) continue
    if (pc === PAWN) {
      const push = (to: number) => {
        if (rankOf(to) === promoRank) for (const k of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(mv(from, to, k))
        else out.push(mv(from, to))
      }
      const one = step(from, 0, me)
      if (one >= 0 && !board[one] && (!capturesOnly || rankOf(one) === promoRank)) {
        push(one)
        const two = step(one, 0, me)
        if (!capturesOnly && rankOf(from) === (side === 0 ? 1 : 6) && !board[two]) out.push(mv(from, two))
      }
      for (const df of [-1, 1]) {
        const to = step(from, df, me)
        if (to >= 0 && (board[to] * me < 0 || to === s.ep)) push(to)
      }
      continue
    }
    if (pc === KNIGHT || pc === KING) {
      for (const [df, dr] of pc === KNIGHT ? KNIGHT_STEPS : KING_STEPS) {
        const to = step(from, df, dr)
        if (to >= 0 && board[to] * me <= 0 && (!capturesOnly || board[to])) out.push(mv(from, to))
      }
      if (pc === KING && !capturesOnly) {
        const home = side === 0 ? 4 : 60
        const [kSide, qSide] = side === 0 ? [WK, WQ] : [BK, BQ]
        if (from === home && !attacked(board, home, them)) {
          if (s.castle & kSide && !board[home + 1] && !board[home + 2] && board[home + 3] === me * ROOK && !attacked(board, home + 1, them)) out.push(mv(home, home + 2))
          if (s.castle & qSide && !board[home - 1] && !board[home - 2] && !board[home - 3] && board[home - 4] === me * ROOK && !attacked(board, home - 1, them)) out.push(mv(home, home - 2))
        }
      }
      continue
    }
    const dirs = pc === BISHOP ? DIAG : pc === ROOK ? ORTH : [...DIAG, ...ORTH]
    for (const [df, dr] of dirs) {
      let to = step(from, df, dr)
      while (to >= 0) {
        const q = board[to] * me
        if (q > 0) break
        if (!capturesOnly || q < 0) out.push(mv(from, to))
        if (q < 0) break
        to = step(to, df, dr)
      }
    }
  }
  return out
}

/** the rights a move through these cells takes away (a king or rook leaving home, a rook taken at home) */
const RIGHTS_LOST: Record<number, number> = { 0: WQ, 4: WK | WQ, 7: WK, 56: BQ, 60: BK | BQ, 63: BK }

/** the position after a move, the repetition record left as it was (play() adds to it) */
function apply(s: ChessState, m: ChessMove): ChessState {
  const board = s.board.slice()
  const from = fromOf(m)
  const to = toOf(m)
  const pc = board[from]
  const me = sign(s.side)
  let captured = board[to] !== 0
  if (pc === me * PAWN && to === s.ep && !board[to]) {
    board[to - me * 8] = 0
    captured = true
  }
  board[to] = promoOf(m) ? me * promoOf(m) : pc
  board[from] = 0
  if (pc === me * KING && Math.abs(to - from) === 2) {
    if (to > from) {
      board[from + 1] = board[from + 3]
      board[from + 3] = 0
    } else {
      board[from - 1] = board[from - 4]
      board[from - 4] = 0
    }
  }
  const pawn = pc === me * PAWN
  return {
    board,
    side: (1 - s.side) as Side,
    castle: s.castle & ~(RIGHTS_LOST[from] ?? 0) & ~(RIGHTS_LOST[to] ?? 0),
    ep: pawn && Math.abs(to - from) === 16 ? (from + to) / 2 : -1,
    half: pawn || captured ? 0 : s.half + 1,
    full: s.full + (s.side === 1 ? 1 : 0),
    keys: s.keys,
  }
}

const legalAfter = (s: ChessState, n: ChessState) => !attacked(n.board, kingAt(n.board, s.side), n.side)

/** every legal move */
export function legalMoves(s: ChessState): ChessMove[] {
  return pseudoMoves(s).filter((m) => legalAfter(s, apply(s, m)))
}

/** leaf positions `depth` plies on (the standard move-generator check) */
export function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1
  let n = 0
  for (const m of pseudoMoves(s)) {
    const c = apply(s, m)
    if (legalAfter(s, c)) n += depth === 1 ? 1 : perft(c, depth - 1)
  }
  return n
}

// ── FEN ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

/** the en passant cell only when a pawn could really take there (so the same position is the same key) */
function epShown(s: ChessState): number {
  if (s.ep < 0) return -1
  const me = sign(s.side)
  for (const df of [-1, 1]) {
    const p = step(s.ep, df, -me)
    if (p >= 0 && s.board[p] === me * PAWN) return s.ep
  }
  return -1
}

function placement(board: Int8Array): string {
  const rows: string[] = []
  for (let r = 7; r >= 0; r--) {
    let row = ''
    let gap = 0
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f]
      if (!p) {
        gap++
        continue
      }
      if (gap) row += gap
      gap = 0
      const l = LETTERS[Math.abs(p)]
      row += p > 0 ? l.toUpperCase() : l
    }
    rows.push(gap ? row + gap : row)
  }
  return rows.join('/')
}

const castleText = (c: number) => (c & WK ? 'K' : '') + (c & WQ ? 'Q' : '') + (c & BK ? 'k' : '') + (c & BQ ? 'q' : '') || '-'

/** what makes two positions the same for repetition: placement, side, castling rights, a real en passant chance */
export function positionKey(s: ChessState): string {
  const ep = epShown(s)
  return `${placement(s.board)} ${s.side === 0 ? 'w' : 'b'} ${castleText(s.castle)} ${ep < 0 ? '-' : squareName(ep)}`
}

export function toFen(s: ChessState): string {
  return `${placement(s.board)} ${s.side === 0 ? 'w' : 'b'} ${castleText(s.castle)} ${s.ep < 0 ? '-' : squareName(s.ep)} ${s.half} ${s.full}`
}

/** a position from FEN, or null when it is not one (two kings, the side not to move not in check) */
export function fromFen(fen: string): ChessState | null {
  const [place, side, castle = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/)
  const rows = place?.split('/') ?? []
  if (rows.length !== 8 || (side !== 'w' && side !== 'b')) return null
  const board = new Int8Array(64)
  for (let i = 0; i < 8; i++) {
    let f = 0
    for (const ch of rows[i]) {
      if (/[1-8]/.test(ch)) f += Number(ch)
      else {
        const k = LETTERS.indexOf(ch.toLowerCase())
        if (k < 1 || f > 7) return null
        board[(7 - i) * 8 + f] = ch === ch.toUpperCase() ? k : -k
        f++
      }
    }
    if (f !== 8) return null
  }
  if (board.filter((p) => p === KING).length !== 1 || board.filter((p) => p === -KING).length !== 1) return null
  let c = 0
  for (const ch of castle) c |= ch === 'K' ? WK : ch === 'Q' ? WQ : ch === 'k' ? BK : ch === 'q' ? BQ : 0
  const epSq = ep === '-' ? -1 : squareAt(ep)
  const s: ChessState = { board, side: side === 'w' ? 0 : 1, castle: c, ep: epSq, half: Number(half) || 0, full: Number(full) || 1, keys: [] }
  if (attacked(board, kingAt(board, (1 - s.side) as Side), s.side)) return null
  return { ...s, keys: [positionKey(s)] }
}

export const startPosition = () => fromFen(START_FEN)!

/** the position after a legal move (null for any other), with the repetition record */
export function play(s: ChessState, m: ChessMove): ChessState | null {
  if (!legalMoves(s).includes(m)) return null
  const n = apply(s, m)
  const key = positionKey(n)
  return { ...n, keys: n.half === 0 ? [key] : [...s.keys, key] }
}

// ── the end ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** neither side can ever mate: kings alone, one minor piece, or bishops only, all on one colour of square */
export function insufficient(board: Int8Array): boolean {
  const rest: { p: number; sq: number }[] = []
  for (let sq = 0; sq < 64; sq++) if (board[sq] && Math.abs(board[sq]) !== KING) rest.push({ p: Math.abs(board[sq]), sq })
  if (rest.length === 0) return true
  if (rest.length === 1 && (rest[0].p === KNIGHT || rest[0].p === BISHOP)) return true
  if (rest.every((r) => r.p === BISHOP)) return new Set(rest.map((r) => (fileOf(r.sq) + rankOf(r.sq)) % 2)).size === 1
  return false
}

export function outcome(s: ChessState): Outcome {
  if (legalMoves(s).length === 0) return inCheck(s) ? { kind: 'win', side: (1 - s.side) as Side, reason: 'checkmate' } : { kind: 'draw', reason: 'stalemate' }
  if (insufficient(s.board)) return { kind: 'draw', reason: 'material' }
  if (s.half >= 100) return { kind: 'draw', reason: 'fifty' }
  const key = s.keys[s.keys.length - 1]
  if (s.keys.filter((k) => k === key).length >= 3) return { kind: 'draw', reason: 'repetition' }
  return { kind: 'playing' }
}

// ── the AI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const VALUE = [0, 100, 320, 330, 500, 900, 0]
// piece-square tables for white, a1 first (rank 1 to 8); black reads them mirrored
// prettier-ignore
const PST: readonly (readonly number[])[] = [
  [],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, -20, -20, 10, 10, 5, 5, -5, -10, 0, 0, -10, -5, 5, 0, 0, 0, 20, 20, 0, 0, 0,
    5, 5, 10, 25, 25, 10, 5, 5, 10, 10, 20, 30, 30, 20, 10, 10, 50, 50, 50, 50, 50, 50, 50, 50, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 5, 5, 0, -20, -40, -30, 5, 10, 15, 15, 10, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 10, 15, 15, 10, 0, -30, -40, -20, 0, 0, 0, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 5, 0, 0, 0, 0, 5, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 5, 5, 0, 0, 0, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 5, 10, 10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 5, 0, 0, 0, 0, -10, -10, 5, 5, 5, 5, 5, 0, -10, 0, 0, 5, 5, 5, 5, 0, -5,
    -5, 0, 5, 5, 5, 5, 0, -5, -10, 0, 5, 5, 5, 5, 0, -10, -10, 0, 0, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [20, 30, 10, 0, 0, 10, 30, 20, 20, 20, 0, 0, 0, 0, 20, 20, -10, -20, -20, -20, -20, -20, -20, -10, -20, -30, -30, -40, -40, -30, -30, -20,
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30],
]

/** the position for the side to move, in centipawns */
export function evaluate(s: ChessState): number {
  let score = 0
  for (let sq = 0; sq < 64; sq++) {
    const p = s.board[sq]
    if (!p) continue
    const k = Math.abs(p)
    score += p > 0 ? VALUE[k] + PST[k][sq] : -(VALUE[k] + PST[k][sq ^ 56])
  }
  return s.side === 0 ? score : -score
}

const MATE = 100_000

/** the AI's levels: how deep it looks, how many positions it may visit (in place of a clock), how much its seed sways the root */
export const CHESS_AI: Record<Level, { depth: number; nodes: number; jitter: number }> = {
  easy: { depth: 1, nodes: 4_000, jitter: 90 },
  normal: { depth: 2, nodes: 25_000, jitter: 20 },
  strong: { depth: 3, nodes: 60_000, jitter: 4 },
}
/** how many plies of captures the search follows past its depth */
const QUIET_PLIES = 4

/** captures first, the most valuable victim by the least valuable attacker; promotions with them */
function ordered(s: ChessState, moves: ChessMove[]): ChessMove[] {
  const score = (m: ChessMove) => {
    const victim = Math.abs(s.board[toOf(m)]) || (toOf(m) === s.ep && Math.abs(s.board[fromOf(m)]) === PAWN ? PAWN : 0)
    return (victim ? 10 * VALUE[victim] - VALUE[Math.abs(s.board[fromOf(m)])] : 0) + (promoOf(m) ? VALUE[promoOf(m)] : 0)
  }
  return moves.map((m) => ({ m, k: score(m) })).sort((a, b) => b.k - a.k || a.m - b.m).map((x) => x.m)
}

class OutOfNodes extends Error {}

function search(s: ChessState, depth: number, alpha: number, beta: number, ply: number, budget: { left: number }): number {
  if (--budget.left < 0) throw new OutOfNodes()
  if (s.half >= 100 || insufficient(s.board)) return 0
  if (depth <= 0) return quiet(s, alpha, beta, QUIET_PLIES, budget)
  let any = false
  for (const m of ordered(s, pseudoMoves(s))) {
    const c = apply(s, m)
    if (!legalAfter(s, c)) continue
    any = true
    const v = -search(c, depth - 1, -beta, -alpha, ply + 1, budget)
    if (v >= beta) return v
    if (v > alpha) alpha = v
  }
  if (!any) return inCheck(s) ? -MATE + ply : 0
  return alpha
}

function quiet(s: ChessState, alpha: number, beta: number, plies: number, budget: { left: number }): number {
  if (--budget.left < 0) throw new OutOfNodes()
  const stand = evaluate(s)
  if (stand >= beta || plies <= 0) return stand
  if (stand > alpha) alpha = stand
  for (const m of ordered(s, pseudoMoves(s, true))) {
    const c = apply(s, m)
    if (!legalAfter(s, c)) continue
    const v = -quiet(c, -beta, -alpha, plies - 1, budget)
    if (v >= beta) return v
    if (v > alpha) alpha = v
  }
  return alpha
}

/** the seed's sway on one root move, in [-j, j] */
const jitterOf = (seed: number, m: ChessMove, j: number) => (j ? (hash(`${seed}|${m}`) % (2 * j + 1)) - j : 0)

/** the AI's move for the side to move (there is one): the same position, level and seed give the same move */
export function aiMove(s: ChessState, level: Level, seed: number): ChessMove {
  const cfg = CHESS_AI[level]
  const roots = ordered(s, legalMoves(s))
  if (roots.length === 0) throw new Error('no move: the game is over')
  const budget = { left: cfg.nodes }
  let best = roots[0]
  for (let depth = 1; depth <= cfg.depth; depth++) {
    try {
      let top = -Infinity
      let pick = roots[0]
      for (const m of roots) {
        const c = play(s, m)!
        // a move into the third repetition or a dead draw is worth nothing, whatever the board says
        const end = outcome(c)
        const v = end.kind === 'draw' ? 0 : end.kind === 'win' ? MATE : -search(c, depth - 1, -MATE - 1, MATE + 1, 1, budget)
        const scored = v + (Math.abs(v) >= MATE - 100 ? 0 : jitterOf(seed, m, cfg.jitter))
        if (scored > top) {
          top = scored
          pick = m
        }
      }
      best = pick
    } catch (e) {
      if (e instanceof OutOfNodes) break
      throw e
    }
  }
  return best
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** UCI: e2e4, e7e8q, e1g1 for castling */
export const moveText = (m: ChessMove) => `${squareName(fromOf(m))}${squareName(toOf(m))}${promoOf(m) ? LETTERS[promoOf(m)] : ''}`

/** a legal move from UCI (a pawn reaching the last rank without a letter becomes a queen) */
export function parseMove(s: ChessState, text: string): ChessMove | null {
  const t = text.trim().toLowerCase()
  const from = squareAt(t.slice(0, 2))
  const to = squareAt(t.slice(2, 4))
  if (from < 0 || to < 0 || t.length > 5) return null
  const promo = t.length === 5 ? LETTERS.indexOf(t[4]) : 0
  if (t.length === 5 && (promo < KNIGHT || promo > QUEEN)) return null
  const legal = legalMoves(s).filter((m) => fromOf(m) === from && toOf(m) === to)
  return legal.find((m) => promoOf(m) === promo) ?? (promo === 0 ? (legal.find((m) => promoOf(m) === QUEEN) ?? null) : null)
}

export const chess: BoardGame<ChessState, ChessMove> = {
  id: 'chess',
  name: '체스',
  sides: ['백', '흑'],
  start: startPosition,
  toMove: (s) => s.side,
  moves: (s) => (outcome(s).kind === 'playing' ? legalMoves(s) : []),
  play: (s, m) => (outcome(s).kind === 'playing' ? play(s, m) : null),
  outcome,
  ai: aiMove,
  moveText,
  parseMove: (s, t) => (outcome(s).kind === 'playing' ? parseMove(s, t) : null),
  save: (s) => JSON.stringify({ fen: toFen(s), keys: s.keys }),
  load: (text) => {
    try {
      const o = JSON.parse(text) as { fen?: unknown; keys?: unknown }
      const s = typeof o.fen === 'string' ? fromFen(o.fen) : null
      if (!s) return null
      const keys = Array.isArray(o.keys) && o.keys.every((k) => typeof k === 'string') && o.keys.length ? (o.keys as string[]) : s.keys
      return keys[keys.length - 1] === positionKey(s) ? { ...s, keys } : null
    } catch {
      return null
    }
  },
}
