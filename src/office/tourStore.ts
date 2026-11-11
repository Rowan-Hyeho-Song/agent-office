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
  stop(): void
}
let commands: TourCommands | null = null
export const registerTour = (c: TourCommands | null) => void (commands = c)

/** the tour's commands for buttons, the agent list and the debug tools (nothing happens while the 3D is not up) */
export const tour = {
  start: (agent?: string) => commands?.start(agent),
  next: () => commands?.next(),
  prev: () => commands?.prev(),
  stop: () => commands?.stop(),
}

/**
 * What the tour's clock (TourRig, every 0.4 s) does (#427): it only ever ENDS a running tour that has to give way (no controls, the door's
 * animation, a side panel). It never starts one: the tour starts from the dock's view toggle or an agent's name in the list, nothing else
 * (no start after a quiet spell any more).
 */
export function tourTick(s: { active: boolean; controls: boolean; busy: boolean; panel: boolean }): 'stop' | null {
  return s.active && (!s.controls || s.busy || s.panel) ? 'stop' : null
}

// The dock's view toggle (#368, office-ui.md 10.6): the icon shows the CURRENT mode, the label names the mode a press goes to.
export interface ViewToggleModel {
  icon: 'camera' | 'cursor'
  label: string
  title: string
  /** aria-pressed: true in free view */
  pressed: boolean
  description?: string
}
export function viewToggleModel(s: Pick<TourState, 'active'>): ViewToggleModel {
  if (s.active) return { icon: 'camera', label: '자유 시점으로 둘러보기', title: '자유 시점', pressed: false }
  return { icon: 'cursor', label: '둘러보기 시작', title: '둘러보기', pressed: true }
}
/** pressing it: during a tour it stops in place like the bar's stop; in free view it starts at once */
export function pressViewToggle() {
  if (state.active) return tour.stop()
  tour.start()
}
/** the line the live region reads after the mode changes */
export const viewAnnouncement = (active: boolean) => (active ? '둘러보기 시작' : '자유 시점')

/** the black for the 0.3 s fade cut: the bar component owns the element, the rig sets its opacity */
let fadeEl: HTMLElement | null = null
export const registerTourFade = (el: HTMLElement | null) => void (fadeEl = el)
export const setTourFade = (v: number) => {
  if (fadeEl) fadeEl.style.opacity = String(v)
}
