import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { markFirstScreen } from '../office/atlases'
import { DESK_URL, ROOM_MODE, isLocked, leaveOffice, listenToDesk, onEntered, onLeaveStart, postToParent } from './link'
import { closeApprovalBox, isApprovalBoxOpen } from '../office/approval/panel'
import { closeDocs, isDocsOpen } from '../office/docs/panel'
import { isReplayActive } from '../replay/store'
import { anyPanelOpen, closeAllPanels, closeTopPanel } from './panels'

/** DOM side: desk messages, Esc, and the way out (a link standalone; a focusable door button in a room) */
export function RoomUi() {
  const [locked, setLocked] = useState(false)

  useEffect(() => listenToDesk(), [])
  // the exit has started (from inside or from the desk): close the panels, swallow input
  useEffect(
    () =>
      onLeaveStart(() => {
        closeAllPanels()
        closeApprovalBox()
        closeDocs()
        setLocked(true)
      }),
    [],
  )
  // the desk said : the office may take the keyboard
  useEffect(() => onEntered(() => window.focus()), [])

  useEffect(() => {
    if (!ROOM_MODE) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isLocked()) return
      // A panel first, then the desk. Capture phase: we look before the panels' own Esc handlers run, so one press
      // is one step (the approval box and the docs viewer step back or close by themselves; a closing panel must not
      // also exit).
      if (isApprovalBoxOpen() || isDocsOpen() || isReplayActive()) return
      if (anyPanelOpen()) closeTopPanel()
      else leaveOffice('esc')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <>
      {ROOM_MODE ? (
        <button type="button" className="door-btn" onClick={() => leaveOffice('door')}>
          출입문: 책상으로 나가기
        </button>
      ) : (
        <a className="desk-link" href={DESK_URL}>
          ← 책상으로
        </a>
      )}
      {locked && <div className="room-lock" aria-hidden />}
    </>
  )
}

let sent = false
/** inside Suspense (so the model has loaded): tells the desk once a frame has been drawn */
export function ReadyPing() {
  const frames = useRef(0)
  useFrame(() => {
    if (frames.current === 2) markFirstScreen() // the room is on screen: the close-up atlases may start (#280)
    if (!sent && ++frames.current === 3) {
      sent = true
      postToParent({ type: 'ready', room: 'office' })
    }
  })
  return null
}
