import { describe, expect, it } from 'vitest'
import { BH, BW, layoutBoard } from '../../board/layout'
import { emptyBoard, type BoardCard, type BoardState } from '../../board/state'
import { stamp } from './CardSummary'
import {
  HOME_VIEW,
  ZOOM,
  canOpen,
  cardLabel,
  cardRef,
  cellCounts,
  clampView,
  contentHeight,
  escapeStep,
  firstCell,
  focusColumn,
  focusReturn,
  hitTest,
  mainRepoOf,
  moveCell,
  navKey,
  outsideCloses,
  panBy,
  popoverPlace,
  revealCard,
  toCanvas,
  toStage,
  zoomAt,
} from './view'

const measure = (t: string, size: number) => t.length * size * 0.6
const card = (n: number, title: string | null = `카드 ${n}`): BoardCard => ({ key: `o/r#${n}`, repo: 'o/r', n, title, seat: 1, at: '2026-11-10T05:32:00Z' })
const state = (doing: number, review = 2, done = 0): BoardState => ({
  ...emptyBoard(),
  doing: Array.from({ length: doing }, (_, i) => card(i + 1)),
  review: Array.from({ length: review }, (_, i) => card(100 + i)),
  done: Array.from({ length: done }, (_, i) => card(200 + i)),
})

describe('zoom and pan', () => {
  it('keeps the view inside the board and the zoom in 1x - 3x', () => {
    expect(clampView({ zoom: 9, cx: -50, cy: 5000 })).toEqual({ zoom: 3, cx: BW / 6, cy: BH - BH / 6 })
    expect(clampView({ zoom: 0.2, cx: 0, cy: 0 })).toEqual(HOME_VIEW)
  })
  it('zooms around the pointer: the canvas point under it stays', () => {
    const v = { zoom: 1.5, cx: 700, cy: 500 }
    const fx = 0.8
    const fy = 0.3
    const before = toCanvas(v, fx, fy)
    const after = toCanvas(zoomAt(v, 1.25, fx, fy), fx, fy)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })
  it('the whole board has nowhere to pan at 1x, and a drag moves the board with the pointer at 2x', () => {
    expect(panBy(HOME_VIEW, 200, 100, 1000)).toEqual(HOME_VIEW)
    const v = { zoom: 2, cx: BW / 2, cy: BH / 2 }
    // drag left by 100 of 1000 stage px: shows content further right by 100 * (1536 / 2 / 1000)
    expect(panBy(v, -100, 0, 1000).cx).toBeCloseTo(BW / 2 + 76.8)
  })
  it('a column head puts that column in the middle at 2x (the edge columns stop at the board edge)', () => {
    const layout = layoutBoard(state(3), measure)
    const col = layout.columns[1]
    const v = focusColumn(layout, 'review')
    expect(v.zoom).toBe(ZOOM.focus)
    expect(v.cx).toBeCloseTo(col.x + col.w / 2)
    expect(focusColumn(layout, 'doing').cx).toBe(BW / 4)
  })
  it('unfolding "+N" makes the content taller, and the view may follow', () => {
    const folded = layoutBoard(state(7), measure)
    const open = layoutBoard(state(7), measure, ['doing'])
    expect(contentHeight(folded)).toBe(BH)
    expect(contentHeight(open)).toBeGreaterThan(BH)
    expect(open.columns[0].cards).toHaveLength(7)
    expect(open.columns[0].more).toBe(0)
    expect(clampView({ zoom: 1, cx: BW / 2, cy: 5000 }, contentHeight(open)).cy).toBeGreaterThan(BH / 2)
    expect(revealCard({ zoom: 2, cx: BW / 2, cy: BH / 4 }, open.columns[0].cards[6], contentHeight(open)).cy).toBeGreaterThan(BH / 4)
  })
  it('stage and canvas px agree', () => {
    const v = { zoom: 2, cx: 600, cy: 400 }
    const p = toStage(v, 600, 400, 1000)
    expect(p.x).toBeCloseTo(500)
    expect(p.y).toBeCloseTo(((1000 / BW) * BH) / 2)
  })
})

describe('what a press lands on', () => {
  const layout = layoutBoard(state(6), measure)
  it('a card, a column head, a "+N", or nothing', () => {
    const k = layout.columns[0].cards[1]
    expect(hitTest(layout, k.x + 10, k.y + 10)).toMatchObject({ kind: 'card', card: { card: { n: 2 } } })
    expect(hitTest(layout, layout.columns[2].x + 20, layout.pad + 10)).toEqual({ kind: 'head', column: 'done' })
    expect(hitTest(layout, layout.columns[0].moreAt.x + 10, layout.columns[0].moreAt.y + 10)).toEqual({ kind: 'more', column: 'doing' })
    expect(hitTest(layout, 5, 5)).toBeNull()
  })
})

describe('keyboard in the grid', () => {
  const counts = cellCounts(layoutBoard(state(6, 2, 0), measure)) // doing: 4 cards + "+2" = 5, review 2, done 0
  it('counts the shown cards and the "+N"', () => expect(counts).toEqual([5, 2, 0]))
  it('left / right skip empty columns and cut the row to the column', () => {
    expect(moveCell(counts, { col: 0, row: 4 }, 'ArrowRight')).toEqual({ col: 1, row: 1 })
    expect(moveCell(counts, { col: 1, row: 1 }, 'ArrowRight')).toEqual({ col: 1, row: 1 }) // done is empty: stay
    expect(moveCell(counts, { col: 1, row: 0 }, 'ArrowLeft')).toEqual({ col: 0, row: 0 })
  })
  it('up / down stop at the ends', () => {
    expect(moveCell(counts, { col: 0, row: 0 }, 'ArrowUp')).toEqual({ col: 0, row: 0 })
    expect(moveCell(counts, { col: 0, row: 4 }, 'ArrowDown')).toEqual({ col: 0, row: 4 })
    expect(moveCell(counts, { col: 0, row: 1 }, 'ArrowDown')).toEqual({ col: 0, row: 2 })
  })
  it('starts at the first column that has entries', () => {
    expect(firstCell([0, 3, 1])).toEqual({ col: 1, row: 0 })
    expect(firstCell([0, 0, 0])).toBeNull()
    expect(moveCell([0, 3, 1], { col: 0, row: 0 }, 'ArrowDown')).toEqual({ col: 1, row: 1 })
  })
  it('+ - zoom, Shift + arrows pan, arrows alone move the focus', () => {
    expect(navKey({ key: '+', shiftKey: true })).toEqual({ type: 'zoom', factor: ZOOM.step })
    expect(navKey({ key: '-', shiftKey: false })).toEqual({ type: 'zoom', factor: 1 / ZOOM.step })
    expect(navKey({ key: 'ArrowLeft', shiftKey: true })).toEqual({ type: 'pan', dx: -1, dy: 0 })
    expect(navKey({ key: 'ArrowDown', shiftKey: false })).toEqual({ type: 'cell', key: 'ArrowDown' })
    expect(navKey({ key: 'a', shiftKey: false })).toBeNull()
  })
  it('the card is read aloud with its column, agent, number, title and place', () => {
    expect(cardLabel('진행 중', '루프', '#207', '둘러보기', 0, 2)).toBe('진행 중, 루프, #207 둘러보기, 2장 중 1번째')
    expect(cardLabel('검토', '메모', '#5', null, 1, 3)).toBe('검토, 메모, #5 책상 방 작업(비공개), 3장 중 2번째')
  })
})

describe('open and close rules', () => {
  it('Esc closes the popover before the board', () => {
    expect(escapeStep(true)).toBe('popover')
    expect(escapeStep(false)).toBe('board')
  })
  it('a press outside closes, a drag that began outside or a press inside does not', () => {
    expect(outsideCloses(0, false)).toBe(true)
    expect(outsideCloses(12, false)).toBe(false)
    expect(outsideCloses(0, true)).toBe(false)
  })
  it('opens only when closed, outside the timelapse, with the camera free', () => {
    expect(canOpen({ replayOn: false, cameraBusy: false, phase: 'closed' })).toBe(true)
    expect(canOpen({ replayOn: true, cameraBusy: false, phase: 'closed' })).toBe(false)
    expect(canOpen({ replayOn: false, cameraBusy: true, phase: 'closed' })).toBe(false)
    expect(canOpen({ replayOn: false, cameraBusy: false, phase: 'open' })).toBe(false)
  })
  it('focus goes back to the opener while it is in the page, else the fallback', () => {
    const opener = { isConnected: true, id: 'o' }
    const gone = { isConnected: false, id: 'g' }
    const fallback = { isConnected: true, id: 'f' }
    expect(focusReturn(opener, fallback)).toBe(opener)
    expect(focusReturn(gone, fallback)).toBe(fallback)
    expect(focusReturn(null, fallback)).toBe(fallback)
    expect(focusReturn(null, null)).toBeNull()
  })
})

describe('popover and labels', () => {
  it('sits right of the card, left when the screen ends, and stays on screen', () => {
    expect(popoverPlace({ left: 100, top: 200, right: 300, bottom: 260 }, 1280, 720)).toMatchObject({ side: 'right', x: 314 })
    expect(popoverPlace({ left: 900, top: 200, right: 1100, bottom: 260 }, 1280, 720)).toMatchObject({ side: 'left', x: 586 })
    expect(popoverPlace({ left: 100, top: 0, right: 300, bottom: 20 }, 1280, 720).y).toBe(8)
    expect(popoverPlace({ left: 100, top: 700, right: 300, bottom: 720 }, 1280, 720, 300, 220).y).toBe(720 - 220 - 8)
  })
  it('names the repository only when it is not the board main one', () => {
    expect(cardRef('o/r', 7, 'o/r')).toBe('#7')
    expect(cardRef('o/other', 7, 'o/r')).toBe('other#7')
    expect(mainRepoOf(['o/r', 'o/x', 'o/r'])).toBe('o/r')
    expect(mainRepoOf([])).toBe('')
  })
  it('the last-changed time is Seoul wall time', () => {
    expect(stamp('2026-11-10T05:32:00Z')).toBe('11-10 14:32')
    expect(stamp('nope')).toBe('')
  })
})
