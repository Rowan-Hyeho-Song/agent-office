// A visitor's game of omok against the agent placing a record alone (#137 ②, play.md 2 · 5). Only in that visitor's tab (no server):
// the visitor is black and moves first, the agent answers with the engine's AI (its personality, the strength the visitor picked). Pure:
// every step takes `now` (ms) and returns the new game and what the agent shows (lines, faces); the stage draws it through the same
// OmokView as the agents' own games, so the agent's hand picks and places its stone the same way.

import { capResult, WORK_LINES } from './workHold'
import { hash, rng } from '../office/play'
import { HAND_MS, N, PLACE_AT, aiMove, axesAt, fiveCells, newGame, personalityOf, play, type Color, type OmokState, type OmokView } from './omok'
import { forbiddenAt, RULE_BY_ID, type Forbid, type RuleId } from './omokRules'

export type Strength = 'easy' | 'normal' | 'strong'
export const STRENGTHS: readonly Strength[] = ['easy', 'normal', 'strong']
export const STRENGTH_NAME: Record<Strength, string> = { easy: '쉬움', normal: '보통', strong: '셈' }

export const VISITOR_OMOK = {
  /** the agent thinks this long (busier boards longer), never over the cap (play.md 5.2) */
  thinkMs: [600, 1400] as const,
  thinkCapMs: 3000,
  /** no input this long ends the game; the HUD counts the last warnMs (play.md 2.5, 5.7) */
  idleMs: 90_000,
  warnMs: 10_000,
  /** undo: the visitor's last move and the agent's answer, three times a game (play.md 5.3) */
  undoMax: 3,
  /** easy: the agent misses the visitor's open three this often (play.md 5.2) */
  easyMiss: 0.4,
} as const

/** what the agent says (play.md 2.4 · 2.5 · 5.2 · 5.3) */
export const OMOK_LINES = {
  block: '어, 거긴 막아야겠어요',
  good: '오, 좋은 수네요',
  visitorWon: '졌어요! 한 판 더?',
  agentWon: '제가 이겼네요 :)',
  resign: '제가 졌어요 · 마저 두세요',
  firstUndo: '괜찮아요, 다시 두세요',
  idle: '다음에 또 둬요',
  // #601 the call to work waits for the game; past its cap (play.md 10.3) the game is wound up with this
  work: WORK_LINES.cap,
  easy: '천천히 둘게요',
  strong: '진지하게 둘게요',
} as const
/** #603 (play.md 11.2 · 11.4) the agent's word as the game starts under a rule, and the first forbidden point the visitor tries */
export const RULE_LINES: Record<RuleId, string> = { renju: '렌주로 둬요', swap: '렌주로 둬요', domestic: '3-3만 조심하세요', free: '금수 없이 가요', exact: '딱 다섯이에요' }
export const FORBID_LINE = '거긴 흑 금수예요'
/** #603 (play.md 11.3) swap: the agent's word as it takes a colour after the visitor's three; the agent thinks this long first */
export const SWAP_LINES: Record<Color, string> = { 1: '제가 흑 할게요', 2: '백으로 둘게요' }
export const SWAP_THINK_MS = 1200
/** the rule a visitor's game starts with, before any is chosen (play.md 11.1) */
export const DEFAULT_RULE: RuleId = 'renju'

/** its own open four, by personality (play.md 2.4) */
export const FOUR_LINES: Record<string, string> = { agent_0: '음… 여기네요', agent_1: '여기에 하나', agent_2: '모양이 예쁘죠?', agent_3: '끝낼게요', agent_4: '한 박자 남았어요' }
const fourLine = (agent: string) => FOUR_LINES[agent] ?? FOUR_LINES.agent_1

export type Face = 'think' | 'surprised' | 'joy' | 'embarrassed' | 'nod'
export type OmokEvent = { kind: 'say'; text: string } | { kind: 'face'; face: Face }

export type EndResult = 'black' | 'white' | 'draw' | 'resign' | 'idle' | 'work' | 'quit'

export interface VisitorGame {
  agent: string
  seed: number
  /** games played in this sitting (다시 두기 starts the next) */
  game: number
  strength: Strength
  /** the board as it stands (the agent's stone joins it when it lands) */
  s: OmokState
  /** the moves on the board, black (the visitor) first */
  moves: number[]
  /** the agent's move under way: the cell it chose, when it began thinking, how long it thinks */
  pending: { cell: number; at: number; thinkMs: number } | null
  /** its last move, whose hand is still withdrawing */
  landed: { cell: number; at: number; thinkMs: number } | null
  /** the visitor's last stone: when it appeared (it grows in 0.12 s, no hand) */
  visitorAt: number
  undos: number
  /** the reaction lines already said this game (each at most once: three a game) */
  said: string[]
  lastInput: number
  /** the agent has laid its stone down (nothing left to stop): it is the visitor's move to finish (play.md 5.2, #491) */
  conceded: boolean
  end: { result: EndResult; at: number; line: number[] | null } | null
  /** #603 the rule this game is played under (s.rule too); chosen before the first stone */
  rule: RuleId
  /** #603 the visitor's colour (black unless a swap gave them white) */
  color: Color
  /**
   * #603 (play.md 11.3) swap's opening: who places the first three (black, white, black), then the other side takes a colour. 'choosing' with
   * `at`: the agent decides then (the visitor opened); without: the visitor picks with the HUD's buttons (the agent opened)
   */
  swap: { by: 'visitor' | 'agent'; stage: 'opening' | 'choosing' | 'done'; at?: number } | null
}

const other = (c: Color): Color => (c === 1 ? 2 : 1)
const colorWord = (c: Color) => (c === 1 ? 'black' : 'white')
/** the colour the visitor places now: in their own swap opening the side to move, else their colour */
export const visitorStone = (g: VisitorGame): Color => (g.swap?.stage === 'opening' && g.swap.by === 'visitor' ? g.s.toMove : g.color)
/** the visitor won this game (a five of their colour, or the agent's concession) */
export const visitorWon = (g: VisitorGame) => !!g.end && (g.end.result === 'resign' || g.end.result === colorWord(g.color))
/** the agent won this game */
export const agentWon = (g: VisitorGame) => !!g.end && g.end.result === colorWord(other(g.color))

export function startVisitorGame(agent: string, seed: number, now: number, strength: Strength = 'normal', game = 0, rule: RuleId = DEFAULT_RULE): VisitorGame {
  // swap: the visitor opens the sitting's first game, then the opener changes every game (play.md 11.3)
  const swap: VisitorGame['swap'] = rule === 'swap' ? { by: game % 2 === 0 ? 'visitor' : 'agent', stage: 'opening' } : null
  const g: VisitorGame = { agent, seed, game, strength, s: newGame(rule), moves: [], pending: null, landed: null, visitorAt: -Infinity, undos: 0, said: [], lastInput: now, conceded: false, end: null, rule, color: 1, swap }
  // the agent opens: its first stone is on its way
  if (swap?.by === 'agent') g.pending = { cell: agentPick(g), at: now, thinkMs: thinkOf(g) }
  return g
}

/** the next game in the same sitting: same agent, strength and rule */
export const restart = (g: VisitorGame, now: number) => startVisitorGame(g.agent, g.seed, now, g.strength, g.game + 1, g.rule)

/** #603 the same game under another rule (only before its first stone): the agent's word for the rule */
export function setRule(g: VisitorGame, rule: RuleId, now: number): { g: VisitorGame; events: OmokEvent[] } | null {
  if (g.moves.length || g.end) return null
  return { g: { ...startVisitorGame(g.agent, g.seed, now, g.strength, g.game, rule), said: [...g.said] }, events: [{ kind: 'say', text: RULE_LINES[rule] }] }
}

const replay = (moves: number[], rule: RuleId): OmokState => moves.reduce<OmokState>((s, m) => play(s, m)!, newGame(rule))

/** the visitor may place a stone: their turn (in their swap opening, every one of the three), nothing in the agent's hand, the game on */
export function visitorTurn(g: VisitorGame): boolean {
  if (g.end || g.pending || g.s.result !== 'playing') return false
  if (g.swap && g.swap.stage !== 'done') return g.swap.stage === 'opening' && g.swap.by === 'visitor'
  return g.s.toMove === g.color
}

/** #603 swap: the visitor picks their colour after the agent's three (the HUD's buttons); the side to move (white) moves next */
export function chooseColor(g0: VisitorGame, color: Color, now: number): { g: VisitorGame; events: OmokEvent[] } | null {
  if (!g0.swap || g0.swap.by !== 'agent' || g0.swap.stage !== 'choosing' || g0.end) return null
  const g: VisitorGame = { ...g0, color, swap: { ...g0.swap, stage: 'done' }, lastInput: now, said: [...g0.said] }
  if (g.s.toMove !== color) g.pending = { cell: agentPick(g), at: now, thinkMs: thinkOf(g) }
  return { g, events: [] }
}

/** the agent's colour after the visitor's three: the side whose shape is better on the board (a seeded nudge breaks a tie) */
export function swapChoice(g: VisitorGame): Color {
  const best = (c: Color) => {
    let top = 0
    for (let cell = 0; cell < N * N; cell++) {
      if (g.s.board[cell] !== 0) continue
      const sc = axesAt(g.s.board, cell, c).reduce((a, x) => a + (x.count - 1) * (x.count - 1) * (1 + x.open), 0)
      if (sc > top) top = sc
    }
    return top
  }
  const b = best(1)
  const w = best(2)
  if (b !== w) return b > w ? 1 : 2
  return hash(`${g.seed}|${g.game}|swap`) % 2 === 0 ? 1 : 2
}

/** #603 why the visitor (black) may not stand at `cell` now under the game's rule, or null (not their turn, taken, or allowed) */
export const visitorForbid = (g: VisitorGame, cell: number): Forbid | null => (visitorTurn(g) && g.s.board[cell] === 0 ? forbiddenAt(g.s.board, cell, g.rule, visitorStone(g)) : null)

function agentPick(g: VisitorGame): number {
  const p = personalityOf(g.agent)
  const seed = hash(`${g.seed}|${g.game}|${g.moves.length}`)
  if (g.strength === 'strong') return aiMove(g.s, { ...p, defn: Math.max(p.defn, 1.15), noise: 0.02, slip: 0 }, seed)
  if (g.strength === 'easy' && rng(hash(`${seed}|easy`))() < VISITOR_OMOK.easyMiss) return aiMove(g.s, { ...p, defn: 0 }, seed)
  return aiMove(g.s, p, seed)
}

/** longer on a fuller board, a seeded wobble; within the range and the cap */
function thinkOf(g: VisitorGame): number {
  const [lo, hi] = VISITOR_OMOK.thinkMs
  const busy = Math.min(1, g.moves.length / 30)
  const wobble = ((hash(`${g.seed}|${g.game}|think|${g.moves.length}`) / 4294967296) * 2 - 1) * 200
  return Math.min(VISITOR_OMOK.thinkCapMs, Math.max(lo, Math.min(hi, lo + (hi - lo) * busy + wobble)))
}

const say = (g: VisitorGame, text: string, ev: OmokEvent[], once = false) => {
  if (once && g.said.includes(text)) return
  if (once) g.said.push(text)
  ev.push({ kind: 'say', text })
}

/** #603 the visitor pressed a forbidden point: nothing is placed; the agent says so once a game */
export function forbidPressed(g0: VisitorGame, now: number): { g: VisitorGame; events: OmokEvent[] } {
  const g: VisitorGame = { ...g0, lastInput: now, said: [...g0.said] }
  const ev: OmokEvent[] = []
  say(g, FORBID_LINE, ev, true)
  return { g, events: ev }
}

/** the visitor places black at `cell`; null when they may not (not their turn, taken, off the board, #603 forbidden) */
export function visitorMove(g0: VisitorGame, cell: number, now: number): { g: VisitorGame; events: OmokEvent[] } | null {
  if (!visitorTurn(g0)) return null
  const s = play(g0.s, cell)
  if (!s) return null
  const g: VisitorGame = { ...g0, s, moves: [...g0.moves, cell], visitorAt: now, lastInput: now, said: [...g0.said] }
  const ev: OmokEvent[] = []
  // #603 the visitor's swap opening: three stones (black, white, black), then the agent thinks and takes a colour (play.md 11.3)
  if (g0.swap?.stage === 'opening' && g0.swap.by === 'visitor') {
    if (g.moves.length >= 3) {
      g.swap = { ...g0.swap, stage: 'choosing', at: now + SWAP_THINK_MS }
      ev.push({ kind: 'face', face: 'think' })
    }
    return { g, events: ev }
  }
  const mine = colorWord(g.color)
  // after the agent laid its stone down: five wins as any five; anywhere else ends it as the concession (흑 승 · 던짐)
  if (g0.conceded && s.result !== mine) {
    g.end = { result: 'resign', at: now, line: null }
    return { g, events: ev }
  }
  if (s.result === mine) {
    g.end = { result: mine, at: now, line: s.line }
    say(g, OMOK_LINES.visitorWon, ev)
    ev.push({ kind: 'face', face: 'embarrassed' })
    return { g, events: ev }
  }
  if (s.result === 'draw') {
    g.end = { result: 'draw', at: now, line: null }
    return { g, events: ev }
  }
  // a good move: two open threes at once
  if (axesAt(s.board, cell, g.color).filter((a) => a.count === 3 && a.open === 2).length >= 2) {
    say(g, OMOK_LINES.good, ev, true)
    ev.push({ kind: 'face', face: 'surprised' })
  }
  // nothing left to stop (two ways to five): the agent lays its stone down and leaves the winning move to the visitor (play.md 5.2, #491).
  // It does not play: the visitor moves again.
  if (fiveCells(s.board, g.color, g.rule).length >= 2) {
    g.conceded = true
    g.s = { ...s, toMove: g.color }
    say(g, OMOK_LINES.resign, ev)
    ev.push({ kind: 'face', face: 'nod' })
    return { g, events: ev }
  }
  g.pending = { cell: agentPick(g), at: now, thinkMs: thinkOf(g) }
  ev.push({ kind: 'face', face: 'think' })
  return { g, events: ev }
}

/** the clock: the agent's stone lands when its hand gets there; a quiet visitor is let go after idleMs */
export function stepVisitorGame(g0: VisitorGame, now: number): { g: VisitorGame; events: OmokEvent[] } {
  const ev: OmokEvent[] = []
  if (g0.end) return { g: g0, events: ev }
  // #603 swap: after the visitor's three the agent has thought it over; it takes a colour and says which (play.md 11.3)
  if (g0.swap?.stage === 'choosing' && g0.swap.at !== undefined && now >= g0.swap.at) {
    const mine = swapChoice(g0)
    const g: VisitorGame = { ...g0, color: other(mine), swap: { by: 'visitor', stage: 'done' }, lastInput: now, said: [...g0.said] }
    ev.push({ kind: 'say', text: SWAP_LINES[mine] })
    // white moves fourth: the agent, if it took white
    if (g.s.toMove === mine) g.pending = { cell: agentPick(g), at: now, thinkMs: thinkOf(g) }
    return { g, events: ev }
  }
  const p = g0.pending
  if (p && now >= p.at + p.thinkMs + HAND_MS * PLACE_AT) {
    const before = g0.s.board
    const s = play(g0.s, p.cell)!
    // the visitor's turn again: the idle clock counts from here
    const g: VisitorGame = { ...g0, s, moves: [...g0.moves, p.cell], pending: null, landed: p, lastInput: now, said: [...g0.said] }
    // #603 the agent's swap opening: its next stone, until three; then the visitor picks a colour (the HUD's buttons)
    if (g0.swap?.stage === 'opening' && g0.swap.by === 'agent') {
      if (g.moves.length < 3) g.pending = { cell: agentPick(g), at: now, thinkMs: thinkOf(g) }
      else g.swap = { ...g0.swap, stage: 'choosing' }
      return { g, events: ev }
    }
    const theirs = colorWord(other(g0.color))
    // a four it can stop (one way to five, play.md 2.4 · #491)
    const fives = fiveCells(before, g0.color, g0.rule)
    if (fives.length === 1 && fives[0] === p.cell) say(g, OMOK_LINES.block, ev, true)
    if (s.result === theirs) {
      g.end = { result: theirs, at: now, line: s.line }
      say(g, OMOK_LINES.agentWon, ev)
      ev.push({ kind: 'face', face: 'joy' })
    } else if (s.result === 'draw') g.end = { result: 'draw', at: now, line: null }
    else if (axesAt(s.board, p.cell, other(g0.color)).some((a) => a.count === 4 && a.open === 2)) say(g, fourLine(g.agent), ev, true)
    return { g, events: ev }
  }
  // waiting on the visitor (not the agent's swap thinking)
  if (!p && !(g0.swap?.stage === 'choosing' && g0.swap.at !== undefined) && now - g0.lastInput >= VISITOR_OMOK.idleMs) {
    // after the concession the game is the visitor's anyway (흑 승 · 던짐); otherwise it is let go
    const g = { ...g0, end: { result: g0.conceded ? ('resign' as const) : ('idle' as const), at: now, line: null } }
    if (!g0.conceded) say(g, OMOK_LINES.idle, ev)
    return { g, events: ev }
  }
  return { g: g0, events: ev }
}

/** any key or touch: the idle clock starts again (play.md 5.7) */
export const touchGame = (g: VisitorGame, now: number): VisitorGame => (g.end ? g : { ...g, lastInput: now })

/** ms until the idle end, while the HUD should count them (the last warnMs), else null */
export function idleLeft(g: VisitorGame, now: number): number | null {
  if (g.end || g.pending) return null
  const left = VISITOR_OMOK.idleMs - (now - g.lastInput)
  return left <= VISITOR_OMOK.warnMs ? Math.max(0, left) : null
}

// #603 not in a swap game (taking back across the opening and the colour choice would tangle who plays which colour)
/** #623 the stones an undo takes back: the visitor's last alone (the agent is still thinking on it), else with the agent's answer after it */
const undoTake = (g: VisitorGame) => (g.pending || (g.moves.length - 1) % 2 === (g.color === 1 ? 0 : 1) ? 1 : 2)
/** #623 (play.md 11.3) a swap game: no undo before the colour is chosen, nor back into the opening three */
export const undoOpeningBlocked = (g: VisitorGame) => !!g.swap && (g.swap.stage !== 'done' || g.moves.length - undoTake(g) < 3)
/** #623 the dimmed [무르기]'s words while the swap opening holds it */
export const UNDO_OPENING_LINE = '여는 수는 무를 수 없어요'
export const canUndo = (g: VisitorGame) => !g.end && !g.conceded && !undoOpeningBlocked(g) && g.undos < VISITOR_OMOK.undoMax && g.moves.length > 0

/** take back the visitor's last move and the agent's answer (or the answer it is still thinking about); null when not allowed */
export function undo(g0: VisitorGame, now: number): { g: VisitorGame; events: OmokEvent[]; removed: number[] } | null {
  if (!canUndo(g0)) return null
  const ev: OmokEvent[] = []
  // whose move is last: the visitor's (the agent is thinking, cancel it) or the agent's (take both)
  const take = undoTake(g0)
  const moves = g0.moves.slice(0, g0.moves.length - take)
  const removed = g0.moves.slice(g0.moves.length - take)
  const g: VisitorGame = { ...g0, s: replay(moves, g0.rule), moves, pending: null, landed: null, undos: g0.undos + 1, lastInput: now, said: [...g0.said] }
  if (g0.undos === 0) {
    say(g, OMOK_LINES.firstUndo, ev)
    ev.push({ kind: 'face', face: 'nod' })
  }
  return { g, events: ev, removed }
}

/** the strength from the next move on (play.md 5.2) */
export function setStrength(g: VisitorGame, strength: Strength, now: number): { g: VisitorGame; events: OmokEvent[] } {
  if (strength === g.strength) return { g, events: [] }
  const ev: OmokEvent[] = []
  if (strength === 'easy') ev.push({ kind: 'say', text: OMOK_LINES.easy })
  if (strength === 'strong') ev.push({ kind: 'say', text: OMOK_LINES.strong })
  return { g: { ...g, strength, lastInput: now }, events: ev }
}

/** the visitor leaves (그만두기, Esc) or the agent is called to work */
export function endGame(g: VisitorGame, why: 'quit' | 'work', now: number): { g: VisitorGame; events: OmokEvent[] } {
  if (g.end) return { g, events: [] }
  const ev: OmokEvent[] = why === 'work' ? [{ kind: 'say', text: OMOK_LINES.work }] : []
  return { g: { ...g, pending: null, end: { result: why, at: now, line: null } }, events: ev }
}

// ---- what the screen shows -------------------------------------------------------------------------------------------

/** a point's name: columns A–O left to right, rows 1–15 bottom to top as the visitor sees the board (H8 is the centre) */
export const cellName = (cell: number) => `${String.fromCharCode(65 + (cell % N))}${N - ((cell / N) | 0)}`

const RESULT_WORD: Record<EndResult, string> = { black: '흑 승', white: '백 승', draw: '무승부', resign: '흑 승 · 던짐', idle: '중단', work: '중단', quit: '중단' }

/** the HUD's status line (play.md 2.2 · 2.5 · 5.2 · 5.3); the thinking dots grow one every 0.4 s (a clock before the move began counts as its start: #536, repeat(-1) threw) */
export function statusLine(g: VisitorGame, agentName: string, now: number, work?: string): string {
  const n = g.moves.length
  // #601 wound up past the call to work's cap: who went (play.md 10.3)
  if (g.end?.result === 'work') return capResult(agentName)
  if (g.end) return `${RESULT_WORD[g.end.result]} · ${n}수${g.undos && visitorWon(g) ? ` · 무르기 ${g.undos}` : ''}`
  // #603 the rule's name first (play.md 11.1); #601 called to work: one more word after the game's name (play.md 10.2)
  const head = `${g.color === 2 ? '○' : '●'} 오목 · ${RULE_BY_ID[g.rule].name} · ${agentName}와 대국${work ? ` · ${work}` : ''}`
  const dots = (at: number) => '.'.repeat(1 + (Math.max(0, Math.floor((now - at) / 400)) % 3))
  // #603 swap's opening (play.md 11.3)
  if (g.swap && g.swap.stage !== 'done') {
    if (g.swap.stage === 'opening' && g.swap.by === 'visitor') return `● 오목 · 스왑 · 첫 세 수 놓기 · ${n + 1}/3`
    if (g.swap.stage === 'opening') return `● 오목 · 스왑 · ${agentName}가 첫 세 수 놓는 중 · ${Math.min(3, n + 1)}/3`
    if (g.swap.by === 'visitor') return `● 오목 · 스왑 · ${agentName}가 색 고르는 중${dots(g.swap.at! - SWAP_THINK_MS)}`
    return '● 오목 · 스왑 · 색을 고르세요'
  }
  if (g.pending) return `${head} · ${agentName}가 생각 중${dots(g.pending.at)}`
  return `${head} · 당신(${g.color === 1 ? '흑' : '백'}) 차례 · ${n + 1}수`
}

/**
 * The game as the stage draws an agents' game (players = [agent, visitor], the visitor holds black): the board, the agent's move in
 * progress for its hand (thinking, picking, placing, withdrawing), and the win.
 */
export function viewOf(g: VisitorGame, now: number): OmokView {
  const board = g.s.board.slice()
  // which of [agent, visitor] holds black: the visitor's colour; while the agent places its swap opening, by the stone in its hand
  const agentStone: Color = g.swap?.stage === 'opening' && g.swap.by === 'agent' ? g.s.toMove : other(g.color)
  const black: 0 | 1 = agentStone === 1 ? 0 : 1
  const base = { board, game: g.game, black, lastMove: g.s.lastMove, toMove: g.s.toMove, moveIndex: g.moves.length, handT01: 0, pending: null as OmokView['pending'], resetT01: 0, wonMs: 0, move: null as OmokView['move'] }
  if (g.end && g.end.line) {
    const winner = g.end.result === 'black' ? 1 : 2
    return { ...base, phase: 'won', winner, line: g.end.line, wonMs: now - g.end.at }
  }
  const m = g.pending ?? (g.landed && now < g.landed.at + g.landed.thinkMs + HAND_MS ? g.landed : null)
  if (!m || g.end) return { ...base, phase: 'thinking' }
  const since = now - m.at
  const hand = since < m.thinkMs ? 0 : Math.min(1, (since - m.thinkMs) / HAND_MS)
  return {
    ...base,
    phase: since < m.thinkMs ? 'thinking' : hand < 0.5 ? 'pick' : 'place',
    handT01: hand,
    pending: g.pending && since >= m.thinkMs ? { move: m.cell, color: agentStone } : null,
    move: { mover: 0, cell: m.cell, sinceMs: since, thinkMs: m.thinkMs },
  }
}
