// #137 ② C: at the board the agent speaks from its face screen's lower right corner as the visitor sees it.
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Mesh, PerspectiveCamera } from 'three'
import { faceCornerAnchor } from './bubbleAnchor'

describe('faceCornerAnchor', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 800 }
  const cam = new PerspectiveCamera(40, 1000 / 800, 0.05, 50)
  cam.position.set(0, 0, 2)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  it('the face to the screen: its right and lower edge; behind the camera: none', () => {
    const face = new Mesh(new BoxGeometry(0.4, 0.2, 0.01))
    face.position.set(0, 0.3, 0)
    face.updateMatrixWorld()
    const a = faceCornerAnchor(face, cam, rect)!
    expect(a.x).toBeGreaterThan(500) // right of the middle
    expect(a.y).toBeLessThan(400) // the face is above the middle, so its lower edge is too
    face.position.set(0, 0.5, 0)
    face.updateMatrixWorld()
    expect(faceCornerAnchor(face, cam, rect)!.y).toBeLessThan(a.y) // higher face, higher corner
    face.position.set(0, 0, 3)
    face.updateMatrixWorld()
    expect(faceCornerAnchor(face, cam, rect)).toBeNull()
  })
})
