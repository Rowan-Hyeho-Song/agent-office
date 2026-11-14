import { Box3, type Object3D, type Vector3 } from 'three'
import { wallRect } from './room'
import { WALL_CUT } from './walls'
import { VIEW, WALLS, keepClear, type ClearBox } from './view'

// What the free camera keeps clear of (#208): the furniture boxes (registered once by the occluder fade, same boxes),
// the robots (moving: re-measured each call) and the four walls at their current height. The rule itself is
// view.ts keepClear.

const furniture: ClearBox[] = []
export const clearIds: string[] = []
export const setClearFurniture = (groups: readonly { id: string; box: Box3 }[]) => {
  furniture.length = 0
  clearIds.length = 0
  for (const { id, box: b } of groups) {
    furniture.push({ min: b.min.toArray() as [number, number, number], max: b.max.toArray() as [number, number, number] })
    clearIds.push(id)
  }
}
/** the furniture boxes (no walls, no robots): what a scripted camera's line of sight must not cross (#253) */
export const furnitureBoxes = (): readonly ClearBox[] => furniture
/** dev only (screenshot scripts): the furniture boxes by fade-group id */
export const clearFurnitureForDev = () => furniture.map((b, i) => ({ id: clearIds[i], ...b }))

const tmp = new Box3()
const wallBoxes = (): ClearBox[] =>
  WALLS.map((w) => {
    const r = wallRect(w)
    return { min: [r.cx - r.sx / 2, 0, r.cz - r.sz / 2], max: [r.cx + r.sx / 2, WALL_CUT[w], r.cz + r.sz / 2], slide: true } as ClearBox
  })

/**
 * The crowns of the big leafy plants: not furniture (the free camera may brush through leaves), but a scripted camera must not look
 * through them (#397: the coffee bar's cut was half hidden behind the fiddle-leaf fig). Their boxes above the pot, from the model.
 */
export const LEAFY = ['plant_corner'] as const
const LEAF_FROM_Y = 0.6
export function leafBoxes(scene: Object3D): ClearBox[] {
  const out: ClearBox[] = []
  for (const name of LEAFY) {
    const o = scene.getObjectByName(name)
    if (!o) continue
    tmp.setFromObject(o)
    if (tmp.isEmpty() || tmp.max.y <= LEAF_FROM_Y) continue
    out.push({ min: [tmp.min.x, Math.max(tmp.min.y, LEAF_FROM_Y), tmp.min.z], max: tmp.max.toArray() as [number, number, number] })
  }
  return out
}

/** a robot's body box (its root node, re-measured) */
export function robotBox(group: Object3D): ClearBox {
  tmp.setFromObject(group)
  return { min: tmp.min.toArray() as [number, number, number], max: tmp.max.toArray() as [number, number, number] }
}
/** the upper part of a robot's box: its head (and what sits on it) */
export const headBox = (b: ClearBox, share = 0.4): ClearBox => ({ min: [b.min[0], b.max[1] - (b.max[1] - b.min[1]) * share, b.min[2]], max: [b.max[0], b.max[1], b.max[2]] })

/** every box the camera keeps clear of: furniture, robots (their root nodes, re-measured) and the walls at their current height */
export function clearBoxes(robots: Iterable<{ visible: boolean; group: Object3D }> = []): ClearBox[] {
  const boxes: ClearBox[] = [...furniture, ...wallBoxes()]
  for (const r of robots) {
    if (!r.visible) continue
    tmp.setFromObject(r.group)
    if (!tmp.isEmpty()) boxes.push({ min: tmp.min.toArray() as [number, number, number], max: tmp.max.toArray() as [number, number, number] })
  }
  return boxes
}

/** the camera position kept `VIEW.clear.margin` clear of furniture, robots (their root nodes) and walls */
export function clearCamera(cam: Vector3, target: Vector3, robots: Iterable<{ visible: boolean; group: Object3D }> = []): Vector3 {
  const p = keepClear(cam.toArray() as [number, number, number], target.toArray() as [number, number, number], clearBoxes(robots), VIEW.clear.margin)
  return cam.set(p[0], p[1], p[2])
}
