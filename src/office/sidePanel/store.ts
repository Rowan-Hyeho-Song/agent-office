// What the side panel (SidePanel.tsx) tells the rest of the page: its shape (the camera rig reads it for the view
// offset, the bubble layer for the area that is still 3D), which tab is mounted, the 결재함 count for its tab, and
// the "one step back" of each tab (Esc). A tiny external store like approval/panel.ts.

import { useSyncExternalStore } from 'react'
import { leftArea, type Sheet, type Size } from './model'

export type Tab = 'docs' | 'approval'

export interface SideLayout {
  open: boolean
  width: number
  sheet: Sheet
  /** the width is being dragged: the 3D follows at once instead of animating */
  dragging: boolean
  /** the tab whose content is mounted: the open one, and the one sliding out while closing */
  present: Tab | null
  /** waiting 결재함 items (for the tab label) */
  count: number | null
  /** tabs reading one item: the phone sheet goes tall for them */
  raise: Record<Tab, boolean>
}

let layout: SideLayout = { open: false, width: 0, sheet: 'half', dragging: false, present: null, count: null, raise: { docs: false, approval: false } }
const listeners = new Set<() => void>()

export const getSideLayout = () => layout
export function setSideLayout(next: Partial<SideLayout>) {
  const merged = { ...layout, ...next }
  if ((Object.keys(merged) as (keyof SideLayout)[]).every((k) => merged[k] === layout[k])) return
  layout = merged
  listeners.forEach((l) => l())
}
export function useSideLayout() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    () => layout,
  )
}

/** the area that is still 3D right now (the screen minus the panel / sheet) */
export const sideArea = (): Size => leftArea({ w: window.innerWidth, h: window.innerHeight }, layout)

// ---- what each tab asks of the shell -------------------------------------------------------------------------------

const backs: Partial<Record<Tab, () => boolean>> = {}
/** a tab registers its "one step back" (one paper -> the list): true when it stepped, false when it is already at the top. Esc calls it before closing the panel */
export const setSideBack = (tab: Tab, fn: (() => boolean) | null) => void (fn ? (backs[tab] = fn) : delete backs[tab])
export const getSideBack = (tab: Tab) => backs[tab]

/** a tab reading one paper / one approval asks for the tall sheet on phones */
export const setSideRaise = (tab: Tab, want: boolean) => layout.raise[tab] !== want && setSideLayout({ raise: { ...layout.raise, [tab]: want } })

// ---- the remembered width -------------------------------------------------------------------------------------------

const WIDTH_KEY = 'agent-office.side-width'
export function loadWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
export function saveWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(w))
  } catch {
    /* storage blocked: the width lasts until reload */
  }
}
