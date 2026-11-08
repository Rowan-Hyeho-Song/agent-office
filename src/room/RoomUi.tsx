import { useThree, useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Raycaster, Vector2 } from 'three'
import { meshesOf, type OfficeNodes } from '../office/nodes'
import { DESK_URL, ROOM_MODE, isLocked, leaveOffice, listenToDesk, postToParent } from './link'
import { anyPanelOpen, closeAllPanels, closeTopPanel } from './panels'

/** DOM side: desk messages, Esc, and the way out (a link standalone; a focusable door button in a room) */
export function RoomUi() {
  const [locked, setLocked] = useState(false)

  useEffect(
    () =>
      listenToDesk((t) => {
        if (t === 'leaving') {
          closeAllPanels()
          setLocked(true)
        } else window.focus() // entered: the office may take the keyboard
      }),
    [],
  )

  useEffect(() => {
    if (!ROOM_MODE) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isLocked()) return
      // a panel first, then the desk
      if (anyPanelOpen()) closeTopPanel()
      else leaveOffice('esc')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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

/** inside the Canvas: a click on the door screen leaves; hover shows a pointer */
export function DoorPick({ nodes }: { nodes: OfficeNodes }) {
  const { gl, camera } = useThree()
  const door = nodes.screen_door
  useEffect(() => {
    if (!door) return
    const el = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    const hit = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return ray.intersectObjects(meshesOf(door), false).length > 0
    }
    let down: [number, number] | null = null
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
    const onUp = (e: PointerEvent) => {
      // a drag is the orbit, not a click
      const moved = down ? Math.hypot(e.clientX - down[0], e.clientY - down[1]) : 99
      down = null
      if (moved < 6 && !isLocked() && hit(e)) leaveOffice('door')
    }
    const onMove = (e: PointerEvent) => {
      el.style.cursor = !isLocked() && hit(e) ? 'pointer' : ''
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
      el.style.cursor = ''
    }
  }, [gl, camera, door])
  return null
}

let sent = false
/** inside Suspense (so the model has loaded): tells the desk once a frame has been drawn */
export function ReadyPing() {
  const frames = useRef(0)
  useFrame(() => {
    if (!sent && ++frames.current === 3) {
      sent = true
      postToParent({ type: 'ready', room: 'office' })
    }
  })
  return null
}
