// #137 ② C: at the board the agent speaks from its face screen as the visitor sees it.
import { describe, expect, it } from 'vitest'
import { BoxGeometry, Mesh, PerspectiveCamera } from 'three'
import { faceScreenRect } from './bubbleAnchor'

describe('faceScreenRect', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 800 }
  const cam = new PerspectiveCamera(40, 1000 / 800, 0.05, 50)
  cam.position.set(0, 0, 2)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  it('the face on the screen: its edges around its middle; behind the camera: none', () => {
    const face = new Mesh(new BoxGeometry(0.4, 0.2, 0.01))
    face.position.set(0, 0.3, 0)
    face.updateMatrixWorld()
    const a = faceScreenRect(face, cam, rect)!
    expect(a.left).toBeLessThan(500)
    expect(a.right).toBeGreaterThan(500)
    expect((a.left + a.right) / 2).toBeCloseTo(500, 0)
    expect(a.top).toBeLessThan(a.bottom)
    expect(a.bottom).toBeLessThan(400) // the face is above the middle, so its lower edge is too
    face.position.set(0, 0.5, 0)
    face.updateMatrixWorld()
    expect(faceScreenRect(face, cam, rect)!.bottom).toBeLessThan(a.bottom) // higher face, higher edge
    face.position.set(0, 0, 3)
    face.updateMatrixWorld()
    expect(faceScreenRect(face, cam, rect)).toBeNull()
  })
})
