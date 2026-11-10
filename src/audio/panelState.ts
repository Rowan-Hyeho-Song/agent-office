// The sound settings panel's state and rules (docs/design/office-ui.md section 11, #353). No DOM here except what the
// caller hands in: the open/close store, where the popover goes, and when a click closes it are pure and tested.

export type PanelFrom = 'turntable' | 'hud'

export const PANEL_W = 280
export const TAIL = 10
export const EDGE = 16
/** a press shorter than this many px is a click; more is a camera drag (the same 5 px pick.ts uses) */
export const DRAG_PX = 5

export const LEVELS = [
  { key: 'volume', label: '전체', hint: '모든 소리' },
  { key: 'music', label: '배경음악', hint: '스피커 음악' },
  { key: 'sfx', label: '효과음', hint: '말소리 · 타자 · 방 소리' },
] as const
export type LevelKey = (typeof LEVELS)[number]['key']

/** a stored 0..1 level as the slider's 0..100 step 5 */
export const toPct = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 20) * 5
/** a slider's 0..100 back to the 0..1 the store takes (snapped to the 5 % steps) */
export const fromPct = (p: number) => Math.round(Math.min(100, Math.max(0, p)) / 5) * 0.05
export const valueText = (label: string, v: number) => `${label} ${toPct(v)}%`

export type Panel = { open: boolean; from: PanelFrom | null }
let panel: Panel = { open: false, from: null }
let returnTo: HTMLElement | null = null
const listeners = new Set<() => void>()
export const getPanel = () => panel
export const subscribePanel = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const set = (p: Panel) => {
  panel = p
  listeners.forEach((f) => f())
}

/** open from `from`; `back` is where focus goes on close (the HUD button, or the canvas for the turntable) */
export function openPanel(from: PanelFrom, back: HTMLElement | null = null) {
  returnTo = back
  set({ open: true, from })
}
/** close, and hand back the element to focus (null when it was not open) */
export function closePanel(): HTMLElement | null {
  if (!panel.open) return null
  const back = returnTo
  returnTo = null
  set({ open: false, from: null })
  return back
}
/** a second press on the same opener closes (the turntable, the HUD button); a different opener moves it */
export function togglePanel(from: PanelFrom, back: HTMLElement | null = null): HTMLElement | null {
  if (panel.open && panel.from === from) return closePanel()
  openPanel(from, back)
  return null
}

/** the click rules: a camera drag (moved >= 5 px) never closes; a click inside the panel or on an opener does not either */
export function outsideClosesPanel(moved: number, insidePanel: boolean, onOpener: boolean): boolean {
  return moved < DRAG_PX && !insidePanel && !onOpener
}

export type Box = { left: number; top: number; right: number; bottom: number }
export type Placed = { x: number; y: number; side: 'right' | 'left'; tail: boolean; tailY: number }

/**
 * The popover next to a target box on the screen `w x h`: to its right (tail 10 px), to its left when it does not fit,
 * clamped 16 px inside the edge; vertical centre on the target. A target off screen (no overlap with the screen) pins
 * the panel inside the edge and hides the tail. `prefer` 'left' is the HUD (the dock is at the right edge).
 */
export function placePopover(target: Box, w: number, h: number, ph: number, prefer: 'right' | 'left' = 'right', pw = PANEL_W): Placed {
  const clampX = (x: number) => Math.min(Math.max(EDGE, x), Math.max(EDGE, w - EDGE - pw))
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), Math.max(EDGE, h - EDGE - ph))
  const visible = target.right > 0 && target.left < w && target.bottom > 0 && target.top < h
  const cy = (target.top + target.bottom) / 2
  const rightX = target.right + TAIL
  const leftX = target.left - TAIL - pw
  const fitsRight = rightX + pw <= w - EDGE
  const fitsLeft = leftX >= EDGE
  const side: 'right' | 'left' = prefer === 'right' ? (fitsRight || !fitsLeft ? 'right' : 'left') : fitsLeft || !fitsRight ? 'left' : 'right'
  const x = clampX(side === 'right' ? rightX : leftX)
  const y = clampY(cy - ph / 2)
  return { x, y, side, tail: visible, tailY: Math.min(Math.max(cy - y, 14), ph - 14) }
}

/** the turntable's box on the screen, written every frame by the 3D side (office/TurntablePick); the panel follows it */
let turntableBox: Box | null = null
const boxListeners = new Set<() => void>()
export const getTurntableBox = () => turntableBox
export const subscribeTurntableBox = (fn: () => void) => {
  boxListeners.add(fn)
  return () => void boxListeners.delete(fn)
}
export function setTurntableBox(b: Box | null) {
  turntableBox = b
  boxListeners.forEach((f) => f())
}

/** which sliders make the preview click when let go: 전체 and 효과음 (the music itself is 배경음악's preview) */
export const previewsOnRelease = (k: LevelKey) => k !== 'music'
