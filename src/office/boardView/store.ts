// What the page sees of the whiteboard close view (#234): is it flying in, open, flying back; which column was pressed; where
// the board's face is on the screen. BoardCamera.tsx (the 3D side) flies the camera and writes the rect, BoardView.tsx is
// the DOM. A tiny external store like tourStore.ts; the camera rig and the tour read `isBoardActive()` so they stand aside.

import { useSyncExternalStore } from 'react'
import { sameRect, type Rect } from './pose'

export type Phase = 'closed' | 'flying' | 'open' | 'leaving'
/** stage = the camera flies to the board and the sharp overdraw sits on it; sheet = a phone's full-screen 2D board (no flight) */
export type Mode = 'stage' | 'sheet'

export interface BoardViewState {
  phase: Phase
  mode: Mode
  /** the pressed column (0 doing .. 2 done) or null (Enter / a press on the frame) */
  column: number | null
  /** the card pressed (`repo#n`), to be focused first */
  focusKey: string | null
  /** the pointer is over the board, or the keyboard opener has focus (the cyan outline + tag) */
  hover: boolean
  /** which board: the whiteboard (#234), or the cork board of the visitors' notes (#4 12.3: "the same way as the whiteboard") */
  surface: Surface
}

export type Surface = 'whiteboard' | 'bulletin'

export const CLOSED: BoardViewState = { phase: 'closed', mode: 'stage', column: null, focusKey: null, hover: false, surface: 'whiteboard' }

export type BoardEvent =
  | { type: 'open'; mode: Mode; column: number | null; focusKey: string | null; surface?: Surface }
  | { type: 'arrived' }
  | { type: 'close' }
  | { type: 'left' }
  | { type: 'reset' }

/** the open / close rules as a pure transition (tested): it opens only from closed; a close in flight turns back from where it is */
export function reduceBoard(s: BoardViewState, e: BoardEvent): BoardViewState {
  switch (e.type) {
    case 'open':
      return s.phase === 'closed' ? { ...s, phase: e.mode === 'sheet' ? 'open' : 'flying', mode: e.mode, column: e.column, focusKey: e.focusKey, surface: e.surface ?? 'whiteboard' } : s
    case 'arrived':
      return s.phase === 'flying' ? { ...s, phase: 'open' } : s
    case 'close':
      if (s.phase === 'closed' || s.phase === 'leaving') return s
      return s.mode === 'sheet' ? { ...CLOSED, hover: s.hover } : { ...s, phase: 'leaving' }
    case 'left':
      return s.phase === 'leaving' ? { ...CLOSED, hover: s.hover } : s
    case 'reset':
      return { ...CLOSED }
  }
}

let state: BoardViewState = CLOSED
let rect: Rect | null = null
let opener: HTMLElement | null = null
const listeners = new Set<() => void>()
const rectListeners = new Set<() => void>()

export const getBoardView = () => state
/** the camera rig and the tour stand aside while the board is flown to or open */
export const isBoardActive = () => state.phase !== 'closed' && state.mode === 'stage'
export const isBoardOpen = () => state.phase !== 'closed'

export function dispatchBoard(e: BoardEvent) {
  const next = reduceBoard(state, e)
  if (next === state) return false
  state = next
  listeners.forEach((l) => l())
  return true
}
/** the pointer over the board / the opener focused */
export function setBoardHover(hover: boolean) {
  if (state.hover === hover) return
  state = { ...state, hover }
  listeners.forEach((l) => l())
}

/** what the open button / a press on the board calls; `from` = the element focus goes back to on close */
export function openBoard(o: { mode: Mode; column?: number | null; focusKey?: string | null; from?: HTMLElement | null; surface?: Surface }): boolean {
  const a = document.activeElement
  opener = o.from ?? (a instanceof HTMLElement && a !== document.body ? a : null)
  const ok = dispatchBoard({ type: 'open', mode: o.mode, column: o.column ?? null, focusKey: o.focusKey ?? null, surface: o.surface })
  if (!ok) opener = null
  return ok
}
export const closeBoard = () => dispatchBoard({ type: 'close' })
export const takeOpener = (): HTMLElement | null => {
  const o = opener
  opener = null
  return o
}

export const getBoardRect = () => rect
export function setBoardRect(r: Rect | null) {
  if (sameRect(rect, r)) return
  rect = r
  rectListeners.forEach((l) => l())
}

const sub = (set: Set<() => void>) => (cb: () => void) => (set.add(cb), () => void set.delete(cb))
export const useBoardView = () => useSyncExternalStore(sub(listeners), getBoardView)
export const useBoardRect = () => useSyncExternalStore(sub(rectListeners), getBoardRect)
