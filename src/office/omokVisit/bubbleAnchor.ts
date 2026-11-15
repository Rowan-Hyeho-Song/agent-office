// #137 ② C (play.md 2.5): at the board the visitor's camera looks down past the agent's face screen, and the point the agent's bubbles
// hang from (0.3 m above the head) is above the top of the screen, where a bubble is not drawn at all. While the visitor plays, the agent's
// lines ("졌어요! 한 판 더?", "제가 이겼네요 :)") stand at the face screen's lower right corner instead: beside the face, above the board.

import { Box3, Vector3, type Camera, type Object3D } from 'three'

const box = new Box3()
const corner = new Vector3()

/**
 * The face screen's lower right corner as the visitor sees it, in CSS pixels of `rect` (the canvas): the rightmost and lowest of the
 * face's box corners on the screen. null when the face is behind the camera.
 */
export function faceCornerAnchor(face: Object3D, camera: Camera, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  box.setFromObject(face)
  if (box.isEmpty()) return null
  let x = -Infinity
  let y = -Infinity
  for (let k = 0; k < 8; k++) {
    corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera)
    if (corner.z >= 1) return null
    x = Math.max(x, rect.left + ((corner.x + 1) / 2) * rect.width)
    y = Math.max(y, rect.top + ((1 - corner.y) / 2) * rect.height)
  }
  return { x, y }
}
