// Clicking things in the 3D scene: the ray tests only the targets it is given (never the agents or their props), so
// nothing standing in front can block a click. Used by the IN tray (approval box) and the bookshelf (library viewer).

import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { hitAllowed } from './walls'
import { BoxGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector2, Vector3, type Intersection, type Object3D } from 'three'

/**
 * The model's `hit_<kind>` empty (extras {hit: kind, size: [w, h, d]}) as an invisible box of that size, placed where the
 * empty is (position = box centre, rotation = box axes). null when the model has none.
 */
export function hitBox(scene: Object3D, kind: string): Mesh | null {
  const hit = scene.getObjectByName(`hit_${kind}`)
  const size = hit?.userData.size as [number, number, number] | undefined
  if (!hit || hit.userData.hit !== kind || size?.length !== 3) return null
  const box = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ visible: false }))
  hit.updateWorldMatrix(true, false)
  hit.matrixWorld.decompose(box.position, box.quaternion, new Vector3())
  box.updateMatrixWorld(true)
  // follows its wall / desk: gone with it (walls.ts hitAllowed)
  box.userData.wall = hit.userData.wall
  box.userData.fadeGroup = hit.userData.fadeGroup
  return box
}

/**
 * Pointer cursor over the targets and a click (not a camera drag) on them. `targets` is read at every pointer event, so
 * it may change; `onPick` gets all hits nearest first; `onHover` fires when the pointer enters or leaves the targets.
 */
export function useCanvasPick(targets: () => Object3D[], onPick: (hits: Intersection[]) => void, onHover?: (over: boolean) => void) {
  const { gl, camera } = useThree()
  const latest = useRef({ targets, onPick, onHover })
  latest.current = { targets, onPick, onHover }
  const ray = useMemo(() => new Raycaster(), [])
  const ndc = useMemo(() => new Vector2(), [])
  useEffect(() => {
    const el = gl.domElement
    const hits = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return ray.intersectObjects(latest.current.targets(), false).filter(hitAllowed)
    }
    let down: [number, number] | null = null
    // the cursor is written only when this picker's own state changes, so two pickers don't undo each other
    let over = false
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return // dragging the camera
      const now = hits(e).length > 0
      if (now !== over) {
        el.style.cursor = (over = now) ? 'pointer' : ''
        latest.current.onHover?.(over)
      }
    }
    const onLeave = () => {
      if (!over) return
      el.style.cursor = ''
      over = false
      latest.current.onHover?.(false)
    }
    const onDown = (e: PointerEvent) => (down = [e.clientX, e.clientY])
    const onClick = (e: MouseEvent) => {
      const moved = down ? Math.hypot(e.clientX - down[0], e.clientY - down[1]) : 0
      if (moved >= 5) return
      const h = hits(e)
      if (h.length) latest.current.onPick(h)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick)
      if (over) {
        el.style.cursor = ''
        latest.current.onHover?.(false)
      }
    }
  }, [gl, camera, ray, ndc])
}
