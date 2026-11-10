import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { agentName, boardColors, drawBoard } from '../../board/draw'
import { BH, BW, FS_L, layoutBoard, type CardLayout } from '../../board/layout'
import { COLUMNS, type Column } from '../../board/state'
import { useReplay } from '../../replay/store'
import { closeApprovalBox } from '../approval/panel'
import { closeDocs, openDocs } from '../docs/panel'
import type { OfficeWorld } from '../world'
import { BoardSheet } from './BoardSheet'
import { measure, useBoardState, useFontsReady, useNarrow } from './hooks'
import { CardSummary, agentVar } from './CardSummary'
import { CLOSE } from './pose'
import { closeBoard, dispatchBoard, openBoard, setBoardHover, takeOpener, useBoardRect, useBoardView, type BoardViewState } from './store'
import {
  HOME_VIEW,
  cardLabel,
  cardRef,
  cellCounts,
  clampView,
  contentHeight,
  escapeStep,
  firstCell,
  focusColumn,
  focusReturn,
  mainRepoOf,
  moveCell,
  navKey,
  outsideCloses,
  panBy,
  panStep,
  popoverPlace,
  revealCard,
  toStage,
  zoomAt,
  ZOOM,
  type Cell,
  type View,
} from './view'

// The whiteboard close view's screen (#234, docs/design/docs-ui.md 3.5). Desktop: the camera is already at the board
// (BoardCamera.tsx); this lays a same-layout canvas over the board's projected rect, drawn at the device's pixel ratio so
// the text is sharp, with real buttons over every card / column head / "+N" so it is in the DOM for the keyboard and
// screen readers. Phone: BoardSheet.tsx, a full-screen 2D board. The 3D scene dims to 40% around the board.

/** the white of the baked board's face: the overdraw is opaque so the 3D cards under it never show through a zoom */
const FACE = '#f1efe9'

/** focus given back: the opener if it is still in the page, else the keyboard opener button */
const giveBack = (el: HTMLElement | null) => {
  if (!el) return
  if (!el.hasAttribute('tabindex') && !/^(BUTTON|INPUT|A)$/.test(el.tagName)) el.setAttribute('tabindex', '-1')
  el.focus({ preventScroll: true })
}

export function BoardView({ world }: { world: OfficeWorld }) {
  const st = useBoardView()
  const replayOn = useReplay().mode !== 'off'
  const narrow = useNarrow()
  const was = useRef<BoardViewState['phase']>('closed')

  // the timelapse owns the board: close at once (nothing flies back, the camera is the replay's)
  useEffect(() => {
    if (replayOn && st.phase !== 'closed') dispatchBoard({ type: 'reset' })
  }, [replayOn, st.phase])
  // the page chrome that would sit on the board steps aside while it is open
  useEffect(() => {
    const open = st.phase !== 'closed'
    if (open) {
      document.documentElement.dataset.boardView = st.mode
      closeDocs()
      closeApprovalBox()
    } else delete document.documentElement.dataset.boardView
    return () => void delete document.documentElement.dataset.boardView
  }, [st.phase, st.mode])
  // a phone-sized window turned wide (or the reverse) while open: close, the other layout would start from nothing
  useEffect(() => {
    if (st.phase !== 'closed' && (st.mode === 'sheet') !== narrow) closeBoard()
  }, [narrow, st.mode, st.phase])
  // focus goes back where the screen was opened from
  useLayoutEffect(() => {
    if (st.phase === 'closed' && was.current !== 'closed') giveBack(focusReturn(takeOpener(), document.getElementById('board-opener')))
    was.current = st.phase
  }, [st.phase])

  return (
    <>
      <Opener hidden={replayOn || st.phase !== 'closed'} narrow={narrow} />
      <Hover />
      {st.phase !== 'closed' && !replayOn && (st.mode === 'sheet' ? <BoardSheet world={world} st={st} /> : <Stage world={world} st={st} />)}
    </>
  )
}

/** the keyboard way in: a button in the tab order that is only seen while it has focus (the board gets its outline then) */
function Opener({ hidden, narrow }: { hidden: boolean; narrow: boolean }) {
  if (hidden) return null
  return (
    <button
      id="board-opener"
      type="button"
      className="board-opener"
      aria-label="화이트보드 크게 보기"
      onFocus={() => setBoardHover(true)}
      onBlur={() => setBoardHover(false)}
      onClick={(e) => openBoard({ mode: narrow ? 'sheet' : 'stage', from: e.currentTarget })}
    >
      화이트보드 크게 보기
    </button>
  )
}

/** the cyan 1 px outline + tag over the board while the pointer (or the keyboard opener) is on it */
function Hover() {
  const st = useBoardView()
  const rect = useBoardRect()
  if (!st.hover || st.phase !== 'closed' || st.mode !== 'stage' || !rect) return null
  return (
    <div className="board-hover" aria-hidden="true" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <span className="board-hover-tag">화이트보드 · 크게 보기</span>
    </div>
  )
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function Stage({ world, st }: { world: OfficeWorld; st: BoardViewState }) {
  const rect = useBoardRect()
  const board = useBoardState(world)
  const fonts = useFontsReady()
  const [expand, setExpand] = useState<Column[]>([])
  const layout = useMemo(() => layoutBoard(board, measure, expand), [board, expand, fonts])
  const contentH = contentHeight(layout)
  const [view, setView] = useState<View>(HOME_VIEW)
  const counts = useMemo(() => cellCounts(layout), [layout])
  const start = useMemo(() => {
    const k = st.focusKey && layout.columns.flatMap((c, col) => c.cards.map((x, row) => ({ x, col, row }))).find((e) => e.x.card.key === st.focusKey)
    return k ? { col: k.col, row: k.row } : st.column !== null && counts[st.column] ? { col: st.column, row: 0 } : (firstCell(counts) ?? { col: 0, row: 0 })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- where focus starts is decided once, at open
  const [cell, setCell] = useState<Cell>(start)
  const [pop, setPop] = useState<{ key: string; col: Column } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; v: View; on: boolean } | null>(null)
  const dragged = useRef(false)
  const [live, setLive] = useState('')
  const open = st.phase === 'open'
  const leaving = st.phase === 'leaving'
  const cur = useRef({ view, layout, contentH, pop, cell, counts, open, rect })
  cur.current = { view, layout, contentH, pop, cell, counts, open, rect }
  const mainRepo = useMemo(() => mainRepoOf(COLUMNS.flatMap((c) => board[c].map((k) => k.repo))), [board])

  // the view must stay inside the content when the layout changes (a card left a column, "+N" folded)
  useEffect(() => setView((v) => clampView(v, contentH)), [contentH])
  // the card the popover shows may be gone
  useEffect(() => {
    if (pop && !layout.columns.some((c) => c.cards.some((k) => k.card.key === pop.key))) setPop(null)
  }, [layout, pop])

  // ---- the sharp overdraw ------------------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const cv = canvas.current
    if (!cv || !rect || !open) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    cv.width = Math.round(rect.width * dpr)
    cv.height = Math.round(rect.height * dpr)
    const ctx = cv.getContext('2d')!
    const s = (rect.width / BW) * view.zoom * dpr
    ctx.setTransform(s, 0, 0, s, -(view.cx - BW / view.zoom / 2) * s, -(view.cy - BH / view.zoom / 2) * s)
    drawBoard(ctx, layout, { colors: boardColors() })
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = FACE
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.globalCompositeOperation = 'source-over'
  }, [rect, view, layout, open])

  // ---- focus -------------------------------------------------------------------------------------------------------
  const cellEl = (c: Cell) => document.getElementById(`bv-cell-${c.col}-${c.row}`)
  useEffect(() => {
    if (!open) return
    ;(cellEl(cur.current.cell) ?? root.current?.querySelector<HTMLElement>('.bv-back'))?.focus({ preventScroll: true })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- once, when the screen has arrived
  const focusCell = (c: Cell) => {
    setCell(c)
    const card = layout.columns[c.col]?.cards[c.row]
    if (card) setView((v) => revealCard(v, card, contentH))
    requestAnimationFrame(() => cellEl(c)?.focus({ preventScroll: true }))
  }

  const closePop = (refocus = true) => {
    setPop(null)
    if (refocus) requestAnimationFrame(() => cellEl(cur.current.cell)?.focus({ preventScroll: true }))
  }
  const showCard = (k: CardLayout, c: Cell) => {
    setCell(c)
    setPop({ key: k.card.key, col: k.column })
    const title = k.card.title === null ? '책상 방 작업(비공개)' : k.card.title
    setLive(`${cardRef(k.card.repo, k.card.n, mainRepo)} ${title} 요약 열림`)
    requestAnimationFrame(() => popRef.current?.focus({ preventScroll: true }))
  }
  const goColumn = (column: Column) => {
    setPop(null)
    setView(focusColumn(layout, column, contentH))
  }
  const unfold = (column: Column) => {
    setExpand((e) => (e.includes(column) ? e : [...e, column]))
    setView((v) => v)
  }

  // ---- Esc (popover first, then the board), Tab kept inside ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (escapeStep(!!cur.current.pop) === 'popover') closePop()
        else closeBoard()
      } else if (e.key === 'Tab' && root.current) {
        const list = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (!list.length) return
        const i = list.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1
        if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
          e.preventDefault()
          list[next].focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- reads the latest through `cur`

  // wheel = zoom 1x - 3x at the pointer (a native, non-passive listener so the page does not scroll)
  useEffect(() => {
    const el = stage.current
    if (!el || !open) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = cur.current.rect
      if (!r) return
      const f = Math.exp(-e.deltaY * ZOOM.wheel * (e.deltaMode === 1 ? 16 : 1))
      setView((v) => zoomAt(v, f, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, cur.current.contentH))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open])

  // ---- pointer: drag to move; a press outside the board closes -----------------------------------------------------------
  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, v: view, on: false }
    dragged.current = false
  }
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId || !rect) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.on && Math.hypot(dx, dy) > 4) {
      d.on = true
      dragged.current = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (d.on) setView(panBy(d.v, dx, dy, rect.width, contentH))
  }
  const onPointerUp = (e: RPointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }
  const backdrop = useRef<[number, number] | null>(null)

  const onGridKey = (e: RKeyboardEvent) => {
    const n = navKey(e)
    if (!n) return
    e.preventDefault()
    if (n.type === 'zoom') setView((v) => zoomAt(v, n.factor, 0.5, 0.5, contentH))
    else if (n.type === 'pan') setView((v) => panStep(v, n.dx, n.dy, contentH))
    else focusCell(moveCell(counts, cell, n.key))
  }

  if (!rect) return null
  const s = (rect.width / BW) * view.zoom
  const place = (b: { x: number; y: number; w: number; h: number }) => {
    const p = toStage(view, b.x, b.y, rect.width)
    return { left: p.x, top: p.y, width: b.w * s, height: b.h * s }
  }
  const popCard = pop ? layout.columns.flatMap((c) => c.cards).find((k) => k.card.key === pop.key) : null
  const popAt = popCard
    ? (() => {
        const b = place(popCard)
        const el = { left: rect.left + b.left, top: rect.top + b.top, right: rect.left + b.left + b.width, bottom: rect.top + b.top + b.height }
        return popoverPlace(el, window.innerWidth, window.innerHeight)
      })()
    : null
  const rows = Math.max(0, ...counts)

  return (
    <div ref={root} className="board-view" data-leaving={leaving || undefined} role="dialog" aria-label="화이트보드" style={{ ['--bv-fade' as string]: `${CLOSE.fadeMs}ms` }}>
      <div
        className="bv-backdrop"
        onPointerDown={(e) => (backdrop.current = [e.clientX, e.clientY])}
        onClick={(e) => {
          const from = backdrop.current
          if (outsideCloses(from ? Math.hypot(e.clientX - from[0], e.clientY - from[1]) : 0, false)) closeBoard()
        }}
      />
      <button type="button" className="bv-back" onClick={closeBoard}>
        ← 사무실로
      </button>
      <div
        ref={stage}
        className="bv-stage"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (dragged.current) return void (dragged.current = false)
          if (e.target !== e.currentTarget && !(e.target as Element).classList.contains('bv-canvas')) return
          if (pop) closePop(false)
        }}
      >
        <canvas ref={canvas} className="bv-canvas" aria-hidden="true" />
        <div className="bv-grid" role="grid" aria-label="화이트보드 카드, 화살표로 옮기고 Enter로 요약, 더하기 빼기로 확대, Shift와 화살표로 이동" aria-rowcount={rows + 1} aria-colcount={3} onKeyDown={onGridKey}>
          <div role="row" aria-rowindex={1} className="bv-row">
            {layout.columns.map((col, ci) => {
              const b = place({ x: col.x, y: layout.pad, w: col.w, h: layout.headerH - layout.pad })
              return (
                <div key={col.column} role="columnheader" aria-colindex={ci + 1} className="bv-cell" style={b}>
                  <button type="button" tabIndex={-1} aria-label={`${col.title} ${col.count}장, 이 칸으로 이동`} onClick={() => goColumn(col.column)} />
                </div>
              )
            })}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} role="row" aria-rowindex={r + 2} className="bv-row">
              {layout.columns.map((col, ci) => {
                const k = col.cards[r]
                const more = !k && r === col.cards.length && col.more > 0
                if (!k && !more) return <div key={col.column} role="gridcell" aria-colindex={ci + 1} aria-hidden="true" />
                const on = cell.col === ci && cell.row === r
                const id = `bv-cell-${ci}-${r}`
                if (more)
                  return (
                    <div key={col.column} role="gridcell" aria-colindex={ci + 1} className="bv-cell" style={place({ x: col.moreAt.x, y: col.moreAt.y, w: 140, h: FS_L + 20 })}>
                      <button id={id} type="button" tabIndex={on ? 0 : -1} aria-label={`${col.title}, 숨은 카드 ${col.more}장 펼치기`} onFocus={() => setCell({ col: ci, row: r })} onClick={() => unfold(col.column)} />
                    </div>
                  )
                return (
                  <div key={col.column} role="gridcell" aria-colindex={ci + 1} className="bv-cell" style={place(k)} data-picked={pop?.key === k.card.key || undefined}>
                    <button
                      id={id}
                      type="button"
                      tabIndex={on ? 0 : -1}
                      aria-haspopup="dialog"
                      aria-label={cardLabel(col.title, agentName(k.card.seat), cardRef(k.card.repo, k.card.n, mainRepo), k.card.title, r, col.count)}
                      onFocus={() => setCell({ col: ci, row: r })}
                      onClick={() => !dragged.current && showCard(k, { col: ci, row: r })}
                    />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {pop && popCard && popAt && (
        <div ref={popRef} className="bv-pop" role="dialog" aria-label={`${cardRef(popCard.card.repo, popCard.card.n, mainRepo)} 카드 요약`} tabIndex={-1} data-side={popAt.side} style={{ left: popAt.x, top: popAt.y, ['--agent' as string]: agentVar(popCard.card.seat) }}>
          <CardSummary
            card={popCard.card}
            column={pop.col}
            mainRepo={mainRepo}
            library={!!world.library}
            onLibrary={() => {
              takeOpener() // the library panel takes focus; the board does not pull it back
              openDocs({ repo: popCard.card.repo, n: popCard.card.n })
              closeBoard()
            }}
          />
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {live}
      </p>
    </div>
  )
}
