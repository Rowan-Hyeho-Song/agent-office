// Open panels/overlays register here so Esc in room mode can close them before asking the desk to leave.
// A panel joins with `usePanelOpen(open, close)`; nothing else needs to know about the panels.
import { useEffect, useRef } from 'react'

const stack: Array<() => void> = []

/** closes the most recently opened panel; false when none is open */
export function closeTopPanel(): boolean {
  const close = stack.pop()
  if (!close) return false
  close()
  return true
}

/** closes every open panel (the desk started leaving) */
export function closeAllPanels() {
  while (closeTopPanel());
}

export const anyPanelOpen = () => stack.length > 0

/** call from a panel: registered while `open` is true */
export function usePanelOpen(open: boolean, close: () => void) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => {
    if (!open) return
    const fn = () => ref.current()
    stack.push(fn)
    return () => {
      const i = stack.indexOf(fn)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open])
}
