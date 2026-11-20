// #137 ② the visitor's game of omok (play.md 2 · 4 · 5 · 8): whether it is flying in, open, flying back; the game itself (visitorOmok.ts); the cursor
// the keyboard moves, the point the pointer hovers, the point a first touch armed; and what the agent says / shows that the scene has not shown yet.
// A tiny external store like boardView/store.ts: OmokVisitRig.tsx (the 3D side) flies the camera, steps the game and draws the cursor; OmokVisitUi.tsx
// is the tag, the HUD and the keyboard grid. Only in this visitor's tab: nothing goes to a server, the other visitors see the scene as it is.

import { useSyncExternalStore } from 'react'
import { N } from '../../play/omok'
import {
  canUndo, chooseColor, DEFAULT_RULE, undoOpeningBlocked, endGame, forbidPressed, restart, setRule, setStrength, startVisitorGame, stepVisitorGame, touchGame, undo, visitorForbid, visitorMove,
  visitorTurn, type OmokEvent, type Strength, type VisitorGame,
} from '../../play/visitorOmok'
import { RULES, type Forbid, type RuleId } from '../../play/omokRules'
import { holdPhase, WORK_HOLD, type WorkHold } from '../../play/workHold'
import {
  canUndoChess, chessIdleLeft, endChess, legalTargets, restartChess, setChessStrength, startVisitorChess, stepVisitorChess, touchChess, undoChess, visitorChessMove, visitorChessTurn, visitorColor,
  visitorPieceAt, type VisitorChess,
} from '../../play/visitorChess'
import type { Vector3 } from 'three'

export type VisitPhase = 'closed' | 'flying' | 'open' | 'leaving'
/** #604 the game at the board: the visitor may switch between them before the first move or at the result (hologram.md 10.3) */
export type VisitKind = 'omok' | 'chess'
/** the agent's word for a game chosen at the board (hologram.md 10.3); it is no reaction line, so it does not count toward the bubble limit */
export const SWITCH_LINES: Record<VisitKind, string> = { chess: '좋아요, 체스로 해요', omok: '좋아요, 오목으로 해요' }

export interface OmokVisitState {
  phase: VisitPhase
  /** the agent at the board (placing a record alone when the visitor sat down) */
  agent: string | null
  game: VisitorGame | null
  /** the keyboard's cursor (a cell; H8 to start) */
  cursor: number
  /** the point under the pointer (a half-transparent black stone), or null */
  preview: number | null
  /** a touch's first tap: the point shown, the same point again places (play.md 2.3) */
  armed: number | null
  /** the screen point the "같이 두기" tag stands at (over the empty chair), or null when nobody is at the board alone */
  tag: { x: number; y: number; agent: string; orient: Orient; kind?: VisitKind; hot?: boolean } | null
  /** the board as the visitor sees it: the grid step (columns, rows) for one point to the right and one point up (away) on the screen */
  orient: Orient
  /** #603 the rule chooser is open (play.md 11.2), and the row selected in it (not yet started) */
  picker: boolean
  pickerRule: RuleId
  /** #603 a forbidden point pressed: where, why and when (the ✕ shakes, the guidance shows 2 s) */
  forbid: { cell: number; why: Forbid; at: number } | null
  /** #603 the board's right edge and vertical middle on the screen while the chooser is open (the rig): it stands beside the board */
  boardBox: { right: number; middle: number } | null
  /** #601 the agent was called to work during the game: it stays to the game's end (this tab only), up to the cap (play.md 10) */
  work: WorkHold | null
  /** #601 where the work chip stands on the screen (the rig, every frame): beside the face screen, its top aligned; null: not shown */
  chip: { x: number; y: number } | null
  /** #604 which game is at the board: `game` is the omok one, `chess` the chess one (the other is null) */
  kind: VisitKind
  chess: VisitorChess | null
  /** #604 chess: the selected square, the keyboard's cursor square, the piece being dragged (its world point), the promotion asked for, the game sheet open */
  sel: number | null
  chessCursor: number
  drag: { pos: Vector3 } | null
  promo: { from: number; to: number } | null
  gameSheet: boolean
  /** #604 the promotion square's top on the screen (the rig, while the promotion sheet is open): the sheet stands over it (hologram.md 11.5) */
  promoAt: { x: number; y: number } | null
}

/** e2 (white) / e7 (black): where the keyboard's chess cursor starts */
export const chessCursorStart = (color: 0 | 1) => (color === 0 ? 12 : 52)

export interface Orient {
  right: readonly [number, number]
  up: readonly [number, number]
}
const ORIENT: Orient = { right: [1, 0], up: [0, -1] }

/** how far `cell` is along an axis of the grid (0 at its start, N - 1 at its end) */
const along = (cell: number, [dc, dr]: readonly [number, number]) => {
  const col = cell % N
  const row = (cell / N) | 0
  return dc ? (dc > 0 ? col : N - 1 - col) : dr > 0 ? row : N - 1 - row
}
/** a point's name as the visitor sees the board: A–O left to right, 1–15 near to far (H8 the middle, play.md 2.3) */
export const viewName = (cell: number, o: Orient = state.orient) => `${String.fromCharCode(65 + along(cell, o.right))}${along(cell, o.up) + 1}`

/** the board's middle, H8 */
export const CENTER = ((N / 2) | 0) * N + ((N / 2) | 0)
export const CLOSED: OmokVisitState = { phase: 'closed', agent: null, game: null, cursor: CENTER, preview: null, armed: null, tag: null, orient: ORIENT, picker: false, pickerRule: DEFAULT_RULE, forbid: null, boardBox: null, work: null, chip: null, kind: 'omok', chess: null, sel: null, chessCursor: 12, drag: null, promo: null, gameSheet: false, promoAt: null }

// #603 (play.md 11.2) the last rule chosen, kept in this browser (none, or storage blocked: renju); the chooser opens by itself for this tab's first game
const RULE_KEY = 'agent-office.omok.rule'
export function lastRule(): RuleId {
  try {
    const r = globalThis.localStorage?.getItem(RULE_KEY)
    return RULES.some((x) => x.id === r) ? (r as RuleId) : DEFAULT_RULE
  } catch {
    return DEFAULT_RULE
  }
}
function keepRule(rule: RuleId) {
  try {
    globalThis.localStorage?.setItem(RULE_KEY, rule)
  } catch {
    /* a private window: the rule is not kept */
  }
}
let chosenInTab = false
/** tests: this tab has chosen no rule yet */
export const forgetRuleChoice = () => void (chosenInTab = false)

let state: OmokVisitState = CLOSED
/** the agent's lines and faces from the game, for the scene to show (drained each frame) */
let pending: OmokEvent[] = []
const listeners = new Set<() => void>()
const set = (next: OmokVisitState) => {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}
const take = (r: { g: VisitorGame; events: OmokEvent[] } | null): boolean => {
  if (!r) return false
  pending.push(...r.events)
  set({ ...state, game: r.g })
  return true
}

const takeChess = (r: { g: VisitorChess; events: OmokEvent[] } | null): boolean => {
  if (!r) return false
  pending.push(...r.events)
  // a selection or a promotion question does not outlive the visitor's turn
  const mine = visitorChessTurn(r.g)
  set({ ...state, chess: r.g, ...(mine ? {} : { sel: null, drag: null, promo: null }) })
  return true
}

export const getOmokVisit = () => state
/** the camera rig, the tour, the WASD keys and the docks stand aside while the visitor plays */
export const isOmokActive = () => state.phase !== 'closed'
export const useOmokVisit = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), getOmokVisit, getOmokVisit)
export const drainOmokEvents = (): OmokEvent[] => {
  const out = pending
  pending = []
  return out
}

/** sit down opposite `agent` (from the tag, the empty chair, the board); only from closed */
export function openOmok(agent: string, now: number, seed: number, orient: Orient = ORIENT, kind: VisitKind = 'omok'): boolean {
  if (state.phase !== 'closed') return false
  pending = []
  if (kind === 'chess') {
    const chess = startVisitorChess(agent, seed, now)
    set({ ...CLOSED, tag: state.tag, phase: 'flying', agent, kind, chess, chessCursor: chessCursorStart(visitorColor(chess)), orient })
    return true
  }
  set({ ...CLOSED, tag: state.tag, phase: 'flying', agent, game: startVisitorGame(agent, seed, now, 'normal', 0, lastRule()), orient })
  return true
}
/** the game's end record, whichever game is at the board */
const endOf = () => (state.kind === 'chess' ? state.chess?.end : state.game?.end) ?? null

/** #604 the games the sheet may switch to now: before the first move, or while the result line shows (hologram.md 10.3) */
export function canSwitchGame(): boolean {
  if (state.phase !== 'open') return false
  const e = endOf()
  if (e) return e.result !== 'work' && !state.work
  if (state.kind === 'chess') return !!state.chess && !state.chess.plies.length
  return !!state.game && !state.game.moves.length
}
/** #604 a game chosen in the sheet: a new game of that kind, same agent and strength; the agent says so. false when not allowed (a game going on) or the same game */
export function switchGame(kind: VisitKind, now: number): boolean {
  const agent = state.agent
  if (!agent || kind === state.kind || !canSwitchGame()) return false
  const strength = (state.kind === 'chess' ? state.chess?.strength : state.game?.strength) ?? 'normal'
  const seed = (state.kind === 'chess' ? state.chess?.seed : state.game?.seed) ?? 0
  pending = [{ kind: 'say', text: SWITCH_LINES[kind] }]
  const base = { ...state, kind, gameSheet: false, preview: null, armed: null, forbid: null, sel: null, drag: null, promo: null }
  if (kind === 'chess') {
    const chess = startVisitorChess(agent, seed, now, strength)
    set({ ...base, game: null, chess, picker: false, chessCursor: chessCursorStart(visitorColor(chess)) })
  } else set({ ...base, chess: null, game: startVisitorGame(agent, seed, now, strength, 0, lastRule()), cursor: CENTER, picker: !chosenInTab, pickerRule: lastRule() })
  return true
}
export const openGameSheet = () => state.phase === 'open' && canSwitchGame() && !state.gameSheet && (set({ ...state, gameSheet: true }), true)
export const closeGameSheet = () => state.gameSheet && set({ ...state, gameSheet: false })
/** at the board: the chooser opens by itself for this tab's first game (the camera has stopped) */
export const omokArrived = () => state.phase === 'flying' && set({ ...state, phase: 'open', picker: state.kind === 'omok' && !chosenInTab, pickerRule: state.game?.rule ?? DEFAULT_RULE })
/** #603 the chooser: open it (only before the first stone), close it (Esc: the rule stays) */
export const openRulePicker = () =>
  !!state.game && !state.game.moves.length && !state.game.end && state.phase === 'open' && (set({ ...state, picker: true, pickerRule: state.game.rule }), true)
/** a row selected in the chooser (↑↓, a click on the row); started with Enter, the button, or the first stone */
export const selectRule = (rule: RuleId) => state.picker && state.pickerRule !== rule && set({ ...state, pickerRule: rule })
export const closeRulePicker = () => state.picker && set({ ...state, picker: false })
/** #603 a rule chosen in the chooser (before the first stone): the game under it, kept for this browser; the agent's word for it */
export function chooseRule(rule: RuleId, now: number): boolean {
  const g = state.game
  if (!g || state.phase !== 'open') return false
  const r = setRule(g, rule, now)
  if (!r) return false
  keepRule(rule)
  chosenInTab = true
  pending.push(...r.events)
  set({ ...state, game: r.g, picker: false })
  return true
}
/** leave (그만두기, Esc, the game over by itself): the game ends as quit unless it already ended; the camera flies back */
export function closeOmok(now: number) {
  if (state.phase === 'closed' || state.phase === 'leaving') return
  const g = state.game
  if (g && !g.end) take(endGame(g, 'quit', now))
  const c = state.chess
  if (c && !c.end) takeChess(endChess(c, 'quit', now))
  set({ ...state, phase: 'leaving', preview: null, armed: null, sel: null, drag: null, promo: null, gameSheet: false })
}
export const omokLeft = () => state.phase === 'leaving' && set({ ...CLOSED, tag: state.tag })
/** a reset (the timelapse, a seek): closed at once, the camera given back by the rig */
export const resetOmok = () => set({ ...CLOSED })

/** the visitor places black at `cell` (their turn only) */
export function placeOmok(cell: number, now: number): boolean {
  const g = state.game
  if (state.phase !== 'open' || !g) return false
  // #603 a forbidden point: nothing placed; the ✕ shakes, the guidance shows, the agent says so once a game (play.md 11.4)
  const why = visitorForbid(g, cell)
  if (why) {
    take(forbidPressed(g, now))
    set({ ...state, cursor: cell, forbid: { cell, why, at: now } })
    return false
  }
  // the first stone with the chooser open starts the game under the rule selected there (play.md 11.2: 빨리 시작)
  if (state.picker && state.pickerRule !== g.rule) {
    chooseRule(state.pickerRule, now)
    return placeOmok(cell, now)
  }
  if (state.picker) {
    chosenInTab = true
    keepRule(g.rule)
  }
  const ok = take(visitorMove(state.game!, cell, now))
  if (ok) set({ ...state, cursor: cell, preview: null, armed: null, picker: false, forbid: null })
  return ok
}
/** the board's box on the screen (the rig, while the chooser is open) */
export function setOmokBoardBox(b: OmokVisitState['boardBox']) {
  const c = state.boardBox
  if (c && b && Math.abs(c.right - b.right) < 0.5 && Math.abs(c.middle - b.middle) < 0.5) return
  set({ ...state, boardBox: b })
}
/** #604 the promotion square's top on the screen (the rig, while the promotion sheet is open) */
export function setChessPromoAt(p: OmokVisitState['promoAt']) {
  const c = state.promoAt
  if (c === p || (c && p && Math.abs(c.x - p.x) < 0.5 && Math.abs(c.y - p.y) < 0.5)) return
  set({ ...state, promoAt: p })
}
/** #603 swap: the visitor's colour after the agent's three (the HUD's buttons) */
export const chooseColorOmok = (color: 1 | 2, now: number) => !!state.game && state.phase === 'open' && take(chooseColor(state.game, color, now))
/** #603 the forbidden reason at a point for the visitor now (the ✕, the cell's words), or null */
export const omokForbidAt = (cell: number | null): Forbid | null => (cell === null || !state.game ? null : visitorForbid(state.game, cell))
/** the clock: the agent's stone lands, a quiet visitor is let go (play.md 2.5) */
export function stepOmok(now: number) {
  if (state.chess && state.phase !== 'closed') {
    const r = stepVisitorChess(state.chess, now)
    if (r.g !== state.chess || r.events.length) takeChess(r)
    return
  }
  const g = state.game
  if (!g || state.phase === 'closed') return
  const r = stepVisitorGame(g, now)
  if (r.g !== g || r.events.length) take(r)
}
/** any key or touch: the 90 s count starts again */
export function touchOmok(now: number) {
  const g = state.game
  if (g && !g.end) set({ ...state, game: touchGame(g, now) })
  const c = state.chess
  if (c && !c.end) set({ ...state, chess: touchChess(c, now) })
}
export function undoOmok(now: number): boolean {
  if (state.chess) {
    const r = undoChess(state.chess, now)
    if (!r || !takeChess(r)) return false
    set({ ...state, sel: null, drag: null, promo: null })
    return true
  }
  return !!state.game && take(undo(state.game, now))
}
export const omokCanUndo = () => !!state.game && canUndo(state.game)
/** #623 the swap opening holds [무르기] now (dimmed, with its words), the game still on */
export const omokUndoOpening = () => !!state.game && !state.game.end && !state.game.conceded && undoOpeningBlocked(state.game)
export function restartOmok(now: number) {
  if (state.chess && state.phase === 'open') {
    pending = []
    const chess = restartChess(state.chess, now)
    set({ ...state, chess, sel: null, drag: null, promo: null, chessCursor: chessCursorStart(visitorColor(chess)), gameSheet: false })
    return
  }
  const g = state.game
  if (!g || state.phase !== 'open') return
  pending = []
  set({ ...state, game: restart(g, now), preview: null, armed: null, cursor: CENTER })
}
export const strengthOmok = (s: Strength, now: number) =>
  state.chess ? takeChess(setChessStrength(state.chess, s, now)) : !!state.game && take(setStrength(state.game, s, now))
/** past the call to work's cap (play.md 10.3): "미안해요, 일하러 가야 해요 · 다음에 또 둬요!" and the game ends (중단) */
export const workOmok = (now: number) =>
  state.chess ? !state.chess.end && takeChess(endChess(state.chess, 'work', now)) : !!state.game && !state.game.end && take(endGame(state.game, 'work', now))

/**
 * #601 the agent's status this frame (Agents.tsx): a call to work during an open game is held (the game goes on), and wound up past its cap;
 * back to rest before the game ends, the hold is dropped. Returns true the frame the hold begins (the moment's look and line follow once).
 */
export function workSignalOmok(busy: boolean, now: number): boolean {
  const g = state.chess ?? state.game
  if (!g || g.end || state.phase === 'closed' || state.phase === 'leaving') return false
  const w = state.work
  if (!busy) {
    if (w) set({ ...state, work: null })
    return false
  }
  if (!w) {
    set({ ...state, work: { since: now, told: false } })
    return true
  }
  if (holdPhase(w, now).phase === 'over') workOmok(now)
  return false
}
/**
 * #601 the visitor's game holds the agent in its chair: until the game ends (or the visitor leaves); a game over with a call to work held (or wound
 * up by its cap) lets it go to its desk at once
 */
export function omokHoldsAgent(now: number): boolean {
  const g = state.chess ?? state.game
  if (!g || state.phase === 'closed') return false
  if (!g.end) return state.phase !== 'leaving'
  if (state.phase === 'leaving') return false
  // over with the call held: its line at the board, then away
  if (g.end.result === 'work' || state.work) return now - g.end.at < WORK_HOLD.leaveMs
  return true
}
/** the moment's look and line were shown */
export const omokWorkTold = (now: number) => state.work && !state.work.told && set({ ...state, work: { ...state.work, told: true, toldAt: now } })
/** the chip's place (the rig) */
export function setOmokChip(chip: OmokVisitState['chip']) {
  const c = state.chip
  if (c === chip || (c && chip && Math.abs(c.x - chip.x) < 0.5 && Math.abs(c.y - chip.y) < 0.5)) return
  set({ ...state, chip })
}
/** the debug probe and tests: a game in progress put on the board as it is (only while seated), e.g. a position near its end for the end scenes */
export function seedOmok(g: VisitorGame) {
  if (state.phase === 'closed' || state.phase === 'leaving') return false
  pending = []
  set({ ...state, game: g, preview: null, armed: null })
  return true
}
export function seedChess(g: VisitorChess) {
  if (state.phase === 'closed' || state.phase === 'leaving') return false
  pending = []
  set({ ...state, chess: g, sel: null, drag: null, promo: null })
  return true
}
export const visitorMayPlace = () => !!state.game && state.phase === 'open' && visitorTurn(state.game)

// ---- #604 chess at the board (hologram.md 10.3 · 11.5): select, move, promote ----------------------------------------------------

/** the visitor may move now (the camera has arrived, their turn) */
export const visitorMayMove = () => !!state.chess && state.phase === 'open' && visitorChessTurn(state.chess)
export const chessCanUndo = () => !!state.chess && canUndoChess(state.chess)
export const chessIdle = (now: number) => (state.chess ? chessIdleLeft(state.chess, now) : null)
/** where the selected piece may go (empty: nothing is selected) */
export const chessTargets = (): { sq: number; capture: boolean }[] =>
  state.chess && state.sel !== null ? legalTargets(state.chess, state.sel).map((t) => ({ sq: t.to, capture: t.capture })) : []

/** the piece on `sq` is chosen (the visitor's own, their turn); the same square again lets it go */
export function chessPick(sq: number, toggle = true): boolean {
  const c = state.chess
  if (!c || !visitorMayMove() || state.promo) return false
  if (!visitorPieceAt(c, sq)?.mine) return false
  if (state.sel === sq) {
    if (toggle) set({ ...state, sel: null, drag: null, chessCursor: sq })
    return toggle
  }
  set({ ...state, sel: sq, drag: null, chessCursor: sq })
  return true
}
export const chessDeselect = () => (state.sel !== null || state.drag) && (set({ ...state, sel: null, drag: null }), true)
/** the piece being dragged: its world point (null: dropped / not dragging) */
export function setChessDrag(pos: Vector3 | null) {
  if (state.sel === null) return
  set({ ...state, drag: pos ? { pos } : null })
}

/** the selected piece goes to `to` (a promotion square asks for the piece first: state.promo); false when it may not */
export function chessMoveTo(to: number, now: number, from = state.sel): boolean {
  const c = state.chess
  if (!c || !visitorMayMove() || from === null) return false
  const r = visitorChessMove(c, from, to, now)
  if (r === 'needsPromotion') {
    set({ ...state, sel: from, drag: null, promo: { from, to }, chessCursor: to })
    return true
  }
  if (!r) return false
  const ok = takeChess(r)
  if (ok) set({ ...state, sel: null, drag: null, promo: null, chessCursor: to })
  return ok
}
/** a square chosen (a click, a tap, Enter at the cursor): one's own piece selects it, a target of the selected piece moves it, else the selection goes */
export function chessSelect(sq: number, now: number): boolean {
  if (!visitorMayMove() || state.promo) return false
  if (state.sel !== null && state.sel !== sq && legalTargets(state.chess!, state.sel).some((t) => t.to === sq)) return chessMoveTo(sq, now)
  if (visitorPieceAt(state.chess!, sq)?.mine) return chessPick(sq)
  set({ ...state, sel: null, drag: null, chessCursor: sq })
  return false
}
/** the promotion sheet's choice (knight 2 … queen 5) */
export function choosePromotion(kind: number, now: number): boolean {
  const p = state.promo
  const c = state.chess
  if (!p || !c || state.phase !== 'open') return false
  const r = visitorChessMove(c, p.from, p.to, now, kind)
  if (!r || r === 'needsPromotion') return false
  const ok = takeChess(r)
  if (ok) set({ ...state, sel: null, drag: null, promo: null, chessCursor: p.to })
  return ok
}
/** Esc on the promotion sheet cancels the move (the pawn stays) */
export const cancelPromotion = () => !!state.promo && (set({ ...state, promo: null, sel: null, drag: null }), true)
/** 기권: the visitor gives up, the agent wins */
export const resignChess = (now: number) => !!state.chess && !state.chess.end && takeChess(endChess(state.chess, 'resign', now))

/** the keyboard cursor: arrows (right, up in the visitor's view; the visitor's colour is near, so black's right is the files running down), clamped */
export function moveChessCursor(dx: number, dy: number) {
  const c = state.chess
  if (!c) return
  const s = visitorColor(c) === 0 ? 1 : -1
  const file = Math.max(0, Math.min(7, (state.chessCursor & 7) + dx * s))
  const rank = Math.max(0, Math.min(7, (state.chessCursor >> 3) + dy * s))
  set({ ...state, chessCursor: rank * 8 + file })
}

/** the keyboard cursor: arrows (dx, dy in the visitor's view: right, up), clamped to the board */
export function moveCursor(dx: number, dy: number) {
  const c = state.cursor
  const { right, up } = state.orient
  const col = Math.max(0, Math.min(N - 1, (c % N) + dx * right[0] + dy * up[0]))
  const row = Math.max(0, Math.min(N - 1, ((c / N) | 0) + dx * right[1] + dy * up[1]))
  set({ ...state, cursor: row * N + col })
}
export const setCursor = (cell: number) => state.cursor !== cell && set({ ...state, cursor: cell })
export const setOmokPreview = (cell: number | null) => state.preview !== cell && set({ ...state, preview: cell })
export const armOmok = (cell: number | null) => state.armed !== cell && set({ ...state, armed: cell })
/** where the tag stands on the screen (the rig, every frame) */
export function setOmokTag(tag: OmokVisitState['tag']) {
  const t = state.tag
  if (t === tag || (t && tag && t.agent === tag.agent && !!t.hot === !!tag.hot && Math.abs(t.x - tag.x) < 0.5 && Math.abs(t.y - tag.y) < 0.5)) return
  set({ ...state, tag })
}
