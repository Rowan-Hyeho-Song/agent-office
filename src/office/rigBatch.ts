// #676 (draw calls) many moving meshes drawn in a few calls: every opaque mesh under the given roots that shares a material with others is drawn by
// one SkinnedMesh whose bones are those meshes themselves. The code keeps moving, showing and hiding its nodes exactly as before (a robot's fingers,
// wrists and head; a binder pulled out of its row, shown, hidden): each vertex follows its own mesh's world matrix, and the vertices of a mesh that
// is hidden (it or a parent of it) collapse to a point, so the picture is the same. The meshes stay where they are (the rig, the grip fits and the
// tests read them) but leave the camera's layer, so they are not drawn twice.
// A robot: about 92 calls (two hands of 38 parts, the head's 6, …) → one per shared material (5). The shelf's binders: their rings and labels.

import { Matrix4, Mesh, Skeleton, type Bone, SkinnedMesh, Uint16BufferAttribute, Float32BufferAttribute, type BufferGeometry, type Material, type Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** the layer the batched meshes move to: not drawn by the camera (layer 0), not hit by a default ray */
export const BATCHED_LAYER = 31

/** a robot's parts that change on their own (faded, recoloured each frame, a canvas face, the post-its' count): never batched */
export const ROBOT_OWN = /_(face|tip|glow|orbit|ear_glow|fork|ring|beam|floor|floor_ring|postit_\d+)$/

export interface RigBatch {
  /** the drawn meshes (one per material) */
  meshes: SkinnedMesh[]
  /** how many source meshes they stand for */
  sources: number
  dispose(): void
}

const isOwn = (o: Object3D, own: RegExp | null) => {
  if (!own) return false
  for (let p: Object3D | null = o; p; p = p.parent) if (own.test(p.name)) return true
  return false
}

/** shown on screen: it and every parent of it visible */
const shown = (o: Object3D) => {
  for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return false
  return true
}

/** the meshes under `roots` that can be drawn together: single material, opaque, not one of the parts `own` names (or under one) */
export function batchable(roots: Object3D[], own: RegExp | null = ROBOT_OWN): Mesh[] {
  const out: Mesh[] = []
  const seen = new Set<Object3D>()
  for (const r of roots)
    r.traverse((o) => {
      const m = o as Mesh
      if (seen.has(o) || !m.isMesh || (m as SkinnedMesh).isSkinnedMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh) return
      seen.add(o)
      if (Array.isArray(m.material) || !m.material || m.material.transparent || isOwn(o, own)) return
      if (!m.geometry.getAttribute('position')) return
      out.push(m)
    })
  return out
}

/** meshes that one draw can take: the same material, the same attributes (names, types, sizes), indexed alike, the same shadow flags */
const keyOf = (m: Mesh) => {
  const g = m.geometry
  const attrs = Object.keys(g.attributes)
    .sort()
    .map((k) => {
      const a = g.getAttribute(k) as { array: ArrayLike<number>; itemSize: number; normalized: boolean }
      return `${k}:${a.array.constructor.name}:${a.itemSize}:${a.normalized ? 1 : 0}`
    })
    .join(',')
  return `${(m.material as Material).uuid}|${attrs}|${g.index ? 'i' : 'n'}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`
}

/** bones = the source meshes; a hidden one (or one under a hidden parent) has its bone zeroed: its vertices collapse to one point, nothing drawn */
class ShownSkeleton extends Skeleton {
  update() {
    super.update()
    const out = this.boneMatrices!
    for (let i = 0; i < this.bones.length; i++) if (!shown(this.bones[i])) out.fill(0, i * 16, i * 16 + 16)
  }
}

/**
 * Draw the batchable meshes under `roots` as one SkinnedMesh per material, added to `parent` (the scene, at the identity). Each source mesh is a
 * bone whose inverse is the identity: a vertex in its mesh's own space is put where that mesh's world matrix puts it. Groups of one mesh are left
 * alone. Returns null when nothing is merged.
 */
export function batchRig(parent: Object3D, roots: Object3D[], name: string, own: RegExp | null = ROBOT_OWN): RigBatch | null {
  const groups = new Map<string, Mesh[]>()
  for (const m of batchable(roots, own)) {
    const k = keyOf(m)
    const g = groups.get(k)
    if (g) g.push(m)
    else groups.set(k, [m])
  }
  const meshes: SkinnedMesh[] = []
  const hidden: Mesh[] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const geos: BufferGeometry[] = list.map((m, bone) => {
      const g = m.geometry.clone()
      // morph targets and groups are not kept (none on these parts); every vertex wholly on its own mesh's bone
      g.morphAttributes = {}
      g.clearGroups()
      const n = g.getAttribute('position').count
      const idx = new Uint16Array(n * 4)
      const w = new Float32Array(n * 4)
      for (let i = 0; i < n; i++) {
        idx[i * 4] = bone
        w[i * 4] = 1
      }
      g.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4))
      g.setAttribute('skinWeight', new Float32BufferAttribute(w, 4))
      return g
    })
    const merged = mergeGeometries(geos, false)
    for (const g of geos) g.dispose()
    if (!merged) continue
    const sm = new SkinnedMesh(merged, list[0].material)
    sm.name = `${name}_batch_${(list[0].material as Material).name || meshes.length}`
    sm.castShadow = list[0].castShadow
    sm.receiveShadow = list[0].receiveShadow
    // it moves only through its bones: no transform of its own, no bounds to cull by (the hands walk all over the office)
    sm.matrixAutoUpdate = false
    sm.matrix.identity()
    sm.frustumCulled = false
    // the bones are the meshes (a Skeleton reads only their world matrices)
    sm.bind(new ShownSkeleton(list as unknown as Bone[], list.map(() => new Matrix4())), new Matrix4())
    sm.userData.batchOf = list.length
    // a ray goes by the meshes it stands for (they keep their own bounds), never by this
    sm.raycast = () => {}
    parent.add(sm)
    sm.updateMatrixWorld(true)
    meshes.push(sm)
    for (const m of list) {
      m.layers.set(BATCHED_LAYER)
      hidden.push(m)
    }
  }
  if (!meshes.length) return null
  return {
    meshes,
    sources: hidden.length,
    dispose() {
      for (const sm of meshes) {
        sm.removeFromParent()
        sm.geometry.dispose()
        sm.skeleton.dispose()
      }
      for (const m of hidden) m.layers.set(0)
    },
  }
}
