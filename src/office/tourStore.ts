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
  /** the stop button / view toggle was used: no automatic start again until the page is reloaded (in memory, not stored) */
  autoOff: boolean
}

let state: TourState = { active: false, cut: null, canBack: false, seq: 0, autoOff: false }
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

/** the stop button / view toggle was used: no automatic start again (lives in the store so the dock button can show it) */
export const setTourAutoOff = (b: boolean) => setTourState({ autoOff: b })
export const tourAutoOff = () => state.autoOff

// The dock's view toggle (#368, office-ui.md 10.6): the icon shows the CURRENT mode, the label names the mode a press goes to.
export interface ViewToggleModel {
  icon: 'camera' | 'cursor'
  label: string
  title: string
  /** aria-pressed: true in free view */
  pressed: boolean
  description?: string
}
export function viewToggleModel(s: Pick<TourState, 'active' | 'autoOff'>): ViewToggleModel {
  if (s.active) return { icon: 'camera', label: '자유 시점으로 둘러보기', title: '자유 시점', pressed: false }
  if (s.autoOff) {
    const t = '둘러보기 시작 (이 탭에서는 자동 꺼 둠)'
    return { icon: 'cursor', label: '둘러보기 시작', title: t, pressed: true, description: t }
  }
  return { icon: 'cursor', label: '둘러보기 시작', title: '둘러보기', pressed: true }
}
/** pressing it: during a tour it stops in place like the bar's stop (and the tab does not restart it); in free view it starts at once and clears that flag */
export function pressViewToggle() {
  if (state.active) return tour.stop('button')
  setTourAutoOff(false)
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
