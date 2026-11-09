import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type Material } from 'three'
import { setClearFurniture } from './clearance'
import { backToOpacity, stepOpacity } from './view'
import { FADED, WALL_HIDDEN, type FadeGroup } from './walls'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface State {
  cur: number
  want: number
}

/**
 * Furniture with its back to a wall (`backTo`, the bookshelf) is at 25% while that wall is lowered (part of the wall
 * cutaway, #111). Nothing else fades: not by distance to the camera and not by standing between camera and target (#253);
 * the camera stays 0.3 m clear of furniture instead (#208, clearance.ts) and app-chosen cameras (the tour) pick a spot that sees
 * their subject (tour.ts). Wanted opacities are recomputed only when a wall changed; the fade runs only while something
 * is still moving. Faded groups are listed in FADED so they stop taking clicks (walls.ts hitAllowed).
 */
export function Occluders({ groups }: { groups: FadeGroup[] }) {
  const states = useMemo(() => groups.map((): State => ({ cur: 1, want: 1 })), [groups])
  const last = useRef('')
  // the same boxes keep the camera clear of the furniture (#208)
  useEffect(() => setClearFurniture(groups), [groups])
  const reduced = useMemo(reducedMotion, [])
  useFrame((_, dt) => {
    const key = `${WALL_HIDDEN.n}${WALL_HIDDEN.e}${WALL_HIDDEN.s}${WALL_HIDDEN.w}`
    if (key !== last.current) {
      last.current = key
      groups.forEach((g, i) => {
        states[i].want = backToOpacity(1, g.backTo, WALL_HIDDEN)
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
