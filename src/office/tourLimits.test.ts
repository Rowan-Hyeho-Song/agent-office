import { describe, expect, it } from 'vitest'
import { DEFAULT_CAMERA, DEFAULT_TARGET } from './room'
import { portraitPose } from './portraitCamera'
import { SPOTS } from './navSpots.fixture'
import { DEG, SHOULDER, forward, meetingPose, standPose, tablePose, workCandidates, workPose, type Clearance, type Frame, type V3 } from './tour'
import { CUT, angleFromBehind, cutInLimits, distScale, fitCut, freeSpot, inFreeLimits, minCutDistance, stopEaseAt, stopEaseDone, type CutLimits } from './tourLimits'
import { VIEW } from './view'

const FOV = 32 * DEG
const DESK: CutLimits = { aspect: 1.6, fovY: FOV, subjectH: 0.35 }
const PHONE: CutLimits = { aspect: 0.46, fovY: FOV, subjectH: 0.35 }
const free = { polar: VIEW.polar, distance: VIEW.distance }
const polarOf = (p: V3, t: V3) => Math.atan2(Math.hypot(p[0] - t[0], p[2] - t[2]), p[1] - t[1])
const distOf = (p: V3, t: V3) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])
const seatOf = (n: number): Frame => {
  const s = SPOTS.find((p) => p.id === `work_${n}`)!
  return { x: s.x, z: s.z, ry: s.ry }
}
const clear = (l: CutLimits): Clearance => ({ boxes: [], margin: 0.3, limits: l })

describe('free-view limits (#405, 10.3)', () => {
  it('are polar 0.45-1.10 rad and distance 4-21 m', () => {
    expect([...VIEW.polar]).toEqual([0.45, 1.1])
    expect([...VIEW.distance]).toEqual([4, 21])
  })
  it('the desktop home pose is inside them', () => {
    expect(inFreeLimits([...DEFAULT_CAMERA] as V3, [...DEFAULT_TARGET] as V3, free)).toBe(true)
  })
  it('the portrait phone home pose (Door HOME_POS) is 1 degree flatter than the new max polar: reported to planning, not moved here', () => {
    for (const aspect of [0.3, 0.46, 0.6, 0.79]) {
      const p = portraitPose(aspect, 32)
      const t = p.target as unknown as V3
      const c = p.camera as unknown as V3
      expect(distOf(c, t)).toBeLessThanOrEqual(VIEW.distance[1])
      expect(polarOf(c, t)).toBeGreaterThan(VIEW.polar[1])
      expect(polarOf(c, t)).toBeLessThan(VIEW.polar[1] + 0.02) // 26 degrees up = polar 1.117 against 1.10
    }
  })
})

describe('stop: the way back into the free view', () => {
  const t: V3 = [1, 0.6, 1]
  it('a camera too close, too flat or overhead ends up inside the limits, keeping its bearing', () => {
    const bad: V3[] = [[1.5, 0.9, 1.5], [9, 0.8, 9], [1.1, 14, 1.2], [5, 20, 5], [40, 8, 1]]
    for (const p of bad) {
      expect(inFreeLimits(p, t, free)).toBe(false)
      const s = freeSpot(p, t, free)
      expect(inFreeLimits(s, t, free)).toBe(true)
      expect(polarOf(s, t)).toBeGreaterThanOrEqual(VIEW.polar[0] - 1e-9)
      expect(polarOf(s, t)).toBeLessThanOrEqual(VIEW.polar[1] + 1e-9)
      expect(distOf(s, t)).toBeGreaterThanOrEqual(VIEW.distance[0] - 1e-9)
      expect(distOf(s, t)).toBeLessThanOrEqual(VIEW.distance[1] + 1e-9)
      expect(Math.atan2(s[2] - t[2], s[0] - t[0])).toBeCloseTo(Math.atan2(p[2] - t[2], p[0] - t[0]), 6)
    }
  })
  it('a pose already inside does not move', () => {
    const p: V3 = [9.56, 7.8, 10.54]
    freeSpot(p, t, free).forEach((v, i) => expect(v).toBeCloseTo(p[i], 9))
  })
  it('takes exactly 0.4 s, smoothly from where it stood to the free pose', () => {
    expect(CUT.stopEaseMs).toBe(400)
    const from: V3 = [1.5, 0.9, 1.5]
    const to = freeSpot(from, t, free)
    expect(stopEaseAt(from, to, 0)).toEqual(from)
    expect(stopEaseAt(from, to, 400)).toEqual(to)
    expect(stopEaseAt(from, to, 900)).toEqual(to)
    const mid = stopEaseAt(from, to, 200)
    for (let i = 0; i < 3; i++) expect(mid[i]).toBeCloseTo((from[i] + to[i]) / 2, 9)
    expect(stopEaseDone(399)).toBe(false)
    expect(stopEaseDone(400)).toBe(true)
    // no jump: it moves only a little in the first frame
    expect(distOf(stopEaseAt(from, to, 16), from)).toBeLessThan(distOf(from, to) * 0.1)
  })
})

describe('tour cut limits (#405, 10.3)', () => {
  it('fitCut puts a too-flat, too-steep or too-near camera inside the look-down range and the distance', () => {
    const t: V3 = [0, 1, 0]
    for (const p of [[0.5, 1.2, 0.5], [3, 1.1, 0], [0.2, 5, 0.1], [2, 6, 0], [-4, 2.4, 3]] as V3[]) {
      const f = fitCut(p, t, DESK)
      expect(cutInLimits(f, t, DESK)).toBe(true)
      expect(distOf(f, t)).toBeGreaterThanOrEqual(CUT.minDist - 1e-9)
    }
    const ok: V3 = [3, 2.5, 0]
    const f = fitCut(ok, t, DESK)
    for (let i = 0; i < 3; i++) expect(f[i]).toBeCloseTo(ok[i], 9)
  })
  it('a portrait phone stands at least 2.6 m away and scales by max(1, 1.6 / aspect) ** 0.5', () => {
    expect(minCutDistance(PHONE)).toBeGreaterThanOrEqual(2.6)
    expect(minCutDistance(DESK)).toBeGreaterThanOrEqual(1.8)
    expect(distScale(0.46)).toBeCloseTo((1.6 / 0.46) ** 0.5, 9)
    expect(distScale(1.6)).toBe(1)
    const t: V3 = [0, 1, 0]
    const p: V3 = [0, 1 + 3 * Math.sin(40 * DEG), 3 * Math.cos(40 * DEG)]
    expect(distOf(fitCut(p, t, PHONE), t)).toBeCloseTo(3 * distScale(0.46), 6)
    expect(distOf(fitCut(p, t, DESK), t)).toBeCloseTo(3, 6)
  })
  it('the head is at most 35 % of the picture height', () => {
    const l: CutLimits = { aspect: 1.6, fovY: FOV, subjectH: 0.9 }
    const d = minCutDistance(l)
    expect(0.9 / (2 * d * Math.tan(FOV / 2))).toBeLessThanOrEqual(0.35 + 1e-9)
  })
  it('every pose the composers return for an open room is inside the limits, desktop and phone', () => {
    for (const l of [DESK, PHONE]) {
      const c = clear(l)
      const poses = [
        ...[0, 1, 2, 3].flatMap((n) => [0, 1, 2].map((v) => workPose(seatOf(n), c, v))),
        ...[0, 1, 2].map((v) => standPose({ x: 1, z: 1, ry: 0.5 }, c, 2.2, 1.7, 1.0, v)),
        ...[0, 1, 2].map((v) => meetingPose({ x: 1, z: 1 }, c, [8, 8, 9], 4.0, 2.6, v)),
        ...[0, 1, 2].map((v) => tablePose({ x: 0, z: 0 }, { x: 0, z: 1.6 }, c, [8, 8, 9], { dist: 3.8, y: 2.2, targetY: 0.76 }, v)),
        ...[0, 1, 2].map((v) => tablePose({ x: -2, z: 0 }, { x: -2, z: 0.8 }, c, [8, 8, 9], { dist: 2.0, y: 1.8, targetY: 0.6 }, v)),
      ]
      for (const p of poses) {
        expect(p).not.toBeNull()
        expect(cutInLimits(p!.pos, p!.target, l)).toBe(true)
      }
    }
  })
  it('over the shoulder stands at least 35 degrees to the side of straight behind the head', () => {
    expect(Math.atan(SHOULDER.side / SHOULDER.back) / DEG).toBeGreaterThanOrEqual(CUT.shoulderDeg)
    for (let n = 0; n < 4; n++) {
      const seat = seatOf(n)
      const fw = forward(seat.ry)
      for (const cand of workCandidates(seat, 0).slice(0, 2)) expect(angleFromBehind([seat.x, seat.z], fw, cand.pos)).toBeGreaterThanOrEqual(CUT.shoulderDeg)
      // and after the fit into the tour's limits (the bearing is kept)
      const p = workPose(seat, clear(DESK), 0)!
      expect(angleFromBehind([seat.x, seat.z], fw, p.pos)).toBeGreaterThanOrEqual(CUT.shoulderDeg - 8)
    }
  })
  it('a cut that cannot be framed inside the limits is skipped (null)', () => {
    const boxed: Clearance = { boxes: [{ min: [-30, -1, -30], max: [30, 0.2, 30] }], margin: 1000, limits: DESK }
    expect(standPose({ x: 0, z: 0, ry: 0 }, boxed)).toBeNull()
  })
})
