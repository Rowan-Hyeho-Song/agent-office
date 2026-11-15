import { Object3D, Quaternion, Vector3 } from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadOffice } from './glbLoad'
import { LiveAxis, axisOf } from './liveAxis'

// #484: ECHO's mixer moved its parts along the room's axes, not their own. The bake turns the mixer to face the room, so the faders
// slid toward the next channel and the knobs lost their tilt. These run the real office.glb nodes through EchoDesk and DeskLive.

const levels = vi.hoisted(() => ({ faders: [0, 0, 0, 0] as [number, number, number, number], cone: 0 }))
vi.mock('../audio/speaker', () => ({
  faderLevels: () => levels.faders,
  speakerCone: () => levels.cone,
  speakerCells: () => 0,
  speakerOn: () => false,
  setSpeakerNodes: () => {},
}))
const { EchoDesk } = await import('./deskLive')

describe('a live node along its own axis', () => {
  it('reads the axis from extras', () => {
    expect(axisOf('-z', new Vector3(1, 0, 0)).toArray()).toEqual([0, 0, -1])
    expect(axisOf('y', new Vector3(1, 0, 0)).toArray()).toEqual([0, 1, 0])
    expect(axisOf(undefined, new Vector3(1, 0, 0)).toArray()).toEqual([1, 0, 0])
    expect(axisOf('w', new Vector3(0, 0, 1)).toArray()).toEqual([0, 0, 1])
  })
  it('slides along and turns about its own axis, keeping the baked rotation', () => {
    const o = new Object3D()
    o.position.set(1, 2, 3)
    o.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2) // its -z is the world's -x
    o.userData.axis = '-z'
    const a = new LiveAxis(o, new Vector3(0, 0, 1))
    a.slide(0.1)
    expect(o.position.x).toBeCloseTo(0.9, 6)
    expect(o.position.z).toBeCloseTo(3, 6)
    a.turn(0.5)
    // the turn is about the node's own -z, after the baked rotation: its own -z (world -x) does not move
    expect(new Vector3(0, 0, -1).applyQuaternion(o.quaternion).x).toBeCloseTo(-1, 6)
    a.reset()
    expect(o.quaternion.angleTo(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2))).toBeCloseTo(0, 6)
  })
})

describe('ECHO\'s mixer (office.glb)', () => {
  beforeEach(() => {
    levels.faders = [0, 0, 0, 0]
    levels.cone = 0
  })

  it('each fader slides along its slot (the channel row is across it), the full travel; the knobs keep their tilt and turn about their own y', async () => {
    const { nodes } = await loadOffice()
    const n = (k: string) => nodes[k]
    const rest = [0, 1, 2, 3].map((k) => n(`desk_4_fader_${k}`).position.clone())
    const knobRest = [0, 1, 2, 3].map((k) => n(`desk_4_knob_${k}`).quaternion.clone())
    const desk = new EchoDesk(n)
    desk.update(false)
    // the channel row: from fader 0 to fader 3
    const row = rest[3].clone().sub(rest[0]).normalize()
    levels.faders = [1, 1, 1, 1]
    desk.update(false)
    for (let k = 0; k < 4; k++) {
      const node = n(`desk_4_fader_${k}`)
      const moved = node.position.clone().sub(rest[k])
      expect(moved.length(), `fader ${k} travel`).toBeCloseTo(Number(node.userData.travel), 6)
      // along the slot: across the channel row, level with the desk
      expect(Math.abs(moved.clone().normalize().dot(row)), `fader ${k} toward the next channel`).toBeLessThan(0.05)
      expect(Math.abs(moved.y), `fader ${k} up or down`).toBeLessThan(0.01)
      // the slot is its own -z (extras axis)
      const own = new Vector3(0, 0, -1).applyQuaternion(node.quaternion)
      expect(moved.clone().normalize().dot(own)).toBeCloseTo(1, 5)
    }
    // the knobs: turned about their own y on top of the baked rotation, so their own y stays where the bake put it
    for (let k = 0; k < 4; k++) {
      const q = n(`desk_4_knob_${k}`).quaternion
      const y0 = new Vector3(0, 1, 0).applyQuaternion(knobRest[k])
      const y1 = new Vector3(0, 1, 0).applyQuaternion(q)
      expect(y1.dot(y0), `knob ${k} axis`).toBeCloseTo(1, 6)
      expect(q.angleTo(knobRest[k]), `knob ${k} turned`).toBeGreaterThan(1)
    }
  })

  it('the speaker cones push along their own +z', async () => {
    const { nodes } = await loadOffice()
    const n = (k: string) => nodes[k]
    const desk = new EchoDesk(n)
    for (const side of ['l', 'r']) {
      const node = n(`desk_4_spk_${side}`)
      const rest = node.position.clone()
      levels.cone = 1
      desk.update(false)
      const moved = node.position.clone().sub(rest)
      const own = new Vector3(0, 0, 1).applyQuaternion(node.quaternion)
      expect(moved.length()).toBeCloseTo(Number(node.userData.travel), 6)
      expect(moved.normalize().dot(own), side).toBeCloseTo(1, 5)
      levels.cone = 0
      desk.update(false)
    }
  })
})
