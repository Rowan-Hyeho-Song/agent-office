// What the floor under an agent is (#316): the bare floor or a rug's top. The hover light on the floor (agent_i_floor,
// _floor_ring) sits a few mm above the floor; a rug is thicker than that, so over a rug the light went under it and the
// depth test hid it. The light now follows the top of what it is over, blended across a rug's edge so it never pops.

import { Raycaster, Vector3, type Mesh, type Object3D } from 'three'

/** a rug: its footprint (centre, half sizes in x / z) and the height of its top, m (world) */
export interface Rug {
  x: number
  z: number
  hx: number
  hz: number
  top: number
}

/** across a rug's edge the height blends over this width (m), centred on the edge */
export const EDGE_BAND = 0.06

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k))
  return x * x * (3 - 2 * x)
}

/**
 * The rugs of the model: the `slot_rug_*` empties give the footprint (extras size [w, h, d], axis-aligned) and the top is
 * measured on the baked meshes: the highest hit below 5 cm straight down at a few points inside the footprint (the meeting
 * rug has a table on its centre). Falls back to the slot's own thickness when nothing is hit. Once at load.
 */
export function readRugs(scene: Object3D): Rug[] {
  const slots: Object3D[] = []
  scene.traverse((o) => {
    if (o.name.startsWith('slot_rug')) slots.push(o)
  })
  if (!slots.length) return []
  const meshes: Mesh[] = []
  scene.traverse((o) => {
    if ((o as Mesh).isMesh && !/^agent_\d/.test(o.name) && !isUnderAgent(o)) meshes.push(o as Mesh)
  })
  scene.updateMatrixWorld(true)
  const ray = new Raycaster()
  const down = new Vector3(0, -1, 0)
  const at = new Vector3()
  const out: Rug[] = []
  for (const s of slots) {
    const size = sizeOf(s.userData.size)
    if (!size) continue
    const p = s.getWorldPosition(new Vector3())
    const hx = size[0] / 2
    const hz = size[2] / 2
    let top = -Infinity
    for (const [fx, fz] of [[0, 0], [0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]] as const) {
      ray.set(at.set(p.x + fx * hx, 1.5, p.z + fz * hz), down)
      for (const h of ray.intersectObjects(meshes, false)) if (h.point.y < 0.05) top = Math.max(top, h.point.y)
    }
    out.push({ x: p.x, z: p.z, hx, hz, top: Number.isFinite(top) ? top : p.y + size[1] })
  }
  return out
}

function isUnderAgent(o: Object3D) {
  for (let p = o.parent; p; p = p.parent) if (/^agent_\d/.test(p.name)) return true
  return false
}

function sizeOf(v: unknown): [number, number, number] | null {
  const a = typeof v === 'string' ? safe(v) : v
  return Array.isArray(a) && a.length >= 3 && a.every((n) => Number.isFinite(Number(n))) ? [Number(a[0]), Number(a[1]), Number(a[2])] : null
}

function safe(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * The floor's height at (x, z), m: 0 on the bare floor, a rug's top over it. Across an edge the height eases over
 * EDGE_BAND (half outside, half inside), so a light that crosses it rises and falls smoothly instead of jumping.
 */
export function groundAt(rugs: readonly Rug[], x: number, z: number): number {
  let y = 0
  for (const r of rugs) {
    // distance outside the rug's rectangle (negative inside: the distance to the nearest edge)
    const dx = Math.abs(x - r.x) - r.hx
    const dz = Math.abs(z - r.z) - r.hz
    const d = dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz)
    const w = smooth((EDGE_BAND / 2 - d) / EDGE_BAND)
    if (w > 0) y = Math.max(y, r.top * w)
  }
  return y
}
