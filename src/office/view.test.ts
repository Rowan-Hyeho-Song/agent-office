import { describe, expect, it } from 'vitest'
import {
  NONE_HIDDEN, NO_KEYS, VIEW, boxDistance, clampDistance, clampPolar, clampTarget, cutAt, easeVelocity, focusAllowsCameraKeys,
  keepClear, keySpeed, nextHidden, occlusionSegment, segmentHitsBox, stepOpacity, wallTop, wantDir, wantOpacity, type Hidden,
} from './view'

const at = (deg: number, r = 9) => [Math.sin((deg * Math.PI) / 180) * r, Math.cos((deg * Math.PI) / 180) * r] as const // 0 deg = +z (south)
const hid = (h: Hidden) => Object.entries(h).filter(([, v]) => v).map(([k]) => k).sort().join('')

describe('nextHidden', () => {
  it('lowers the two near walls from each diagonal', () => {
    // 45: south-east (the default camera), 135: north-east, 225: north-west, 315: south-west
    expect(hid(nextHidden(NONE_HIDDEN, ...at(45)))).toBe('es')
    expect(hid(nextHidden(NONE_HIDDEN, ...at(135)))).toBe('en')
    expect(hid(nextHidden(NONE_HIDDEN, ...at(225)))).toBe('nw')
    expect(hid(nextHidden(NONE_HIDDEN, ...at(315)))).toBe('sw')
  })
  it('head-on lowers one wall and the side walls keep their state', () => {
    const fromEast = nextHidden(NONE_HIDDEN, 9, 0) // east down
    expect(hid(nextHidden(fromEast, 0, 9))).toBe('es') // south goes down, east keeps
    expect(hid(nextHidden(NONE_HIDDEN, 0, 9))).toBe('s')
    expect(hid(nextHidden(nextHidden(NONE_HIDDEN, 9, 0), 0, -9))).toBe('en')
  })
  it('keeps the state inside the hysteresis band (no flicker at the boundary)', () => {
    // sweep the camera round a full circle in 0.5 degree steps both ways: each wall flips at most once per crossing
    for (const dir of [1, -1]) {
      let h = NONE_HIDDEN
      const flips: Record<string, number> = { n: 0, e: 0, s: 0, w: 0 }
      for (let a = 0; a <= 720; a += 0.5) {
        const nh = nextHidden(h, ...at(a * dir))
        for (const w of ['n', 'e', 's', 'w'] as const) if (nh[w] !== h[w]) flips[w]++
        h = nh
      }
      for (const w of ['n', 'e', 's', 'w']) expect(flips[w]).toBeLessThanOrEqual(5) // 2 laps x (down, up) + the first lowering
    }
  })
  it('approaching the threshold from either side gives different answers only inside the band', () => {
    const edge = Math.asin(VIEW.switchSin) * (180 / Math.PI) // south wall: c = cos(angle from south)... band around 90 deg off
    const justInside = 90 - edge + 1
    const justOutside = 90 - edge - 1
    expect(nextHidden(NONE_HIDDEN, ...at(justInside)).s).toBe(false) // c just under the threshold: stays up
    expect(nextHidden(NONE_HIDDEN, ...at(justOutside)).s).toBe(true)
    expect(nextHidden({ ...NONE_HIDDEN, s: true }, ...at(justInside)).s).toBe(true) // already down: stays down
  })
  it('raises everything when the camera is inside the room', () => {
    expect(hid(nextHidden({ n: true, e: true, s: true, w: true }, 1, 0.5))).toBe('')
  })
})

describe('cutAt / wallTop', () => {
  it('lowers in 240 ms and raises in 320 ms, ending exactly on the rest heights', () => {
    expect(cutAt(wallTop(false), wallTop(true), 0)).toBe(VIEW.wallH)
    expect(cutAt(wallTop(false), wallTop(true), 240)).toBe(VIEW.stripH)
    expect(cutAt(wallTop(true), wallTop(false), 319)).toBeLessThan(VIEW.wallH)
    expect(cutAt(wallTop(true), wallTop(false), 320)).toBe(VIEW.wallH)
  })
})

describe('view limits', () => {
  it('clamps the target to the floor inset and the height range, per axis', () => {
    const t = clampTarget({ x: 99, y: 5, z: -99 })
    expect(t).toEqual({ x: VIEW.floor.maxX - VIEW.targetInset, y: VIEW.targetY[1], z: VIEW.floor.minZ + VIEW.targetInset })
    expect(clampTarget({ x: 0.2, y: 0.7, z: 0.1 })).toEqual({ x: 0.2, y: 0.7, z: 0.1 })
    expect(clampTarget({ x: 0, y: -3, z: 0 }).y).toBe(VIEW.targetY[0])
    // sliding: pushing past one edge leaves the other axis alone
    expect(clampTarget({ x: 99, y: 1, z: 0.3 }).z).toBe(0.3)
  })
  it('clamps polar and distance', () => {
    expect([clampPolar(0), clampPolar(1), clampPolar(3)]).toEqual([0.15, 1, 1.35])
    expect([clampDistance(1), clampDistance(8), clampDistance(40)]).toEqual([2.5, 8, 18])
  })
})

describe('WASD', () => {
  const fwd = { x: 0, z: -1 } // camera looks towards -z
  it('forward is away from the camera, right is to its right', () => {
    expect(wantDir({ ...NO_KEYS, fwd: true }, fwd)).toEqual({ x: 0, z: -1 })
    const r = wantDir({ ...NO_KEYS, right: true }, fwd)
    expect(r.x).toBeCloseTo(1)
    expect(r.z).toBeCloseTo(0)
    const d = wantDir({ ...NO_KEYS, fwd: true, right: true }, fwd)
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1)
    expect(wantDir({ ...NO_KEYS, fwd: true, back: true }, fwd)).toEqual({ x: 0, z: 0 })
  })
  it('speed is 0.35 x distance within 1.2..4, Shift doubles', () => {
    expect(keySpeed(2.5, false)).toBe(1.2)
    expect(keySpeed(8, false)).toBeCloseTo(2.8)
    expect(keySpeed(18, false)).toBe(4)
    expect(keySpeed(8, true)).toBeCloseTo(5.6)
  })
  it('eases the velocity, instant when reduced', () => {
    const v = easeVelocity({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.016, false)
    expect(v.x).toBeGreaterThan(0)
    expect(v.x).toBeLessThan(0.5)
    expect(easeVelocity({ x: 0, z: 0 }, { x: 1, z: 0 }, 0.016, true).x).toBe(1)
  })
  it('keys belong to a focused control: only the page body or the canvas let them through', () => {
    const body = { tagName: 'BODY' }
    expect(focusAllowsCameraKeys(null, body)).toBe(true)
    expect(focusAllowsCameraKeys(body, body)).toBe(true)
    expect(focusAllowsCameraKeys({ tagName: 'CANVAS' }, body)).toBe(true)
    for (const t of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'DIV', 'SECTION']) expect(focusAllowsCameraKeys({ tagName: t }, body)).toBe(false)
  })
})

describe('near-object fade', () => {
  const box = { min: [0, 0, 0], max: [1, 1, 1] } as const
  it('measures to the box surface', () => {
    expect(boxDistance([0.5, 0.5, 0.5], box)).toBe(0)
    expect(boxDistance([3, 0.5, 0.5], box)).toBe(2)
    expect(boxDistance([2, 2, 0.5], box)).toBeCloseTo(Math.SQRT2)
  })
  it('segment against box', () => {
    expect(segmentHitsBox([-2, 0.5, 0.5], [3, 0.5, 0.5], box)).toBe(true)
    expect(segmentHitsBox([-2, 0.5, 0.5], [-0.5, 0.5, 0.5], box)).toBe(false) // stops short
    expect(segmentHitsBox([-2, 3, 0.5], [3, 3, 0.5], box)).toBe(false) // passes above
    expect(segmentHitsBox([2, 0.5, 2], [2, 0.5, -2], box)).toBe(false) // parallel and outside
  })
  it('the occlusion segment stops short of the target', () => {
    const [a, b] = occlusionSegment([0, 0, 0], [0, 0, -10])
    expect(a).toEqual([0, 0, 0])
    expect(b[2]).toBeCloseTo(-10 + VIEW.near.targetSkip)
  })
  it('opacity: 1 beyond 1.4 m, 25% at 0.6 m, 0 at 0.4 m, linear between; occluders at 25%', () => {
    expect(wantOpacity(2, false)).toBe(1)
    expect(wantOpacity(1.4, false)).toBe(1)
    expect(wantOpacity(1.0, false)).toBeCloseTo(0.625)
    expect(wantOpacity(0.6, false)).toBe(VIEW.near.minOpacity)
    expect(wantOpacity(0.4, false)).toBe(0)
    expect(wantOpacity(5, true)).toBe(VIEW.near.minOpacity)
  })
  it('fades out in 160 ms, back in 240 ms, instantly when reduced', () => {
    expect(stepOpacity(1, 0.25, 0.16, false)).toBeCloseTo(0.25)
    expect(stepOpacity(0.25, 1, 0.12, false)).toBeCloseTo(0.625)
    expect(stepOpacity(1, 0.25, 0.001, true)).toBe(0.25)
  })
})

describe('key map', () => {
  it('is WASD only (arrow keys belong to lists, tabs and the timelapse bar)', async () => {
    const { KEY_DIR } = await import('./view')
    expect(Object.keys(KEY_DIR).sort()).toEqual(['KeyA', 'KeyD', 'KeyS', 'KeyW'])
  })
})

describe('camera clearance (#208)', () => {
  const box = { min: [-1, 0, -1], max: [1, 1, 1] } as const
  const m = VIEW.clear.margin
  it('leaves a clear camera alone', () => {
    expect(keepClear([5, 4, 5], [0, 0.5, 0], [box])).toEqual([5, 4, 5])
    expect(keepClear([1 + m + 0.01, 0.5, 0], [0, 0.5, 0], [box])).toEqual([1 + m + 0.01, 0.5, 0])
  })
  it('pushes a camera inside the grown box out to the margin, back along the view ray', () => {
    const p = keepClear([1.1, 0.5, 0], [-4, 0.5, 0], [box])
    expect(p[0]).toBeCloseTo(1 + m, 2)
    expect(p[1]).toBeCloseTo(0.5)
    expect(boxDistance(p, box)).toBeGreaterThanOrEqual(m - 1e-3)
  })
  it('is monotone: zooming in along the ray stops at the surface, never nearer', () => {
    const target: [number, number, number] = [-6, 0.5, 0]
    let last = Infinity
    for (let x = 6; x > 0.5; x -= 0.1) {
      const p = keepClear([x, 0.5, 0], target, [box])
      expect(boxDistance(p, box)).toBeGreaterThanOrEqual(m - 1e-3)
      expect(p[0]).toBeLessThanOrEqual(last + 1e-3) // the camera never moves back out while it is pushed in
      last = p[0]
    }
    expect(last).toBeCloseTo(1 + m, 2)
  })
  it('slide boxes (walls) push by the nearest face; the result stays clear', () => {
    const wall = { min: [-5, 0, -3.64], max: [5, 2.6, -3.5], slide: true } as const
    const p = keepClear([0, 1, -3.3], [0, 1, 2], [wall])
    expect(boxDistance(p, wall)).toBeGreaterThanOrEqual(m - 1e-3)
    expect(p[2]).toBeGreaterThan(-3.5)
  })
  it('falls back to the nearest face when the ray exit would pass the max distance', () => {
    const p = keepClear([0.9, 0.5, 0], [0.9 + 17.9, 0.5, 0], [box])
    expect(Math.hypot(p[0] - 18.8, p[1] - 0.5, p[2])).toBeLessThanOrEqual(VIEW.distance[1] + 1e-6 + 2)
    expect(boxDistance(p, box)).toBeGreaterThanOrEqual(m - 1e-3)
  })
  it('the near plane stays inside the margin, and anything inside near.hide is fully hidden', () => {
    expect(VIEW.cameraNear * 2).toBeLessThan(VIEW.clear.margin)
    expect(VIEW.near.hide).toBeGreaterThan(VIEW.clear.margin)
    expect(wantOpacity(VIEW.near.hide, false)).toBe(0)
    expect(wantOpacity(0, true)).toBe(0)
    expect(wantOpacity(0.5, false)).toBeCloseTo(0.125)
    expect(VIEW.distance[0]).toBeGreaterThan(VIEW.clear.margin)
  })
})
