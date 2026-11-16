// #137 ② the visitor's game of omok (play.md 2 · 4 · 5 · 8): whether it is flying in, open, flying back; the game itself (visitorOmok.ts); the cursor
// the keyboard moves, the point the pointer hovers, the point a first touch armed; and what the agent says / shows that the scene has not shown yet.
// A tiny external store like boardView/store.ts: OmokVisitRig.tsx (the 3D side) flies the camera, steps the game and draws the cursor; OmokVisitUi.tsx
// is the tag, the HUD and the keyboard grid. Only in this visitor's tab: nothing goes to a server, the other visitors see the scene as it is.

import { useSyncExternalStore } from 'react'
import { N } from '../../play/omok'
import {
  canUndo, chooseColor, DEFAULT_RULE, endGame, forbidPressed, restart, setRule, setStrength, startVisitorGame, stepVisitorGame, touchGame, undo, visitorForbid, visitorMove,
  visitorTurn, type OmokEvent, type Strength, type VisitorGame,
} from '../../play/visitorOmok'
import { RULES, type Forbid, type RuleId } from '../../play/omokRules'

export type VisitPhase = 'closed' | 'flying' | 'open' | 'leaving'

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
  tag: { x: number; y: number; agent: string; orient: Orient } | null
  /** the board as the visitor sees it: the grid step (columns, rows) for one point to the right and one point up (away) on the screen */
  orient: Orient
  /** #603 the rule chooser is open (play.md 11.2), and the row selected in it (not yet started) */
  picker: boolean
  pickerRule: RuleId
  /** #603 a forbidden point pressed: where, why and when (the ✕ shakes, the guidance shows 2 s) */
  forbid: { cell: number; why: Forbid; at: number } | null
  /** #603 the board's right edge and vertical middle on the screen while the chooser is open (the rig): it stands beside the board */
  boardBox: { right: number; middle: number } | null
}

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
export const CLOSED: OmokVisitState = { phase: 'closed', agent: null, game: null, cursor: CENTER, preview: null, armed: null, tag: null, orient: ORIENT, picker: false, pickerRule: DEFAULT_RULE, forbid: null, boardBox: null }

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
export function openOmok(agent: string, now: number, seed: number, orient: Orient = ORIENT): boolean {
  if (state.phase !== 'closed') return false
  pending = []
  set({ ...CLOSED, tag: state.tag, phase: 'flying', agent, game: startVisitorGame(agent, seed, now, 'normal', 0, lastRule()), orient })
  return true
}
/** at the board: the chooser opens by itself for this tab's first game (the camera has stopped) */
export const omokArrived = () => state.phase === 'flying' && set({ ...state, phase: 'open', picker: !chosenInTab, pickerRule: state.game?.rule ?? DEFAULT_RULE })
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
  set({ ...state, phase: 'leaving', preview: null, armed: null })
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
/** #603 swap: the visitor's colour after the agent's three (the HUD's buttons) */
export const chooseColorOmok = (color: 1 | 2, now: number) => !!state.game && state.phase === 'open' && take(chooseColor(state.game, color, now))
/** #603 the forbidden reason at a point for the visitor now (the ✕, the cell's words), or null */
export const omokForbidAt = (cell: number | null): Forbid | null => (cell === null || !state.game ? null : visitorForbid(state.game, cell))
/** the clock: the agent's stone lands, a quiet visitor is let go (play.md 2.5) */
export function stepOmok(now: number) {
  const g = state.game
  if (!g || state.phase === 'closed') return
  const r = stepVisitorGame(g, now)
  if (r.g !== g || r.events.length) take(r)
}
/** any key or touch: the 90 s count starts again */
export function touchOmok(now: number) {
  const g = state.game
  if (g && !g.end) set({ ...state, game: touchGame(g, now) })
}
export const undoOmok = (now: number) => !!state.game && take(undo(state.game, now))
export const omokCanUndo = () => !!state.game && canUndo(state.game)
export function restartOmok(now: number) {
  const g = state.game
  if (!g || state.phase !== 'open') return
  pending = []
  set({ ...state, game: restart(g, now), preview: null, armed: null, cursor: CENTER })
}
export const strengthOmok = (s: Strength, now: number) => !!state.game && take(setStrength(state.game, s, now))
/** the agent is called to work: "일하러 가야 해요!" and the game ends (중단) */
export const workOmok = (now: number) => !!state.game && !state.game.end && take(endGame(state.game, 'work', now))
/** the debug probe and tests: a game in progress put on the board as it is (only while seated), e.g. a position near its end for the end scenes */
export function seedOmok(g: VisitorGame) {
  if (state.phase === 'closed' || state.phase === 'leaving') return false
  pending = []
  set({ ...state, game: g, preview: null, armed: null })
  return true
}
export const visitorMayPlace = () => !!state.game && state.phase === 'open' && visitorTurn(state.game)

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
  if (t === tag || (t && tag && t.agent === tag.agent && Math.abs(t.x - tag.x) < 0.5 && Math.abs(t.y - tag.y) < 0.5)) return
  set({ ...state, tag })
}
