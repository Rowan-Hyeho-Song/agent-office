import { useEffect, useRef, useState } from 'react'
import { N } from '../../play/omok'
import { STRENGTHS, STRENGTH_NAME, idleLeft, statusLine, type Strength } from '../../play/visitorOmok'
import { AGENT_INFO, officeNow, type OfficeWorld } from '../world'
import { chipText, hudBit, momentSaid } from '../../play/workHold'
import { WorkChip } from '../WorkChip'
import { tagOnScreen } from './pose'
import {
  closeOmok, getOmokVisit, moveCursor, omokCanUndo, openOmok, placeOmok, restartOmok, setCursor, strengthOmok, touchOmok, undoOmok, useOmokVisit, viewName,
  visitorMayPlace,
} from './store'

// The page side of the visitor's omok (#137 ②, play.md 2.1 · 2.2 · 2.3 · 4 · 5): the "같이 두기" tag over the empty chair, the HUD at the bottom (status,
// the cursor's name, strength, undo, again, leave), the board as a keyboard grid (arrows, Enter / Space) with its words for a screen reader, and Esc. While
// the visitor plays, the docks and the agent list are hidden (html[data-omok], styles.css). The camera, the game's clock and the board's marks: OmokVisitRig.

const shortName = (a: string) => AGENT_INFO[a]?.name.split(' ')[0] ?? a
/** 이/가, 와/과 after a name (the last syllable's final consonant) */
const final = (w: string) => {
  const c = w.charCodeAt(w.length - 1) - 0xac00
  return c >= 0 && c < 11172 && c % 28 !== 0
}
const wa = (w: string) => `${w}${final(w) ? '과' : '와'}`

export function OmokVisitUi({ world }: { world: OfficeWorld }) {
  const v = useOmokVisit()
  const [, tick] = useState(0)
  const grid = useRef<HTMLDivElement>(null)
  const tagEl = useRef<HTMLButtonElement>(null)
  const [said, setSaid] = useState('')
  const lastMoves = useRef(0)
  const open = v.phase !== 'closed'
  const name = v.agent ? shortName(v.agent) : ''

  // the HUD's dots and count move on their own: 4 a second is enough
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [open])

  // the docks hidden while at the board; the grid takes the focus once there (the keyboard plays from the start)
  useEffect(() => {
    const root = document.documentElement
    if (open) root.dataset.omok = ''
    else delete root.dataset.omok
    return () => {
      delete root.dataset.omok
    }
  }, [open])
  useEffect(() => {
    if (v.phase === 'open') grid.current?.focus()
  }, [v.phase])

  // the screen reader's words for each stone (play.md 2.3): "흑 H8. 메모가 생각 중" / "백 J9", and the result
  useEffect(() => {
    const g = v.game
    if (!g) {
      lastMoves.current = 0
      return
    }
    if (g.moves.length !== lastMoves.current) {
      const m = g.moves[g.moves.length - 1]
      if (g.moves.length > lastMoves.current && m !== undefined) setSaid(g.moves.length % 2 === 1 ? `흑 ${viewName(m)}.${g.pending ? ` ${name}가 생각 중` : ''}` : `백 ${viewName(m)}`)
      lastMoves.current = g.moves.length
    }
  }, [v.game, name])

  // Esc leaves; any key keeps the game alive (the 90 s count starts again, play.md 5.7). The arrows and Enter / Space play from anywhere but a
  // control (a click on the board leaves the focus on the canvas, and the keyboard still plays); on a button its own Enter stays
  useEffect(() => {
    if (!open) return
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    const key = (e: KeyboardEvent) => {
      const now = officeNow(world)
      touchOmok(now)
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeOmok(now)
        return
      }
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('button, input, select, textarea, a') || e.ctrlKey || e.altKey || e.metaKey) return
      const d = step[e.key]
      if (d) {
        e.preventDefault()
        moveCursor(...d)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        placeOmok(getOmokVisit().cursor, now)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [open, world])

  const sit = () => {
    const t = getOmokVisit().tag
    if (t) openOmok(t.agent, officeNow(world), Date.now() % 1_000_000, t.orient)
  }

  const g = v.game
  const now = officeNow(world)
  const left = g ? idleLeft(g, now) : null
  // #601 called to work: the HUD's word and the chip's (play.md 10.2)
  const work = v.work && g && !g.end ? v.work : null
  const status = g ? statusLine(g, name, now, work ? hudBit('omok', work, now) : undefined) : ''
  const cellWord = (cell: number) => {
    const c = g?.s.board[cell]
    return `${viewName(cell)}, ${c === 1 ? '흑' : c === 2 ? '백' : '빈칸'}`
  }

  return (
    <>
      {work && v.chip && v.agent && <WorkChip agent={v.agent} at={v.chip} anchor="start" text={chipText('omok', work, now)} />}
      {v.tag && !open && (
        <button
          type="button"
          className="omok-tag"
          ref={tagEl}
          style={tagOnScreen(v.tag.x, v.tag.y, tagEl.current?.offsetWidth ?? 96, tagEl.current?.offsetHeight ?? 28, window.innerWidth)}
          aria-label={`같이 두기 · ${wa(shortName(v.tag.agent))} 오목`}
          onClick={sit}
        >
          <span aria-hidden="true">●</span> 같이 두기
        </button>
      )}
      {open && g && (
        <section className="omok-hud" aria-label="오목 대국">
          <p className="omok-status" aria-live="polite">
            {status}
            {left !== null && <span className="omok-idle"> · {Math.ceil(left / 1000)}초 뒤 끝남</span>}
          </p>
          <span className="omok-cell" aria-hidden="true">{viewName(v.cursor)}</span>
          <div className="omok-strength" role="radiogroup" aria-label="세기">
            {STRENGTHS.map((s: Strength) => (
              <button key={s} type="button" role="radio" aria-checked={g.strength === s} onClick={() => strengthOmok(s, officeNow(world))}>
                {STRENGTH_NAME[s]}
              </button>
            ))}
          </div>
          {v.armed !== null && visitorMayPlace() && (
            <button type="button" className="omok-here" onClick={() => placeOmok(v.armed!, officeNow(world))}>
              여기에 두기
            </button>
          )}
          <button type="button" disabled={!omokCanUndo()} onClick={() => undoOmok(officeNow(world))}>
            무르기
          </button>
          {/* #601 the agent goes after this game: no new one */}
          {!v.work && (
            <button type="button" onClick={() => restartOmok(officeNow(world))}>
              다시 두기
            </button>
          )}
          <button type="button" onClick={() => closeOmok(officeNow(world))}>
            그만두기 <kbd>Esc</kbd>
          </button>
          <p className="sr-only" aria-live="polite">{said}</p>
          <p className="sr-only" aria-live="polite">{v.work && v.agent ? momentSaid(name) : ''}</p>
          <div
            ref={grid}
            className="omok-grid"
            role="grid"
            tabIndex={0}
            aria-label={`오목판 ${N}×${N}, 화살표로 옮기고 Enter로 둡니다`}
            aria-activedescendant={`omok-cell-${v.cursor}`}
          >
            {Array.from({ length: N }, (_, r) => (
              <div key={r} role="row">
                {Array.from({ length: N }, (_, c) => {
                  const cell = r * N + c
                  return (
                    <div key={c} id={`omok-cell-${cell}`} role="gridcell" aria-selected={cell === v.cursor} onClick={() => setCursor(cell)}>
                      {cellWord(cell)}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
