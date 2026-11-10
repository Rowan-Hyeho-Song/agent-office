// The mouse rule of the tour (#405, office-ui.md 10.1): only a press-and-drag ends it; a mouse that merely moves (no button
// held) never does. Wheel, keys and touch are decided in TourRig as before. Pure, so the regression tests can drive it.

export const DRAG_PX = 30

export interface MouseState {
  /** where the button went down (null = no button held) */
  down: { x: number; y: number } | null
}
export const NO_MOUSE: MouseState = { down: null }

export type MouseEv =
  | { kind: 'down' | 'move'; x: number; y: number; buttons: number; onBar: boolean; active: boolean }
  | { kind: 'up'; x: number; y: number; buttons: number; onBar: boolean; active: boolean }

/** the next state and whether the tour ends; the pointer events on the bar / agent list / view toggle never end it */
export function mouseStep(s: MouseState, e: MouseEv): { state: MouseState; stop: boolean } {
  if (e.kind === 'up') return { state: e.buttons === 0 ? NO_MOUSE : s, stop: false }
  // a press only marks where a drag would start (office-ui.md 10.1: the input that ends it is press-AND-drag; a click on the picture does not)
  if (e.kind === 'down') return { state: { down: { x: e.x, y: e.y } }, stop: false }
  // a plain move: no button held, nothing happens
  if (e.buttons === 0) return { state: NO_MOUSE, stop: false }
  // a drag that began before the tour (or this event stream) started counts from its first move
  const origin = s.down ?? { x: e.x, y: e.y }
  const state = { down: origin }
  if (!e.active || e.onBar) return { state, stop: false }
  return { state, stop: Math.hypot(e.x - origin.x, e.y - origin.y) > DRAG_PX }
}
