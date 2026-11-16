import { useEffect, useRef, useState } from 'react'
import { N } from '../../play/omok'
import { STRENGTHS, STRENGTH_NAME, idleLeft, statusLine, type Strength } from '../../play/visitorOmok'
import { FORBID_NAME, RULES, RULE_BY_ID } from '../../play/omokRules'
import { AGENT_INFO, officeNow, type OfficeWorld } from '../world'
import { chipText, hudBit, momentSaid } from '../../play/workHold'
import { WorkChip } from '../WorkChip'
import { tagOnScreen } from './pose'
import {
  chooseColorOmok, chooseRule, closeOmok, closeRulePicker, getOmokVisit, moveCursor, omokCanUndo, omokForbidAt, openOmok, openRulePicker, placeOmok, restartOmok, selectRule,
  setCursor, strengthOmok, touchOmok, undoOmok, useOmokVisit, viewName, visitorMayPlace,
} from './store'

/** 은/는 after a point's name, by how its number reads (H8은 팔, H9는 구, H10은 십) */
export const eunNeun = (name: string) => {
  const n = Number(name.replace(/^\D+/, ''))
  return `${name}${n % 10 === 0 || [1, 3, 6, 7, 8].includes(n % 10) ? '은' : '는'}`
}

/** #603 (designer, #617) a wide screen: the chooser beside the board (its left 32 px past the board's right edge, its middle at the board's), when it
 * fits with 16 px to spare; else over the HUD (styles.css). A phone keeps the sheet over the HUD (an empty board may be covered) */
const SHEET_W = 340
export function besideBoard(b: { right: number; middle: number } | null, screenW = window.innerWidth): Record<string, string | number> | undefined {
  if (!b || screenW <= 640) return undefined
  const left = b.right + 32
  if (screenW - left < SHEET_W + 16) return undefined
  return { left, top: b.middle, bottom: 'auto', translate: '0 -50%' }
}

/** #603 how long the forbidden point's guidance stays (play.md 11.4) */
const FORBID_SHOW_MS = 2000

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
      // #603 the rule chooser first: ↑↓ choose, Enter starts, the first Esc closes it (the rule stays), the next one leaves (play.md 11.2)
      if (getOmokVisit().picker) {
        const v0 = getOmokVisit()
        const i = RULES.findIndex((r) => r.id === v0.pickerRule)
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          closeRulePicker()
          return
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const r = RULES[(i + (e.key === 'ArrowDown' ? 1 : RULES.length - 1)) % RULES.length].id
          selectRule(r)
          document.getElementById(`omok-rule-${r}`)?.focus()
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          chooseRule(v0.pickerRule, now)
          return
        }
      }
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
    // #603 an empty point black may not take says so (play.md 11.4)
    const why = c ? null : omokForbidAt(cell)
    return `${viewName(cell)}, ${c === 1 ? '흑' : c === 2 ? '백' : '빈칸'}${why ? `, 흑 금수 ${FORBID_NAME[why]}` : ''}`
  }
  // #603 the forbidden point just pressed: the guidance over the HUD for 2 s, read once
  const forbidNow = v.forbid && now - v.forbid.at < FORBID_SHOW_MS ? v.forbid : null
  const armedForbid = v.armed !== null && !!omokForbidAt(v.armed)
  // the chooser: the selected row takes the focus as it opens
  const pickerEl = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (v.picker) document.getElementById(`omok-rule-${getOmokVisit().pickerRule}`)?.focus()
  }, [v.picker])

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
      {open && g && v.picker && (
        <div className="omok-rules" role="dialog" aria-label="오목 규칙 고르기" ref={pickerEl} style={besideBoard(v.boardBox)}>
          <h2>규칙 고르기</h2>
          <div role="radiogroup" aria-label="오목 규칙">
            {RULES.map((r) => (
              <button
                key={r.id}
                id={`omok-rule-${r.id}`}
                type="button"
                role="radio"
                aria-checked={v.pickerRule === r.id}
                tabIndex={v.pickerRule === r.id ? 0 : -1}
                aria-label={`${r.name}, ${r.hint}`}
                onClick={() => selectRule(r.id)}
              >
                <b>{v.pickerRule === r.id ? '● ' : ''}{r.name}</b>
                <small>{r.hint}</small>
              </button>
            ))}
          </div>
          <button type="button" className="omok-rules-go" onClick={() => chooseRule(getOmokVisit().pickerRule, officeNow(world))}>
            이 규칙으로 시작 <kbd>Enter</kbd>
          </button>
        </div>
      )}
      {open && g && forbidNow && (
        <p className="omok-forbid" role="status">
          <span aria-hidden="true">✕</span> 금수예요 · {FORBID_NAME[forbidNow.why]}
        </p>
      )}
      {open && g && (
        <section className="omok-hud" aria-label="오목 대국">
          {/* #603 the rule: a chip that reopens the chooser until the first stone, then its name alone (play.md 11.2) */}
          {!g.moves.length && !g.end ? (
            <button type="button" className="omok-rule-chip" aria-label={`규칙 ${RULE_BY_ID[g.rule].name}, 바꾸기`} onClick={() => openRulePicker()}>
              {RULE_BY_ID[g.rule].name} ▾
            </button>
          ) : null}
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
            <button
              type="button"
              className="omok-here"
              aria-disabled={armedForbid}
              data-forbid={armedForbid ? '' : undefined}
              onClick={() => placeOmok(v.armed!, officeNow(world))}
            >
              여기에 두기
            </button>
          )}
          {/* #603 swap: after the agent's three, the visitor takes a colour (play.md 11.3; Tab · Enter) */}
          {g.swap?.by === 'agent' && g.swap.stage === 'choosing' && (
            <>
              <button type="button" className="omok-here" onClick={() => chooseColorOmok(1, officeNow(world))}>
                흑으로 두기
              </button>
              <button type="button" className="omok-here" onClick={() => chooseColorOmok(2, officeNow(world))}>
                백으로 두기
              </button>
            </>
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
          <p className="sr-only" aria-live="polite">{forbidNow ? `${eunNeun(viewName(forbidNow.cell))} 금수예요, ${FORBID_NAME[forbidNow.why]}` : ''}</p>
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
