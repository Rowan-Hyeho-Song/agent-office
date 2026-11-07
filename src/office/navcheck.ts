// ?debug=1 check that the nav graph stays off the furniture: rays along every edge (at the agent's pod, torso,
// shoulder and head height, at its center line and both sides) against the baked meshes. A blocked edge is
// drawn red and listed in the debug panel.

import { DoubleSide, Raycaster, Vector3, type Material, type Mesh } from 'three'
import { dist, type NavGraph } from './nav'

const HEIGHTS = [0.2, 0.35, 0.5, 0.62, 0.74, 0.86, 1.0] // pod to head; 0.74 = desk and table tops
const HALF_WIDTH = 0.22 // arms included
/** an agent settles into these spots, so the last stretch may touch the furniture it sits on / works at */
const SETTLE: Record<string, number> = { sofa: 0.55, stool: 0.45, work: 0.25 }

export interface Blocked {
  where: string
  /** the meshes hit, nearest first */
  hits: string[]
}

export interface NavCheck {
  edges: Record<string, boolean>
  blocked: Blocked[]
}

export const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function checkNav(g: NavGraph, meshes: Mesh[]): NavCheck {
  // the baked meshes are single-sided; a ray starting inside a desk would miss it otherwise
  const sides = meshes.map((m) => (m.material as Material).side)
  for (const m of meshes) (m.material as Material).side = DoubleSide
  const ray = new Raycaster()
  const o = new Vector3()
  const d = new Vector3()
  const edges: Record<string, boolean> = {}
  const blocked: Blocked[] = []

  const seen = new Set<string>()
  for (const a in g.adj) {
    for (const b of g.adj[a]) {
      const key = edgeKey(a, b)
      if (seen.has(key)) continue
      seen.add(key)
      const A = g.spots[a]
      const B = g.spots[b]
      const len = dist(A, B)
      const skipA = SETTLE[A.kind] ?? 0
      const skipB = SETTLE[B.kind] ?? 0
      const hits = new Set<string>()
      const dx = (B.x - A.x) / len
      const dz = (B.z - A.z) / len
      for (const h of HEIGHTS) {
        for (const side of [-1, 0, 1]) {
          const ox = -dz * side * HALF_WIDTH
          const oz = dx * side * HALF_WIDTH
          o.set(A.x + ox + dx * skipA, h, A.z + oz + dz * skipA)
          d.set(dx, 0, dz)
          ray.set(o, d)
          ray.far = Math.max(0, len - skipA - skipB)
          for (const hit of ray.intersectObjects(meshes, false)) hits.add(hit.object.name)
        }
      }
      edges[key] = hits.size === 0
      if (hits.size) blocked.push({ where: `${a} — ${b}`, hits: [...hits] })
    }
  }

  // the spots themselves: a ring of short rays around where the agent stands (seats excepted)
  for (const s of Object.values(g.spots)) {
    if (SETTLE[s.kind]) continue
    const hits = new Set<string>()
    for (const h of HEIGHTS) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        o.set(s.x, h, s.z)
        d.set(Math.cos(a), 0, Math.sin(a))
        ray.set(o, d)
        ray.far = HALF_WIDTH
        for (const hit of ray.intersectObjects(meshes, false)) hits.add(hit.object.name)
      }
    }
    if (hits.size) blocked.push({ where: `spot ${s.id}`, hits: [...hits] })
  }

  meshes.forEach((m, i) => ((m.material as Material).side = sides[i]))
  return { edges, blocked }
}
