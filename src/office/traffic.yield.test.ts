// The yield itself (#138 · agents.md 2.8), kept on a small made-up floor so no room layout can make it pass instead
// (#329: the big room #280 widened the demo's "narrow" lane). A 0.9 m corridor between two open ends: after the R
// inflation only one body fits across (two need 2R = 0.6 m between centres, the corridor leaves a 0.3 m band), so two
// agents swapping ends must meet in it and one must yield. Also used by #272 (head-on passing).
import { describe, expect, it } from 'vitest'
import { buildGrid, type Footprint } from './grid'
import type { NavGraph } from './nav'
import { TRAFFIC, TrafficPlanner, type Request } from './traffic'

/** 6 x 3 m: open 1 m at each end, a 4 m corridor of `width` m along z = 0 between them, and halfway along it one side bay (0.9 x 0.75 m) where a single body can stand aside; furniture elsewhere */
function corridorFloor(width: number, withBay = true): Footprint {
  const cell = 0.05
  const w = 120
  const h = 60
  const minX = -3
  const minZ = -1.5
  const bits = new Uint8Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = minX + (i + 0.5) * cell
      const z = minZ + (j + 0.5) * cell
      const inCorridor = Math.abs(z) < width / 2
      const bay = withBay && Math.abs(x) < 0.45 && z > 0 && z < width / 2 + 0.75
      const open = x < -2 || x > 2
      bits[j * w + i] = open || inCorridor || bay ? 0 : 1
    }
  return { cell, minX, minZ, w, h, bits }
}

const EMPTY: NavGraph = { spots: {}, adj: {} }
const req = (label: string, x: number, z: number, ry: number): Request => ({ spot: label, slot: { x, z, ry }, pace: 1 })

/** a and b swap ends through the corridor; the cues each shows, the closest approach, who arrived */
function swapThrough(width: number, withBay = true) {
  const p = new TrafficPlanner(buildGrid(corridorFloor(width, withBay)), EMPTY)
  const A = { x: -2.5, z: 0 }
  const B = { x: 2.5, z: 0 }
  p.place('a', req('a_from', A.x, A.z, Math.PI / 2), 0, 0)
  p.place('b', req('b_from', B.x, B.z, -Math.PI / 2), 0, 1)
  const cues = { a: new Set<string>(), b: new Set<string>() }
  /** a yield cue that plays the hand gesture was shown */
  const gestures = { a: false, b: false }
  /** seconds each one stood still in the bay (off the corridor line, |x| < 0.45, z > 0.4) */
  const aside = { a: 0, b: 0 }
  /** seconds each one stood still anywhere in the corridor itself (it would cork it) */
  const corked = { a: 0, b: 0 }
  const last = { a: { x: A.x, z: A.z }, b: { x: B.x, z: B.z } }
  const dt = 0.05
  let min = Infinity
  for (let t = 0; t <= 45; t += dt) {
    if (t >= 1) {
      p.request('a', req('a_to', B.x, B.z, Math.PI / 2), t)
      p.request('b', req('b_to', A.x, A.z, -Math.PI / 2), t)
    }
    p.update(t)
    const s = { a: p.sample('a', t), b: p.sample('b', t) }
    for (const k of ['a', 'b'] as const) {
      if (s[k].cue) cues[k].add(s[k].cue!.kind)
      if (s[k].cue?.kind === 'yield' && s[k].cue!.gesture) gestures[k] = true
      const still = Math.hypot(s[k].x - last[k].x, s[k].z - last[k].z) / dt < 0.05
      if (still && Math.abs(s[k].x) < 0.45 && s[k].z > 0.4) aside[k] += dt
      if (still && Math.abs(s[k].x) < 2 && Math.abs(s[k].z) < 0.3 && t > 1.5) corked[k] += dt
      last[k] = { x: s[k].x, z: s[k].z }
    }
    min = Math.min(min, Math.hypot(s.a.x - s.b.x, s.a.z - s.b.z))
  }
  return { cues, gestures, aside, corked, min, arrived: [p.sample('a', 45).arrived, p.sample('b', 45).arrived] }
}

describe('a corridor too narrow for two: one yields (#138, #329)', () => {
  it('0.9 m corridor with no bay at all: the one that gives way backs out to the open end and waits there, the other passes, both get through', () => {
    const r = swapThrough(0.9, false)
    expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
    expect(r.arrived).toEqual(['a_to', 'b_to'])
    // nobody is ever stuck still inside the corridor
    expect(r.corked.a + r.corked.b).toBeLessThan(0.3)
  })

  it('0.9 m corridor with one side bay: exactly one steps into the bay and waits, the other passes, never closer than 2R, both get through', () => {
    const r = swapThrough(0.9)
    // the behaviour: one waits in the bay (standing still there for a while), nobody stops in the corridor itself
    const yielders = (['a', 'b'] as const).filter((k) => r.aside[k] >= 0.5)
    expect(yielders.length).toBe(1)
    expect(r.corked.a + r.corked.b).toBeLessThan(0.3)
    expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
    expect(r.arrived).toEqual(['a_to', 'b_to'])
    // the yield gesture cue (#272): the one in the bay starts back out just before the closest approach, so both are moving at it; that is
    // still a yield (the planner classes a body that stood aside and has just set off again as the yielder), never a 'wide' pass, and it plays
    // the gesture. The other one, who walked on, shows no yield
    for (const k of yielders) {
      expect([...r.cues[k]]).toContain('yield')
      expect([...r.cues[k]]).not.toContain('wide')
      expect(r.gestures[k]).toBe(true)
    }
    for (const k of (['a', 'b'] as const).filter((q) => !yielders.includes(q))) expect([...r.cues[k]]).not.toContain('yield')
  })
})
