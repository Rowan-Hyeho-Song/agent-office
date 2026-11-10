// The whiteboard canvas's geometry (#66, docs-ui section 3) as pure numbers: where each column, card, "+N" and note
// goes and which lines of text they hold. The values are the mock's (docs/design/docs-ui.html drawBoard). Text width
// comes in as a function so this runs (and is tested) without a canvas.

import { COLUMNS, COLUMN_LABEL, type BoardCard, type BoardDecision, type BoardState, type Column } from './state'

export const BW = 1536
export const BH = 1024
export const FS_L = 48 // --board-fs-l: titles (12px at 1/4 distance)
export const FS_S = 24 // --board-fs-s: numbers and names (close up only)
export const CARDS_PER_COLUMN = 4
export const NOTES = 3

const PAD = 40
const COL_W = 330
const GAP = 24
const CARD_H = 172
export const CARD_STEP = 196
const NOTE_H = 260
const NOTE_STEP = 300

/** width in canvas px of `text` at `size` (bold or not) */
export type Measure = (text: string, size: number, bold: boolean) => number

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface CardLayout extends Box {
  card: BoardCard
  column: Column
  /** degrees, +-1 at most */
  tilt: number
  /** "#27 · 메모" parts are drawn by the painter; these are the title lines (empty when SECRET) */
  lines: string[]
}

export interface ColumnLayout {
  column: Column
  title: string
  /** every card of the column, not only the shown ones */
  count: number
  x: number
  w: number
  cards: CardLayout[]
  /** cards beyond the shown four */
  more: number
  moreAt: { x: number; y: number }
}

export interface NoteLayout extends Box {
  decision: BoardDecision
  tilt: number
  titleLines: string[]
  noteLines: string[]
}

export interface BoardLayout {
  columns: ColumnLayout[]
  notes: NoteLayout[]
  notesHeading: { x: number; w: number }
  pad: number
  headerH: number
}

/**
 * Break `text` into at most `maxLines` lines no wider than `w`: at spaces; a word wider than a line is cut by
 * character; what does not fit ends the last line with an ellipsis.
 */
export function wrapLines(text: string, w: number, size: number, bold: boolean, measure: Measure, maxLines: number): string[] {
  const fits = (s: string) => measure(s, size, bold) <= w
  let lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word
    if (fits(t)) {
      line = t
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const ch of [...word]) {
      const u = line + ch
      if (!fits(u) && line) {
        lines.push(line)
        line = ch
      } else line = u
    }
  }
  lines.push(line)
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    const last = [...lines[maxLines - 1]]
    // make room for the ellipsis
    while (last.length > 1 && !fits(`${last.join('')}…`)) last.pop()
    lines[maxLines - 1] = `${last.join('')}…`
  }
  return lines
}

/** `expand`: columns whose hidden cards unfold below the shown four (the board screen's "+N"; the 3D board never expands) */
export function layoutBoard(state: BoardState, measure: Measure, expand: readonly Column[] = []): BoardLayout {
  const headerH = PAD + FS_L + 34
  const columns: ColumnLayout[] = COLUMNS.map((column, ci) => {
    const x = PAD + ci * (COL_W + GAP)
    const all = state[column]
    const shown = expand.includes(column) ? all : all.slice(0, CARDS_PER_COLUMN)
    const cards: CardLayout[] = shown.map((card, k) => ({
      card,
      column,
      x,
      y: headerH + k * CARD_STEP,
      w: COL_W,
      h: CARD_H,
      tilt: (k % 2 ? 1 : -1) * (0.6 + ci * 0.2),
      lines: card.title === null ? [] : wrapLines(card.title, COL_W - 36, FS_L, true, measure, 2),
    }))
    return { column, title: COLUMN_LABEL[column], count: all.length, x, w: COL_W, cards, more: all.length - shown.length, moreAt: { x: x + 8, y: headerH + shown.length * CARD_STEP } }
  })
  const nx = PAD + 3 * (COL_W + GAP) + 6
  const nw = BW - nx - PAD
  const notes: NoteLayout[] = state.decisions.slice(0, NOTES).map((decision, k) => ({
    decision,
    x: nx,
    y: PAD + FS_L + 40 + k * NOTE_STEP,
    w: nw,
    h: NOTE_H,
    tilt: k % 2 ? 1.4 : -1.1,
    titleLines: wrapLines(decision.title, nw - 44, FS_L, true, measure, 2),
    noteLines: decision.note ? wrapLines(decision.note, nw - 44, FS_S, false, measure, 2) : [],
  }))
  return { columns, notes, notesHeading: { x: nx, w: nw }, pad: PAD, headerH }
}

/** the card under a canvas point (px in BW x BH), or null; boxes are not tilted (a degree is a pixel or two) */
export function cardAt(layout: BoardLayout, x: number, y: number): CardLayout | null {
  for (const col of layout.columns)
    for (const c of col.cards) if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return c
  return null
}

/** a text signature of what a layout would draw; equal signatures need no redraw */
export const boardSignature = (state: BoardState): string =>
  JSON.stringify([
    COLUMNS.map((c) => [state[c].length, ...state[c].slice(0, CARDS_PER_COLUMN).map((k) => [k.key, k.title, k.seat])]),
    state.decisions.slice(0, NOTES).map((d) => [d.key, d.title, d.note]),
  ])
