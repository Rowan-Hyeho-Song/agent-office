// The walkable floor (#138): the room split into square cells, furniture (floorMask.ts) inflated by the body radius
// blocked, plus a short carved dock in front of every spot that sits on furniture (desk seats, sofa, stools, the
// table ends). Agents path-find over these cells (A*, 8 directions, string-pulling) and the traffic planner reserves
// cells in time (traffic.ts). The nav_* spots stay as destinations only. Pure: no three.js.

import { dist, type NavGraph } from './nav'
import { inSofaRow, SOFA_ROW, type SofaRow } from './sofaRow'

export interface Footprint {
  cell: number
  minX: number
  minZ: number
  w: number
  h: number
  /** 1 = furniture */
  bits: Uint8Array
  /** the sofa's knee row (zone_sofa_row of the glb, #341): travels with the footprint so every grid built from it has it */
  zone?: SofaRow
}

export const GRID = {
  /** cell size, m */
  cell: 0.15,
  /** furniture and walls are kept this far from an agent's centre (the body radius R) */
  inflate: 0.3,
  /** a dock carved to a spot on furniture: radius round the spot and half-width of the way out */
  dockR: 0.32,
  dockHalf: 0.3,
}

export interface Grid {
  cell: number
  minX: number
  minZ: number
  w: number
  h: number
  /** 1 = an agent's centre may not be here */
  blocked: Uint8Array
  /** 1 = furniture itself (not inflated) at this cell */
  raw: Uint8Array
  /** 1 = carved dock cell */
  dock: Uint8Array
  /** the sofa's knee row (#341): furniture clearance is relaxed inside it, and the planner's side-step rule applies there */
  zone?: SofaRow
}

export function decodeFootprint(d: { cell: number; minX: number; minZ: number; w: number; h: number; b64: string; zone?: SofaRow }): Footprint {
  const bin = atob(d.b64)
  const bits = new Uint8Array(d.w * d.h)
  for (let k = 0; k < bits.length; k++) bits[k] = (bin.charCodeAt(k >> 3) >> (k & 7)) & 1
  return { cell: d.cell, minX: d.minX, minZ: d.minZ, w: d.w, h: d.h, bits, zone: d.zone }
}

/** a footprint from rectangles (x0, z0, x1, z1), for tests and tiny rooms */
export function footprintFromRects(hx: number, hz: number, rects: [number, number, number, number][], cell = 0.05): Footprint {
  const w = Math.ceil((2 * hx) / cell)
  const h = Math.ceil((2 * hz) / cell)
  const bits = new Uint8Array(w * h)
  for (const [x0, z0, x1, z1] of rects) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = -hx + (i + 0.5) * cell
        const z = -hz + (j + 0.5) * cell
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) bits[j * w + i] = 1
      }
    }
  }
  return { cell, minX: -hx, minZ: -hz, w, h, bits }
}

/** the row comes from the footprint unless one is passed */
export function buildGrid(fp: Footprint, g?: NavGraph, opts: Partial<typeof GRID> = {}, zone: SofaRow | undefined = fp.zone): Grid {
  const o = { ...GRID, ...opts }
  const cell = o.cell
  const w = Math.floor((fp.w * fp.cell) / cell + 1e-9)
  const h = Math.floor((fp.h * fp.cell) / cell + 1e-9)
  const raw = new Uint8Array(w * h)
  const blocked = new Uint8Array(w * h)
  const dock = new Uint8Array(w * h)
  const ratio = Math.round(cell / fp.cell)
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let hit = 0
      for (let b = 0; b < ratio && !hit; b++) for (let a = 0; a < ratio; a++) if (fp.bits[(j * ratio + b) * fp.w + i * ratio + a]) hit = 1
      raw[j * w + i] = hit
    }
  }
  // inside the sofa's knee row the furniture is kept less than a body radius away so a body fits the 0.75 m row (walls keep o.inflate)
  const rowInflate = Math.min(o.inflate, SOFA_ROW.clearance)
  const reach = Math.ceil(o.inflate / fp.cell)
  const maxX = fp.minX + fp.w * fp.cell
  const maxZ = fp.minZ + fp.h * fp.cell
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = fp.minX + (i + 0.5) * cell
      const z = fp.minZ + (j + 0.5) * cell
      // walls: keep R from the room's rim
      let bad = x - fp.minX < o.inflate || maxX - x < o.inflate || z - fp.minZ < o.inflate || maxZ - z < o.inflate
      if (!bad) {
        const r2 = (zone && inSofaRow(zone, x, z) ? rowInflate : o.inflate) ** 2
        const ci = Math.floor((x - fp.minX) / fp.cell)
        const cj = Math.floor((z - fp.minZ) / fp.cell)
        for (let b = -reach; b <= reach && !bad; b++) {
          for (let a = -reach; a <= reach; a++) {
            const ii = ci + a
            const jj = cj + b
            if (ii < 0 || jj < 0 || ii >= fp.w || jj >= fp.h || !fp.bits[jj * fp.w + ii]) continue
            const dx = fp.minX + (ii + 0.5) * fp.cell - x
            const dz = fp.minZ + (jj + 0.5) * fp.cell - z
            if (dx * dx + dz * dz <= r2) {
              bad = true
              break
            }
          }
        }
      }
      blocked[j * w + i] = bad ? 1 : 0
    }
  }
  const grid: Grid = { cell, minX: fp.minX, minZ: fp.minZ, w, h, blocked, raw, dock, zone }
  if (g) carveDocks(grid, g, o)
  return grid
}

export const cellAt = (g: Grid, x: number, z: number): number => {
  const i = Math.floor((x - g.minX) / g.cell)
  const j = Math.floor((z - g.minZ) / g.cell)
  return i < 0 || j < 0 || i >= g.w || j >= g.h ? -1 : j * g.w + i
}

export const centre = (g: Grid, c: number) => ({ x: g.minX + ((c % g.w) + 0.5) * g.cell, z: g.minZ + (Math.floor(c / g.w) + 0.5) * g.cell })

/** open a dock for every spot whose own cell is blocked: a disc round it and a lane along each nav edge it has */
function carveDocks(grid: Grid, g: NavGraph, o: typeof GRID) {
  const carve = (px: number, pz: number, qx: number, qz: number, half: number) => {
    const len = Math.hypot(qx - px, qz - pz)
    for (let k = 0; k < grid.w * grid.h; k++) {
      const { x, z } = centre(grid, k)
      let d: number
      if (len < 1e-9) d = Math.hypot(x - px, z - pz)
      else {
        const t = Math.max(0, Math.min(1, ((x - px) * (qx - px) + (z - pz) * (qz - pz)) / (len * len)))
        d = Math.hypot(x - (px + (qx - px) * t), z - (pz + (qz - pz) * t))
      }
      if (d <= half) {
        if (grid.blocked[k]) grid.dock[k] = 1
        grid.blocked[k] = 0
      }
    }
  }
  for (const id of Object.keys(g.spots).sort()) {
    const s = g.spots[id]
    const c = cellAt(grid, s.x, s.z)
    if (c < 0 || !grid.blocked[c]) continue
    carve(s.x, s.z, s.x, s.z, o.dockR)
    // along every edge of the spot, at most 1.2 m out
    for (const n of g.adj[id] ?? []) {
      const t = g.spots[n]
      const d = dist(s, t)
      const stop = Math.min(d, 1.2)
      carve(s.x, s.z, s.x + ((t.x - s.x) / d) * stop, s.z + ((t.z - s.z) / d) * stop, o.dockHalf)
    }
  }
}

/** 8 neighbours in a fixed order (the tie-break rule): [di, dj]; the first four are orthogonal */
export const DIRS: readonly [number, number][] = [
  [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1],
]

/** a cell's neighbour in direction d, if walkable and (for a diagonal) both orthogonal cells are too; else -1 */
export function step(g: Grid, c: number, d: number, extra?: Uint8Array): number {
  const [di, dj] = DIRS[d]
  const i = (c % g.w) + di
  const j = Math.floor(c / g.w) + dj
  if (i < 0 || j < 0 || i >= g.w || j >= g.h) return -1
  const n = j * g.w + i
  if (g.blocked[n] || extra?.[n]) return -1
  if (di && dj) {
    const a = j * g.w + (i - di)
    const b = (j - dj) * g.w + i
    if (g.blocked[a] || g.blocked[b] || extra?.[a] || extra?.[b]) return -1
  }
  return n
}

/** the walkable cell nearest to (x, z) (the cell itself if it is walkable) */
export function nearestWalkable(g: Grid, x: number, z: number): number {
  let best = -1
  let bd = Infinity
  for (let c = 0; c < g.w * g.h; c++) {
    if (g.blocked[c]) continue
    const p = centre(g, c)
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bd) {
      bd = d
      best = c
    }
  }
  return best
}

/** octile distance field from the goal over walkable cells, in metres (Infinity = unreachable) */
export function distanceField(g: Grid, goal: number, extra?: Uint8Array): Float64Array {
  const D = new Float64Array(g.w * g.h).fill(Infinity)
  if (goal < 0) return D
  const heap: [number, number][] = []
  const push = (e: [number, number]) => {
    heap.push(e)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= e[0]) break
      heap[i] = heap[p]
      i = p
    }
    heap[i] = e
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= heap.length) break
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++
        if (last[0] <= heap[c][0]) break
        heap[i] = heap[c]
        i = c
      }
      heap[i] = last
    }
    return top
  }
  D[goal] = 0
  push([0, goal])
  const diag = Math.SQRT2 * g.cell
  while (heap.length) {
    const [d, c] = pop()
    if (d > D[c]) continue
    for (let k = 0; k < 8; k++) {
      const n = step(g, c, k, extra)
      if (n < 0) continue
      const nd = d + (k < 4 ? g.cell : diag)
      if (nd < D[n]) {
        D[n] = nd
        push([nd, n])
      }
    }
  }
  return D
}

/** can an agent's centre go straight from a to b without entering a blocked cell? */
export function lineClear(g: Grid, a: { x: number; z: number }, b: { x: number; z: number }, extra?: Uint8Array): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z)
  const n = Math.max(1, Math.ceil(len / (g.cell / 3)))
  for (let k = 0; k <= n; k++) {
    const c = cellAt(g, a.x + ((b.x - a.x) * k) / n, a.z + ((b.z - a.z) * k) / n)
    if (c < 0 || g.blocked[c] || extra?.[c]) return false
  }
  return true
}

/**
 * Shortest route between two points: A* over the cells (8 directions, ties broken by the fixed neighbour order),
 * then string-pulled into a few straight legs. null when the goal cannot be reached.
 */
export function findPath(g: Grid, from: { x: number; z: number }, to: { x: number; z: number }, extra?: Uint8Array): { x: number; z: number }[] | null {
  const s = cellAt(g, from.x, from.z)
  const e = cellAt(g, to.x, to.z)
  if (s < 0 || e < 0) return null
  const D = distanceField(g, e, extra)
  if (!Number.isFinite(D[s])) return null
  const cells = [s]
  let c = s
  while (c !== e) {
    let best = -1
    let bd = D[c]
    for (let k = 0; k < 8; k++) {
      const n = step(g, c, k, extra)
      if (n >= 0 && D[n] < bd - 1e-6) {
        bd = D[n]
        best = n
      }
    }
    if (best < 0) return null
    cells.push(best)
    c = best
  }
  const pts = cells.map((q) => centre(g, q))
  pts[0] = { x: from.x, z: from.z }
  pts[pts.length - 1] = { x: to.x, z: to.z }
  // string pulling
  const out = [pts[0]]
  let i = 0
  while (i < pts.length - 1) {
    let j = pts.length - 1
    while (j > i + 1 && !lineClear(g, pts[i], pts[j], extra)) j--
    out.push(pts[j])
    i = j
  }
  return out
}
