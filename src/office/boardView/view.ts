// The board screen's own state as pure functions (#234, docs-ui.md 3.5): the zoom / pan of the sharp overdraw, what a press
// lands on, keyboard moves in the grid, where the card popover sits, the close rules and where focus goes back to.

import { BH, BW, CARD_STEP, type BoardLayout, type CardLayout } from '../../board/layout'
import type { Column } from '../../board/state'

export const ZOOM = { min: 1, max: 3, focus: 2, step: 1.25, wheel: 0.0015 } as const

/** the part of the board shown: its centre in canvas px and the zoom (1 = the whole board, the arrival framing) */
export interface View {
  zoom: number
  cx: number
  cy: number
}

export const HOME_VIEW: View = { zoom: 1, cx: BW / 2, cy: BH / 2 }

/** the canvas height the board screen can show: the board's, or more when "+N" unfolded cards below it */
export function contentHeight(layout: BoardLayout): number {
  const bottom = Math.max(0, ...layout.columns.flatMap((c) => c.cards.map((k) => k.y + k.h)))
  return Math.max(BH, bottom + layout.pad)
}

/** keep the view inside the board (no rubber band: it just stops at the edge) */
export function clampView(v: View, contentH: number = BH): View {
  const zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, v.zoom))
  const vw = BW / zoom
  const vh = BH / zoom
  const cx = Math.max(vw / 2, Math.min(BW - vw / 2, v.cx))
  // the board's own height, or more when unfolded cards make the content taller
  const cy = Math.max(vh / 2, Math.min(Math.max(vh / 2, contentH - vh / 2), v.cy))
  return { zoom, cx, cy }
}

/** zoom by `factor` keeping the canvas point under the pointer still; (fx, fy) = the pointer in 0..1 across the stage */
export function zoomAt(v: View, factor: number, fx: number, fy: number, contentH: number = BH): View {
  const zoom = Math.max(ZOOM.min, Math.min(ZOOM.max, v.zoom * factor))
  const px = v.cx + (fx - 0.5) * (BW / v.zoom)
  const py = v.cy + (fy - 0.5) * (BH / v.zoom)
  return clampView({ zoom, cx: px - (fx - 0.5) * (BW / zoom), cy: py - (fy - 0.5) * (BH / zoom) }, contentH)
}

/** a drag of (dx, dy) stage px moves the board with the pointer; `stageW` is the stage's width in px */
export function panBy(v: View, dx: number, dy: number, stageW: number, contentH: number = BH): View {
  const k = BW / v.zoom / stageW
  return clampView({ ...v, cx: v.cx - dx * k, cy: v.cy - dy * k }, contentH)
}

/** a column head was pressed: that column in the middle at 2x (docs-ui 3.5), looking at its first cards */
export function focusColumn(layout: BoardLayout, column: Column, contentH: number = BH): View {
  const col = layout.columns.find((c) => c.column === column)
  if (!col) return HOME_VIEW
  return clampView({ zoom: ZOOM.focus, cx: col.x + col.w / 2, cy: layout.headerH + 2 * CARD_STEP }, contentH)
}

/** the card brought into view (when it is outside) with the zoom kept */
export function revealCard(v: View, card: CardLayout, contentH: number = BH): View {
  const vw = BW / v.zoom
  const vh = BH / v.zoom
  const inside = card.x >= v.cx - vw / 2 && card.x + card.w <= v.cx + vw / 2 && card.y >= v.cy - vh / 2 && card.y + card.h <= v.cy + vh / 2
  return inside ? v : clampView({ ...v, cx: card.x + card.w / 2, cy: card.y + card.h / 2 }, contentH)
}

/** stage fraction (0..1 across) -> canvas px */
export const toCanvas = (v: View, fx: number, fy: number): { x: number; y: number } => ({ x: v.cx + (fx - 0.5) * (BW / v.zoom), y: v.cy + (fy - 0.5) * (BH / v.zoom) })

/** canvas px -> stage px for a stage `stageW` px wide (its height is the board's aspect) */
export const toStage = (v: View, x: number, y: number, stageW: number): { x: number; y: number } => {
  const s = (stageW / BW) * v.zoom
  return { x: (x - v.cx) * s + stageW / 2, y: (y - v.cy) * s + ((stageW / BW) * BH) / 2 }
}

export type Hit = { kind: 'card'; card: CardLayout } | { kind: 'head'; column: Column } | { kind: 'more'; column: Column } | null

/** what is under a canvas point: a card, a column head (the title strip above the cards) or a "+N" */
export function hitTest(layout: BoardLayout, x: number, y: number): Hit {
  for (const col of layout.columns) {
    for (const c of col.cards) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return { kind: 'card', card: c }
    if (x >= col.x && x <= col.x + col.w && y >= layout.pad && y < layout.headerH) return { kind: 'head', column: col.column }
    if (col.more && x >= col.moreAt.x && x <= col.x + col.w && y >= col.moreAt.y && y <= col.moreAt.y + CARD_STEP / 2) return { kind: 'more', column: col.column }
  }
  return null
}

// ---- keyboard ------------------------------------------------------------------------------------------------------

export interface Cell {
  col: number
  /** the row inside the column; the "+N" is the row after the last card */
  row: number
}

/** the entries of each column: its shown cards, then one for "+N" when some are hidden */
export const cellCounts = (layout: BoardLayout): number[] => layout.columns.map((c) => c.cards.length + (c.more ? 1 : 0))

export function firstCell(counts: readonly number[]): Cell | null {
  const col = counts.findIndex((n) => n > 0)
  return col < 0 ? null : { col, row: 0 }
}

/** an arrow key's move inside the grid: left / right to the next column that has entries (the row kept, cut to its length), up / down within the column. Stays put at an edge. */
export function moveCell(counts: readonly number[], at: Cell, key: string): Cell {
  const stay = counts[at.col] ? at : (firstCell(counts) ?? at)
  if (key === 'ArrowUp') return { ...stay, row: Math.max(0, stay.row - 1) }
  if (key === 'ArrowDown') return { ...stay, row: Math.min(counts[stay.col] - 1, stay.row + 1) }
  const dir = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0
  if (!dir) return stay
  for (let c = stay.col + dir; c >= 0 && c < counts.length; c += dir) if (counts[c] > 0) return { col: c, row: Math.min(stay.row, counts[c] - 1) }
  return stay
}

/** keys that move or zoom the overdraw: `+` / `-` zoom, Shift + an arrow pans (the plain arrows move the focus) */
export type Nav = { type: 'zoom'; factor: number } | { type: 'pan'; dx: number; dy: number } | { type: 'cell'; key: string } | null
export function navKey(e: { key: string; shiftKey: boolean }): Nav {
  if (e.key === '+' || e.key === '=') return { type: 'zoom', factor: ZOOM.step }
  if (e.key === '-' || e.key === '_') return { type: 'zoom', factor: 1 / ZOOM.step }
  const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
  if (!arrow) return null
  return e.shiftKey ? { type: 'pan', dx: arrow[0], dy: arrow[1] } : { type: 'cell', key: e.key }
}

/** the pan one Shift + arrow press does: a fifth of what is shown */
export const panStep = (v: View, dx: number, dy: number, contentH: number = BH): View => clampView({ ...v, cx: v.cx + (dx * BW) / v.zoom / 5, cy: v.cy + (dy * BH) / v.zoom / 5 }, contentH)

// ---- close rules, popover, focus ---------------------------------------------------------------------------------------

/** Esc closes the card popover first, then the board screen */
export const escapeStep = (popoverOpen: boolean): 'popover' | 'board' => (popoverOpen ? 'popover' : 'board')

/** a press on the dim area outside the board closes it; a drag that started there (a camera habit) does not */
export const outsideCloses = (moved: number, insideStage: boolean): boolean => !insideStage && moved < 5

/** the board screen may open: not in the timelapse, not while the door flies the camera, not already open */
export const canOpen = (s: { replayOn: boolean; cameraBusy: boolean; phase: string }): boolean => !s.replayOn && !s.cameraBusy && s.phase === 'closed'

/** where focus goes when the board screen closes: the thing it was opened from, if it is still in the page, else the fallback */
export function focusReturn<T extends { isConnected: boolean }>(opener: T | null, fallback: T | null): T | null {
  return opener?.isConnected ? opener : fallback
}

export type Side = 'right' | 'left'
/** the popover's side of a card: to the right of it, or to the left when it would run off the screen; kept on screen vertically */
export function popoverPlace(card: { left: number; top: number; right: number; bottom: number }, vw: number, vh: number, w = 300, h = 220, gap = 14): { side: Side; x: number; y: number } {
  const side: Side = card.right + gap + w <= vw - 8 ? 'right' : 'left'
  const x = side === 'right' ? card.right + gap : Math.max(8, card.left - gap - w)
  const y = Math.max(8, Math.min(vh - h - 8, (card.top + card.bottom) / 2 - h / 2))
  return { side, x, y }
}

/** "#27" for the board's own repository, "name#27" for another (docs-ui 3.5 / #182) */
export function cardRef(repo: string, n: number, mainRepo: string): string {
  return repo === mainRepo ? `#${n}` : `${repo.split('/').pop()}#${n}`
}

/** the repository most cards come from = "this repository" */
export function mainRepoOf(repos: readonly string[]): string {
  const count = new Map<string, number>()
  for (const r of repos) count.set(r, (count.get(r) ?? 0) + 1)
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? ''
}

/** the card's reading-aloud name: "진행 중, 루프, #207 둘러보기, 2장 중 1번째" */
export function cardLabel(column: string, agent: string, ref: string, title: string | null, index: number, total: number): string {
  return `${column}, ${agent}, ${ref} ${title ?? '책상 방 작업(비공개)'}, ${total}장 중 ${index + 1}번째`
}
