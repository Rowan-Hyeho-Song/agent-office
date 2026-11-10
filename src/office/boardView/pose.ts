// The close view of the whiteboard (#234, docs-ui.md 3.5) as pure numbers: where the camera stands, and where the
// board's face lands on the screen. No three.js objects here, so it runs (and is tested) without a scene.

export type V3 = readonly [number, number, number]

/** the board face in world space: its centre, the unit normal (toward the room), the unit right and up axes, and its size in m */
export interface BoardFrame {
  center: V3
  normal: V3
  right: V3
  up: V3
  w: number
  h: number
}

export const CLOSE = {
  /** the board is this much of the screen width (docs-ui 3.5: the left area's 88%) ... */
  fillW: 0.88,
  /** ... and at most this much of its height (a wide window would otherwise cut the board top and bottom; the rest keeps the back button clear) */
  fillH: 0.82,
  /** the camera is pushed toward the pressed column by this much of the board's width (at the outer columns) */
  lean: 0.1,
  flightMs: 1200,
  fadeMs: 200,
} as const

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

/**
 * The camera pose in front of the board: on the board's normal at the distance where the board is `fillW` of the width
 * (and no more than `fillH` of the height), looking at the board's centre. `focusX` (-1 left .. 1 right, 0 = Enter or
 * the middle) pushes the whole pose sideways, so the pressed column sits nearer the middle.
 */
export function closePose(frame: BoardFrame, fovDeg: number, aspect: number, focusX = 0): { position: V3; target: V3; distance: number } {
  const half = Math.tan((fovDeg * Math.PI) / 360)
  const byW = frame.w / (CLOSE.fillW * 2 * half * aspect)
  const byH = frame.h / (CLOSE.fillH * 2 * half)
  const distance = Math.max(byW, byH)
  const lean = Math.max(-1, Math.min(1, focusX)) * CLOSE.lean * frame.w
  const target = add(frame.center, frame.right, lean)
  return { position: add(target, frame.normal, distance), target, distance }
}

/** the pressed column (0 doing, 1 review, 2 done; null = Enter) -> -1 .. 1 across the board */
export function focusXOf(column: number | null): number {
  return column === null ? 0 : Math.max(-1, Math.min(1, column - 1))
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** the screen rect (px) of the board's corners given in NDC (x, y in -1..1, y up): their bounding box */
export function rectFromNdc(corners: readonly (readonly [number, number])[], width: number, height: number): Rect {
  const xs = corners.map((c) => ((c[0] + 1) / 2) * width)
  const ys = corners.map((c) => ((1 - c[1]) / 2) * height)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

export const sameRect = (a: Rect | null, b: Rect | null, eps = 0.5): boolean =>
  a === b || (!!a && !!b && Math.abs(a.left - b.left) < eps && Math.abs(a.top - b.top) < eps && Math.abs(a.width - b.width) < eps && Math.abs(a.height - b.height) < eps)

export const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

/** a point `k` (0..1, eased by the caller) of the way from `a` to `b` */
export const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
