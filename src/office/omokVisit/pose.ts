// #137 ② where the camera sits for the visitor's omok (play.md 2.2), and the board as the visitor sees it: no React, for the rig and the tests.
import { Vector3 } from 'three'
import type { Orient } from './store'

export type V3 = [number, number, number]
export const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]

/** play.md 2.2: 55° down, the board about 60% of the screen's height; in 0.9 s (power2.inOut), a cut with reduced motion; out the same way.
 * On a screen taller than wide (a phone) the width is the short side: the board takes fillNarrow of it, so its edges stay in and the agent shows above.
 * The camera looks lookAhead of the board's size past its middle, toward the agent: the board sits a little low and the agent's head comes in */
export const OMOK_VIEW = { downDeg: 55, fill: 0.6, fillNarrow: 0.75, lookAhead: 0.2, flightMs: 900, tagAboveM: 0.9 } as const

/** the board's middle and the visitor's place, and from them the camera's pose and the board as the visitor sees it (grid steps for right, up) */
export function visitPose(center: Vector3, seat: { x: number; z: number }, size: number, fovDeg: number, aspect = 16 / 10): { position: V3; target: V3; orient: Orient } {
  const d = new Vector3(seat.x - center.x, 0, seat.z - center.z).normalize()
  const down = (OMOK_VIEW.downDeg * Math.PI) / 180
  const tall = Math.tan(((fovDeg * Math.PI) / 180) / 2)
  const r = aspect >= 1 ? size / (OMOK_VIEW.fill * 2 * tall) : size / (OMOK_VIEW.fillNarrow * 2 * tall * aspect)
  const target = center.clone().addScaledVector(d, -OMOK_VIEW.lookAhead * size)
  const position = target.clone().addScaledVector(d, r * Math.cos(down)).add(new Vector3(0, r * Math.sin(down), 0))
  // the visitor looks along -d: right is (-f.z, 0, f.x) with f = -d; each as a grid step (columns run +x, rows +z)
  const f = d.clone().negate()
  const step = (x: number, z: number): readonly [number, number] => (Math.abs(x) >= Math.abs(z) ? [Math.sign(x), 0] : [0, Math.sign(z)])
  return { position: v3(position), target: v3(target), orient: { right: step(-f.z, f.x), up: step(f.x, f.z) } }
}
