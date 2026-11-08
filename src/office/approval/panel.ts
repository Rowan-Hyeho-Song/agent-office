// Whether the approval panel is open: a tiny external store. The IN tray on the planner's desk (a click in the 3D
// scene), the panel's own tab and ?owner all open it through these functions.

import { useSyncExternalStore } from 'react'
import { closeDocs } from '../docs/panel'

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  if (v === open) return
  open = v
  listeners.forEach((l) => l())
}

// one side panel, two tabs: opening this tab closes the other one at once (no frame with both)
export const openApprovalBox = () => {
  closeDocs()
  set(true)
}
export const closeApprovalBox = () => set(false)
export const toggleApprovalBox = () => (open ? closeApprovalBox() : openApprovalBox())
export const isApprovalBoxOpen = () => open

export function useApprovalBoxOpen() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    () => open,
  )
}
