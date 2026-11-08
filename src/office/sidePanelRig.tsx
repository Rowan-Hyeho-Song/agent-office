import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { SIDE, easeOut, viewOffset } from './sidePanel/model'
import { getSideLayout } from './sidePanel/store'

// The side panel moves the picture, not the canvas (#170): the canvas stays full screen and the camera's view offset
// shifts the centre left by half the panel (up by half the phone sheet). Same 240 ms and curve as the panel's slide;
// at once while the width is dragged and under reduced motion. Applied every frame it differs, because R3F's resize
// calls updateProjectionMatrix with a stale full size: the check below puts the offset back for the new size.

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
    if (!stale) return
    if (x === 0 && y === 0) camera.clearViewOffset()
    else camera.setViewOffset(size.width, size.height, x, y, size.width, size.height)
  })
  return null
}
