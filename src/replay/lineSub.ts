// The meeting line shown as the one-line subtitle (timelapse.md): the scene sets it each frame, the HUD shows it in place
// of the point's own subtitle. The snapshot is the same object until the line changes.

import { useSyncExternalStore } from 'react'

export interface LineSub {
  seat: number
  who: string
  text: string
}

let cur: LineSub | null = null
const listeners = new Set<() => void>()

export function setLineSub(next: LineSub | null) {
  if (next === cur || (next && cur && next.seat === cur.seat && next.text === cur.text)) return
  cur = next
  listeners.forEach((l) => l())
}

export const useLineSub = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    () => cur,
  )
