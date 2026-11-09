// What the rest of the page sees of the tour (#207): is it on, which cut, can the back button go; and the few commands the
// buttons and the agent list send. TourRig.tsx (the 3D side) registers the implementation. A tiny external store like
// sidePanel/store.ts; the camera rig reads `isTouring()` so it does not fight the tour.

import { useSyncExternalStore } from 'react'
import type { Cut } from './tour'

export interface TourState {
  active: boolean
  cut: Cut | null
  canBack: boolean
  /** bumps at every cut (the bar keys its announcement on it) */
  seq: number
}

let state: TourState = { active: false, cut: null, canBack: false, seq: 0 }
const listeners = new Set<() => void>()

export const getTourState = () => state
export const isTouring = () => state.active
export function setTourState(next: Partial<TourState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
export const useTour = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => state,
  )

export interface TourCommands {
  start(agent?: string): void
  next(): void
  prev(): void
  /** `button`: the stop button, which also keeps the tour from starting by itself again in this tab */
  stop(why?: 'button' | 'input'): void
}
let commands: TourCommands | null = null
export const registerTour = (c: TourCommands | null) => void (commands = c)

/** the tour's commands for buttons, the agent list and the debug tools (nothing happens while the 3D is not up) */
export const tour = {
  start: (agent?: string) => commands?.start(agent),
  next: () => commands?.next(),
  prev: () => commands?.prev(),
  stop: (why: 'button' | 'input' = 'input') => commands?.stop(why),
}

/** the stop button was used: no automatic start again until the page is reloaded (in memory, not stored) */
let autoOff = false
export const setTourAutoOff = (b: boolean) => void (autoOff = b)
export const tourAutoOff = () => autoOff

/** the black for the 0.3 s fade cut: the bar component owns the element, the rig sets its opacity */
let fadeEl: HTMLElement | null = null
export const registerTourFade = (el: HTMLElement | null) => void (fadeEl = el)
export const setTourFade = (v: number) => {
  if (fadeEl) fadeEl.style.opacity = String(v)
}
