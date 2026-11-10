// The water's timing and effects as pure state machines (#185, docs/design/watering.md 2 – 5): the flow inside a pour, the shake, the habits, the stream's
// pool, the soil that darkens and dries, the plant's sway and the leaf-tip drips, and what the speed and reduced motion keep.
import { describe, expect, it } from 'vitest'
import { POUR_S, POUR_TILT, UP_A, pourAt, pourHoldOf, pourTotal } from './water'
import { startWater, stepWater } from './waterRun'
import {
  CIRCLE_R,
  DRIP_DELAY_S,
  DRIP_FORM_S,
  DRIP_R,
  DRIP_STAY,
  DRY_S,
  Drips,
  HABIT_OF_SEAT,
  HABIT_S,
  LEAK_AT,
  LEAK_TILT,
  PARTICLE_CAP,
  PARTICLE_RATE,
  SHAKE_RAD,
  SPILL,
  Stream,
  Sway,
  SWAY_RAD,
  WET_DARK,
  WET_S,
  Wetness,
  circleAt,
  circleRadius,
  dripTips,
  flowAt,
  habitFor,
  habitSeconds,
  habitU,
  lastDropTimes,
  levelFor,
  shakeAt,
} from './waterFx'

const PLANTS = ['plant_corner', 'plant_sofa', 'plant_desk', 'plant_hang_0']
const DEG = Math.PI / 180

describe('the pour: timing and flow (watering.md 2, 3)', () => {
  it('the tilt reaches 15° at 0.4 s after the settle, rests, then 30°; the water starts at 20°, not before', () => {
    for (const p of PLANTS) {
      expect(pourAt(p, POUR_S.settle).tilt).toBeCloseTo(0, 6)
      expect(pourAt(p, POUR_S.settle + UP_A).tilt).toBeCloseTo(0.5, 6) // 15° of 30°
      expect(pourAt(p, POUR_S.settle + POUR_S.up).tilt).toBeCloseTo(1, 6)
      // the tilt passes 20° exactly at LEAK_AT, and no water runs before it
      expect(pourAt(p, LEAK_AT).tilt).toBeCloseTo(LEAK_TILT, 3)
      expect(flowAt(p, LEAK_AT - 0.01)).toBe(0)
      expect(flowAt(p, LEAK_AT + 0.01)).toBeGreaterThan(0)
      // at 15° there is none
      expect(flowAt(p, POUR_S.settle + UP_A)).toBe(0)
    }
  })

  it('a small spill first, then it grows to the even pour and stays level through the hold', () => {
    for (const p of PLANTS) {
      const t0 = LEAK_AT + 1e-4
      expect(flowAt(p, t0)).toBeCloseTo(SPILL, 1)
      let prev = flowAt(p, t0)
      const hold0 = POUR_S.settle + POUR_S.up
      for (let u = t0; u < hold0 + pourHoldOf(p); u += 0.01) {
        const f = flowAt(p, u)
        expect(f, p + ' ' + u.toFixed(2)).toBeGreaterThanOrEqual(prev - 1e-9)
        prev = f
      }
      // the last half second of the hold is the even pour
      expect(flowAt(p, hold0 + pourHoldOf(p) - 0.01)).toBeCloseTo(1, 6)
    }
  })

  it('it thins at the end: falling, stopping at 20° of the way back, and nothing after', () => {
    for (const p of PLANTS) {
      const t3 = POUR_S.settle + POUR_S.up + pourHoldOf(p)
      let prev = flowAt(p, t3)
      let stopped = -1
      for (let u = t3; u < t3 + POUR_S.down + 0.5; u += 0.005) {
        const f = flowAt(p, u)
        expect(f, p + ' ' + u.toFixed(3)).toBeLessThanOrEqual(prev + 1e-9)
        if (f === 0 && stopped < 0) stopped = u
        prev = f
      }
      // it stops inside the tip-back (0.3 s), well before the can is upright
      expect(stopped).toBeGreaterThan(t3)
      expect(stopped).toBeLessThan(t3 + POUR_S.down)
      expect(flowAt(p, t3 + POUR_S.down + POUR_S.shake)).toBe(0)
    }
  })

  it('the whole pour (without walking) adds up: settle + tip + hold + back + shake + habit + lower, and the can is back at the carrying hold', () => {
    for (const p of PLANTS)
      for (const h of [0, 0.7, 0.8]) {
        const total = pourTotal(p, h)
        expect(total).toBeCloseTo(POUR_S.settle + POUR_S.up + pourHoldOf(p) + POUR_S.down + POUR_S.shake + h + POUR_S.back, 9)
        expect(pourAt(p, total, h)).toEqual({ hold: 0, tilt: 0 })
        // it stays at the pour hold through the shake and the habit
        const mid = total - POUR_S.back - 0.01
        expect(pourAt(p, mid, h).hold).toBeCloseTo(1, 3)
        // continuous: the can never jumps in a 10 ms frame
        let prev = pourAt(p, 0, h)
        for (let u = 0.01; u <= total + 0.2; u += 0.01) {
          const cur = pourAt(p, u, h)
          expect(Math.abs(cur.hold - prev.hold)).toBeLessThan(0.08)
          expect(Math.abs(cur.tilt - prev.tilt)).toBeLessThan(0.08)
          prev = cur
        }
      }
    // one watering of the fig lasts under 8 s of its own (the stages walk and are timed by waterRun besides)
    expect(pourTotal('plant_corner', 0.8)).toBeLessThan(8)
  })

  it('the tilt is upright again before the shake: two ±8° turns of 0.15 s, one at x16, then the last two drops 0.2 s apart', () => {
    for (const p of PLANTS) {
      const t4 = POUR_S.settle + POUR_S.up + pourHoldOf(p) + POUR_S.down
      expect(pourAt(p, t4 + 0.25).tilt).toBeCloseTo(0, 6)
      expect(shakeAt(p, t4)).toBe(0)
      let peak = 0
      let turns = 0
      let last = 0
      for (let u = t4; u < t4 + POUR_S.shake; u += 0.005) {
        const s = shakeAt(p, u)
        peak = Math.max(peak, Math.abs(s))
        if (last <= 0 && s > 0) turns++
        last = s
      }
      expect(peak).toBeCloseTo(SHAKE_RAD, 1)
      expect(peak).toBeLessThanOrEqual(SHAKE_RAD + 1e-9)
      expect(turns).toBe(2)
      expect(shakeAt(p, t4 + 0.25 + 0.31, 1)).toBe(0) // one turn at x16
      const [a, b] = lastDropTimes(p)
      expect(b - a).toBeCloseTo(0.2, 9)
      expect(a).toBeGreaterThan(t4 + 0.25) // after the can is upright
      expect(b).toBeLessThan(t4 + POUR_S.shake + 1e-9)
    }
  })

  it('the spout circles the stem (4 cm, 30 % of a small soil) and the circle starts and ends at zero', () => {
    expect(circleRadius(0.184)).toBe(CIRCLE_R)
    expect(circleRadius(0.064)).toBeCloseTo(0.0192, 6)
    for (const p of PLANTS) {
      const t2 = POUR_S.settle + POUR_S.up
      expect(circleAt(p, 0.18, t2)).toEqual({ fwd: 0, lat: 0 })
      expect(Math.hypot(circleAt(p, 0.18, t2 + pourHoldOf(p)).fwd, circleAt(p, 0.18, t2 + pourHoldOf(p)).lat)).toBeLessThan(1e-9)
      let max = 0
      let prev = { fwd: 0, lat: 0 }
      for (let u = t2; u <= t2 + pourHoldOf(p); u += 0.01) {
        const c = circleAt(p, 0.18, u)
        max = Math.max(max, Math.hypot(c.fwd, c.lat))
        expect(Math.hypot(c.fwd - prev.fwd, c.lat - prev.lat), 'no jump').toBeLessThan(0.01)
        prev = c
      }
      expect(max).toBeLessThanOrEqual(CIRCLE_R + 1e-9)
      expect(max).toBeGreaterThan(0.025)
    }
  })
})

describe('the habits (watering.md 4)', () => {
  it('each seat has its own, they last 0.6 – 0.8 s, and about half of the waterings show one, the same for the same seed', () => {
    expect(HABIT_OF_SEAT).toEqual(['poke', 'look', 'leaf', 'tap', 'listen'])
    for (const k of Object.values(HABIT_S)) {
      expect(k).toBeGreaterThanOrEqual(0.6)
      expect(k).toBeLessThanOrEqual(0.8)
    }
    for (let seat = 0; seat < 5; seat++) {
      let shown = 0
      for (let seed = 0; seed < 400; seed++) {
        const h = habitFor('agent_' + seat, seed)
        expect(habitFor('agent_' + seat, seed)).toBe(h)
        if (h) {
          expect(h).toBe(HABIT_OF_SEAT[seat])
          shown++
        }
      }
      expect(shown / 400, 'seat ' + seat).toBeGreaterThan(0.4)
      expect(shown / 400, 'seat ' + seat).toBeLessThan(0.6)
    }
    expect(habitFor('nobody', 3)).toBeNull()
    expect(habitSeconds(null)).toBe(0)
  })

  it('it runs after the shake and before the lowering', () => {
    for (const p of PLANTS)
      for (const h of Object.keys(HABIT_S) as (keyof typeof HABIT_S)[]) {
        const start = POUR_S.settle + POUR_S.up + pourHoldOf(p) + POUR_S.down + POUR_S.shake
        expect(habitU(p, h, start - 0.01)).toBeNull()
        expect(habitU(p, h, start + 0.01)).toBeCloseTo(0.01, 6)
        expect(habitU(p, h, start + HABIT_S[h] + 0.01)).toBeNull()
        expect(start + HABIT_S[h] + POUR_S.back).toBeCloseTo(pourTotal(p, HABIT_S[h]), 9)
      }
    expect(habitU('plant_corner', null, 5)).toBeNull()
  })
})

describe('the errand carries the habit (waterRun)', () => {
  it('the pour stage lasts the habit longer, reduced motion has none, and the habit is part of the run, not decided later', () => {
    const at = () => false // nobody is at the can's stand: the run stays in 'return' once it is out of 'pour'
    const run = startWater('plant_corner', 1, 0, false, 'leaf')
    expect(run.habit).toBe('leaf')
    expect(startWater('plant_corner', 1, 0, true, 'leaf').habit).toBeNull()
    expect(startWater('plant_corner', 1, 0, false).habit).toBeNull()
    const pouring = { ...run, stage: 'pour' as const, t0: 0 }
    const base = pourTotal('plant_corner', 0) * 1000
    expect(stepWater(pouring, { now: base + 10, at }).run.stage, 'with the habit it is still pouring after the plain total').toBe('pour')
    expect(stepWater(pouring, { now: pourTotal('plant_corner', HABIT_S.leaf) * 1000 + 10, at }).run.stage).toBe('return')
    expect(stepWater({ ...pouring, habit: null }, { now: base + 10, at }).run.stage, 'without it the plain total ends it').toBe('return')
  })
})

describe('the speed and reduced motion (watering.md 5)', () => {
  it('x1 – x4 keep everything; x16 drops the particles and the drips but keeps the soil and the sway and shakes once; reduced motion keeps only the soil, at once', () => {
    expect(levelFor(1, false)).toMatchObject({ particles: true, drips: true, sway: true, instantSoil: false, shakes: 2, body: true })
    expect(levelFor(4, false)).toEqual(levelFor(1, false))
    expect(levelFor(16, false)).toMatchObject({ particles: false, drips: false, sway: true, shakes: 1 })
    expect(levelFor(1, true)).toMatchObject({ particles: false, drips: false, sway: false, instantSoil: true, body: false })
    expect(levelFor(16, true).sway).toBe(false)
  })
})

describe('the stream: a fixed pool', () => {
  const soil = { x: 0, z: 0, y: 0, r: 0.2 }
  const tip = { x: 0.1, y: 0.4, z: 0 }
  const dir = { x: -0.8, y: -0.1, z: 0 }

  it('never holds more than its cap, however long the frame or full the flow', () => {
    for (const cap of [PARTICLE_CAP.desktop, PARTICLE_CAP.mobile]) {
      const s = new Stream(cap)
      for (let k = 0; k < 300; k++) s.step(k % 7 === 0 ? 0.5 : 0.016, { tip, dir, flow: 1 }, { ...soil, y: -50 })
      expect(s.n).toBeLessThanOrEqual(cap)
      expect(s.peak).toBeLessThanOrEqual(cap)
    }
    expect(PARTICLE_CAP).toEqual({ desktop: 80, mobile: 40 })
    expect(PARTICLE_RATE).toBe(40)
  })

  it('emits about 40 a second at full flow, fewer at less, none at zero', () => {
    for (const [flow, expected] of [[1, PARTICLE_RATE], [0.5, PARTICLE_RATE / 2], [0, 0]] as const) {
      const s = new Stream(100)
      let landed = 0
      for (let k = 0; k < 600; k++) landed += s.step(0.01, { tip, dir, flow }, { x: 0.05, z: 0, y: 0.2, r: 5 })
      const perSecond = (landed + s.n) / 6
      expect(perSecond, 'flow ' + flow).toBeGreaterThan(expected - 2)
      expect(perSecond, 'flow ' + flow).toBeLessThan(expected + 2)
    }
  })

  it('drops fall, are gone at the soil height, count as a hit inside the soil circle and a miss outside', () => {
    const s = new Stream(40, 3)
    for (let k = 0; k < 300; k++) s.step(0.01, { tip, dir, flow: 1 }, { x: 0.1 - 0.12, z: 0, y: 0, r: 0.3 })
    expect(s.hits).toBeGreaterThan(0)
    expect(s.misses).toBe(0)
    const m = new Stream(40, 3)
    for (let k = 0; k < 300; k++) m.step(0.01, { tip, dir, flow: 1 }, { x: 5, z: 5, y: 0, r: 0.05 })
    expect(m.hits).toBe(0)
    expect(m.misses).toBeGreaterThan(0)
    // every live drop is above the soil
    const p = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < s.n; i++) {
      s.position(i, p)
      expect(p.y).toBeGreaterThan(0)
    }
  })

  it('the same seed gives the same stream', () => {
    const run = () => {
      const s = new Stream(40, 9)
      for (let k = 0; k < 120; k++) s.step(0.016, { tip, dir, flow: 1 }, soil)
      return [s.n, s.hits, s.misses, s.ox[0]]
    }
    expect(run()).toEqual(run())
  })

  it('a shed drop falls from the rose at once', () => {
    const s = new Stream(5)
    expect(s.drop(tip, { x: 0, y: -0.01, z: 0 })).toBe(true)
    expect(s.n).toBe(1)
    s.step(0.3, null, { ...soil, y: -1 })
    const p = { x: 0, y: 0, z: 0 }
    s.position(0, p)
    expect(p.y).toBeCloseTo(0.4 - 0.5 * 9.81 * 0.09, 1)
    expect(p.x).toBeCloseTo(0.1, 1)
  })

  it("#185 sound: a shed drop is told when it reaches the soil (once, where it lands); the stream's own drops are not", () => {
    const s = new Stream(40, 3)
    for (let k = 0; k < 30; k++) s.step(0.016, { tip, dir, flow: 1 }, soil)
    s.drop(tip, { x: 0, y: -0.01, z: 0 })
    const landed: { x: number; y: number; z: number }[] = []
    for (let k = 0; k < 120; k++) {
      s.step(0.016, null, soil)
      landed.push(...s.takeMarkedLanded())
    }
    expect(landed, 'the one shed drop, not the stream').toHaveLength(1)
    expect(landed[0].y).toBe(soil.y)
    expect(landed[0].x).toBeCloseTo(tip.x, 2)
    expect(s.takeMarkedLanded()).toEqual([])
  })
})

describe('the soil: dark over 0.8 s, dry over 60 s', () => {
  it('goes from dry to 100 % in 0.8 s while water lands, 0.2 s with reduced motion, and never past', () => {
    const w = new Wetness()
    for (let t = 0; t < 0.8 - 1e-9; t += 0.01) w.step('a', 0.01, true)
    expect(w.get('a')).toBeGreaterThan(0.98)
    w.step('a', 0.05, true)
    expect(w.get('a')).toBe(1)
    expect(w.opacity('a')).toBeCloseTo(WET_DARK, 9)
    const f = new Wetness()
    f.step('a', 0.2, true, true)
    expect(f.get('a')).toBe(1)
    // gradual: half way at 0.4 s
    const h = new Wetness()
    h.step('a', WET_S / 2, true)
    expect(h.get('a')).toBeCloseTo(0.5, 6)
  })

  it('dries evenly over 60 s once the water stops, and only the plant that was watered is wet', () => {
    const w = new Wetness()
    w.step('a', 1, true)
    w.step('b', 1, false)
    expect(w.get('b')).toBe(0)
    for (let t = 0; t < DRY_S / 2; t++) w.step('a', 1, false)
    expect(w.get('a')).toBeCloseTo(0.5, 6)
    expect(w.active()).toEqual(['a'])
    for (let t = 0; t < DRY_S / 2 + 1; t++) w.step('a', 1, false)
    expect(w.get('a')).toBe(0)
    expect(w.active()).toEqual([])
  })

  it('the darkening is the 70 % brightness layer (as the eye sees it: sRGB 0.7 is 0.45 of the light)', () => {
    expect((1 - WET_DARK) ** (1 / 2.2)).toBeGreaterThan(0.68)
    expect((1 - WET_DARK) ** (1 / 2.2)).toBeLessThan(0.76)
  })
})

describe('the sway: ±1.5° while hit, dying away in 0.6 s', () => {
  it('stays inside ±1.5° while the flow runs, and is flat after about three time constants', () => {
    const s = new Sway()
    let peak = 0
    for (let t = 0; t < 1.6; t += 1 / 60) peak = Math.max(peak, Math.abs(s.step(1 / 60, 1)))
    expect(peak).toBeGreaterThan(SWAY_RAD * 0.9)
    expect(peak).toBeLessThanOrEqual(SWAY_RAD + 1e-9)
    // the amplitude is 1/e after 0.6 s of no water
    const a0 = s.amp
    for (let t = 0; t < 0.6; t += 1 / 60) s.step(1 / 60, 0)
    expect(s.amp / a0).toBeGreaterThan(0.3)
    expect(s.amp / a0).toBeLessThan(0.45)
    for (let t = 0; t < 4; t += 1 / 60) s.step(1 / 60, 0)
    expect(s.amp).toBe(0)
    expect(s.angle()).toBe(0)
    void DEG
  })

  it('a plant that is not hit does not move', () => {
    const s = new Sway()
    for (let t = 0; t < 2; t += 0.016) expect(Math.abs(s.step(0.016, 0))).toBe(0)
  })
})

describe('the leaf-tip drips', () => {
  it('only a tip whose drop falls inside the soil disc forms a drip', () => {
    const soil = { x: 0, z: 0, r: 0.2 }
    expect(dripTips([{ x: 0.1, z: 0 }, { x: 0.3, z: 0 }, { x: 0, z: -0.19 }], soil)).toEqual([0, 2])
    expect(dripTips([{ x: 0.5, z: 0.5 }], soil)).toEqual([])
  })

  const height = () => 1.2

  it('wait, form for 1 s, fall under gravity and are done on arrival; leaf k starts 0.4 s after leaf k−1', () => {
    const d = new Drips()
    d.trigger(3)
    expect(d.drips.map((x) => x.phase)).toEqual(['wait', 'wait', 'wait'])
    expect(d.active).toBe(true)
    let t = 0
    const seen: string[][] = []
    const doneAt: number[] = []
    let formAt = [-1, -1, -1]
    while (d.active && t < 10) {
      d.step(0.01, height)
      t += 0.01
      d.drips.forEach((x, k) => {
        if (x.phase === 'form' && formAt[k] < 0) formAt[k] = t
        if (x.phase === 'done' && !doneAt[k]) doneAt[k] = t
      })
      seen.push(d.drips.map((x) => x.phase))
    }
    expect(formAt[0]).toBeCloseTo(DRIP_DELAY_S, 1)
    expect(formAt[1] - formAt[0]).toBeCloseTo(0.4, 1)
    expect(formAt[2] - formAt[1]).toBeCloseTo(0.4, 1)
    // it falls 1.2 m under gravity: sqrt(2·1.2 / 9.81) = 0.49 s after forming 1 s
    expect(doneAt[0] - formAt[0]).toBeCloseTo(DRIP_FORM_S + Math.sqrt((2 * 1.2) / 9.81), 1)
    expect(d.active).toBe(false)
    expect(t).toBeLessThan(4)
  })

  it('grows from nothing to 5 mm across while it forms, is full size falling, and none once done', () => {
    const d = new Drips()
    d.trigger(1)
    expect(d.size(0)).toBe(0)
    let prev = 0
    for (let t = 0; t < DRIP_DELAY_S + DRIP_FORM_S - 0.02; t += 0.01) {
      d.step(0.01, height)
      expect(d.size(0)).toBeGreaterThanOrEqual(prev - 1e-12)
      expect(d.size(0)).toBeLessThanOrEqual(DRIP_R)
      prev = d.size(0)
    }
    expect(prev).toBeGreaterThan(DRIP_R * 0.9)
    d.step(0.05, height)
    d.step(0.1, height)
    expect(d.drips[0].phase).toBe('fall')
    expect(d.size(0)).toBe(DRIP_R)
    expect(d.below(0)).toBeGreaterThan(0.0)
    while (d.active) d.step(0.02, height)
    expect(d.size(0)).toBe(0)
  })

  it('one whose drop would land outside the soil stays on the leaf: forms 1 s, glints, shrinks away in 0.3 s, never falls (watering.md 3, #393)', () => {
    const d = new Drips()
    d.trigger(2, [true, false])
    expect(d.drips.map((x) => x.stay)).toEqual([true, false])
    let t = 0
    let formAt = -1
    let shrinkAt = -1
    let doneAt = -1
    let biggest = 0
    let fell = false
    while (d.active && t < 5) {
      d.step(0.005, height)
      t += 0.005
      const x = d.drips[0]
      if (x.phase === 'form' && formAt < 0) formAt = t
      if (x.phase === 'shrink' && shrinkAt < 0) shrinkAt = t
      if (x.phase === 'done' && doneAt < 0) doneAt = t
      if (x.phase === 'fall') fell = true
      biggest = Math.max(biggest, d.size(0))
      // it hangs at its tip: never further below it than its own size
      expect(d.below(0)).toBeLessThanOrEqual(DRIP_R * (1 + DRIP_STAY.swell) + 1e-9)
      if (x.phase === 'shrink') expect(d.size(0)).toBeLessThanOrEqual(DRIP_R)
    }
    expect(fell, 'it never falls').toBe(false)
    expect(shrinkAt - formAt).toBeCloseTo(DRIP_FORM_S, 1)
    expect(doneAt - shrinkAt).toBeCloseTo(DRIP_STAY.shrinkS, 1)
    // the glint: just before it shrinks it swells clearly past full size (a quarter over its size then, which is not quite full yet)
    expect(biggest).toBeGreaterThan(DRIP_R * 1.15)
    expect(d.size(0)).toBe(0)
    // the other one fell as before
    expect(d.drips[1].phase).toBe('done')
  })

  it('#185 sound: `landed` names a falling drop in the one step it reaches the soil; a drop staying on its leaf never lands', () => {
    const d = new Drips()
    d.trigger(2, [true, false])
    const landings: number[][] = []
    let t = 0
    while (d.active && t < 5) {
      d.step(0.005, height)
      t += 0.005
      if (d.landed.length) landings.push([...d.landed])
    }
    expect(landings, 'one landing, the falling drop (k 1)').toEqual([[1]])
    d.trigger(1)
    expect(d.landed, 'a new watering starts clean').toEqual([])
  })

  it('a new watering starts them again', () => {
    const d = new Drips()
    d.trigger(2)
    while (d.active) d.step(0.05, height)
    d.trigger(3)
    expect(d.active).toBe(true)
    expect(d.drips).toHaveLength(3)
  })
})

describe('sanity', () => {
  it('the can tips to POUR_TILT = 30° and the flow thresholds are the spec 20°', () => {
    expect(POUR_TILT).toBeCloseTo(30 * DEG, 9)
    expect(LEAK_TILT * 30).toBeCloseTo(20, 9)
  })
})
