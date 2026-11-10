import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { agentName } from '../../board/draw'
import { COLUMNS, COLUMN_LABEL, type BoardCard, type Column } from '../../board/state'
import { shownTitle, topicsOf } from '../../docs/topics'
import { openDocs } from '../docs/panel'
import { TopicIcon } from '../TopicBadges'
import type { OfficeWorld } from '../world'
import { useBoardState } from './hooks'
import { CardSummary, agentVar } from './CardSummary'
import { closeBoard, takeOpener, type BoardViewState } from './store'
import { cardRef, escapeStep, mainRepoOf } from './view'

// The phone's board (docs-ui.md 3.5, <= 640 px): no flight, a full-screen 2D sheet rising from the bottom: a head with a close
// button, a tab per column (swipe or tap), the column's cards one per line in the board's paper and colour strip, the decision
// notes under the done tab, and the card's summary in a bottom sheet. Back, the close button, Esc and a drag down close it.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'
const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
const SWIPE = 56
/** sheets mounted now (a StrictMode remount unmounts and mounts at once and must not touch the history) */
let live = 0

export function BoardSheet({ world, st }: { world: OfficeWorld; st: BoardViewState }) {
  const board = useBoardState(world)
  const [tab, setTab] = useState<number>(st.column ?? 0)
  const [pop, setPop] = useState<{ card: BoardCard; col: Column } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const pull = useRef<{ y: number } | null>(null)
  const [drop, setDrop] = useState(0)
  const mainRepo = useMemo(() => mainRepoOf(COLUMNS.flatMap((c) => board[c].map((k) => k.repo))), [board])
  const column = COLUMNS[tab]
  const cards = board[column]
  const popNow = useRef(pop)
  popNow.current = pop

  // the back gesture closes the sheet: one history entry while it is open (kept across a StrictMode remount)
  useEffect(() => {
    live++
    if (!(history.state as { board?: boolean } | null)?.board) history.pushState({ board: true }, '')
    const onPop = () => {
      // back pressed: closes the card summary first, then the sheet (the entry is already gone)
      if (popNow.current) {
        history.pushState({ board: true }, '')
        setPop(null)
      } else closeBoard()
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      live--
      setTimeout(() => {
        if (live === 0 && (history.state as { board?: boolean } | null)?.board) history.back()
      }, 0)
    }
  }, [])

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (escapeStep(!!popNow.current) === 'popover') setPop(null)
        else closeBoard()
      } else if (e.key === 'Tab' && root.current) {
        const list = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!list.length) return
        const i = list.indexOf(document.activeElement as HTMLElement)
        if (i < 0 || (e.shiftKey && i === 0)) {
          e.preventDefault()
          list[list.length - 1].focus()
        } else if (!e.shiftKey && i === list.length - 1) {
          e.preventDefault()
          list[0].focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    if (pop) popRef.current?.focus({ preventScroll: true })
  }, [pop])

  const onTabKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const next = Math.max(0, Math.min(COLUMNS.length - 1, tab + d))
    setTab(next)
    setPop(null)
    requestAnimationFrame(() => document.getElementById(`bs-tab-${next}`)?.focus())
  }

  const onListDown = (e: RPointerEvent) => (swipe.current = { x: e.clientX, y: e.clientY })
  const onListUp = (e: RPointerEvent) => {
    const s = swipe.current
    swipe.current = null
    if (!s) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) setTab((t) => Math.max(0, Math.min(COLUMNS.length - 1, t + (dx < 0 ? 1 : -1))))
  }

  // a drag down on the head closes (the sheet follows the finger)
  const onHeadDown = (e: RPointerEvent) => {
    if ((e.target as Element).closest('button')) return
    pull.current = { y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHeadMove = (e: RPointerEvent) => pull.current && setDrop(Math.max(0, e.clientY - pull.current.y))
  const onHeadUp = () => {
    if (!pull.current) return
    pull.current = null
    if (drop > 100) closeBoard()
    else setDrop(0)
  }

  const counts = COLUMNS.map((c) => board[c].length)
  return (
    <div ref={root} className="board-sheet" role="dialog" aria-modal="true" aria-label="화이트보드" data-reduced={reduced() || undefined} style={drop ? { transform: `translateY(${drop}px)`, transition: 'none' } : undefined}>
      <header className="bs-head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
        <h2>화이트보드</h2>
        <button ref={closeRef} type="button" className="bs-close" aria-label="화이트보드 닫기" onClick={closeBoard}>
          ✕
        </button>
      </header>
      <div className="bs-tabs" role="tablist" aria-label="칸" onKeyDown={onTabKey}>
        {COLUMNS.map((c, i) => (
          <button key={c} id={`bs-tab-${i}`} type="button" role="tab" aria-selected={i === tab} aria-controls="bs-panel" tabIndex={i === tab ? 0 : -1} onClick={() => (setTab(i), setPop(null))}>
            {COLUMN_LABEL[c]} <b>{counts[i]}</b>
          </button>
        ))}
      </div>
      <div id="bs-panel" className="bs-list" role="tabpanel" aria-labelledby={`bs-tab-${tab}`} onPointerDown={onListDown} onPointerUp={onListUp}>
        {cards.length === 0 && <p className="bs-empty">이 칸에는 카드가 없습니다</p>}
        <ul>
          {cards.map((k, i) => {
            const topics = k.title === null ? [] : topicsOf([], k.title)
            return (
              <li key={k.key}>
                <button type="button" className="bs-card" style={{ ['--agent' as string]: agentVar(k.seat) }} aria-haspopup="dialog" onClick={() => setPop({ card: k, col: column })}>
                  <span className="bs-card-top">
                    {cardRef(k.repo, k.n, mainRepo)} · {agentName(k.seat)}
                    {topics[0] && (
                      <span className="bs-topic">
                        <TopicIcon id={topics[0]} />
                      </span>
                    )}
                  </span>
                  <span className="bs-card-title">
                    {k.title === null ? '책상 방 작업(비공개)' : shownTitle(k.title, topics)}
                  </span>
                  <span className="sr-only">
                    , {COLUMN_LABEL[column]}, {cards.length}장 중 {i + 1}번째
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {column === 'done' && board.decisions.length > 0 && (
          <section aria-label="최근 결정" className="bs-notes">
            <h3>최근 결정</h3>
            {board.decisions.slice(0, 3).map((d) => (
              <p key={d.key} className="bs-note">
                <b>{d.title}</b>
                {d.note && <span>{d.note}</span>}
                {d.n !== null && <i>#{d.n}</i>}
              </p>
            ))}
          </section>
        )}
      </div>
      {pop && (
        <>
          <div className="bs-scrim" onClick={() => setPop(null)} />
          <div ref={popRef} className="bs-summary" role="dialog" aria-label={`${cardRef(pop.card.repo, pop.card.n, mainRepo)} 카드 요약`} tabIndex={-1} style={{ ['--agent' as string]: agentVar(pop.card.seat) }}>
            <CardSummary
              card={pop.card}
              column={pop.col}
              mainRepo={mainRepo}
              library={!!world.library}
              onLibrary={() => {
                takeOpener()
                openDocs({ repo: pop.card.repo, n: pop.card.n })
                closeBoard()
              }}
            />
            <button type="button" className="bs-summary-close" onClick={() => setPop(null)}>
              닫기
            </button>
          </div>
        </>
      )}
    </div>
  )
}
