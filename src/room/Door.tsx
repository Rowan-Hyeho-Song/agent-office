import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { Box3, CanvasTexture, MeshBasicMaterial, Raycaster, SRGBColorSpace, Vector2, Vector3, type PerspectiveCamera } from 'three'
import { meshesOf, type OfficeNodes } from '../office/nodes'
import { PORTRAIT_ASPECT, portraitPose } from '../office/portraitCamera'
import { DEFAULT_CAMERA, DEFAULT_TARGET } from '../office/room'
import { hitAllowed } from '../office/walls'
import { DOOR_FX } from './doorFx'
import { DOOR_H, DOOR_W, drawDoor, hoverTick } from './doorScreen'
import { getDoorMessage } from './doorMessage'
import { ROOM_MODE, isLocked, leaveOffice, onEntered, onLeaveStart } from './link'

// The door screen's states (hover, press) and, in room mode, the camera that starts in front of it (O) and
// dives into it (X1). The desk's CRT is what the visitor sees around these (rowansong.dev #6 spec).

/** default view (App.tsx): the intro ends here. Mutated in place by setHomeAspect: the portrait-phone pose below PORTRAIT_ASPECT (portraitCamera.ts) */
export const HOME_POS = new Vector3(...DEFAULT_CAMERA)
export const HOME_TARGET = new Vector3(...DEFAULT_TARGET)
export const CAMERA_FOV = 32

let homePortrait = false
/** the default view for a viewport aspect; true when it changed (the portrait threshold was crossed) */
export function setHomeAspect(aspect: number): boolean {
  const portrait = aspect < PORTRAIT_ASPECT
  if (portrait === homePortrait) return false
  homePortrait = portrait
  const p = portrait ? portraitPose(aspect, CAMERA_FOV) : { camera: DEFAULT_CAMERA, target: DEFAULT_TARGET }
  HOME_POS.set(p.camera[0], p.camera[1], p.camera[2])
  HOME_TARGET.set(p.target[0], p.target[1], p.target[2])
  return true
}
if (typeof window !== 'undefined' && window.innerHeight > 0) setHomeAspect(window.innerWidth / window.innerHeight)

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// OrbitControls sits out while the camera is moved by the door's animation
let busy = ROOM_MODE
const busyListeners = new Set<() => void>()
const setBusy = (b: boolean) => {
  if (busy === b) return
  busy = b
  busyListeners.forEach((f) => f())
}
export const useCameraBusy = () =>
  useSyncExternalStore(
    (f) => (busyListeners.add(f), () => void busyListeners.delete(f)),
    () => busy,
  )

/** door centre and the direction it faces (the thin axis of its box, towards the room's middle) */
function doorFrame(door: Object3DLike) {
  const box = new Box3().setFromObject(door)
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3())
  const n = new Vector3()
  const axis = size.x <= size.z ? 'x' : 'z'
  n[axis] = Math.sign(HOME_TARGET[axis] - center[axis]) || 1
  return { center, normal: n, size }
}
type Object3DLike = Parameters<Box3['setFromObject']>[0]

const easeOut2 = (x: number) => 1 - (1 - x) * (1 - x)
const easeIn3 = (x: number) => x * x * x

export function Door({ nodes }: { nodes: OfficeNodes }) {
  const { gl, camera, scene } = useThree()
  const door = nodes.screen_door
  const view = useRef({ hover: false, pressed: null as number | null, key: '' })
  const reduced = useMemo(reducedMotion, [])

  // --- the screen: a canvas texture, redrawn only when what it shows changes ---
  const screen = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = DOOR_W
    canvas.height = DOOR_H
    const texture = new CanvasTexture(canvas)
    texture.flipY = false // glTF UV convention (the atlases do the same)
    texture.colorSpace = SRGBColorSpace
    texture.anisotropy = 8
    return { canvas, texture, ctx: canvas.getContext('2d')! }
  }, [])
  useEffect(() => {
    if (!door) return
    for (const m of meshesOf(door)) {
      const mat = m.material as MeshBasicMaterial
      mat.map = screen.texture
      mat.color.set('#ffffff')
      mat.needsUpdate = true
    }
  }, [door, screen])
  // the font may arrive after the first draw: redraw once it has
  useEffect(() => {
    void document.fonts?.load('bold 120px Galmuri11').catch(() => {})
    void document.fonts?.ready.then(() => (view.current.key = ''))
  }, [])

  useFrame(() => {
    const v = view.current
    const now = performance.now()
    const t = v.hover || v.pressed !== null ? now : 0
    const since = v.pressed === null ? null : now - v.pressed
    // the key changes only when a pixel would: hover/press, the arrow's and cursor's steps, the flash end
    const phase = since === null ? 'x' : since < DOOR_FX.pressFlashMs ? 'f' : since < DOOR_FX.reducedDimMs && reduced ? 'd' : 'p'
    const message = getDoorMessage()
    const key = `${v.hover ? 1 : 0}${phase}${v.hover || v.pressed !== null ? hoverTick(t) : ''}${message ? `|${message.masked ? 'm' : 't'}${message.text}` : ''}`
    if (key === v.key) return
    v.key = key
    drawDoor(screen.ctx, { hover: v.hover, pressed: since, reduced, t, message })
    screen.texture.needsUpdate = true
  })

  // the press: one amber flash, then the screen stays lit
  useEffect(() => onLeaveStart(() => (view.current.pressed = performance.now())), [])

  // --- hover + click on the door screen (a drag is the orbit, not a click) ---
  useEffect(() => {
    if (!door) return
    const el = gl.domElement
    const ray = new Raycaster()
    const ndc = new Vector2()
    const hit = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return ray.intersectObjects(meshesOf(door), false).some(hitAllowed)
    }
    let down: [number, number] | null = null
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
    const onUp = (e: PointerEvent) => {
      const moved = down ? Math.hypot(e.clientX - down[0], e.clientY - down[1]) : 99
      down = null
      if (moved < 6 && !isLocked() && hit(e)) leaveOffice('door')
    }
    // the cursor is written only when the door's own state changes, so it doesn't undo the office pickers' (pick.ts)
    let over = false
    const onMove = (e: PointerEvent) => {
      const on = !isLocked() && hit(e)
      view.current.hover = on
      if (on !== over) el.style.cursor = (over = on) ? 'pointer' : ''
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointermove', onMove)
    const onLeave = () => (view.current.hover = false)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      if (over) el.style.cursor = ''
    }
  }, [gl, camera, door])

  // --- room mode: O (intro) and X1 (dive) ---
  const anim = useRef<null | { from: Vector3; to: Vector3; fromT: Vector3; toT: Vector3; t0: number; ms: number; kind: 'intro' | 'dive' }>(null)
  const frame = useMemo(() => {
    if (!door) return null
    scene.updateMatrixWorld(true)
    return doorFrame(door)
  }, [door, scene])

  const lookAtCenter = useRef(new Vector3())
  // before the first frame: the camera is at the door, so the amber DESK.LNK is what shows through the interlace
  useEffect(() => {
    if (!ROOM_MODE || !frame) return
    const cam = camera as PerspectiveCamera
    const at = frame.center.clone().addScaledVector(frame.normal, DOOR_FX.officeDoorDist)
    cam.position.copy(at)
    lookAtCenter.current.copy(frame.center)
    cam.lookAt(frame.center)
    setBusy(true)
    if (import.meta.env.DEV) Object.assign(window, { __door: { center: frame.center.toArray(), normal: frame.normal.toArray(), at: at.toArray() } })
    let started = false
    const toHome = () => {
      if (started) return
      started = true
      if (reduced) {
        cam.position.copy(HOME_POS)
        cam.lookAt(HOME_TARGET)
        setBusy(false)
        return
      }
      anim.current = { from: at, to: HOME_POS, fromT: frame.center.clone(), toT: HOME_TARGET, t0: performance.now() + DOOR_FX.introDelayMs, ms: DOOR_FX.officeIntroMs, kind: 'intro' }
    }
    const offEntered = onEntered(toHome)
    const timer = window.setTimeout(toHome, DOOR_FX.enteredTimeoutMs)
    const offLeave = onLeaveStart(() => {
      started = true
      setBusy(true)
      if (reduced) return
      const from = cam.position.clone()
      const aim = anim.current?.toT ?? lookAtCenter.current
      anim.current = {
        from,
        to: frame.center.clone().addScaledVector(frame.normal, DOOR_FX.x1Dist),
        fromT: aim.clone(),
        toT: frame.center.clone(),
        t0: performance.now(),
        ms: DOOR_FX.x1Ms,
        kind: 'dive',
      }
    })
    return () => {
      window.clearTimeout(timer)
      offEntered()
      offLeave()
    }
  }, [frame, camera, reduced])

  const tmp = useRef(new Vector3())
  useFrame(() => {
    const a = anim.current
    if (!a) return
    const cam = camera as PerspectiveCamera
    const k = Math.max(0, Math.min(1, (performance.now() - a.t0) / a.ms))
    if (a.kind === 'intro') {
      const e = easeOut2(k)
      cam.position.lerpVectors(a.from, a.to, e)
      // up and over the furniture: most of the rise happens in the first part
      const rise = DOOR_FX.introRise
      const s = DOOR_FX.introRiseShare
      const ey = k < s ? rise * easeOut2(k / s) : rise + (1 - rise) * easeOut2((k - s) / (1 - s))
      cam.position.y = a.from.y + (a.to.y - a.from.y) * ey
      lookAtCenter.current.lerpVectors(a.fromT, a.toT, e)
    } else {
      const e = easeIn3(k)
      cam.position.lerpVectors(a.from, a.to, e)
      lookAtCenter.current.lerpVectors(a.fromT, a.toT, e)
    }
    cam.lookAt(tmp.current.copy(lookAtCenter.current))
    if (k >= 1) {
      anim.current = null
      if (a.kind === 'intro') setBusy(false)
    }
  })
  return null
}
