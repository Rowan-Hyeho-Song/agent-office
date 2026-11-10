import { Box3, BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, Plane, Vector3, type Intersection, type Object3D } from 'three'
import { ROOM } from './room'
import { VIEW, WALLS, type Hidden, type Wall } from './view'

// Wall + fade bookkeeping for the cutaway (#111). Walls are lowered with one shared clipping plane per wall
// (keep y <= cutH); everything that belongs to a wall is clipped by the same plane, so it goes down with it.
// The glb says which node belongs to which wall: wall_n/e/s/w and every wall-mounted node carry extras `wall`
// (userData.wall; children inherit). Furniture touching the floor has none: never cut, only near/occluder-faded.
// Furniture is never faded or hidden (#253): the cutaway only lowers walls. Furniture boxes (FadeGroup) are for the camera clearance.
// Tall furniture standing with its back to a wall carries extras `backTo`: it is one group (the shelf and what belongs to it).

/** the bookshelf's fade group */
export const SHELF = 'shelf'

/** furniture whose glb has no `backTo` extra yet: node name -> wall it stands against */
export const BACK_TO_FALLBACK: Record<string, Wall> = { shelf: 'n' }

/** a loose lounge part that hangs near a wall plane above the floor goes with that wall (none in today's glb) */
export function wallOfLoose(box: Box3): Wall | null {
  if (box.min.y <= 0.3) return null
  const { hx, hz } = ROOM
  const d: [Wall, number][] = [['n', Math.abs(box.min.z + hz)], ['s', Math.abs(box.max.z - hz)], ['w', Math.abs(box.min.x + hx)], ['e', Math.abs(box.max.x - hx)]]
  const [w, dist] = d.reduce((m, x) => (x[1] < m[1] ? x : m))
  return dist < 0.25 ? w : null
}

/** things attached to a piece of furniture (desk screens and props, the tray's hit box, the shelf's binders and plates) take its opacity: node name -> fade group */
const FADE_NODE = /^(?:desk|screen_work|neon_desk|screen_cal)_(\d)(?:_|$)/
export const fadeGroupOfNode = (name: string) => {
  const m = FADE_NODE.exec(name)
  if (m) return `desk${m[1]}`
  // the lounge's own shelf_records / shelf_wall* are other furniture, in other places (one of them 9 m away, outside the room): each its own box. Grouped with the bookshelf they made one
  // box over most of the room that no camera could see through, so the tour skipped every ping-pong cut (#277)
  if (/^shelf_(records|wall)/.test(name)) return name
  if (/^(shelf_|screen_shelf_|hit_library$)/.test(name)) return SHELF
  return name === 'hit_approval' ? 'desk0' : null
}

// ---- shared state ---------------------------------------------------------------------------------------------------

/** each wall's current top height, and the clipping plane that follows it */
export const WALL_CUT: Record<Wall, number> = { n: VIEW.wallH, e: VIEW.wallH, s: VIEW.wallH, w: VIEW.wallH }
export const WALL_PLANES = Object.fromEntries(WALLS.map((w) => [w, [new Plane(new Vector3(0, -1, 0), VIEW.wallH)]])) as Record<Wall, Plane[]>
export const setWallCut = (w: Wall, h: number) => {
  WALL_CUT[w] = h
  WALL_PLANES[w][0].constant = h
}

/** which walls are lowered right now (set by the cutaway each frame) */
export const WALL_HIDDEN: Hidden = { n: false, e: false, s: false, w: false }

export const wallOf = (o: Object3D | null): Wall | null => {
  for (; o; o = o.parent) if (o.userData.wall) return o.userData.wall as Wall
  return null
}

/** false for a hit on the part of a lowered wall that is gone: it must not take the click */
export function hitAllowed(h: Intersection): boolean {
  const w = wallOf(h.object)
  if (w && h.point.y > WALL_CUT[w] + 0.002) return false
  return true
}

// ---- scene preparation ----------------------------------------------------------------------------------------------

export interface FadeGroup {
  id: string
  meshes: Mesh[]
  box: Box3
}

const meshesUnder = (o: Object3D) => {
  const out: Mesh[] = []
  o.traverse((c) => c instanceof Mesh && out.push(c))
  return out
}

/** a mesh of some of `src`'s triangles, sharing its vertex data, with its own material */
function subMesh(src: Mesh, tris: number[]): Mesh {
  const g = new BufferGeometry()
  for (const k of Object.keys(src.geometry.attributes)) g.setAttribute(k, src.geometry.attributes[k])
  const idx = new Uint32Array(tris.length * 3)
  const old = src.geometry.index
  tris.forEach((t, i) => {
    for (let j = 0; j < 3; j++) idx[i * 3 + j] = old ? old.getX(t * 3 + j) : t * 3 + j
  })
  g.setIndex(new BufferAttribute(idx, 1))
  g.computeBoundingSphere()
  g.computeBoundingBox()
  const m = new Mesh(g, Array.isArray(src.material) ? src.material[0].clone() : src.material.clone())
  m.userData = { ...src.userData }
  return m
}

const triCount = (m: Mesh) => (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3
/** connected parts of a mesh (vertices welded by position), merged when their boxes touch: one group of triangles per object */
function looseParts(src: Mesh): { tris: number[]; box: Box3 }[] {
  const p = src.geometry.getAttribute('position')
  const ix = src.geometry.index
  const n = triCount(src)
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)!
    for (let c = k; c !== r; ) {
      const nx = parent.get(c)!
      parent.set(c, r)
      c = nx
    }
    return r
  }
  const key = (i: number) => `${Math.round(p.getX(i) * 500)},${Math.round(p.getY(i) * 500)},${Math.round(p.getZ(i) * 500)}`
  const tk: string[] = []
  for (let t = 0; t < n; t++) {
    const k = [0, 1, 2].map((j) => key(ix ? ix.getX(t * 3 + j) : t * 3 + j))
    for (const x of k) if (!parent.has(x)) parent.set(x, x)
    parent.set(find(k[0]), find(k[1]))
    parent.set(find(k[1]), find(k[2]))
    tk.push(k[0])
  }
  const comps = new Map<string, { tris: number[]; box: Box3 }>()
  const v = new Vector3()
  for (let t = 0; t < n; t++) {
    const r = find(tk[t])
    let c = comps.get(r)
    if (!c) comps.set(r, (c = { tris: [], box: new Box3() }))
    c.tris.push(t)
    for (let j = 0; j < 3; j++) c.box.expandByPoint(v.fromBufferAttribute(p, ix ? ix.getX(t * 3 + j) : t * 3 + j))
  }
  // merge parts whose (slightly grown) boxes touch; flat floor stuff (rugs) stays on its own
  const list = [...comps.values()]
  const flat = (c: { box: Box3 }) => c.box.max.y < 0.12
  const groups: { tris: number[]; box: Box3 }[] = []
  for (const c of list) {
    if (flat(c)) {
      groups.push(c)
      continue
    }
    const into = groups.filter((g) => !flat(g) && g.box.clone().expandByScalar(0.03).intersectsBox(c.box))
    if (!into.length) {
      groups.push({ tris: [...c.tris], box: c.box.clone() })
      continue
    }
    const first = into[0]
    first.tris.push(...c.tris)
    first.box.union(c.box)
    for (const g of into.slice(1)) {
      first.tris.push(...g.tris)
      first.box.union(g.box)
      groups.splice(groups.indexOf(g), 1)
    }
  }
  return groups
}

/** tag the wall-mounted nodes, split the merged baked meshes by wall and the lounge into objects, build the fade groups */
export function prepareView(scene: Object3D): FadeGroup[] {
  if (scene.userData.fadeGroups) return scene.userData.fadeGroups as FadeGroup[]
  const groups: FadeGroup[] = []
  scene.userData.fadeGroups = groups
  const byName = new Map<string, Object3D>()
  scene.traverse((o) => o.name && !byName.has(o.name) && byName.set(o.name, o))

  // furniture without a `backTo` extra yet
  for (const [name, w] of Object.entries(BACK_TO_FALLBACK)) {
    const o = byName.get(name)
    if (o && !o.userData.backTo) o.userData.backTo = w
  }

  const byId = new Map<string, Mesh[]>()
  const toGroup = (id: string, m: Mesh) => {
    byId.set(id, [...(byId.get(id) ?? []), m])
  }

  // 1. the lounge atlas is one mesh: cut it into objects; hung ones join their wall, the rest are fade groups
  const lounge = byName.get('lounge')
  for (const m of lounge ? meshesUnder(lounge) : []) {
    const parts = looseParts(m)
    let k = 0
    for (const part of parts) {
      const mesh = subMesh(m, part.tris)
      m.parent?.add(mesh)
      const w = wallOfLoose(part.box)
      if (w) mesh.userData.wall = w
      else if (part.box.max.y >= 0.12) {
        const id = `lounge${k++}`
        groups.push({ id, meshes: [mesh], box: part.box })
      }
    }
    m.visible = false
  }

  // 2. desk things are one group with their desk (its clearance box); `backTo` furniture is one group with the things attached to it
  scene.traverse((o) => {
    const id = fadeGroupOfNode(o.name) ?? (o.userData.backTo && o.name ? o.name : null)
    if (!id) return
    if (o instanceof Mesh) toGroup(id, o)
    else if (o.userData.backTo) for (const m of meshesUnder(o)) toGroup(id, m)
  })
  scene.updateMatrixWorld(true)
  for (const [id, meshes] of byId) {
    const box = new Box3()
    for (const m of meshes) box.union(new Box3().setFromObject(m))
    groups.push({ id, meshes, box })
  }

  // 3. wall and fade meshes get their own material (the exported lit ones are shared with other meshes)
  scene.traverse((o) => {
    if (!(o instanceof Mesh) || !(o.material instanceof MeshStandardMaterial)) return
    if (wallOf(o)) o.material = o.material.clone()
  })
  return groups
}
