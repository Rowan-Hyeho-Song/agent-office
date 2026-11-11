// What the day view shows about a minutes point (timelapse.md 11.4): which row of the table is playing (`회의 4/9줄`) and how long
// the rows take (the remaining time). The scene sets the row each frame; the driver notes the rows of a point once its table is known.

import { useSyncExternalStore } from 'react'
import type { MeetingScript } from '../office/meeting'
import { MINUTES_CAP_MS, planScript, tierOf } from '../office/minutes'
import type { Point } from '../timeline/types'
import { MINUTES_MS } from './engine'

export interface MinutesProgress {
  row: number
  total: number
}

let cur: MinutesProgress | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

export function setMinutesProgress(next: MinutesProgress | null) {
  if (next === cur || (next && cur && next.row === cur.row && next.total === cur.total)) return
  cur = next
  emit()
}
export const useMinutesProgress = () => useSyncExternalStore(subscribe, () => cur)

/** `회의 4/9줄` (null when no row has begun yet) */
export const progressText = (p: MinutesProgress | null) => (p && p.row > 0 ? `회의 ${p.row}/${p.total}줄` : null)

// ---- how long the rows take -----------------------------------------------------------------------------------------

const known = new Map<string, { script: MeetingScript; ms: Map<number, number> }>()
let version = 0

/** the script of a minutes point once its table is known: its length enters the remaining time */
export function noteMinutes(p: Point, script: MeetingScript) {
  if (known.has(p.key)) return
  known.set(p.key, { script, ms: new Map() })
  version++
  emit()
}
export const forgetMinutes = () => {
  known.clear()
  version++
}
export const useMinutesVersion = () => useSyncExternalStore(subscribe, () => version)

/** the replay ms a known minutes point holds the next one beyond its own 4.5 s, at this speed (0 when its table is not known yet) */
export function minutesExtraMs(p: Point, speed: number): number {
  const k = known.get(p.key)
  if (!k) return 0
  const tier = tierOf(speed)
  let ms = k.ms.get(tier)
  if (ms === undefined) {
    ms = Math.min(MINUTES_CAP_MS, planScript(k.script, { speed }).linesMs)
    k.ms.set(tier, ms)
  }
  return Math.max(0, ms - MINUTES_MS)
}
