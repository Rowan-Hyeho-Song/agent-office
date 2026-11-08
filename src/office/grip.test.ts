/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { GRIPS, GRIP_S, GripClock, REST, fitContact, handFor, objectFor, stoneGrip, tipAt, type FingerModel } from './grip'
import { loadOffice, stubCanvas } from './glbLoad'
import { buildRig, fingerModelOf } from './rig'

stubCanvas()

/** a finger of three 4 cm segments along +y that bends toward +z, like the #134 hand's */
const finger = (sx: 1 | -1 = 1): FingerModel => ({
  p: [new Vector3(0, 0.04, 0), new Vector3(0, 0.04, 0), new Vector3(0, 0.04, 0)],
  rest: [new Quaternion(), new Quaternion(), new Quaternion()],
  tip: new Vector3(0, 0.02, 0),
  thumb: false,
  sx,
})

describe('GripClock: the three stages (grips.md 1)', () => {
  const run = (want: (t: number) => boolean, opts = {}, until = 2, dt = 0.01) => {
    const c = new GripClock()
    const frames: ReturnType<GripClock['step']>[] = []
    for (let t = 0; t <= until; t += dt) frames.push(c.step(t, want(t), opts))
    return { c, frames }
  }
  it('approach 0.3 s, the fingers open only in the last 0.15 s, then 0.12 s to close, the object is the hand\'s from the closed instant', () => {
    const { frames } = run(() => true)
    const at = (t: number) => frames[Math.round(t / 0.01)]
    expect(at(0.1).stage).toBe('approach')
    expect(at(0.1).wCurl).toBe(0)
    expect(at(0.29).wCurl).toBeGreaterThan(0.9)
    expect(at(0.2).wHand).toBeGreaterThan(0.5)
    expect(at(0.31).stage).toBe('close')
    expect(at(0.41).attached).toBe(false)
    const first = frames.find((f) => f.attached)!
    const i = frames.indexOf(first)
    expect(i * 0.01).toBeGreaterThanOrEqual(GRIP_S.approach + GRIP_S.close - 0.011)
    expect(i * 0.01).toBeLessThanOrEqual(GRIP_S.approach + GRIP_S.close + 0.011)
    expect(first.mix).toEqual([0, 1, 0])
  })
  it('release: the object is let go at once, "after" in 0.15 s, back to rest within 0.3 s', () => {
    const { frames } = run((t) => t < 1, {}, 1.6)
    const at = (t: number) => frames[Math.round(t / 0.01)]
    expect(at(0.99).attached).toBe(true)
    expect(at(1.01).attached).toBe(false)
    expect(at(1.01).stage).toBe('release')
    expect(at(1.16).mix[2]).toBeGreaterThan(0.99)
    expect(at(1.16).wCurl).toBeGreaterThan(0.9)
    expect(at(1.31).stage).toBe('rest')
    expect(at(1.31).wHand).toBe(0)
  })
  it('reduced motion: hold ↔ rest at once, no pre-grip, no after', () => {
    const { frames } = run((t) => t >= 0.5 && t < 1, { reduced: true })
    expect(frames[49].stage).toBe('rest')
    expect(frames[50]).toMatchObject({ stage: 'hold', attached: true, wHand: 1, wCurl: 1, mix: [0, 1, 0] })
    expect(frames[100]).toMatchObject({ stage: 'rest', attached: false, wHand: 0, wCurl: 0 })
  })
  it('the timelapse: a stage lasts at least gestureMin scene seconds', () => {
    const { frames } = run(() => true, { gestureMin: 2.4 }, 8, 0.05)
    const first = frames.findIndex((f) => f.attached) * 0.05
    expect(first).toBeGreaterThan(2.4 * 2 - 0.1) // approach and close each ≥ 2.4 s
  })
  it('is deterministic: the same times give the same frames', () => {
    const a = run((t) => t % 3 < 1.5).frames
    const b = run((t) => t % 3 < 1.5).frames
    expect(a).toEqual(b)
  })
  it('the table has every object of grips.md and its values are in range', () => {
    for (const [kind, spec] of Object.entries(GRIPS))
      for (const side of [spec.r, spec.l]) {
        if (!side) continue
        for (const c of [side.pre, side.hold, side.after]) {
          expect(c).toHaveLength(6)
          for (const x of c.slice(0, 4)) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThanOrEqual(1)
        }
        expect(kind.length).toBeGreaterThan(0)
      }
    expect(Object.keys(GRIPS)).toEqual(expect.arrayContaining(['cup', 'paddle', 'watering_can', 'book', 'stamp', 'marker', 'tablet_pen', 'mouse', 'button', 'piece']))
    expect(REST).toHaveLength(6)
  })
})

describe('contact correction on a plain finger', () => {
  it('puts the tip within 3 mm of a reachable contact point, outside the surface', () => {
    const m = finger()
    const truth = tipAt(m, 0.6, 0.1)
    const n = new Vector3(0, 0, 1) // a surface facing +z through the point
    const fit = fitContact(m, truth, n, 0.3)
    expect(fit.err).toBeLessThan(0.003)
    expect(fit.off).toBeGreaterThanOrEqual(-1e-4)
  })
  it('a contact in front of the finger\'s reach is approached without going through the surface', () => {
    const m = finger()
    // a plane the finger would run into before reaching the point behind it: the tip stays on the outside
    const target = tipAt(m, 1, 0).add(new Vector3(0, 0, -0.02))
    const fit = fitContact(m, target, new Vector3(0, 0, -1), 0.5)
    expect(fit.off).toBeGreaterThanOrEqual(-1e-4)
  })
  it('hand placement: the hand\'s grip frame lands on the object\'s grip frame', () => {
    const obj = new Matrix4().compose(new Vector3(1, 2, 3), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7), new Vector3(1, 1, 1))
    const pg = new Matrix4().compose(new Vector3(0.02, 0.05, 0), new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.2), new Vector3(1, 1, 1))
    const hg = new Matrix4().compose(new Vector3(0, 0.015, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.5), new Vector3(1, 1, 1))
    const hand = handFor(obj, pg, hg)
    const handGripWorld = hand.clone().multiply(hg)
    const objGripWorld = obj.clone().multiply(pg)
    handGripWorld.elements.forEach((v, i) => expect(v).toBeCloseTo(objGripWorld.elements[i], 6))
    objectFor(hand, hg, pg).elements.forEach((v, i) => expect(v).toBeCloseTo(obj.elements[i], 6))
  })
})

describe('the baked model and the #134 hands', () => {
  it('the 바둑식 stone: the middle fingertip under it, the index fingertip within 3 mm of its top, for every agent', async () => {
    const { scene, nodes } = await loadOffice()
    for (let i = 0; i < 4; i++) {
      const rig = buildRig(scene, nodes, i)
      const hand = rig.hands.r
      const hold = GRIPS.piece.r!.hold
      const g = stoneGrip(fingerModelOf(hand, 1, 'r')!, fingerModelOf(hand, 0, 'r')!, { index: hold[0], middle: hold[1] })
      expect(g.err.index, `agent_${i} index`).toBeLessThanOrEqual(0.003)
      expect(g.off.index).toBeGreaterThanOrEqual(-1e-4)
    }
  })
})
