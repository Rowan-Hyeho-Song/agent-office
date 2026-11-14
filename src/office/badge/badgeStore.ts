// Which agent's badge (사원증, office-ui.md 12.1a, #4) is open, and where its robot is on the screen. A tiny external store like
// docs/panel.ts. The robot click (BadgePick, in the canvas) and the agent list's ⓘ open it; AgentBadge draws it.

import { useSyncExternalStore } from 'react'
import { isReplayActive } from '../../replay/store'
import { isTouring, tour } from '../tourStore'

export interface BadgeState {
  agent: string | null
  /** bumps at every open (the card replays its drop when it moves to another robot) */
  nonce: number
}

let state: BadgeState = { agent: null, nonce: 0 }
let opener: HTMLElement | null = null
const listeners = new Set<() => void>()
const set = (next: BadgeState) => {
  state = next
  listeners.forEach((l) => l())
}

/**
 * Open `agent`'s badge. `opener` gets the focus back when it closes (the list's ⓘ; a robot click has none). Not during the
 * timelapse (12.1: its points have their own tags). The ⓘ during a tour stops the tour first (the robot click is ignored then,
 * BadgePick): a keyboard has no other way to the card.
 */
export function openBadge(agent: string, from: HTMLElement | null = null) {
  if (isReplayActive()) return
  if (isTouring()) tour.stop()
  opener = from
  set({ agent, nonce: state.nonce + 1 })
}
export function closeBadge() {
  if (!state.agent) return
  set({ ...state, agent: null })
  const back = opener
  opener = null
  if (back?.isConnected) back.focus()
}
export const getBadge = () => state
export const useBadge = () =>
  useSyncExternalStore(
    (cb) => (listeners.add(cb), () => void listeners.delete(cb)),
    () => state,
  )

/** the open robot's head on the screen, CSS px of the canvas (written every frame by BadgePick, read by the card's own frame loop) */
export const badgeAnchor = { x: 0, y: 0, on: false }
