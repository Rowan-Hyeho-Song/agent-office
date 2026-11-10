import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { HOME_POS, HOME_TARGET, setHomeAspect, useCameraBusy } from '../room/Door'
import { clearCamera, clearFurnitureForDev } from './clearance'
import type { OfficeWorld } from './world'
import { isTouring } from './tourStore'
import { KEY_DIR, NO_KEYS, VIEW, clampTarget, easeVelocity, focusAllowsCameraKeys, keySpeed, wantDir, type Keys } from './view'

// Camera behaviour on top of OrbitControls (#111): the target stays inside the room (also for right-drag / two-finger
// pan), WASD moves the target, R or a double-click on empty space goes back to the default view.

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** the timelapse entry rewind (and anything else that must own the camera) can switch the keys off */
let keysBlocked = false
export const setCameraKeysBlocked = (b: boolean) => void (keysBlocked = b)

interface Orbit {
  target: Vector3
  update: () => unknown
  addEventListener: (t: 'change', f: () => void) => void
  removeEventListener: (t: 'change', f: () => void) => void
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

export function CameraRig({ limits, world }: { limits: boolean; world: OfficeWorld }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const controls = useThree((s) => s.controls) as unknown as Orbit | null
  const size = useThree((s) => s.size)
  const busy = useCameraBusy()
  const reduced = useMemo(reducedMotion, [])
  const keys = useRef<Keys>({ ...NO_KEYS })
  const vel = useRef({ x: 0, z: 0 })
  const anim = useRef<null | { fromP: Vector3; fromT: Vector3; t0: number }>(null)
  const live = useRef({ busy, controls })
  live.current = { busy, controls }

  /** the target back inside the room; the camera moves by the same amount so the view direction stays */
  const clampNow = useMemo(
    () => (c: Orbit) => {
      const t = c.target
      const k = clampTarget(t)
      const d = new Vector3(k.x - t.x, k.y - t.y, k.z - t.z)
      if (d.lengthSq() === 0) return
      camera.position.add(d)
      t.set(k.x, k.y, k.z)
    },
    [camera],
  )
  /** the camera kept clear of furniture, robots and walls (#208): zoom, pinch, WASD and robots walking into it all end here */
  const clearNow = useMemo(
    // not while the door flies the camera (room mode intro / dive end 0.35 m from the door screen: that path is the door's)
    () => (c: Orbit) => void (live.current.busy || clearCamera(camera.position, c.target, Object.values(world.rigs))),
    [camera, world],
  )

  useEffect(() => {
    // dev only: screenshot scripts read the camera
    if (import.meta.env.DEV) Object.assign(window, {
        __cam: () => ({ pos: camera.position.toArray(), target: controls?.target.toArray() }),
        __camSet: (p: number[], t: number[]) => {
          camera.position.set(p[0], p[1], p[2])
          controls?.target.set(t[0], t[1], t[2])
          controls?.update()
        },
        __clearBoxes: clearFurnitureForDev,
        __scene: scene,
        __camera: camera,
      })
  }, [camera, controls, scene])

  useEffect(() => {
    if (!controls || !limits) return
    const fix = () => {
      if (isTouring()) return // the tour owns the camera (#207)
      clampNow(controls)
      clearNow(controls)
    }
    fix()
    controls.addEventListener('change', fix)
    return () => controls.removeEventListener('change', fix)
  }, [controls, limits, clampNow, clearNow])

  // the default view follows the viewport (portrait phone, portraitCamera.ts): when the aspect crosses the threshold the home
  // pose changes; the camera follows only if it still sits on the old one (a visitor who has orbited is left alone)
  useEffect(() => {
    if (!size.width || !size.height) return
    const oldPos = HOME_POS.clone()
    const oldTarget = HOME_TARGET.clone()
    if (!setHomeAspect(size.width / size.height)) return
    const c = live.current.controls
    if (!limits || !c || live.current.busy || isTouring() || anim.current) return
    if (camera.position.distanceTo(oldPos) > 0.05 || c.target.distanceTo(oldTarget) > 0.05) return
    if (reduced) {
      camera.position.copy(HOME_POS)
      c.target.copy(HOME_TARGET)
      c.update()
    } else anim.current = { fromP: camera.position.clone(), fromT: c.target.clone(), t0: performance.now() }
  }, [size.width, size.height, limits, camera, reduced])

  useEffect(() => {
    if (!limits) return
    const reset = () => {
      const c = live.current.controls
      if (!c || live.current.busy) return
      if (reduced) {
        camera.position.copy(HOME_POS)
        c.target.copy(HOME_TARGET)
        c.update()
      } else anim.current = { fromP: camera.position.clone(), fromT: c.target.clone(), t0: performance.now() }
    }
    const usable = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey && focusAllowsCameraKeys(document.activeElement, document.body, document.documentElement)
    const down = (e: KeyboardEvent) => {
      keys.current.shift = e.shiftKey
      if (!usable(e) || e.isComposing) return
      if (e.code === 'KeyR') return e.repeat ? undefined : reset()
      const d = KEY_DIR[e.code]
      if (!d) return
      keys.current[d] = true
    }
    const up = (e: KeyboardEvent) => {
      keys.current.shift = e.shiftKey
      const d = KEY_DIR[e.code]
      if (d) keys.current[d] = false
    }
    const clear = () => (keys.current = { ...NO_KEYS })
    const dbl = () => {
      if (gl.domElement.style.cursor !== 'pointer') reset() // double-click on something clickable is not a reset
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    gl.domElement.addEventListener('dblclick', dbl)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
      gl.domElement.removeEventListener('dblclick', dbl)
      clear()
    }
  }, [limits, camera, gl, reduced])

  useFrame((_, dt) => {
    const c = live.current.controls
    if (!c || !limits || isTouring()) return // the tour owns the camera (#207)
    const a = anim.current
    if (a) {
      const k = Math.min(1, (performance.now() - a.t0) / VIEW.resetMs)
      const e = easeInOut(k)
      camera.position.lerpVectors(a.fromP, HOME_POS, e)
      c.target.lerpVectors(a.fromT, HOME_TARGET, e)
      if (k >= 1) anim.current = null
      return
    }
    clearNow(c) // a robot walking into the camera pushes it too
    const k = keys.current
    const any = k.fwd || k.back || k.left || k.right
    const go = any && !live.current.busy && !keysBlocked
    const fwd = { x: c.target.x - camera.position.x, z: c.target.z - camera.position.z }
    const dist = camera.position.distanceTo(c.target)
    const dir = go ? wantDir(k, fwd) : { x: 0, z: 0 }
    const sp = keySpeed(dist, k.shift)
    vel.current = easeVelocity(vel.current, { x: dir.x * sp, z: dir.z * sp }, Math.min(dt, 0.1), reduced)
    if (!go && Math.hypot(vel.current.x, vel.current.z) < 1e-3) {
      vel.current = { x: 0, z: 0 }
      return
    }
    const step = Math.min(dt, 0.1)
    camera.position.x += vel.current.x * step
    camera.position.z += vel.current.z * step
    c.target.x += vel.current.x * step
    c.target.z += vel.current.z * step
    clampNow(c) // per axis: slides along an edge
    clearNow(c)
  })
  return null
}

const HINT_KEY = 'agent-office.camera-hint'

/** the first visit only: how to move (#111); remembered once it has been shown for hintMs */
export function CameraHint({ enabled }: { enabled: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!enabled) return
    try {
      if (localStorage.getItem(HINT_KEY)) return
    } catch {
      /* storage blocked: show it every time */
    }
    setShow(true)
    const id = window.setTimeout(() => {
      setShow(false)
      try {
        localStorage.setItem(HINT_KEY, '1')
      } catch {
        /* ignore */
      }
    }, VIEW.hintMs)
    return () => {
      window.clearTimeout(id)
      setShow(false)
    }
  }, [enabled])
  return show ? (
    <p className="cam-hint" role="status">
      WASD로 이동 · 더블클릭으로 처음 시점
    </p>
  ) : null
}
