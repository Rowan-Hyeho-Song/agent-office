// Whether the approval panel is open: a tiny external store. The IN tray on the planner's desk (a click in the 3D
// scene), the panel's own tab and ?owner all open it through these functions.

import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()
const set = (v: boolean) => {
  if (v === open) return
  open = v
  listeners.forEach((l) => l())
}

export const openApprovalBox = () => set(true)
export const closeApprovalBox = () => set(false)
export const toggleApprovalBox = () => set(!open)
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
