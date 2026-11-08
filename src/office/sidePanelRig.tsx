import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { SIDE, easeOut, fitKey, fitScale, viewOffset } from './sidePanel/model'
import { ROOM } from './room'
import { getSideLayout } from './sidePanel/store'

// The side panel moves the picture, not the canvas (#170): the canvas stays full screen and the camera's view offset
// shifts the centre left by half the panel (up by half the phone sheet). Same 240 ms and curve as the panel's slide;
// at once while the width is dragged and under reduced motion. Applied every frame it differs, because R3F's resize
// calls updateProjectionMatrix with a stale full size: the check below puts the offset back for the new size.

// the room box (floor to wall top), measured on screen with the panel closed: no view offset, no fit zoom
const CORNERS = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz) => [0, 1].map((top) => [sx, sz, top] as const)))
const tmp = new Vector3()
function roomScreenWidth(camera: PerspectiveCamera, width: number, height: number): number {
  const t = Math.tan((camera.fov * Math.PI) / 360) * (width / height)
  let lo = Infinity
  let hi = -Infinity
  for (const [sx, sz, top] of CORNERS) {
    tmp.set(sx * ROOM.hx, top * ROOM.wallH, sz * ROOM.hz).applyMatrix4(camera.matrixWorldInverse)
    if (tmp.z >= -1e-3) continue
    const x = tmp.x / -tmp.z / t
    lo = Math.min(lo, x)
    hi = Math.max(hi, x)
  }
  return hi > lo ? ((hi - lo) / 2) * width : 0
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'

export function SideViewOffset() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    // dev only: screenshot scripts project a point / a named node to canvas px, to measure the re-centring and aim clicks
    if (!import.meta.env.DEV) return
    const v = new Vector3()
    const px = (p: Vector3) => {
      p.project(camera)
      return [((p.x + 1) / 2) * size.width, ((1 - p.y) / 2) * size.height]
    }
    Object.assign(window, {
      __proj: (x: number, y: number, z: number) => px(v.set(x, y, z)),
      __projNode: (name: string) => {
        const o = scene.getObjectByName(name)
        return o ? px(o.getWorldPosition(v)) : null
      },
    })
  }, [camera, scene, size])
  const st = useRef({ cur: { x: 0, y: 0 }, from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, t0: 0 })
  // the fit (#175): how far "open" the scale is (0 closed, 1 open), eased like the offset; the viewer's own orbit / dolly
  // stays theirs and the held scale multiplies it
  const fit = useRef({ cur: 0, from: 0, to: 0, t0: 0 })
  // the fit scale is measured when the panel opens (and again when its width or the screen changes), then held: measured
  // every frame it undid the viewer's own zoom while the panel was open, the room kept its size whatever the wheel did (#190)
  const held = useRef({ key: '', scale: 1 })
  useFrame(() => {
    const s = st.current
    const L = getSideLayout()
    const to = viewOffset({ w: size.width, h: size.height }, L)
    const now = performance.now()
    if (to.x !== s.to.x || to.y !== s.to.y) {
      s.from = { ...s.cur }
      s.to = to
      s.t0 = now
    }
    const k = L.dragging || reduced() ? 1 : Math.min(1, (now - s.t0) / SIDE.ms)
    const e = easeOut(k)
    const x = s.from.x + (s.to.x - s.from.x) * e
    const y = s.from.y + (s.to.y - s.from.y) * e
    const v = camera.view
    const stale = !v?.enabled ? x !== 0 || y !== 0 : v.fullWidth !== size.width || v.fullHeight !== size.height || v.offsetX !== x || v.offsetY !== y
    s.cur = { x, y }
    const f = fit.current
    const fitTo = L.open ? 1 : 0
    if (fitTo !== f.to) {
      f.from = f.cur
      f.to = fitTo
      f.t0 = now
    }
    const kf = L.dragging || reduced() ? 1 : Math.min(1, (now - f.t0) / SIDE.ms)
    f.cur = f.from + (f.to - f.from) * easeOut(kf)
    const key = fitKey({ w: size.width, h: size.height }, L)
    if (key !== held.current.key) held.current = { key, scale: key ? fitScale({ w: size.width, h: size.height }, L, roomScreenWidth(camera, size.width, size.height)) : 1 }
    const target = held.current.scale
    const zoom = 1 + (target - 1) * f.cur
    if (Math.abs(camera.zoom - zoom) > 1e-4) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
    }
    if (!stale) return
    if (x === 0 && y === 0) camera.clearViewOffset()
    else camera.setViewOffset(size.width, size.height, x, y, size.width, size.height)
  })
  return null
}
