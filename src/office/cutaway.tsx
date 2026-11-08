import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three'
import { NONE_HIDDEN, VIEW, WALLS, cutAt, nextHidden, wallTop, type Hidden, type Wall } from './view'
import { WALL_CUT, WALL_PLANES, WALL_RECT, setWallCut, wallOf } from './walls'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** point every wall mesh's material at its wall's shared clipping plane (new meshes and swapped materials included) */
function bindClips(scene: Object3D) {
  scene.traverse((o) => {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) return
    const w = wallOf(o)
    if (w && o.material.clippingPlanes !== WALL_PLANES[w]) o.material.clippingPlanes = WALL_PLANES[w]
  })
}

/**
 * The cutaway (#111): the walls between the camera and the room are lowered to a floor strip (and raised again) with
 * the hysteresis rule of view.ts. A wall is lowered by moving its clipping plane; a dark cap on the cut top hides the
 * hollow inside it. Everything tagged with the wall (walls.ts) is clipped by the same plane.
 */
export function Cutaway({ scene }: { scene: Object3D }) {
  const gl = useThree((s) => s.gl)
  const caps = useMemo(() => {
    const geo = new BoxGeometry(1, 1, 1)
    const mat = new MeshBasicMaterial({ color: VIEW.capColor, toneMapped: false })
    const out: Partial<Record<Wall, Mesh>> = {}
    for (const w of WALLS) {
      const r = WALL_RECT[w]
      if (!r) continue
      const m = new Mesh(geo, mat)
      m.scale.set(r.sx, 0.012, r.sz)
      m.position.set(r.cx, VIEW.wallH, r.cz)
      m.visible = false
      out[w] = m
    }
    return out
  }, [])
  useEffect(() => {
    gl.localClippingEnabled = true
    if (import.meta.env.DEV) Object.assign(window, { __cut: WALL_CUT }) // screenshot scripts read the wall heights
    const list = Object.values(caps)
    list.forEach((c) => scene.add(c))
    return () => list.forEach((c) => scene.remove(c))
  }, [gl, scene, caps])

  const st = useRef({
    hidden: { ...NONE_HIDDEN } as Hidden,
    first: true,
    tween: {} as Partial<Record<Wall, { from: number; to: number; t0: number }>>,
    frames: 0,
  })
  const reduced = useMemo(reducedMotion, [])
  useFrame(({ camera }) => {
    const s = st.current
    if (s.frames++ % 30 === 0) bindClips(scene)
    const nh = nextHidden(s.hidden, camera.position.x, camera.position.z)
    const now = performance.now()
    for (const w of WALLS) {
      if (nh[w] !== s.hidden[w] || s.first) {
        const to = wallTop(nh[w])
        if (reduced || s.first) {
          delete s.tween[w]
          setWallCut(w, to)
        } else s.tween[w] = { from: WALL_CUT[w], to, t0: now }
      }
      const t = s.tween[w]
      if (t) {
        setWallCut(w, cutAt(t.from, t.to, now - t.t0))
        if (WALL_CUT[w] === t.to) delete s.tween[w]
      }
      const cap = caps[w]
      if (cap) {
        cap.visible = WALL_CUT[w] < VIEW.wallH - 0.001
        cap.position.y = WALL_CUT[w] - 0.006
      }
    }
    s.hidden = nh
    s.first = false
  })
  return null
}
