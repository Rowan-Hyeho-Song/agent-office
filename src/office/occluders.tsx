import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type Material } from 'three'
import { setClearFurniture } from './clearance'
import { DEFAULT_TARGET } from './room'
import { backToOpacity, boxDistance, occlusionSegment, segmentHitsBox, stepOpacity, wantOpacity } from './view'
import { FADED, WALL_HIDDEN, type FadeGroup } from './walls'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface State {
  cur: number
  want: number
}

/**
 * Near-object fade (#111): objects whose bounding box is within 1.4 m of the camera, or that the camera -> target
 * segment crosses, fade towards 25% and on to 0 inside VIEW.near.hide (0.4 m, #208: no cut face shows; the camera itself stays 0.3 m clear, clearance.ts) (walls have their own cutaway, agents and the floor are not in `groups`). Wanted
 * opacities are recomputed only when the camera or its target moved; the fade itself runs only while something is
 * still moving. Furniture with its back to a wall (`backTo`, the bookshelf) is also at 25% while that wall is lowered. Furniture with its back to a wall (`backTo`, the bookshelf) is also at 25% while that wall is lowered. Faded groups are listed in FADED so they stop taking clicks (walls.ts hitAllowed).
 */
export function Occluders({ groups }: { groups: FadeGroup[] }) {
  const camera = useThree((s) => s.camera)
  const states = useMemo(() => groups.map((): State => ({ cur: 1, want: 1 })), [groups])
  const last = useRef('')
  // the same boxes keep the camera clear of the furniture (#208)
  useEffect(() => setClearFurniture(groups), [groups])
  const reduced = useMemo(reducedMotion, [])
  useFrame(({ controls }, dt) => {
    const c = camera.position
    const tg = (controls as { target?: { x: number; y: number; z: number } } | null)?.target
    const t = tg ? ([tg.x, tg.y, tg.z] as const) : DEFAULT_TARGET
    const key = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${t[0].toFixed(3)},${t[1].toFixed(3)},${t[2].toFixed(3)},${WALL_HIDDEN.n}${WALL_HIDDEN.e}${WALL_HIDDEN.s}${WALL_HIDDEN.w}`
    if (key !== last.current) {
      last.current = key
      const cam = [c.x, c.y, c.z] as const
      const [a, b] = occlusionSegment(cam, t)
      groups.forEach((g, i) => {
        const box = { min: g.box.min.toArray() as [number, number, number], max: g.box.max.toArray() as [number, number, number] }
        states[i].want = backToOpacity(wantOpacity(boxDistance(cam, box), segmentHitsBox(a, b, box)), g.backTo, WALL_HIDDEN)
      })
    }
    groups.forEach((g, i) => {
      const s = states[i]
      if (s.cur === s.want) return
      s.cur = stepOpacity(s.cur, s.want, Math.min(dt, 0.1), reduced)
      const fading = s.cur < 1
      for (const m of g.meshes) {
        const mat = m.material as Material
        if (!m.userData.fadeBase) m.userData.fadeBase = { transparent: mat.transparent, depthWrite: mat.depthWrite }
        const base = m.userData.fadeBase as { transparent: boolean; depthWrite: boolean }
        mat.opacity = s.cur
        mat.transparent = fading || base.transparent
        mat.depthWrite = fading ? false : base.depthWrite
      }
      if (s.cur < 0.95) FADED.add(g.id)
      else FADED.delete(g.id)
    })
  })
  return null
}
