/// <reference types="node" />
// 메시's orbiting cube never covers the face screen seen from the front (#193): over a full orbit, whenever the cube is in front of the screen
// plane, its box is clear of the screen's rectangle.
import { Box3 } from 'three'
import { describe, expect, it } from 'vitest'
import { AgentRig, buildRig, ORBIT_LIFT, ORBIT_TILT } from './rig'
import { loadOffice, stubCanvas } from './glbLoad'

stubCanvas()

describe('the orbit leaves the face free', async () => {
  const { scene, nodes } = await loadOffice()
  const parts = buildRig(scene, nodes, 1)
  new AgentRig('agent_1', 1, parts, '#8c8cff')
  new AgentRig('agent_1', 1, parts, '#8c8cff') // StrictMode: built twice, tilted once
  const orbit = parts.orbit!
  const face = parts.face!

  it('tilted and lifted once', () => {
    expect(orbit.rotation.x).toBeCloseTo(ORBIT_TILT, 6)
    expect(orbit.position.y).toBeCloseTo(0.06 + ORBIT_LIFT, 6)
  })

  it('over a full orbit the cube is never in front of the screen rectangle', () => {
    scene.updateMatrixWorld(true)
    const fb = new Box3().setFromObject(face, true)
    let worst = Infinity
    let inFront = 0
    for (let deg = 0; deg < 360; deg += 2) {
      orbit.rotation.y = (deg * Math.PI) / 180
      scene.updateMatrixWorld(true)
      const b = new Box3().setFromObject(orbit, true)
      if (b.min.z > fb.min.z + 0.02) continue // behind the screen's plane
      inFront++
      const gap = Math.max(b.min.x - fb.max.x, fb.min.x - b.max.x, b.min.y - fb.max.y, fb.min.y - b.max.y)
      worst = Math.min(worst, gap)
    }
    expect(inFront).toBeGreaterThan(20) // it does go around the front
    expect(worst).toBeGreaterThan(0)
  })
})
