import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { N } from '../../play/omok'
import { STRENGTHS, STRENGTH_NAME, UNDO_OPENING_LINE, idleLeft, statusLine, type Strength } from '../../play/visitorOmok'
import { FORBID_NAME, RULES, RULE_BY_ID } from '../../play/omokRules'
import { AGENT_INFO, officeNow, type OfficeWorld } from '../world'
import { chipText, hudBit, momentSaid } from '../../play/workHold'
import { WorkChip } from '../WorkChip'
import { tagOnScreen } from './pose'
import { cue, PROP_CLICK_DB } from '../../audio/cues'
import {
  canSwitchGame, cancelPromotion, chessCanUndo, chessDeselect, chessSelect, chooseColorOmok, choosePromotion, chooseRule, closeGameSheet, closeOmok, closeRulePicker, getOmokVisit, moveChessCursor,
  moveCursor, omokCanUndo, omokForbidAt, omokUndoOpening, openGameSheet, openOmok, openRulePicker, placeOmok, restartOmok, selectRule, setCursor, strengthOmok, switchGame, touchOmok, undoOmok,
  useOmokVisit, viewName, visitorMayPlace, type VisitKind,
} from './store'
import { PROMOTION_CHOICES, chessIdleLeft, chessLastMoveLine, chessStatusLine, legalTargets, visitorColor, visitorPieceAt } from '../../play/visitorChess'
import { squareName } from '../../play/chess'
import { setTagEl, useTagAway } from '../playHover'

/** #604 the games the sheet offers, in its order (designer decision: omok and chess only; alkkagi comes later) */
// hologram.md 10.3: a line of what each game is about (alkkagi's row '상대 돌을 판 밖으로' comes with its visitor game, #605 ③)
const GAME_ROWS: { kind: VisitKind; name: string; hint: string }[] = [
  { kind: 'omok', name: '오목', hint: '다섯 줄 먼저' },
  { kind: 'chess', name: '체스', hint: '킹을 잡기' },
]
/** #604 the promotion sheet over its square, kept 16 px inside the screen's edges (hologram.md 11.5) */
const PROMO_W = 300
const PROMO_EDGE = 16
export function overSquare(p: { x: number; y: number } | null, screenW = window.innerWidth): Record<string, string | number> | undefined {
  if (!p) return undefined
  const left = Math.min(Math.max(p.x - PROMO_W / 2, PROMO_EDGE), Math.max(PROMO_EDGE, screenW - PROMO_EDGE - PROMO_W))
  return { left, top: p.y, bottom: 'auto', translate: '0 calc(-100% - 8px)', maxWidth: `calc(100vw - ${2 * PROMO_EDGE}px)` }
}
const PIECE_WORD = ['', '폰', '나이트', '비숍', '룩', '퀸', '킹'] as const
const PROMO_NAME: Record<number, string> = { 5: '퀸', 4: '룩', 3: '비숍', 2: '나이트' }

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
/** #623 the undo words keep this far inside the screen's edges (px) */
const UNDO_WHY_EDGE = 16
/** #603 choosing a rule or a colour: the office click, quieter (sound.md, like a prop press) */
const choiceClick = () => cue('ui.click', { db: PROP_CLICK_DB })

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
  // #670 (play.md 2.1.1) a mouse sees the tag only while it points at the play spot or the tag (styles.css: a touch screen and a focus always do)
  const tagAway = useTagAway(!!v.tag?.hot)
  const [said, setSaid] = useState('')
  /** #623 the dimmed [무르기]'s words: shown on hover, focus, a tap or a long press (a tap's for 2 s) */
  const [undoWhy, setUndoWhy] = useState<{ hover: boolean; focus: boolean; tapAt: number | null }>({ hover: false, focus: false, tapAt: null })
  const lastMoves = useRef(0)
  const lastPlies = useRef(0)
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

  // #604 the screen reader's words for each half-move (hologram.md 11.5): "백 폰 e2에서 e4. 메모가 생각 중" / "흑 나이트 g8에서 f6", a capture, a check
  useEffect(() => {
    const c = v.chess
    if (!c) {
      lastPlies.current = 0
      return
    }
    if (c.plies.length !== lastPlies.current) {
      if (c.plies.length > lastPlies.current) setSaid(chessLastMoveLine(c, name) ?? '')
      lastPlies.current = c.plies.length
    }
  }, [v.chess, name])

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
          choiceClick()
          document.getElementById(`omok-rule-${r}`)?.focus()
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          choiceClick()
          chooseRule(v0.pickerRule, now)
          return
        }
      }
      const cv = getOmokVisit()
      // #604 chess: Esc goes back one layer at a time: the promotion question (the move is cancelled), the game sheet, the selection, then the board
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (cv.kind === 'chess') {
          if (cv.promo) return void cancelPromotion()
          if (cv.gameSheet) return void closeGameSheet()
          if (cv.sel !== null) return void chessDeselect()
        } else if (cv.gameSheet) return void closeGameSheet()
        closeOmok(now)
        return
      }
      // the promotion sheet and the game sheet: ← → / ↑ ↓ move between their buttons (Enter is the button's own)
      const sheet = cv.promo ? '.chess-promo button' : cv.gameSheet ? '.game-sheet button' : null
      if (sheet && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault()
        const items = [...document.querySelectorAll<HTMLButtonElement>(sheet)]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        items[(i + (back ? items.length - 1 : 1)) % items.length]?.focus()
        return
      }
      const t = e.target instanceof Element ? e.target : null
      if (t?.closest('button, input, select, textarea, a') || e.ctrlKey || e.altKey || e.metaKey) return
      const d = step[e.key]
      if (cv.kind === 'chess') {
        if (cv.promo || cv.gameSheet) return
        if (d) {
          e.preventDefault()
          moveChessCursor(...d)
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          chessSelect(cv.chessCursor, now)
        }
        return
      }
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
    if (t) openOmok(t.agent, officeNow(world), Date.now() % 1_000_000, t.orient, t.kind)
  }

  const g = v.game
  const c = v.chess
  const now = officeNow(world)
  const left = g ? idleLeft(g, now) : null
  const cLeft = c ? chessIdleLeft(c, now) : null
  // #601 called to work: the HUD's word and the chip's (play.md 10.2)
  const cur = c ?? g
  const work = v.work && cur && !cur.end ? v.work : null
  const status = g ? statusLine(g, name, now, work ? hudBit('omok', work, now) : undefined) : ''
  const chessStatus = c ? chessStatusLine(c, name, now, work ? hudBit('omok', work, now) : undefined) : ''
  const canSwitch = open && v.phase === 'open' && canSwitchGame()
  // #604 the game sheet: the current row takes the focus as it opens; the promotion sheet's queen
  useEffect(() => {
    if (v.gameSheet) document.getElementById(`game-row-${getOmokVisit().kind}`)?.focus()
  }, [v.gameSheet])
  useEffect(() => {
    if (v.promo) document.getElementById(`promo-${PROMOTION_CHOICES[0]}`)?.focus()
    else if (v.phase === 'open' && !v.gameSheet && !v.picker) grid.current?.focus()
  }, [v.promo, v.phase, v.kind, v.gameSheet, v.picker])
  // a sheet whose game can no longer be switched (a move was made) goes away
  useEffect(() => {
    if (v.gameSheet && !canSwitch) closeGameSheet()
  }, [v.gameSheet, canSwitch])
  // the visitor's colour on the chip: chess white ○ / black ●; omok black ● unless the game gave them white
  const chipMark = c ? (visitorColor(c) === 1 ? '●' : '○') : g && g.color === 2 ? '○' : '●'
  // the HUD line without its head: the name chip says the game, and the rule chip (while it shows) the rule (hologram.md 10.3, play.md 11.2)
  const ruleChip = !!g && !g.moves.length && !g.end
  let omokLine = g ? status.replace(`${chipMark} 오목 · `, '') : ''
  if (g && ruleChip) omokLine = omokLine.replace(`${RULE_BY_ID[g.rule].name} · `, '')
  const chessLine = chessStatus.replace(`${chipMark} 체스 · `, '')
  // #604 the name chip is the game's button: '○ 체스 ▾' opens the sheet while the game may still be switched (hologram.md 10.3); the circle is the visitor's colour
  const gameChip = (
    <button
      type="button"
      className="omok-rule-chip game-chip"
      disabled={!canSwitch}
      aria-haspopup="dialog"
      aria-expanded={v.gameSheet}
      aria-label={`게임 ${v.kind === 'chess' ? '체스' : '오목'}${canSwitch ? ', 바꾸기' : ''}`}
      onClick={() => (v.gameSheet ? closeGameSheet() : openGameSheet())}
    >
      <span aria-hidden="true">{chipMark}</span> {v.kind === 'chess' ? '체스' : '오목'}{canSwitch ? ' ▾' : ''}
    </button>
  )
  const chessCellWord = (sq: number) => {
    if (!c) return ''
    const p = visitorPieceAt(c, sq)
    const target = v.sel !== null && legalTargets(c, v.sel).some((t) => t.to === sq)
    return `${squareName(sq)}, ${p ? `${p.side === 0 ? '백' : '흑'} ${PIECE_WORD[p.kind]}` : '빈칸'}${v.sel === sq ? ', 선택됨' : ''}${target ? ', 이동 가능' : ''}`
  }
  const cellWord = (cell: number) => {
    const c = g?.s.board[cell]
    // #603 an empty point black may not take says so (play.md 11.4)
    const why = c ? null : omokForbidAt(cell)
    return `${viewName(cell)}, ${c === 1 ? '흑' : c === 2 ? '백' : '빈칸'}${why ? `, 흑 금수 ${FORBID_NAME[why]}` : ''}`
  }
  // #603 the forbidden point just pressed: the guidance over the HUD for 2 s, read once
  const forbidNow = v.forbid && now - v.forbid.at < FORBID_SHOW_MS ? v.forbid : null
  const armedForbid = v.armed !== null && !!omokForbidAt(v.armed)
  // #623 a swap game holds [무르기] through its opening: dimmed but still focusable, its words over the HUD
  const undoHeld = open && omokUndoOpening()
  const undoWhyShown = undoHeld && (undoWhy.hover || undoWhy.focus || (undoWhy.tapAt !== null && Date.now() - undoWhy.tapAt < FORBID_SHOW_MS))
  const undoBtn = useRef<HTMLButtonElement>(null)
  const undoNote = useRef<HTMLParagraphElement>(null)
  // the words over the button they explain (the forbid guidance is the board's, in the middle): its centre across, 16 px inside the screen
  useLayoutEffect(() => {
    const b = undoBtn.current
    const n = undoNote.current
    if (!b || !n || n.hidden) return
    const r = b.getBoundingClientRect()
    const w = n.offsetWidth
    n.style.left = `${Math.max(UNDO_WHY_EDGE, Math.min(innerWidth - UNDO_WHY_EDGE - w, r.left + r.width / 2 - w / 2))}px`
    n.style.translate = '0 0'
  })
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
          ref={(el) => {
            tagEl.current = el
            setTagEl('omok', el)
          }}
          data-away={tagAway || undefined}
          style={tagOnScreen(v.tag.x, v.tag.y, tagEl.current?.offsetWidth ?? 96, tagEl.current?.offsetHeight ?? 28, window.innerWidth)}
          aria-label={`같이 두기 · ${wa(shortName(v.tag.agent))} ${v.tag.kind === 'chess' ? '체스' : '오목'}`}
          onClick={sit}
        >
          <span aria-hidden="true">●</span> 같이 두기
        </button>
      )}
      {open && v.gameSheet && canSwitch && (
        <div className="omok-rules game-sheet" role="dialog" aria-label="게임 고르기" style={besideBoard(v.boardBox)}>
          <h2>게임 고르기</h2>
          <div role="radiogroup" aria-label="게임">
            {GAME_ROWS.map((r) => (
              <button
                key={r.kind}
                id={`game-row-${r.kind}`}
                type="button"
                role="radio"
                aria-checked={v.kind === r.kind}
                onClick={() => {
                  choiceClick()
                  if (v.kind === r.kind) closeGameSheet()
                  else switchGame(r.kind, officeNow(world))
                }}
              >
                <b>{v.kind === r.kind ? '● ' : ''}{r.name}</b>
                <small>{r.hint}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      {open && c && v.promo && (
        <div className="omok-rules chess-promo" role="dialog" aria-label="승진할 기물 고르기" style={overSquare(v.promoAt)}>
          <h2>승진할 기물 <kbd>Esc 취소</kbd></h2>
          <div>
            {PROMOTION_CHOICES.map((k) => (
              <button key={k} id={`promo-${k}`} type="button" onClick={() => choosePromotion(k, officeNow(world))}>
                {PROMO_NAME[k]}
              </button>
            ))}
          </div>
        </div>
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
                onClick={() => {
                  choiceClick()
                  selectRule(r.id)
                }}
              >
                <b>{v.pickerRule === r.id ? '● ' : ''}{r.name}</b>
                <small>{r.hint}</small>
              </button>
            ))}
          </div>
          <button type="button" className="omok-rules-go" onClick={() => {
              choiceClick()
              chooseRule(getOmokVisit().pickerRule, officeNow(world))
            }}>
            이 규칙으로 시작 <kbd>Enter</kbd>
          </button>
        </div>
      )}
      {open && g && forbidNow && (
        <p className="omok-forbid" role="status">
          <span aria-hidden="true">✕</span> 금수예요 · {FORBID_NAME[forbidNow.why]}
        </p>
      )}
      {open && g && undoHeld && (
        <p ref={undoNote} id="omok-undo-why" role="tooltip" className="omok-forbid" hidden={!undoWhyShown || !!forbidNow}>
          {UNDO_OPENING_LINE}
        </p>
      )}
      {open && g && (
        <section className="omok-hud" aria-label="오목 대국">
          {gameChip}
          {/* #603 the rule: a chip that reopens the chooser until the first stone, then its name alone (play.md 11.2) */}
          {!g.moves.length && !g.end ? (
            <button type="button" className="omok-rule-chip" aria-label={`규칙 ${RULE_BY_ID[g.rule].name}, 바꾸기`} onClick={() => openRulePicker()}>
              {RULE_BY_ID[g.rule].name} ▾
            </button>
          ) : null}
          <p className="omok-status" aria-live="polite">
            {omokLine}
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
              <button type="button" className="omok-here" onClick={() => {
                choiceClick()
                chooseColorOmok(1, officeNow(world))
              }}>
                흑으로 두기
              </button>
              <button type="button" className="omok-here" onClick={() => {
                choiceClick()
                chooseColorOmok(2, officeNow(world))
              }}>
                백으로 두기
              </button>
            </>
          )}
          <button
            type="button"
            disabled={!undoHeld && !omokCanUndo()}
            ref={undoBtn}
            aria-disabled={undoHeld || undefined}
            aria-describedby={undoHeld ? 'omok-undo-why' : undefined}
            onClick={() => (undoHeld ? setUndoWhy((w) => ({ ...w, tapAt: Date.now() })) : undoOmok(officeNow(world)))}
            onContextMenu={(e) => {
              if (!undoHeld) return
              e.preventDefault()
              setUndoWhy((w) => ({ ...w, tapAt: Date.now() }))
            }}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setUndoWhy((w) => ({ ...w, hover: true }))}
            onPointerLeave={() => setUndoWhy((w) => ({ ...w, hover: false }))}
            // the keyboard's focus only: a tap focuses too, and its words go after 2 s
            onFocus={(e) => e.currentTarget.matches(':focus-visible') && setUndoWhy((w) => ({ ...w, focus: true }))}
            onBlur={() => setUndoWhy((w) => ({ ...w, focus: false }))}
          >
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
      {open && c && (
        <section className="omok-hud" aria-label="체스 대국">
          {gameChip}
          <p className="omok-status" aria-live="polite">
            {chessLine}
            {cLeft !== null && <span className="omok-idle"> · {Math.ceil(cLeft / 1000)}초 뒤 끝남</span>}
          </p>
          <span className="omok-cell" aria-hidden="true">{squareName(v.chessCursor)}</span>
          <div className="omok-strength" role="radiogroup" aria-label="세기">
            {STRENGTHS.map((s: Strength) => (
              <button key={s} type="button" role="radio" aria-checked={c.strength === s} onClick={() => strengthOmok(s, officeNow(world))}>
                {STRENGTH_NAME[s]}
              </button>
            ))}
          </div>
          <button type="button" disabled={!chessCanUndo()} onClick={() => undoOmok(officeNow(world))}>
            무르기
          </button>
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
            aria-label="체스판 8×8, 화살표로 옮기고 Enter로 말을 고르고 한 번 더 Enter로 둡니다"
            aria-activedescendant={`chess-cell-${v.chessCursor}`}
          >
            {Array.from({ length: 8 }, (_, r) => {
              // the visitor's side is near: white sees rank 8 on top and file a on the left; black the other way round
              const rank = visitorColor(c) === 0 ? 7 - r : r
              return (
                <div key={r} role="row">
                  {Array.from({ length: 8 }, (_, f) => {
                    const file = visitorColor(c) === 0 ? f : 7 - f
                    const sq = rank * 8 + file
                    return (
                      <div key={f} id={`chess-cell-${sq}`} role="gridcell" aria-selected={sq === v.chessCursor} onClick={() => chessSelect(sq, officeNow(world))}>
                        {chessCellWord(sq)}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}
