import { describe, expect, it } from 'vitest'
import { aimPose, bodyTarget, planGesture, reachNeeded, HEAD_MAX, SEATED_BODY_MAX, type AimOpts } from './aim'

const D = Math.PI / 180
const deg = (r: number) => r / D
const slow: AimOpts = { seated: true, reduced: false, fast: false, minTurn: 0, bodyOk: true }

describe('the throw schedule (#224 designer table)', () => {
  const thetas = [0, 20, 60, 61, 90, 120, 150, 180, -45, -120, -180]

  it('the head stays within 60 deg of the body, always, at every angle and time', () => {
    for (const th of thetas)
      for (const seated of [true, false]) {
        const p = planGesture('throw', th * D, { ...slow, seated })
        for (let t = 0; t <= p.times.end; t += 0.02) expect(Math.abs(aimPose(p, t, th * D).head), `theta=${th} t=${t}`).toBeLessThanOrEqual(HEAD_MAX + 1e-9)
      }
  })

  it('seated: the body turns at most 90 deg; standing it turns all the way', () => {
    for (const th of thetas) {
      const seated = planGesture('throw', th * D, slow)
      expect(Math.abs(seated.body)).toBeLessThanOrEqual(SEATED_BODY_MAX + 1e-9)
      for (let t = 0; t <= seated.times.end; t += 0.02) expect(Math.abs(aimPose(seated, t, th * D).body)).toBeLessThanOrEqual(SEATED_BODY_MAX + 1e-9)
    }
    expect(deg(planGesture('throw', 170 * D, { ...slow, seated: false }).body)).toBeCloseTo(170, 6)
  })

  it("within the head's reach (<= 60 deg) the body does not turn; beyond it the body takes the rest", () => {
    expect(planGesture('throw', 50 * D, slow).body).toBe(0)
    expect(deg(planGesture('throw', 100 * D, slow).body)).toBeCloseTo(90, 6)
    expect(deg(planGesture('throw', 75 * D, slow).body)).toBeCloseTo(75, 6)
    expect(deg(bodyTarget(-120 * D, slow))).toBeCloseTo(-90, 6)
  })

  it("back to back (theta = 180 deg) seated: body 90 + head 60 = 150, the other 30 is the hand's reach", () => {
    const p = planGesture('throw', Math.PI, slow)
    const a = aimPose(p, p.times.holdEnd - 0.01, Math.PI)
    expect(deg(a.body)).toBeCloseTo(90, 3)
    expect(deg(a.head)).toBeCloseTo(60, 3)
    expect(deg(reachNeeded(Math.PI, p.body))).toBeCloseTo(30, 6)
    // the hand points 90 deg off the body front, to the side
    expect(deg(a.handAngle)).toBeCloseTo(90, 3)
  })

  it('the head turns first: all of it by 0.25 s, the body not before 0.15 s, done at 0.55 s', () => {
    const p = planGesture('throw', 100 * D, slow)
    expect(deg(aimPose(p, 0.15, 100 * D).body)).toBeCloseTo(0, 6)
    expect(deg(aimPose(p, 0.25, 100 * D).head)).toBeGreaterThan(50)
    expect(deg(aimPose(p, 0.25, 100 * D).body)).toBeLessThan(20)
    expect(deg(aimPose(p, 0.55, 100 * D).body)).toBeCloseTo(90, 6)
    // once the body has turned, the head is back near it (100 - 90 = 10 deg)
    expect(deg(aimPose(p, 0.6, 100 * D).head)).toBeCloseTo(10, 3)
  })

  it('the eyes lead the head by 0.08 s: on the target while the head has barely moved', () => {
    const p = planGesture('throw', 100 * D, slow)
    const a = aimPose(p, 0.04, 100 * D)
    expect(a.eyes).toBeGreaterThan(0.95)
    expect(Math.abs(a.head)).toBeLessThan(5 * D)
    // and back at the middle once the head has caught up
    expect(Math.abs(aimPose(p, 0.7, 100 * D).eyes)).toBeLessThan(0.1)
    // the eyes of a target to the right go the other way
    expect(aimPose(planGesture('throw', -100 * D, slow), 0.04, -100 * D).eyes).toBeLessThan(-0.95)
  })

  it('the aim hold is 0.3 s (0.55 - 0.85): hand up and still, a 2 deg nod, release at 1.0 s', () => {
    const p = planGesture('throw', 90 * D, slow)
    const T = p.times
    expect(T.holdEnd - T.bodyEnd).toBeCloseTo(0.3, 9)
    expect(T.holdEnd).toBeGreaterThanOrEqual(0.85)
    expect(T.release).toBeGreaterThanOrEqual(0.85)
    expect(T.release).toBeLessThanOrEqual(1.0)
    for (let t = T.bodyEnd; t < T.holdEnd; t += 0.05) {
      const a = aimPose(p, t, 90 * D)
      expect(a.arm).toBeCloseTo(1, 9)
      expect(a.stroke).toBe(0)
      expect(a.body).toBeCloseTo(p.body, 9)
      expect(a.phase).toBe('aim')
      expect(a.mood).toBe('focus')
    }
    const mid = aimPose(p, (T.bodyEnd + T.holdEnd) / 2, 90 * D)
    expect(deg(mid.nod)).toBeCloseTo(2, 3)
    expect(aimPose(p, T.release, 90 * D).stroke).toBeCloseTo(1, 9)
  })

  it('after the throw the head follows the plane for 0.6 s within 30 deg of the body, then all is back in 0.6 s', () => {
    const p = planGesture('throw', 100 * D, slow)
    const T = p.times
    expect(T.followEnd - T.release).toBeCloseTo(0.6, 9)
    for (let t = T.release + 0.2; t < T.followEnd; t += 0.05) expect(Math.abs(aimPose(p, t, 170 * D).head)).toBeLessThanOrEqual(30 * D + 1e-9)
    expect(deg(aimPose(p, T.followEnd - 0.01, 170 * D).head)).toBeCloseTo(30, 0)
    expect(T.end - T.followEnd).toBeCloseTo(0.6, 9)
    // back (designer, #226 ②): the head leads the body by 0.08 s only and eases to the body's front without passing it
    expect(T.retBodyStart - T.followEnd).toBeCloseTo(0.08, 9)
    const h0 = aimPose(p, T.followEnd, 130 * D).head
    for (let t = T.followEnd; t <= T.end; t += 1 / 60) {
      const h = aimPose(p, t, 130 * D).head
      expect(Math.sign(h) === Math.sign(h0) || Math.abs(h) < 1e-9, `head crossed the body front at ${t.toFixed(2)}`).toBe(true)
      expect(Math.abs(h)).toBeLessThanOrEqual(Math.abs(h0) + 1e-9)
    }
    expect(aimPose(p, T.retHeadEnd, 130 * D).head).toBeCloseTo(0, 9)
    expect(aimPose(p, T.retHeadEnd, 130 * D).body).toBeGreaterThan(0)
    expect(aimPose(p, T.end - 1e-6, 130 * D).body).toBeLessThan(0.01)
    expect(aimPose(p, T.end, 130 * D).phase).toBe('done')
    expect(aimPose(p, T.end, 130 * D).body).toBe(0)
    // the throwing hand has come down by the end
    expect(aimPose(p, T.end - 1e-6, 130 * D).arm).toBeLessThan(0.05)
  })

  it('the turns are eased: no jump in the body or head between frames', () => {
    for (const th of [90, 180, -150]) {
      const p = planGesture('throw', th * D, slow)
      let prev = aimPose(p, 0, th * D)
      for (let t = 1 / 60; t < p.times.end; t += 1 / 60) {
        const a = aimPose(p, t, th * D)
        expect(Math.abs(a.body - prev.body), `body theta=${th} t=${t.toFixed(2)}`).toBeLessThan(8 * D)
        expect(Math.abs(a.head - prev.head), `head theta=${th} t=${t.toFixed(2)}`).toBeLessThan(8 * D)
        prev = a
      }
    }
  })
})

describe('the catch schedule', () => {
  const F = 1.2
  const c = (th: number, o: Partial<AimOpts> = {}) => planGesture('catch', th * D, { ...slow, flyFor: F, holdS: 1.2, ...o })

  it('eyes, then the head turn to the plane within 0.2 s (<= 60 deg); the body turns 0.2 - 0.6 s past 60 deg', () => {
    const p = c(120)
    expect(Math.abs(aimPose(p, 0.04, 120 * D).eyes)).toBeGreaterThan(0.9)
    expect(deg(aimPose(p, 0.2, 120 * D).head)).toBeCloseTo(60, 0)
    expect(aimPose(p, 0.2, 120 * D).body).toBeCloseTo(0, 6)
    expect(deg(aimPose(p, 0.6, 120 * D).body)).toBeCloseTo(90, 6)
    for (let t = 0; t < p.times.end; t += 0.02) {
      expect(Math.abs(aimPose(p, t, 120 * D).head)).toBeLessThanOrEqual(HEAD_MAX + 1e-9)
      expect(Math.abs(aimPose(p, t, 120 * D).body)).toBeLessThanOrEqual(SEATED_BODY_MAX + 1e-9)
    }
    expect(c(40).body).toBe(0)
  })

  it('the catching hand is up by the halfway point, stays until it has been looked at, then comes down', () => {
    const p = c(90)
    expect(aimPose(p, 0.1 * F, 90 * D).arm).toBe(0)
    expect(aimPose(p, F * 0.5, 90 * D).arm).toBeCloseTo(1, 9)
    expect(aimPose(p, F + 0.8, 90 * D).arm).toBeCloseTo(1, 9)
    expect(aimPose(p, p.times.end - 1e-6, 90 * D).arm).toBeLessThan(0.05)
  })

  it('wide eyes for the first 0.4 s only, then the usual', () => {
    const p = c(30)
    expect(aimPose(p, 0.3, 30 * D).mood).toBe('wide')
    expect(aimPose(p, 0.5, 30 * D).mood).toBe(null)
  })

  it('keeps looking at the plane through the hold, then head to body back over 0.6 s', () => {
    const p = c(90)
    expect(p.times.end - p.times.followEnd).toBeCloseTo(0.6, 9)
    expect(p.times.followEnd).toBeCloseTo(F + 1.2, 9)
    // the plane is at 90 deg and the body already faces it: the head is on it (0 against the body)
    expect(deg(aimPose(p, F + 1.0, 90 * D).head)).toBeCloseTo(0, 3)
    // while the body is still turning the head carries the rest
    expect(deg(aimPose(p, 0.3, 90 * D).head)).toBeGreaterThan(40)
    expect(aimPose(p, p.times.end, 90 * D).phase).toBe('done')
  })

  it('back to back, the catching hand reaches 30 deg past the head (90 deg to the body side)', () => {
    const p = c(180)
    const a = aimPose(p, F * 0.5 + 0.1, Math.PI)
    expect(deg(a.body)).toBeCloseTo(90, 3)
    expect(deg(a.head)).toBeCloseTo(60, 3)
    expect(deg(a.handAngle)).toBeCloseTo(90, 3)
  })
})

describe('reduced motion and the fast replay', () => {
  it('reduced: the head only, within 60 deg, no body, no hand, no nod; the eyes still point', () => {
    for (const kind of ['throw', 'catch'] as const) {
      const p = planGesture(kind, 150 * D, { ...slow, reduced: true })
      expect(p.body).toBe(0)
      for (let t = 0; t < p.times.end; t += 0.02) {
        const a = aimPose(p, t, 150 * D)
        expect(a.body).toBe(0)
        expect(a.arm).toBe(0)
        expect(a.nod).toBe(0)
        expect(Math.abs(a.head)).toBeLessThanOrEqual(HEAD_MAX + 1e-9)
      }
      expect(aimPose(p, 0.04, 150 * D).eyes).toBeGreaterThan(0.9)
      expect(deg(aimPose(p, 0.5, 150 * D).head)).toBeCloseTo(60, 3)
    }
  })

  it('x16: no hold, no follow, the head and the body turn each in at least gestureMin', () => {
    const fast = planGesture('throw', 120 * D, { ...slow, fast: true, minTurn: 2.4 })
    const T = fast.times
    expect(T.holdEnd).toBe(T.bodyEnd)
    expect(T.followEnd).toBe(T.release)
    expect(T.headEnd).toBeCloseTo(2.4, 9)
    expect(T.bodyEnd - T.bodyStart).toBeGreaterThanOrEqual(2.4 - 1e-9)
    expect(planGesture('throw', 120 * D, { ...slow, fast: true, minTurn: 0 }).times.headEnd).toBeCloseTo(0.15, 9)
    expect(aimPose(fast, 0, 0).nod).toBe(0)
  })

  it('walking: only the head turns', () => {
    expect(planGesture('throw', 150 * D, { ...slow, bodyOk: false }).body).toBe(0)
  })
})
