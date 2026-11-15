// #137 ② C (play.md 2.5): at the board the visitor's camera looks down past the agent's face screen, and the point the agent's bubbles
// hang from (0.3 m above the head) is above the top of the screen, where a bubble is not drawn at all. While the visitor plays, the agent's
// lines ("졌어요! 한 판 더?", "제가 이겼네요 :)") stand by the face screen instead: on a wide screen at its lower right corner (beside the
// face, above the board), on a phone over its top edge (no room beside it; the eyes and the clapping hands stay clear).

import { Vector3, type Camera, type Mesh } from 'three'

const v = new Vector3()

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The face screen's extent as the visitor sees it, in CSS pixels of `rect` (the canvas): its vertices projected (not its box: the screen
 * leans, and a box's far corners seen from above would stretch it up and down). null when it is behind the camera.
 */
export function faceScreenRect(face: Mesh, camera: Camera, rect: { left: number; top: number; width: number; height: number }): ScreenRect | null {
  const pos = face.geometry?.getAttribute('position')
  if (!pos || pos.count === 0) return null
  const out = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(face.matrixWorld).project(camera)
    if (v.z >= 1) return null
    const x = rect.left + ((v.x + 1) / 2) * rect.width
    const y = rect.top + ((1 - v.y) / 2) * rect.height
    out.left = Math.min(out.left, x)
    out.right = Math.max(out.right, x)
    out.top = Math.min(out.top, y)
    out.bottom = Math.max(out.bottom, y)
  }
  return out
}
