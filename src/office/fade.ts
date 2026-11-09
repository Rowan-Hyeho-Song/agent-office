import { Mesh, type Material } from 'three'

/**
 * See-through for a fade group (#253): material.alphaHash (three's hashed alpha) with opacity, never `transparent`.
 * Each fragment is either kept or discarded by a hash of its object-space position against the opacity, so
 *  - nothing is blended and nothing is sorted: translucent parts that overlap (shelf, books, back panel) cannot flicker or swap
 *    order as the camera moves, depthWrite stays on and the parts behind show through the holes;
 *  - the pattern is fixed to the object (it does not crawl with the camera), so it is stable from frame to frame;
 *  - every part of the group at the same opacity gives the same density, so the group reads as one see-through piece.
 * A material that is already `transparent` (it has its own blending) keeps that and just scales its opacity.
 * The materials of a group are its own (walls.ts clones them), so fading never reaches other furniture sharing an atlas.
 */
interface Base {
  alphaHash: boolean
  transparent: boolean
  opacity: number
}

const baseOf = (mat: Material): Base => {
  const u = mat.userData as { fadeBase?: Base }
  return (u.fadeBase ??= { alphaHash: mat.alphaHash, transparent: mat.transparent, opacity: mat.opacity })
}

const materialsOf = (m: Mesh): Material[] => (Array.isArray(m.material) ? m.material : [m.material])

/** a material at `a` (1 = exactly as it was before any fade); only touches the material when something changed */
export function fadeMaterial(mat: Material, a: number) {
  const base = baseOf(mat)
  if (a >= 1) {
    if (mat.alphaHash !== base.alphaHash) {
      mat.alphaHash = base.alphaHash
      mat.needsUpdate = true
    }
    mat.opacity = base.opacity
    return
  }
  if (base.transparent) {
    mat.opacity = base.opacity * a
    return
  }
  if (!mat.alphaHash) {
    mat.alphaHash = true
    mat.needsUpdate = true
  }
  mat.opacity = a
}

/** every material of a mesh at `a` */
export const fadeMesh = (m: Mesh, a: number) => {
  for (const mat of materialsOf(m)) fadeMaterial(mat, a)
}
