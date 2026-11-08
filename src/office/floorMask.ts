// Furniture footprint on the floor (#138): the baked meshes' triangles that sit in the height band an agent's body
// occupies are rasterized onto a fine grid (hollow shapes are filled), once at load. The agents' walkable grid
// (grid.ts) is derived from this. three.js only here; the result is plain data (a committed snapshot of it lets the
// tests and the planner run without the glb: footprint.data.ts, regenerated with ?debug=1 -> __office.footprint()).

import { BufferGeometry, Vector3, type Mesh, type Object3D } from 'three'
import { ROOM } from './room'
import type { Footprint } from './grid'

/** the body spans roughly this height band (pod to head); furniture entirely above or below it is ignored */
export const BAND = { lo: 0.15, hi: 1.05 }

/** shell, wall decor and floor pads are not obstacles (the walls are the floor rect itself) */
const SKIP = /^(room|wall.*|pad_.*|boards|door)$/

type Box = { at: [number, number, number]; size: [number, number, number] }

/** slot_* empties with extras core = {at, size} (the furniture body without the usable spot, Blender #151); none in older models */
function readCores(root: Object3D | undefined): { core: Box; full: Box | null }[] {
  const out: { core: Box; full: Box | null }[] = []
  root?.traverse((o) => {
    if (!o.name.startsWith('slot_')) return
    const core = parseBox(o.userData.core)
    if (core) out.push({ core, full: parseBox({ at: o.userData.at ?? [o.position.x, o.position.y, o.position.z], size: o.userData.size }) })
  })
  return out
}

function parseBox(v: unknown): Box | null {
  const b = (typeof v === 'string' ? safeJson(v) : v) as Partial<Box> | null
  if (!b || !Array.isArray(b.at) || !Array.isArray(b.size) || b.at.length < 3 || b.size.length < 3) return null
  const at = b.at.map(Number) as Box['at']
  const size = b.size.map(Number) as Box['size']
  return [...at, ...size].every(Number.isFinite) ? { at, size } : null
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/** meshes' triangles in the body band; a slot with a `core` extra is blocked by its core only. `root` = the scene (for the slots). */
export function rasterFootprint(meshes: Mesh[], cell = 0.05, root?: Object3D): Footprint {
  const minX = -ROOM.hx
  const minZ = -ROOM.hz
  const w = Math.ceil((2 * ROOM.hx) / cell)
  const h = Math.ceil((2 * ROOM.hz) / cell)
  const bits = new Uint8Array(w * h)
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const put = (x0: number, x1: number, z0: number, z1: number) => {
    const i0 = Math.max(0, Math.floor((x0 - minX) / cell))
    const i1 = Math.min(w - 1, Math.floor((x1 - minX) / cell))
    const j0 = Math.max(0, Math.floor((z0 - minZ) / cell))
    const j1 = Math.min(h - 1, Math.floor((z1 - minZ) / cell))
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bits[j * w + i] = 1
  }
  for (const m of meshes) {
    if (SKIP.test(m.name)) continue
    m.updateWorldMatrix(true, false)
    const geo = m.geometry as BufferGeometry
    const pos = geo.getAttribute('position')
    const idx = geo.getIndex()
    const n = idx ? idx.count : pos.count
    for (let t = 0; t < n; t += 3) {
      const ia = idx ? idx.getX(t) : t
      const ib = idx ? idx.getX(t + 1) : t + 1
      const ic = idx ? idx.getX(t + 2) : t + 2
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld)
      b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld)
      c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld)
      const y0 = Math.min(a.y, b.y, c.y)
      const y1 = Math.max(a.y, b.y, c.y)
      if (y1 < BAND.lo || y0 > BAND.hi) continue
      put(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z))
    }
  }
  // slots that declare a core: their full box is cleared and the core blocks instead
  for (const { core, full } of readCores(root)) {
    if (full && full.size[0] > 0) {
      const x0 = Math.floor((full.at[0] - full.size[0] / 2 - minX) / cell)
      const x1 = Math.floor((full.at[0] + full.size[0] / 2 - minX) / cell)
      const z0 = Math.floor((full.at[2] - full.size[2] / 2 - minZ) / cell)
      const z1 = Math.floor((full.at[2] + full.size[2] / 2 - minZ) / cell)
      for (let j = Math.max(0, z0); j <= Math.min(h - 1, z1); j++) for (let i = Math.max(0, x0); i <= Math.min(w - 1, x1); i++) bits[j * w + i] = 0
    }
    put(core.at[0] - core.size[0] / 2, core.at[0] + core.size[0] / 2, core.at[2] - core.size[2] / 2, core.at[2] + core.size[2] / 2)
  }
  // fill what the outline encloses (a desk modelled as hollow sides is still solid to walk through)
  const out = new Uint8Array(w * h)
  const stack: number[] = []
  const seen = new Uint8Array(w * h)
  const visit = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return
    const k = j * w + i
    if (seen[k] || bits[k]) return
    seen[k] = 1
    stack.push(k)
  }
  for (let i = 0; i < w; i++) {
    visit(i, 0)
    visit(i, h - 1)
  }
  for (let j = 0; j < h; j++) {
    visit(0, j)
    visit(w - 1, j)
  }
  while (stack.length) {
    const k = stack.pop()!
    const i = k % w
    const j = (k - i) / w
    visit(i + 1, j)
    visit(i - 1, j)
    visit(i, j + 1)
    visit(i, j - 1)
  }
  for (let k = 0; k < w * h; k++) out[k] = seen[k] ? 0 : 1
  return { cell, minX, minZ, w, h, bits: out }
}
