// The side panel (#170; design: docs/design/docs-ui.md section 4), as pure decisions: width limits, the phone sheet's
// two heights, how far the 3D picture is moved (camera.setViewOffset), the left area that is still 3D, and the curve.
// DOM side: ../SidePanel.tsx. three.js side: ../sidePanelRig.tsx.

export const SIDE = {
  def: 480,
  min: 380,
  maxPx: 760,
  maxFrac: 0.55,
  /** 641 to 1024px screens start narrower: min(420px, 50%) */
  midMaxScreen: 1024,
  midDef: 420,
  midFrac: 0.5,
  /** keyboard step on the drag strip */
  key: 16,
  /** open / close / re-centre time (--dur-base) and the fade between the two tabs */
  ms: 240,
  fadeMs: 120,
  /** phones (<= 640px): the sheet has two heights, as a share of the screen; the 3D keeps the top 1 - half */
  phoneMaxScreen: 640,
  half: 0.55,
  full: 0.92,
} as const

/** --ease-out of tokens.css */
export const EASE_OUT = [0.2, 0.8, 0.2, 1] as const

export type Sheet = 'half' | 'full'
export interface Size {
  w: number
  h: number
}
export interface SideShape {
  open: boolean
  /** the desktop panel's width in px (ignored on phones) */
  width: number
  sheet: Sheet
}

export const isPhone = (screenW: number) => screenW <= SIDE.phoneMaxScreen

/** the widest the panel may be: min(760px, 55% of the screen), but never under the minimum */
export const maxWidth = (screenW: number) => Math.max(SIDE.min, Math.min(SIDE.maxPx, Math.floor(screenW * SIDE.maxFrac)))

export const clampWidth = (w: number, screenW: number) => Math.round(Math.min(maxWidth(screenW), Math.max(SIDE.min, w)))

/** the first width: 480px, or min(420px, 50%) on 641 to 1024px screens */
export const defaultWidth = (screenW: number) => clampWidth(screenW <= SIDE.midMaxScreen ? Math.min(SIDE.midDef, screenW * SIDE.midFrac) : SIDE.def, screenW)

/** the width to use: the remembered one (clamped to this screen) or the default */
export const panelWidth = (stored: number | null, screenW: number) => (stored === null || !Number.isFinite(stored) ? defaultWidth(screenW) : clampWidth(stored, screenW))

/** left arrow = the strip moves left = wider; right arrow = narrower */
export const stepWidth = (w: number, dir: 'left' | 'right', screenW: number) => clampWidth(w + (dir === 'left' ? SIDE.key : -SIDE.key), screenW)

/** the width for a pointer at `clientX` (the panel is flush right) */
export const widthAt = (clientX: number, screenW: number) => clampWidth(screenW - clientX, screenW)

/** how far the picture moves: left by half the panel on desktop, up by half the half-sheet on phones. 0 while closed. */
export function viewOffset(screen: Size, s: SideShape): { x: number; y: number } {
  if (!s.open) return { x: 0, y: 0 }
  if (isPhone(screen.w)) return { x: 0, y: Math.round((screen.h * SIDE.half) / 2) }
  return { x: s.width / 2, y: 0 }
}

/** the area that is still 3D (clicks, WASD, bubbles); the panel / sheet covers the rest */
export function leftArea(screen: Size, s: SideShape): Size {
  if (!s.open) return screen
  if (isPhone(screen.w)) return { w: screen.w, h: Math.round(screen.h * (1 - SIDE.half)) }
  return { w: Math.max(0, screen.w - s.width), h: screen.h }
}

/** where a released sheet drag lands: closed under 40% of the screen, full past the middle of the two heights */
export function snapSheet(heightPx: number, screenH: number): Sheet | 'close' {
  const f = heightPx / screenH
  if (f < 0.4) return 'close'
  return f >= (SIDE.half + SIDE.full) / 2 ? 'full' : 'half'
}

/** CSS cubic-bezier(x1, y1, x2, y2): progress for a time share k in 0..1 (the same curve the panel's slide uses) */
export function bezier(x1: number, y1: number, x2: number, y2: number, k: number): number {
  if (k <= 0) return 0
  if (k >= 1) return 1
  const at = (a: number, b: number, t: number) => 3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (at(x1, x2, mid) < k) lo = mid
    else hi = mid
  }
  return at(y1, y2, (lo + hi) / 2)
}
export const easeOut = (k: number) => bezier(...EASE_OUT, k)
