// #604 ② a visitor's game of hologram chess against an agent (hologram.md 10.3 · 11.4 – 11.6, play.md 2 · 5 · 10). Only in that visitor's tab (no
// server). The twin of visitorOmok.ts: pure, every step takes `now` (ms) and returns the new game and what the agent shows (lines, faces); the stage
// draws it through the same ChessView as the agents' own games (chessTimeline.ts), so the agent's hand picks and puts down its piece the same way.
//
//  - sides: the visitor has white in the sitting's first game (they move first), the sides swap every game (`restartChess`)
//  - the visitor's move lands at once (no hand); the agent's: it thinks 0.6–1.6 s, its hand takes CHESS_HAND.land (0.92 s) to put the piece down
//    and 1.25 s to be back, the move counts on the board from the landing
//  - no 120-move limit (that is the agents' own games'): checkmate, stalemate, fifty moves, three repetitions, material only
//  - counting: "수" is a full move (white + black, FEN's move number): `당신 차례 · 12수` is the 12th move; a result counts the full moves played
//    (a mate on the 31st move, by white or by black: `31수`); the agents' limit '120수' is 240 half-moves, counted the same way

import { capResult, iga } from './workHold'
import { hash } from '../office/play'
import type { Level, Side } from './boardGame'
import { aiMove, attacked, inCheck, KING, legalMoves, mv, outcome, PAWN, play, promoOf, fromOf, toOf, squareName, startPosition, type ChessMove, type ChessState } from './chess'
import { CHESS_HAND, CHESS_THINK, type ChessMoveView, type ChessView } from './chessTimeline'
import { OMOK_LINES, STRENGTHS, STRENGTH_NAME, VISITOR_OMOK, type Face, type OmokEvent, type Strength } from './visitorOmok'

export { STRENGTHS, STRENGTH_NAME, type Strength, type Face }
export type ChessEvent = OmokEvent

/** the strength chip's words go to the engine's levels one to one (hologram.md 10.3) */
export const CHESS_STRENGTH_LEVEL: Record<Strength, Level> = { easy: 'easy', normal: 'normal', strong: 'strong' }

/** what the agent says (hologram.md 11.4; the rest are play.md 2.5 · 5.3's, shared with omok) */
export const CHESS_LINES = {
  check: '체크예요',
  avoid: '어, 이건 피해야겠어요',
  visitorWon: OMOK_LINES.visitorWon,
  agentWon: OMOK_LINES.agentWon,
  firstUndo: OMOK_LINES.firstUndo,
  idle: OMOK_LINES.idle,
  work: OMOK_LINES.work,
  easy: OMOK_LINES.easy,
  strong: OMOK_LINES.strong,
} as const

/** how a game ended: a side won (checkmate, or the visitor's resignation), a draw, or the visitor left / the agent was called to work */
export type EndResult = 'white' | 'black' | 'draw' | 'resign' | 'idle' | 'work' | 'quit'
export type EndReason = 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material' | 'resign'

/** one half-move of the game, with what the stage draws of it (the fields of chessTimeline's ChessPly) */
export interface VisitorPly {
  move: ChessMove
  by: 'agent' | 'visitor'
  side: Side
  /** the moving piece's kind */
  kind: number
  /** what it took (0 = nothing) and where it stood (en passant: not the destination) */
  capture: number
  captureAt: number
  castle: { from: number; to: number } | null
  promo: number
  check: boolean
  /** the mover's piece was attacked before the move and is not on its new square (the agent's "피해야겠어요") */
  fled: boolean
}

/** the agent's move under way: what it will play, when it began thinking, how long it thinks */
export interface PendingMove {
  ply: VisitorPly
  at: number
  thinkMs: number
}

export interface VisitorChess {
  agent: string
  seed: number
  /** games played in this sitting (restartChess starts the next) */
  game: number
  strength: Strength
  /** the position the game began from (the standard start unless a test gave another) */
  base: ChessState
  /** the visitor's colour: white (0) in game 0, then swapping */
  color: Side
  /** the position as it stands (the agent's move joins it at its landing) */
  s: ChessState
  /** the half-moves on the board, in order */
  plies: VisitorPly[]
  pending: PendingMove | null
  /** the agent's last move, whose hand is still withdrawing */
  landed: PendingMove | null
  undos: number
  /** the reaction lines already said this game (each at most once) */
  said: string[]
  lastInput: number
  end: { result: EndResult; reason?: EndReason; at: number } | null
}

export type ChessResult = { g: VisitorChess; events: ChessEvent[] }

const otherSide = (c: Side): Side => (1 - c) as Side
const sideWord = (c: Side): 'white' | 'black' => (c === 0 ? 'white' : 'black')
const SIDE_NAME = ['백', '흑'] as const
const PIECE_NAME = ['', '폰', '나이트', '비숍', '룩', '퀸', '킹'] as const

/** the visitor's and the agent's colours */
export const visitorColor = (g: VisitorChess): Side => g.color
export const agentColor = (g: VisitorChess): Side => otherSide(g.color)

/** what a move does on `s` (the half-move record), the mover being `by` */
export function describeMove(s: ChessState, m: ChessMove, by: 'agent' | 'visitor'): VisitorPly {
  const from = fromOf(m)
  const to = toOf(m)
  const after = play(s, m)!
  const kind = Math.abs(s.board[from])
  let capture = Math.abs(s.board[to])
  let captureAt = capture ? to : -1
  // en passant: a pawn moving diagonally onto an empty square takes the pawn beside it
  if (kind === PAWN && !capture && (from & 7) !== (to & 7)) {
    captureAt = to + (s.side === 0 ? -8 : 8)
    capture = PAWN
  }
  const castle = kind === KING && Math.abs(to - from) === 2 ? (to > from ? { from: to + 1, to: to - 1 } : { from: to - 2, to: to + 1 }) : null
  const foe = otherSide(s.side)
  const fled = kind !== KING && attacked(s.board, from, foe) && !attacked(after.board, to, foe)
  return { move: m, by, side: s.side, kind, capture, captureAt, castle, promo: promoOf(m), check: inCheck(after), fled }
}

/**
 * A new game. The visitor is white in game 0 and the sides swap with every `game`; when the agent has white it opens at once. `base`: a position
 * to begin from instead of the standard start (tests).
 */
export function startVisitorChess(agent: string, seed: number, now: number, strength: Strength = 'normal', game = 0, base: ChessState = startPosition()): VisitorChess {
  const g: VisitorChess = { agent, seed, game, strength, base, color: game % 2 === 0 ? 0 : 1, s: base, plies: [], pending: null, landed: null, undos: 0, said: [], lastInput: now, end: null }
  if (base.side !== g.color) g.pending = agentPending(g, now)
  return g
}

/** the next game in the same sitting: same agent and strength, the sides swapped */
export const restartChess = (g: VisitorChess, now: number) => startVisitorChess(g.agent, g.seed, now, g.strength, g.game + 1)

function agentPending(g: VisitorChess, now: number): PendingMove {
  const seed = hash(`${g.seed}|${g.game}|chess|${g.plies.length}`)
  const move = aiMove(g.s, CHESS_STRENGTH_LEVEL[g.strength], seed)
  return { ply: describeMove(g.s, move, 'agent'), at: now, thinkMs: thinkOf(g, seed) }
}

/** 0.6 s plus 25 ms a legal move, a seeded wobble of ±100 ms; within 0.6–1.6 s (hologram.md 11.4) */
function thinkOf(g: VisitorChess, seed: number): number {
  const wobble = ((hash(`${seed}|think`) / 4294967296) * 2 - 1) * 100
  const t = CHESS_THINK.min + legalMoves(g.s).length * CHESS_THINK.perMove + wobble
  return Math.round(Math.min(CHESS_THINK.max, Math.max(CHESS_THINK.min, t)))
}

const replay = (base: ChessState, plies: VisitorPly[]): ChessState => plies.reduce((s, p) => play(s, p.move)!, base)

/** the visitor may move now: their side to move, nothing in the agent's hand, the game on */
export const visitorChessTurn = (g: VisitorChess): boolean => !g.end && !g.pending && g.s.side === g.color && outcome(g.s).kind === 'playing'

/** the piece on a square, for the UI: its kind (1 pawn … 6 king), colour, and whether it is the visitor's; null on an empty square */
export function visitorPieceAt(g: VisitorChess, sq: number): { kind: number; side: Side; mine: boolean } | null {
  const v = g.s.board[sq]
  if (!v) return null
  const side: Side = v > 0 ? 0 : 1
  return { kind: Math.abs(v), side, mine: side === g.color }
}

/** where the visitor's piece on `from` may go now (a promotion square once), and whether it takes something there (en passant too); [] when not their turn */
export function legalTargets(g: VisitorChess, from: number): { to: number; capture: boolean }[] {
  if (!visitorChessTurn(g)) return []
  const out: { to: number; capture: boolean }[] = []
  for (const m of legalMoves(g.s)) {
    if (fromOf(m) !== from) continue
    const to = toOf(m)
    if (out.some((t) => t.to === to)) continue
    const ep = Math.abs(g.s.board[from]) === PAWN && !g.s.board[to] && (from & 7) !== (to & 7)
    out.push({ to, capture: g.s.board[to] !== 0 || ep })
  }
  return out
}

/** the promotion sheet's pieces in order (queen first: the focus); the values `visitorChessMove`'s `promo` takes */
export const PROMOTION_CHOICES = [5, 4, 3, 2] as const

const say = (g: VisitorChess, text: string, ev: ChessEvent[], once = false) => {
  if (once && g.said.includes(text)) return
  if (once) g.said.push(text)
  ev.push({ kind: 'say', text })
}

/**
 * The visitor moves `from` → `to`. null: not legal (or not their turn). 'needsPromotion': a pawn reaching the last rank without `promo` (2..5:
 * knight, bishop, rook, queen), the UI opens the promotion sheet and asks again with the choice. Otherwise the new game: the move lands at
 * once, and the agent's answer is on its way (g.pending) unless the game ended.
 */
export function visitorChessMove(g0: VisitorChess, from: number, to: number, now: number, promo?: number): ChessResult | 'needsPromotion' | null {
  if (!visitorChessTurn(g0)) return null
  const cands = legalMoves(g0.s).filter((m) => fromOf(m) === from && toOf(m) === to)
  if (!cands.length) return null
  let move: ChessMove
  if (promoOf(cands[0])) {
    if (promo === undefined) return 'needsPromotion'
    move = mv(from, to, promo)
    if (!cands.includes(move)) return null
  } else move = cands[0]
  const ply = describeMove(g0.s, move, 'visitor')
  const g: VisitorChess = { ...g0, s: play(g0.s, move)!, plies: [...g0.plies, ply], lastInput: now, said: [...g0.said], landed: null }
  const ev: ChessEvent[] = []
  const o = outcome(g.s)
  if (o.kind === 'win') {
    g.end = { result: sideWord(o.side), reason: 'checkmate', at: now }
    say(g, CHESS_LINES.visitorWon, ev)
    ev.push({ kind: 'face', face: 'embarrassed' })
  } else if (o.kind === 'draw') g.end = { result: 'draw', reason: o.reason as EndReason, at: now }
  else {
    g.pending = agentPending(g, now)
    ev.push({ kind: 'face', face: 'think' })
  }
  return { g, events: ev }
}

/**
 * The clock: the agent's piece lands when its hand gets there (the lines: '체크예요' on a check, '어, 이건 피해야겠어요' once a game when it moved a
 * piece out of attack; its win: joy); a quiet visitor is let go after idleMs.
 */
export function stepVisitorChess(g0: VisitorChess, now: number): ChessResult {
  const ev: ChessEvent[] = []
  if (g0.end) return { g: g0, events: ev }
  const p = g0.pending
  if (p && now >= p.at + p.thinkMs + CHESS_HAND.land) {
    const landAt = p.at + p.thinkMs + CHESS_HAND.land
    const s = play(g0.s, p.ply.move)!
    // the visitor's turn again: the idle clock counts from here
    const g: VisitorChess = { ...g0, s, plies: [...g0.plies, p.ply], pending: null, landed: p, lastInput: now, said: [...g0.said] }
    const o = outcome(s)
    if (o.kind === 'win') {
      g.end = { result: sideWord(o.side), reason: 'checkmate', at: landAt }
      say(g, CHESS_LINES.agentWon, ev)
      ev.push({ kind: 'face', face: 'joy' })
      return { g, events: ev }
    }
    if (o.kind === 'draw') g.end = { result: 'draw', reason: o.reason as EndReason, at: landAt }
    else if (p.ply.check) say(g, CHESS_LINES.check, ev)
    if (p.ply.fled) say(g, CHESS_LINES.avoid, ev, true)
    return { g, events: ev }
  }
  if (!p && now - g0.lastInput >= VISITOR_OMOK.idleMs) {
    const g = { ...g0, end: { result: 'idle' as const, at: now } }
    say(g, CHESS_LINES.idle, ev)
    return { g, events: ev }
  }
  return { g: g0, events: ev }
}

/** any key or touch: the idle clock starts again (play.md 5.7) */
export const touchChess = (g: VisitorChess, now: number): VisitorChess => (g.end ? g : { ...g, lastInput: now })

/** ms until the idle end, while the HUD should count them (the last warnMs), else null */
export function chessIdleLeft(g: VisitorChess, now: number): number | null {
  if (g.end || g.pending) return null
  const left = VISITOR_OMOK.idleMs - (now - g.lastInput)
  return left <= VISITOR_OMOK.warnMs ? Math.max(0, left) : null
}

/** the half-moves an undo takes back: the visitor's last alone (the agent is still thinking on it), else with the agent's answer after it */
const undoTake = (g: VisitorChess) => (g.plies[g.plies.length - 1]?.by === 'visitor' ? 1 : 2)
export const canUndoChess = (g: VisitorChess) => !g.end && g.undos < VISITOR_OMOK.undoMax && g.plies.some((p) => p.by === 'visitor') && g.plies.length >= undoTake(g)

/** take back the visitor's last move and the agent's answer (or cancel the answer it is still thinking about); null when not allowed (play.md 5.3) */
export function undoChess(g0: VisitorChess, now: number): (ChessResult & { removed: ChessMove[] }) | null {
  if (!canUndoChess(g0)) return null
  const ev: ChessEvent[] = []
  const take = undoTake(g0)
  const plies = g0.plies.slice(0, g0.plies.length - take)
  const removed = g0.plies.slice(g0.plies.length - take).map((p) => p.move)
  const g: VisitorChess = { ...g0, s: replay(g0.base, plies), plies, pending: null, landed: null, undos: g0.undos + 1, lastInput: now, said: [...g0.said] }
  if (g0.undos === 0) {
    say(g, CHESS_LINES.firstUndo, ev)
    ev.push({ kind: 'face', face: 'nod' })
  }
  return { g, events: ev, removed }
}

/** the strength from the next move on (play.md 5.2) */
export function setChessStrength(g: VisitorChess, strength: Strength, now: number): ChessResult {
  if (strength === g.strength) return { g, events: [] }
  const ev: ChessEvent[] = []
  if (strength === 'easy') ev.push({ kind: 'say', text: CHESS_LINES.easy })
  if (strength === 'strong') ev.push({ kind: 'say', text: CHESS_LINES.strong })
  return { g: { ...g, strength, lastInput: now }, events: ev }
}

/** the visitor leaves (quit, Esc), gives up (the agent wins) or the agent is called to work (its cap line) */
export function endChess(g: VisitorChess, why: 'quit' | 'work' | 'resign', now: number): ChessResult {
  if (g.end) return { g, events: [] }
  if (why === 'resign') {
    const events: ChessEvent[] = [{ kind: 'say', text: CHESS_LINES.agentWon }, { kind: 'face', face: 'joy' }]
    return { g: { ...g, pending: null, end: { result: 'resign', reason: 'resign', at: now } }, events }
  }
  const events: ChessEvent[] = why === 'work' ? [{ kind: 'say', text: CHESS_LINES.work }] : []
  return { g: { ...g, pending: null, end: { result: why, at: now } }, events }
}

/** the visitor won (checkmate of the agent) / the agent won (checkmate, or the visitor's resignation) */
export const chessVisitorWon = (g: VisitorChess) => !!g.end && g.end.result === sideWord(g.color)
export const chessAgentWon = (g: VisitorChess) => !!g.end && (g.end.result === sideWord(otherSide(g.color)) || g.end.result === 'resign')

// ---- what the screen shows -------------------------------------------------------------------------------------------

/** full moves played, white's and black's together (a mate on the 31st move: 31), as FEN counts them */
const fullMoves = (s: ChessState) => (s.side === 0 ? s.full - 1 : s.full)

const REASON_WORD: Record<EndReason, string> = { checkmate: '체크메이트', stalemate: '스테일메이트', fifty: '50수 규칙', repetition: '3회 반복', material: '기물 부족', resign: '기권' }

/** the result line (hologram.md 11.6): `백 승 · 체크메이트 · 31수`, `무승부 · 스테일메이트 · 40수`; a visitor who left or was wound up: `중단 · n수`; null while it goes on */
export function chessResultLine(g: VisitorChess): string | null {
  const e = g.end
  if (!e) return null
  const n = `${fullMoves(g.s)}수`
  if (e.result === 'idle' || e.result === 'work' || e.result === 'quit') return `중단 · ${n}`
  if (e.result === 'draw') return `무승부 · ${REASON_WORD[e.reason!]} · ${n}`
  const winner: Side = e.result === 'resign' ? agentColor(g) : e.result === 'white' ? 0 : 1
  return `${SIDE_NAME[winner]} 승 · ${REASON_WORD[e.reason!]} · ${n}`
}

/** the HUD's status line (hologram.md 10.3, play.md 2.2 · 2.5): the circle is the visitor's colour (white ○, black ●); the thinking dots grow one every 0.4 s */
export function chessStatusLine(g: VisitorChess, agentName: string, now: number, work?: string): string {
  if (g.end?.result === 'work') return capResult(agentName)
  if (g.end) return `${chessResultLine(g)}${g.undos && chessVisitorWon(g) ? ` · 무르기 ${g.undos}` : ''}`
  const head = `${g.color === 0 ? '○' : '●'} 체스 · ${agentName}와 대국${work ? ` · ${work}` : ''}`
  if (g.pending) return `${head} · ${iga(agentName)} 생각 중${'.'.repeat(1 + (Math.max(0, Math.floor((now - g.pending.at) / 400)) % 3))}`
  return `${head} · 당신(${SIDE_NAME[g.color]}) 차례 · ${g.s.full}수`
}

/**
 * The screen-reader line for a half-move (hologram.md 11.5): `백 폰 e2에서 e4. 메모가 생각 중`; the agent's `흑 나이트 g8에서 f6`; a capture
 * `… 잡음 흑 폰`; a check `. 체크`. `thinking`: the agent's name, when it now thinks about its answer (after the visitor's move).
 */
export function chessMoveLine(p: VisitorPly, thinking?: string): string {
  const mine = `${SIDE_NAME[p.side]} ${PIECE_NAME[p.kind]} ${squareName(fromOf(p.move))}에서 ${squareName(toOf(p.move))}`
  const cap = p.capture ? ` 잡음 ${SIDE_NAME[otherSide(p.side)]} ${PIECE_NAME[p.capture]}` : ''
  const promo = p.promo ? ` ${PIECE_NAME[p.promo]}으로 승진` : ''
  const check = p.check ? '. 체크' : ''
  return `${mine}${cap}${promo}${check}${thinking ? `. ${iga(thinking)} 생각 중` : ''}`
}

/** the line to announce for the game's last half-move (the visitor's: with the agent now thinking; the agent's: plain), or null before any */
export function chessLastMoveLine(g: VisitorChess, agentName: string): string | null {
  const p = g.plies[g.plies.length - 1]
  if (!p) return null
  return chessMoveLine(p, p.by === 'visitor' && g.pending ? agentName : undefined)
}

/**
 * The game as the stage draws an agents' game (players = [agent, visitor], `white` the one holding white): the board after the moves that have
 * landed, the agent's move in progress for its hand (thinking, picking, placing, back), and the end. The visitor's own moves land at once (no `move`).
 */
export function chessViewOf(g: VisitorChess, now: number): ChessView {
  const state = g.s
  const takenByWhite: number[] = []
  const takenByBlack: number[] = []
  for (const p of g.plies) if (p.capture) (p.side === 0 ? takenByWhite : takenByBlack).push(p.capture)
  const last = g.plies[g.plies.length - 1]
  const kingSq = state.board.findIndex((v) => v === (state.side === 0 ? KING : -KING))
  const m = g.pending ?? (g.landed && now < g.landed.at + g.landed.thinkMs + CHESS_HAND.end ? g.landed : null)
  let move: ChessMoveView | null = null
  let phase: ChessView['phase'] = 'thinking'
  if (m && !g.end) {
    const since = now - m.at
    const p = m.ply
    move = { mover: 0, side: p.side, from: fromOf(p.move), to: toOf(p.move), kind: p.kind, capture: p.capture, captureAt: p.captureAt, castle: p.castle, promo: p.promo, check: p.check, sinceMs: since, thinkMs: m.thinkMs }
    phase = since < m.thinkMs + CHESS_HAND.pick ? 'thinking' : since < m.thinkMs + CHESS_HAND.land ? 'pick' : 'place'
  }
  let end: ChessView['end'] = null
  const e = g.end
  if (e && e.reason) {
    const sinceMs = Math.max(0, now - e.at)
    const winner: Side = e.result === 'resign' ? agentColor(g) : e.result === 'white' ? 0 : 1
    end = e.result === 'draw' ? { kind: 'draw', reason: e.reason, plies: g.plies.length, sinceMs } : { kind: 'win', side: winner, reason: e.reason, plies: g.plies.length, sinceMs }
    phase = 'result'
  }
  return {
    game: g.game,
    white: g.color === 0 ? 1 : 0,
    board: state.board.slice(),
    toMove: state.side,
    lastMove: last ? { from: fromOf(last.move), to: toOf(last.move) } : null,
    check: inCheck(state) && kingSq >= 0 ? kingSq : null,
    takenByWhite,
    takenByBlack,
    moveIndex: g.plies.length,
    phase,
    move,
    end,
  }
}
