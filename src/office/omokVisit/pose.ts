// #137 ② where the camera sits for the visitor's omok (play.md 2.2), and the board as the visitor sees it: no React, for the rig and the tests.
import { Vector3 } from 'three'
import type { Orient } from './store'
import { TAG_MARGIN } from '../keyRackRules'

export type V3 = [number, number, number]
export const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]

/**
 * play.md 2.2: 55° down, the board about half the screen's height (#137 B designer: 50%); in 0.9 s (power2.inOut), a cut with reduced motion; out the same way.
 * On a screen taller than wide (a phone) the width is the short side: the board takes fillNarrow of it, so its edges stay in and the agent shows above, and
 * the camera looks lookAhead of the board's size past its middle, toward the agent. On a wide screen fill and the look past the middle are fitted (fitView).
 */
export const OMOK_VIEW = { downDeg: 55, fill: 0.5, fillNarrow: 0.75, lookAhead: 0.2, flightMs: 900, tagAboveM: 0.9 } as const
/**
 * #137 B (designer): on a wide screen the agent's whole face screen shows with `faceTopPx` above it and the board's near edge stays `hudGapPx` above the
 * HUD (`hudPx` from the screen's foot): the board is as big as fits up to OMOK_VIEW.fill of the height, and the camera looks as far past its middle as
 * puts the face there (fitView)
 */
export const OMOK_FIT = { faceTopPx: 12, hudPx: 64, hudGapPx: 16, minFill: 0.3 } as const

/** the board's middle and the visitor's place, and from them the camera's pose and the board as the visitor sees it (grid steps for right, up) */
export function visitPose(center: Vector3, seat: { x: number; z: number }, size: number, fovDeg: number, aspect = 16 / 10, view: { fill: number; fillNarrow: number; lookAhead: number; downDeg: number } = OMOK_VIEW): { position: V3; target: V3; orient: Orient } {
  const d = new Vector3(seat.x - center.x, 0, seat.z - center.z).normalize()
  const down = (view.downDeg * Math.PI) / 180
  const tall = Math.tan(((fovDeg * Math.PI) / 180) / 2)
  const r = aspect >= 1 ? size / (view.fill * 2 * tall) : size / (view.fillNarrow * 2 * tall * aspect)
  const target = center.clone().addScaledVector(d, -view.lookAhead * size)
  const position = target.clone().addScaledVector(d, r * Math.cos(down)).add(new Vector3(0, r * Math.sin(down), 0))
  // the visitor looks along -d: right is (-f.z, 0, f.x) with f = -d; each as a grid step (columns run +x, rows +z)
  const f = d.clone().negate()
  const step = (x: number, z: number): readonly [number, number] => (Math.abs(x) >= Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)])
  return { position: v3(position), target: v3(target), orient: { right: step(-f.z, f.x), up: step(f.x, f.z) } }
}

/**
 * #137 B (designer, as #480): where the "같이 두기" tag stands, its centre over the chair but pulled inside the screen by TAG_MARGIN at either edge, and
 * its top kept on the screen (the tag is drawn centred on x and above y)
 */
export function tagOnScreen(x: number, y: number, w: number, h: number, screenW: number): { left: number; top: number } {
  const half = w / 2
  return { left: Math.min(Math.max(x, TAG_MARGIN + half), Math.max(TAG_MARGIN + half, screenW - TAG_MARGIN - half)), top: Math.max(y, TAG_MARGIN + h) }
}

type View = { fill: number; fillNarrow: number; lookAhead: number; downDeg: number }
/**
 * The wide screen's view (OMOK_FIT): `measure` gives, for a view, the face screen's top and the board's near edge on the screen (px down from the top);
 * the look past the middle is found for the face's top, and the board is the biggest (up to OMOK_VIEW.fill) whose near edge then clears the HUD
 */
export function fitView(measure: (v: View) => { faceTop: number; nearEdge: number }, heightPx: number): View {
  const base: View = { fill: OMOK_VIEW.fill, fillNarrow: OMOK_VIEW.fillNarrow, lookAhead: OMOK_VIEW.lookAhead, downDeg: OMOK_VIEW.downDeg }
  const floor = heightPx - OMOK_FIT.hudPx - OMOK_FIT.hudGapPx
  // the look past the middle that puts the face's top at faceTopPx (looking further past it brings the face down the screen)
  const lookFor = (fill: number) => {
    let lo = -0.5
    let hi = 1.5
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (measure({ ...base, fill, lookAhead: mid }).faceTop < OMOK_FIT.faceTopPx) lo = mid
      else hi = mid
    }
    return hi
  }
  const fits = (fill: number) => {
    const lookAhead = lookFor(fill)
    return { view: { ...base, fill, lookAhead }, ok: measure({ ...base, fill, lookAhead }).nearEdge <= floor }
  }
  const top = fits(OMOK_VIEW.fill)
  if (top.ok) return top.view
  let lo: number = OMOK_FIT.minFill
  let hi: number = OMOK_VIEW.fill
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid).ok) lo = mid
    else hi = mid
  }
  return fits(lo).view
}
