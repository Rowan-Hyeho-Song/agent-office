import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import type { Object3D } from 'three'
import { setClearFurniture } from './clearance'
import { fadeMesh } from './fade'
import type { PropBank } from './rig'
import { backToOpacity, stepOpacity } from './view'
import { FADED, WALL_HIDDEN, type FadeGroup } from './walls'

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

interface State {
  cur: number
  want: number
  /** what the meshes were last set to (1 = restored) */
  applied: number
}

/**
 * Furniture with its back to a wall (`backTo`, the bookshelf) is at 25% while that wall is lowered (part of the wall
 * cutaway, #111). The WHOLE group goes together at one opacity (walls.ts: back panel, shelves, binders, books, what stands on or in it),
 * as hashed alpha (fade.ts) so overlapping parts neither flicker nor sort. A book an agent has taken out (PropBank.isAway)
 * leaves the group while away: fully opaque and clickable; it rejoins when it is back in place. Nothing else fades: not by distance to
 * the camera and not by standing between camera and target (#253); the camera stays 0.3 m clear of furniture instead (#208, clearance.ts)
 * and app-chosen cameras (the tour) pick a spot that sees their subject (tour.ts). Wanted opacities are recomputed only when a wall changed;
 * the fade runs only while something is still moving. Faded groups are listed in FADED so they stop taking clicks (walls.ts hitAllowed).
 */
export function Occluders({ groups, scene }: { groups: FadeGroup[]; scene: Object3D }) {
  const states = useMemo(() => groups.map((): State => ({ cur: 1, want: 1, applied: 1 })), [groups])
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
    const bank = scene.userData.props as PropBank | undefined
    groups.forEach((g, i) => {
      const s = states[i]
      if (s.cur !== s.want) s.cur = stepOpacity(s.cur, s.want, Math.min(dt, 0.1), reduced)
      if (s.cur === 1 && s.applied === 1) return
      const away = new Map<Object3D, boolean>()
      for (const m of g.meshes) {
        const prop = g.props?.get(m)
        const out = !!prop && !!bank && (away.get(prop) ?? (away.set(prop, bank.isAway(prop)), away.get(prop)!))
        if (out) delete m.userData.fadeGroup
        else m.userData.fadeGroup = g.id
        fadeMesh(m, out ? 1 : s.cur)
      }
      s.applied = s.cur
      if (s.cur < 0.95) FADED.add(g.id)
      else FADED.delete(g.id)
    })
  })
  return null
}
