import { useFrame, useThree } from '@react-three/fiber'
import { useRef, useSyncExternalStore } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { HOME_POS, HOME_TARGET, useCameraBusy } from '../room/Door'
import { LANDMARKS, PORTRAIT_ASPECT, landmarkView, type Pose } from './portraitCamera'
import { isTouring } from './tourStore'

// Edge hints (portrait phone only): the landmarks the portrait home view leaves out (portraitCamera.ts) get a small label at
// the screen edge on the side they lie. A hint shows only while the camera is still on the home pose (an orbit, zoom, pan or
// WASD hides it) and a click pans the view sideways until that landmark is centred. EdgeHintRig lives in the Canvas
// (reads the camera each frame, writes a tiny store), EdgeHints is the DOM.

interface Hint {
  id: string
  label: string
  side: 'l' | 'r'
  /** percent from the top of the screen */
  top: number
}
let hints: readonly Hint[] = []
let key = ''
let panWish: string | null = null
const listeners = new Set<() => void>()
const set = (h: Hint[]) => {
  const k = h.map((x) => `${x.id}${x.side}${Math.round(x.top)}`).join()
  if (k === key) return
  key = k
  hints = h
  listeners.forEach((f) => f())
}
const useHints = () =>
  useSyncExternalStore(
    (f) => (listeners.add(f), () => void listeners.delete(f)),
    () => hints,
  )

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'
const PAN_MS = 500
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

export function EdgeHintRig({ limits }: { limits: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => unknown } | null
  const size = useThree((s) => s.size)
  const busy = useCameraBusy()
  const pan = useRef<null | { t0: number; dx: number; dz: number; fromP: Vector3; fromT: Vector3 }>(null)
  useFrame(() => {
    if (!controls || !limits || busy || isTouring() || !size.width || !size.height) return set([])
    const aspect = size.width / size.height
    const a = pan.current
    if (a) {
      const k = Math.min(1, (performance.now() - a.t0) / PAN_MS)
      const e = ease(k)
      camera.position.set(a.fromP.x + a.dx * e, a.fromP.y, a.fromP.z + a.dz * e)
      controls.target.set(a.fromT.x + a.dx * e, a.fromT.y, a.fromT.z + a.dz * e)
      controls.update()
      if (k >= 1) pan.current = null
      return set([])
    }
    const home = aspect < PORTRAIT_ASPECT && camera.position.distanceTo(HOME_POS) < 0.05 && controls.target.distanceTo(HOME_TARGET) < 0.05
    if (!home) {
      panWish = null
      return set([])
    }
    const pose: Pose = { camera: camera.position.toArray(), target: controls.target.toArray() }
    const views = landmarkView(pose, camera.fov, aspect)
    if (panWish) {
      const l = views.find((v) => v.id === panWish)
      panWish = null
      if (l) {
        // slide along the screen's horizontal axis (ground plane) until the landmark's centre is in the middle
        const c = LANDMARKS.find((x) => x.id === l.id)!
        const mid = new Vector3((c.min[0] + c.max[0]) / 2 - controls.target.x, 0, (c.min[2] + c.max[2]) / 2 - controls.target.z)
        const fwd = new Vector3().subVectors(controls.target, camera.position).setY(0).normalize()
        const right = new Vector3(-fwd.z, 0, fwd.x).negate().negate() // right of forward on the ground (y up)
        const s = mid.dot(right)
        const dx = right.x * s
        const dz = right.z * s
        if (reduced()) {
          camera.position.x += dx
          camera.position.z += dz
          controls.target.x += dx
          controls.target.z += dz
          controls.update()
        } else pan.current = { t0: performance.now(), dx, dz, fromP: camera.position.clone(), fromT: controls.target.clone() }
        return set([])
      }
    }
    set(
      views
        .filter((v) => !v.full)
        .map((v) => ({ id: v.id, label: v.label, side: v.cx > 0 ? ('r' as const) : ('l' as const), top: Math.min(82, Math.max(14, ((1 - v.cy) / 2) * 100)) })),
    )
  })
  return null
}

export function EdgeHints() {
  const list = useHints()
  return (
    <>
      {list.map((h) => (
        <button
          key={h.id}
          type="button"
          className={`edge-hint edge-hint-${h.side}`}
          style={{ top: `${h.top}%` }}
          aria-label={`${h.label} 쪽으로 화면 이동`}
          onClick={() => void (panWish = h.id)}
        >
          {h.side === 'l' ? `‹ ${h.label}` : `${h.label} ›`}
        </button>
      ))}
    </>
  )
}
