// A node's box in its own frame, from its meshes' geometry (#370 C): a world box taken back into a turned frame is wider than the thing.
import { Box3, type Mesh, type Object3D } from 'three'

export function localBox(o: Object3D): Box3 {
  o.updateWorldMatrix(true, true)
  const inv = o.matrixWorld.clone().invert()
  const out = new Box3()
  o.traverse((m) => {
    const g = (m as Mesh).geometry
    if (!(m as Mesh).isMesh || !g) return
    if (!g.boundingBox) g.computeBoundingBox()
    out.union(g.boundingBox!.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)))
  })
  return out
}
