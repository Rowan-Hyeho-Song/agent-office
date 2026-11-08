import { DEFAULT_PARENT_ORIGINS, allowedOrigins, envelope, parentOrigin, parseDeskMessage, type OfficeMessage } from './protocol'

/** `?embed=room` and really inside a frame: the desk draws the way back and plays the exit */
export const ROOM_MODE = (() => {
  try {
    return new URLSearchParams(location.search).get('embed') === 'room' && window.parent !== window
  } catch {
    return false
  }
})()
if (ROOM_MODE) document.documentElement.dataset.room = '1'

/** standalone "← 책상으로" target */
export const DESK_URL = (import.meta.env.VITE_DESK_URL as string | undefined) || `${DEFAULT_PARENT_ORIGINS}/`

const allowed = allowedOrigins(location.origin, import.meta.env.VITE_ROOM_PARENT_ORIGINS as string | undefined)

const target = () => parentOrigin(location.ancestorOrigins?.[0], document.referrer, allowed)

/** posts to the parent with an explicit origin; posts nothing when the parent is not allow-listed */
export function postToParent(m: OfficeMessage) {
  if (!ROOM_MODE) return
  const to = target()
  if (to) window.parent.postMessage(envelope(m), to)
}

let locked = false
/** the exit has started (from inside or from the desk): ignore input until the iframe is gone */
export const isLocked = () => locked

type Leave = 'inside' | 'desk'
const leaveListeners = new Set<(from: Leave) => void>()
const enteredListeners = new Set<() => void>()
/** X1 starts: the visitor left from inside, or the desk said `leaving` */
export const onLeaveStart = (fn: (from: Leave) => void) => (leaveListeners.add(fn), () => void leaveListeners.delete(fn))
/** the desk said `entered` (its CRT started): step back from the door */
export const onEntered = (fn: () => void) => (enteredListeners.add(fn), () => void enteredListeners.delete(fn))

function startLeave(from: Leave) {
  if (locked) return
  locked = true
  leaveListeners.forEach((f) => f(from))
}

/** the visitor asked to leave: ask the desk (room mode) or go to it (standalone) */
export function leaveOffice(via: 'door' | 'esc') {
  if (locked) return
  if (ROOM_MODE) {
    postToParent({ type: 'exit', room: 'office', via })
    startLeave('inside')
  } else if (via === 'door') location.assign(DESK_URL)
}

/** listens for desk messages (room mode only); returns the unsubscribe */
export function listenToDesk() {
  if (!ROOM_MODE) return () => {}
  const onMessage = (e: MessageEvent) => {
    const t = parseDeskMessage(e, window.parent, allowed)
    if (t === 'leaving') startLeave('desk')
    else if (t === 'entered') enteredListeners.forEach((f) => f())
  }
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
