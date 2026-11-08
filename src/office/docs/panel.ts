// Whether the library viewer is open, and where it should land: a tiny external store like approval/panel.ts. The
// bookshelf (a click in the 3D scene), the launcher button, a "전문 보기" link and a #library/... address open it.
// Esc closes it from the viewer itself; this can join the shared Esc registry (#68, src/room/panels.ts) later.

import { useSyncExternalStore } from 'react'
import { parseRef, type Ref } from '../../docs/library'

export interface DocsPanel {
  open: boolean
  /** where to land; `nonce` changes on every open so the same target can be asked for again */
  target: Ref | null
  nonce: number
}

let state: DocsPanel = { open: false, target: null, nonce: 0 }
const listeners = new Set<() => void>()
const set = (next: DocsPanel) => {
  state = next
  listeners.forEach((l) => l())
}

/** open the viewer, at a file / document / minutes row if given */
export const openDocs = (target: Ref | null = null) => set({ open: true, target, nonce: state.nonce + 1 })
export const closeDocs = () => state.open && set({ ...state, open: false })
export const toggleDocs = () => (state.open ? closeDocs() : openDocs())
export const isDocsOpen = () => state.open

export function useDocsPanel() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    () => state,
  )
}

/** `#library/owner/name/28/minutes/1-3` in the page address opens the viewer there (on load and when the hash changes) */
export function openFromHash(): boolean {
  const ref = parseRef(location.hash)
  if (ref) openDocs(ref)
  return !!ref
}
