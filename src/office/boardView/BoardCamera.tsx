import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Quaternion, Vector3, type Object3D, type PerspectiveCamera } from 'three'
import { tour } from '../tourStore'
import { prefersReducedMotion } from '../world'
import { CLOSE, closePose, easeInOut, focusXOf, lerp3, rectFromNdc, type BoardFrame, type V3 } from './pose'
import { dispatchBoard, getBoardView, setBoardRect } from './store'

// The camera of the whiteboard close view (#234, docs-ui.md 3.5): flies to the front of the board in 1.2 s (ease in-out, the
// tour's curve) and back to where it was. OrbitControls is off and its limits relaxed for the flight, the camera keeps clear of
// nothing (the clearance in cameraRig.tsx stands aside while the view is active). Each frame it also writes the screen rect of
// the board's face, which the DOM overdraw is laid over exactly.

interface Orbit {
  target: Vector3
  enabled: boolean
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
  update: () => unknown
}

interface Run {
  kind: 'in' | 'out'
  t0: number
  dur: number
  fromP: V3
  fromT: V3
  toP: V3
  toT: V3
}
interface Saved {
  pos: V3
  target: V3
  limits: { minD: number; maxD: number; minP: number; maxP: number; enabled: boolean }
}

const v3 = (v: Vector3): V3 => [v.x, v.y, v.z]
const Z = new Vector3(0, 0, 1)
const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)

/** the board face in world space, from the model's `surface_whiteboard` empty (extras w, h; its +z is the face's normal) */
export function boardFrame(surface: Object3D): BoardFrame {
  surface.updateWorldMatrix(true, false)
  const q = surface.getWorldQuaternion(new Quaternion())
  const { w = 1.5, h = 1 } = surface.userData as { w?: number; h?: number }
  return { center: v3(surface.getWorldPosition(new Vector3())), right: v3(X.clone().applyQuaternion(q)), up: v3(Y.clone().applyQuaternion(q)), normal: v3(Z.clone().applyQuaternion(q)), w, h }
}

export function BoardCamera() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const live = useRef({ controls, size })
  live.current = { controls, size }
  const run = useRef<Run | null>(null)
  const saved = useRef<Saved | null>(null)

  const restore = useRef<() => void>(() => {})
  restore.current = () => {
    const c = live.current.controls
    const s = saved.current
    if (!c || !s) return
    camera.position.set(...s.pos)
    c.target.set(...s.target)
    c.minDistance = s.limits.minD
    c.maxDistance = s.limits.maxD
    c.minPolarAngle = s.limits.minP
    c.maxPolarAngle = s.limits.maxP
    c.enabled = s.limits.enabled
    c.update()
    saved.current = null
  }
  // the page went away (or the scene changed) in the middle of a flight: give the controls back
  useEffect(() => () => restore.current(), [])

  useFrame(() => {
    const st = getBoardView()
    const c = live.current.controls
    // the board it flies to: the whiteboard, or the cork board of the notes (#4 12.3)
    const surface = scene.getObjectByName(`surface_${st.surface}`)
    if (st.mode !== 'stage' || !surface || !c) {
      setBoardRect(null)
      return
    }
    const frame = boardFrame(surface)
    const now = performance.now()

    // a reset (the timelapse started, say) while away from home: back at once
    if (st.phase === 'closed' && saved.current) {
      run.current = null
      restore.current()
    }
    if (st.phase === 'flying' && !run.current && !saved.current) {
      tour.stop('board')
      saved.current = { pos: v3(camera.position), target: v3(c.target), limits: { minD: c.minDistance, maxD: c.maxDistance, minP: c.minPolarAngle, maxP: c.maxPolarAngle, enabled: c.enabled } }
      c.enabled = false
      c.minDistance = 0.05
      c.maxDistance = 100
      c.minPolarAngle = 0
      c.maxPolarAngle = Math.PI
      const pose = closePose(frame, camera.fov, camera.aspect, focusXOf(st.column))
      run.current = { kind: 'in', t0: now, dur: prefersReducedMotion() ? 0 : CLOSE.flightMs, fromP: v3(camera.position), fromT: v3(c.target), toP: pose.position, toT: pose.target }
    }
    if (st.phase === 'leaving' && run.current?.kind !== 'out') {
      const s = saved.current
      if (!s) dispatchBoard({ type: 'left' })
      else run.current = { kind: 'out', t0: now, dur: prefersReducedMotion() ? 0 : CLOSE.flightMs, fromP: v3(camera.position), fromT: v3(c.target), toP: s.pos, toT: s.target }
    }

    const r = run.current
    if (r) {
      const k = r.dur ? Math.min(1, (now - r.t0) / r.dur) : 1
      const e = easeInOut(k)
      camera.position.set(...lerp3(r.fromP, r.toP, e))
      c.target.set(...lerp3(r.fromT, r.toT, e))
      c.update()
      if (k >= 1) {
        run.current = null
        if (r.kind === 'in') dispatchBoard({ type: 'arrived' })
        else {
          restore.current()
          dispatchBoard({ type: 'left' })
        }
      }
    }

    // the board's face on the screen: laid under the overdraw, and under the hover outline
    if (st.phase !== 'closed' || st.hover) {
      camera.updateMatrixWorld(true)
      const { width, height } = live.current.size
      const corner = (sx: number, sy: number) => {
        const p = new Vector3(...frame.center)
        p.addScaledVector(new Vector3(...frame.right), (sx * frame.w) / 2).addScaledVector(new Vector3(...frame.up), (sy * frame.h) / 2)
        p.project(camera)
        return [p.x, p.y] as const
      }
      setBoardRect(rectFromNdc([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], width, height))
    } else setBoardRect(null)
  })
  return null
}
