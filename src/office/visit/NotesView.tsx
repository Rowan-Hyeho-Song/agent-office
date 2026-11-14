// #4 office-ui.md 12.3, reading the notes: a press on the cork board flies the camera to it the way the whiteboard's close view does
// (#234, BoardCamera with `surface: 'bulletin'`), and the notes are laid over the board's face as cards (buttons: the keyboard and
// screen readers get them as well). A card opens to its whole note, who wrote it and when. A phone gets a full-screen sheet of
// the same cards. Esc closes the open card first, then the board; "← 사무실로" and a press outside close it too.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { NOTE_ANON, type Note } from '../../visit/note'
import { closeBoard, useBoardRect, type BoardViewState } from '../boardView/store'
import { AGENT_INFO } from '../world'
import { notesStore } from './notes'
import { noteSlot, paperOf } from './bulletinLayout'

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])'

/** `휴에게 · 11월 14일 14:32` (Seoul time, as the office clock) */
export function noteMeta(n: Note): string {
  const d = new Date(Date.parse(n.created_at) + 9 * 3600_000)
  const p2 = (x: number) => String(x).padStart(2, '0')
  const who = AGENT_INFO[n.agent]?.name.split(' ')[0] ?? n.agent
  return `${who}에게 · ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`
}

/** Esc and Tab inside the view; Esc closes the open card first */
function useKeys(root: React.RefObject<HTMLDivElement | null>, open: () => boolean, closeOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (open()) closeOpen()
        else closeBoard()
      } else if (e.key === 'Tab' && root.current) {
        const list = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
        if (!list.length) return
        const i = list.indexOf(document.activeElement as HTMLElement)
        if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
          e.preventDefault()
          list[e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : i === list.length - 1 ? 0 : i + 1].focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [root, open, closeOpen])
}

function Card({ note, onOpen, style }: { note: Note; onOpen: (n: Note, el: HTMLElement) => void; style?: React.CSSProperties }) {
  return (
    <button type="button" className="nv-card" style={{ ...style, background: paperOf(note.id), ['--pin' as string]: `var(--agent-${note.agent.split('_')[1]})` }} aria-label={`${noteMeta(note)}, ${note.name || NOTE_ANON}: ${note.text}`} onClick={(e) => onOpen(note, e.currentTarget)}>
      <span className="nv-pin" aria-hidden="true" />
      <span className="nv-text">{note.text}</span>
      <span className="nv-name">— {note.name || NOTE_ANON}</span>
    </button>
  )
}

function Opened({ note, onClose }: { note: Note; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])
  return (
    <section className="nv-open" role="dialog" aria-label="쪽지 전문" style={{ background: paperOf(note.id), ['--pin' as string]: `var(--agent-${note.agent.split('_')[1]})` }}>
      <p className="nv-open-meta">{noteMeta(note)}</p>
      <p className="nv-open-text">{note.text}</p>
      <p className="nv-open-name">— {note.name || NOTE_ANON}</p>
      <button ref={ref} type="button" className="bv-back nv-open-close" onClick={onClose}>
        닫기
      </button>
    </section>
  )
}

/** the desktop view: the cards over the board's face, where the camera has flown */
export function NotesStage({ st }: { st: BoardViewState }) {
  const rect = useBoardRect()
  const { notes } = useSyncExternalStore(notesStore.subscribe, notesStore.getSnapshot)
  const [opened, setOpened] = useState<{ note: Note; from: HTMLElement } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const cur = useRef(opened)
  cur.current = opened
  const closeOpen = () => {
    const from = cur.current?.from
    setOpened(null)
    window.setTimeout(() => from?.isConnected && from.focus({ preventScroll: true }), 0)
  }
  useKeys(root, () => !!cur.current, closeOpen)
  const open = st.phase === 'open'
  useEffect(() => {
    if (open) (root.current?.querySelector<HTMLElement>('.nv-card') ?? root.current?.querySelector<HTMLElement>('.bv-back'))?.focus({ preventScroll: true })
  }, [open])
  if (!rect) return null
  return (
    <div ref={root} className="board-view" data-leaving={st.phase === 'leaving' || undefined} role="dialog" aria-label={`코르크 게시판, 쪽지 ${notes.length}장`}>
      <div className="bv-backdrop" onClick={closeBoard} />
      <button type="button" className="bv-back" onClick={closeBoard}>
        ← 사무실로
      </button>
      {open && (
        <div className="nv-stage" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          {notes.length ? (
            notes.map((n, k) => {
              const s = noteSlot(k, rect.width, rect.height)
              return <Card key={n.id} note={n} style={{ left: s.x, top: s.y, width: s.w, height: s.h }} onOpen={(note, from) => setOpened({ note, from })} />
            })
          ) : (
            <p className="nv-empty">아직 붙은 쪽지가 없어요. 로봇 사원증의 ✉로 남겨 보세요.</p>
          )}
          {opened && <Opened note={opened.note} onClose={closeOpen} />}
        </div>
      )}
    </div>
  )
}

/** the phone: a full-screen sheet of the same cards, the whole notes (no flight) */
export function NotesSheet() {
  const { notes } = useSyncExternalStore(notesStore.subscribe, notesStore.getSnapshot)
  const [opened, setOpened] = useState<{ note: Note; from: HTMLElement } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const cur = useRef(opened)
  cur.current = opened
  const closeOpen = () => {
    const from = cur.current?.from
    setOpened(null)
    window.setTimeout(() => from?.isConnected && from.focus({ preventScroll: true }), 0)
  }
  useKeys(root, () => !!cur.current, closeOpen)
  useEffect(() => root.current?.querySelector<HTMLElement>('.bv-back')?.focus({ preventScroll: true }), [])
  return (
    <div ref={root} className="nv-sheet" role="dialog" aria-label={`코르크 게시판, 쪽지 ${notes.length}장`}>
      <header className="nv-sheet-head">
        <button type="button" className="bv-back nv-sheet-close" onClick={closeBoard}>
          ← 사무실로
        </button>
        <h2>코르크 게시판 · 쪽지 {notes.length}장</h2>
      </header>
      <div className="nv-sheet-list">
        {notes.length ? notes.map((n) => <Card key={n.id} note={n} onOpen={(note, from) => setOpened({ note, from })} />) : <p className="nv-empty">아직 붙은 쪽지가 없어요. 로봇 사원증의 ✉로 남겨 보세요.</p>}
      </div>
      {opened && <Opened note={opened.note} onClose={closeOpen} />}
    </div>
  )
}
