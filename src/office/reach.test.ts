import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { EXTENSION_MAX, SHOULDER, WRIST_LIMITS, extensionFor, reachFrame } from './reach'

// #255 (grips.md 1.1): the reaching hand's fingers follow the reach direction (shoulder -> target), the palm faces what it takes, and above the
// shoulder the wrist extends; never past the wrist's limits.
const DEG = Math.PI / 180
const angle = (a: Vector3, b: Vector3) => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) / DEG

describe('reach direction (#255)', () => {
  it('extension grows with the elevation of the reach and never passes the app cap', () => {
    expect(extensionFor(-20 * DEG)).toBe(0)
    expect(extensionFor(0)).toBe(0)
    expect(extensionFor(30 * DEG)).toBeCloseTo(20, 6)
    expect(extensionFor(60 * DEG)).toBeCloseTo(EXTENSION_MAX, 6)
    expect(extensionFor(89 * DEG)).toBe(EXTENSION_MAX)
    expect(EXTENSION_MAX).toBeLessThan(WRIST_LIMITS.extension)
  })

  for (const side of ['l', 'r'] as const) {
    const sx = side === 'l' ? -1 : 1
    it(`${side}: a target above the shoulder: the fingers are within 30° of the reach direction, the wrist inside its limits`, () => {
      let n = 0
      for (const seat of [0, -0.3])
        for (let x = -0.5; x <= 0.5; x += 0.1)
          for (let y = 0.99; y <= 1.9; y += 0.15)
            for (let z = -0.7; z <= 0.2; z += 0.15) {
              const pos = new Vector3(x, y + seat, z)
              const shoulder = new Vector3(sx * SHOULDER.x, SHOULDER.y + seat, SHOULDER.z)
              if (pos.y <= shoulder.y + 0.01 || pos.distanceTo(shoulder) < 0.1) continue
              const dir = pos.clone().sub(shoulder).normalize()
              for (const palm of [null, new Vector3(0, 0, -1), new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(-sx, 0, 0)]) {
                const r = reachFrame(side, pos, seat, palm)
                const fingers = new Vector3(0, 1, 0).applyQuaternion(r.quat)
                const palmN = new Vector3(0, 0, 1).applyQuaternion(r.quat)
                expect(angle(fingers, dir), `fingers vs reach at ${pos.toArray().map((v) => v.toFixed(2))}`).toBeLessThanOrEqual(30 + 1e-6)
                expect(fingers.dot(palmN)).toBeCloseTo(0, 6)
                expect(r.extension).toBeLessThanOrEqual(WRIST_LIMITS.extension)
                expect(Math.abs(r.twist)).toBeLessThanOrEqual(WRIST_LIMITS.twist + 1e-6)
                n++
              }
            }
      expect(n).toBeGreaterThan(500)
    })

    it(`${side}: a target below the shoulder: the fingers follow the reach exactly (no wrist bend)`, () => {
      for (const pos of [new Vector3(sx * 0.2, 0.6, -0.4), new Vector3(sx * 0.1, 0.85, -0.3), new Vector3(0, 0.3, -0.5)]) {
        const shoulder = new Vector3(sx * SHOULDER.x, SHOULDER.y, SHOULDER.z)
        const dir = pos.clone().sub(shoulder).normalize()
        const r = reachFrame(side, pos, 0, new Vector3(0, -1, 0))
        expect(angle(new Vector3(0, 1, 0).applyQuaternion(r.quat), dir)).toBeLessThan(1e-3)
        expect(r.extension).toBe(0)
      }
    })

    it(`${side}: the palm faces the object it takes (as far as the twist allows)`, () => {
      const pos = new Vector3(sx * 0.15, 1.4, -0.4)
      const toObj = new Vector3(0, 0.2, -1).normalize()
      const r = reachFrame(side, pos, 0, toObj)
      const palmN = new Vector3(0, 0, 1).applyQuaternion(r.quat)
      // with the wrist extended the palm is tilted toward the reach direction, so within 45° of the wanted side
      expect(angle(palmN, toObj)).toBeLessThan(45)
    })
  }

  it('a quaternion is returned unit and the hand frame is right-handed', () => {
    const r = reachFrame('r', new Vector3(0.2, 1.5, -0.3), 0, null)
    expect(r.quat.length()).toBeCloseTo(1, 9)
    const x = new Vector3(1, 0, 0).applyQuaternion(r.quat)
    const y = new Vector3(0, 1, 0).applyQuaternion(r.quat)
    const z = new Vector3(0, 0, 1).applyQuaternion(r.quat)
    expect(x.clone().cross(y).dot(z)).toBeCloseTo(1, 9)
    expect(new Quaternion().copy(r.quat).invert().length()).toBeCloseTo(1, 9)
  })
})
