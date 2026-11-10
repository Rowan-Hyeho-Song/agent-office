// What the water does (#185, docs/design/watering.md 3 – 5): the timing of the flow inside a pour, the per-agent habit, the stream of drops,
// the soil that darkens, the plant that sways and the drops that form at a leaf tip. All pure (numbers in, numbers out, no three.js objects):
// waterScene.ts puts them on the model, playStage.ts feeds them the can's pose. Everything runs on the office clock, so the speed (#158) only
// changes how much clock one frame covers.

import { POUR_S, STREAM_V, G, UP_A, pourAt, pourHoldOf } from './water'

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k))
  return c * c * (3 - 2 * c)
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

// ---------------------------------------------------------------------------------------------------------- the flow inside a pour

/** the can must be tipped this far (of POUR_TILT, 20° of 30°) before the first water comes out */
export const LEAK_TILT = 20 / 30
/** the first water is a small spill (this share of the full stream), it grows to the even pour in SPILL_RAMP_S */
export const SPILL = 0.25
export const SPILL_RAMP_S = 0.6
/** the pour time at which the tilt passes LEAK_TILT: the second stretch of the tip is a smoothstep, inverted here */
export const LEAK_AT = POUR_S.settle + UP_A + (POUR_S.up - UP_A) * (0.5 - Math.sin(Math.asin(1 - 2 * ((LEAK_TILT - 0.5) / 0.5)) / 3))

/**
 * How much of the stream is running `u` s after arriving at the plant (0 … 1): nothing until the can is tipped 20°, a small spill first, then
 * growing to the even pour, and on the way back it thins as the tilt falls under 20° and stops there.
 */
export function flowAt(plant: string, u: number, habitS = 0): number {
  const { tilt } = pourAt(plant, u, habitS)
  const t3 = POUR_S.settle + POUR_S.up + pourHoldOf(plant)
  if (u < t3) {
    if (u < LEAK_AT) return 0
    return SPILL + (1 - SPILL) * ease((u - LEAK_AT) / SPILL_RAMP_S)
  }
  if (tilt <= LEAK_TILT) return 0
  return Math.min(1, ease((tilt - LEAK_TILT) / (1 - LEAK_TILT)))
}

/** the wrist shake after the tip back (rad): two turns of ±8°, 0.15 s each (one at x16), starting once the can stands upright */
export const SHAKE_RAD = (8 * Math.PI) / 180
export const SHAKE_TURN_S = 0.15
const shakeFrom = (plant: string) => POUR_S.settle + POUR_S.up + pourHoldOf(plant) + POUR_S.down + 0.25
export function shakeAt(plant: string, u: number, turns = 2): number {
  const s = u - shakeFrom(plant)
  if (s < 0 || s > turns * SHAKE_TURN_S) return 0
  return SHAKE_RAD * Math.sin((2 * Math.PI * s) / SHAKE_TURN_S)
}
/** the pour times (s) the last two drops leave the spout, 0.2 s apart, inside the 0.6 s of the shake */
export const lastDropTimes = (plant: string): [number, number] => {
  const t4 = shakeFrom(plant) - 0.25
  return [t4 + 0.3, t4 + 0.5]
}

/** while the can is tipped the spout draws a circle of this radius round the stem (m); small pots get a smaller one (30 % of the soil's radius) so the stream stays on the soil */
export const CIRCLE_R = 0.04
export const circleRadius = (soilR: number) => Math.min(CIRCLE_R, 0.3 * soilR)
/** the circle's offset (forward, sideways) of the can in the body's frame at pour time `u`: one turn over the hold, faded in and out so it never jumps */
export function circleAt(plant: string, soilR: number, u: number): { fwd: number; lat: number } {
  const t2 = POUR_S.settle + POUR_S.up
  const k = (u - t2) / pourHoldOf(plant)
  if (k <= 0 || k >= 1) return { fwd: 0, lat: 0 }
  const r = circleRadius(soilR) * Math.sin(Math.PI * k)
  const a = 2 * Math.PI * k
  return { fwd: r * Math.cos(a), lat: r * Math.sin(a) }
}

// --------------------------------------------------------------------------------------------------------------------- the habits

export type HabitKind = 'poke' | 'look' | 'leaf' | 'tap' | 'listen'
/** each agent's habit (watering.md 4), by seat: 메모 pokes the soil, 메시 looks the plant over, 휴 strokes a leaf, 루프 taps the pot, 에코 listens */
export const HABIT_OF_SEAT: HabitKind[] = ['poke', 'look', 'leaf', 'tap', 'listen']
export const HABIT_S: Record<HabitKind, number> = { poke: 0.7, look: 0.8, leaf: 0.7, tap: 0.7, listen: 0.8 }
const hash = (a: number, b: number) => {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  return (h >>> 0) / 4294967296
}
/** the habit this agent shows in this watering (about half of them, decided from the time seed: the same day gives the same habits), or null */
export function habitFor(agent: string, seed: number): HabitKind | null {
  const seat = Number(agent.split('_')[1])
  if (!Number.isFinite(seat) || seat < 0) return null
  return hash(seat * 31 + 7, seed) < 0.5 ? HABIT_OF_SEAT[seat % HABIT_OF_SEAT.length] : null
}
export const habitSeconds = (h: HabitKind | null | undefined) => (h ? HABIT_S[h] : 0)

/** the habit's own time (s, 0 … its length) at pour time `u`, or null outside it: it runs once the shake is done */
export function habitU(plant: string, kind: HabitKind | null | undefined, u: number): number | null {
  if (!kind) return null
  const s = u - (POUR_S.settle + POUR_S.up + pourHoldOf(plant) + POUR_S.down + POUR_S.shake)
  return s >= 0 && s <= HABIT_S[kind] ? s : null
}
/** how much of the habit is showing (0 … 1): in over 0.15 s, out over 0.15 s */
export const habitEnv = (s: number, len: number) => ease(s / 0.15) * ease((len - s) / 0.15)

// ------------------------------------------------------------------------------------------------------------------ the speed levels

/** what the speed (#158) and reduced motion keep of the effects (watering.md 5) */
export interface FxLevel {
  particles: boolean
  drips: boolean
  sway: boolean
  /** the soil darkens at once instead of over 0.8 s */
  instantSoil: boolean
  shakes: number
  /** the body's own details: the lean, the dip, the habit */
  body: boolean
}
export function levelFor(speed: number, reduced: boolean): FxLevel {
  if (reduced) return { particles: false, drips: false, sway: false, instantSoil: true, shakes: 1, body: false }
  if (speed >= 16) return { particles: false, drips: false, sway: true, instantSoil: false, shakes: 1, body: true }
  return { particles: true, drips: true, sway: true, instantSoil: false, shakes: 2, body: true }
}

// --------------------------------------------------------------------------------------------------------------------- the stream

export const PARTICLE_RATE = 40
/** most drops alive at once (the leaf-tip drips are counted in it) */
export const PARTICLE_CAP = { desktop: 80, mobile: 40 }
/** the stream leaves inside a cone of this half-angle round the rose's axis */
export const CONE_RAD = (10 * Math.PI) / 180
/** the rose's hole circle (m, radius), the drops' radius range (m) */
export const ROSE_R = 0.018
export const DROP_R = [0.0015, 0.002] as const

export interface SoilDisc {
  x: number
  z: number
  y: number
  r: number
}

/** deterministic noise: the stream looks the same in every run of a test */
export function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * A fixed pool of drops: they leave the rose's hole circle along the spout's direction at STREAM_V, fall under gravity and are gone at the soil's
 * height (a hit when inside the soil circle, a miss when not: the stream must not miss). Never more than `cap` alive: the emission waits.
 */
export class Stream {
  readonly cap: number
  /** origin, velocity, age, radius of each live drop (struct of arrays) */
  readonly ox: Float32Array
  readonly oy: Float32Array
  readonly oz: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly vz: Float32Array
  readonly age: Float32Array
  readonly rad: Float32Array
  n = 0
  hits = 0
  misses = 0
  /** how far from the soil's centre the last miss landed (m), for the tests' messages */
  lastMiss = 0
  /** the most drops alive at once since the last resetCounts: the cost's bound */
  peak = 0
  private acc = 0
  private rand: () => number
  constructor(cap: number, seed = 1) {
    this.cap = cap
    this.ox = new Float32Array(cap)
    this.oy = new Float32Array(cap)
    this.oz = new Float32Array(cap)
    this.vx = new Float32Array(cap)
    this.vy = new Float32Array(cap)
    this.vz = new Float32Array(cap)
    this.age = new Float32Array(cap)
    this.rad = new Float32Array(cap)
    this.rand = rng(seed)
  }
  clear() {
    this.n = 0
    this.acc = 0
  }
  position(i: number, out: Vec3) {
    const a = this.age[i]
    out.x = this.ox[i] + this.vx[i] * a
    out.y = this.oy[i] + this.vy[i] * a - 0.5 * G * a * a
    out.z = this.oz[i] + this.vz[i] * a
  }
  private add(tip: Vec3, dir: Vec3, age: number, radius: number, spread: number) {
    if (this.n >= this.cap) return false
    // a point on the rose's hole circle: in the plane perpendicular to the direction
    const up = Math.abs(dir.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
    let ax = dir.y * up.z - dir.z * up.y
    let ay = dir.z * up.x - dir.x * up.z
    let az = dir.x * up.y - dir.y * up.x
    const al = Math.hypot(ax, ay, az) || 1
    ax /= al
    ay /= al
    az /= al
    const bx = dir.y * az - dir.z * ay
    const by = dir.z * ax - dir.x * az
    const bz = dir.x * ay - dir.y * ax
    const ang = this.rand() * Math.PI * 2
    const rr = spread * Math.sqrt(this.rand())
    const c = Math.cos(ang)
    const s = Math.sin(ang)
    const i = this.n++
    this.ox[i] = tip.x + (ax * c + bx * s) * rr
    this.oy[i] = tip.y + (ay * c + by * s) * rr
    this.oz[i] = tip.z + (az * c + bz * s) * rr
    const v = STREAM_V * (0.96 + 0.08 * this.rand())
    // a little off the axis, inside the cone
    const tilt = spread > 0 ? Math.tan(CONE_RAD * Math.sqrt(this.rand())) : 0
    const pa = this.rand() * Math.PI * 2
    const jx = dir.x + (ax * Math.cos(pa) + bx * Math.sin(pa)) * tilt
    const jy = dir.y + (ay * Math.cos(pa) + by * Math.sin(pa)) * tilt
    const jz = dir.z + (az * Math.cos(pa) + bz * Math.sin(pa)) * tilt
    // (a shed drop has no cone and keeps its own tiny direction: it just falls)
    const jl = tilt > 0 ? Math.hypot(jx, jy, jz) || 1 : 1
    this.vx[i] = (jx / jl) * v
    this.vy[i] = (jy / jl) * v
    this.vz[i] = (jz / jl) * v
    this.age[i] = age
    this.rad[i] = radius
    return true
  }
  /** one drop at once (the last two of the shake: no spread, they hang at the rose's centre) */
  drop(tip: Vec3, dir: Vec3) {
    return this.add(tip, dir, 0, 0.0025, 0)
  }
  /**
   * Advance `dt` s of the office clock. `emit` (the spout's tip and direction, the flow 0 … 1) or null: no water leaves. Returns how many drops
   * reached the soil this step; `hits` / `misses` count them since the last resetCounts.
   */
  step(dt: number, emit: { tip: Vec3; dir: Vec3; flow: number } | null, soil: SoilDisc): number {
    let landed = 0
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt
      const a = this.age[i]
      const y = this.oy[i] + this.vy[i] * a - 0.5 * G * a * a
      if (a > 0.01 && y <= soil.y) {
        const x = this.ox[i] + this.vx[i] * a
        const z = this.oz[i] + this.vz[i] * a
        if (Math.hypot(x - soil.x, z - soil.z) <= soil.r) {
          this.hits++
          landed++
        } else {
          this.misses++
          this.lastMiss = Math.hypot(x - soil.x, z - soil.z)
        }
        this.remove(i)
      } else if (a > 2) this.remove(i)
    }
    if (emit && emit.flow > 0) {
      this.acc += PARTICLE_RATE * emit.flow * dt
      while (this.acc >= 1) {
        this.acc -= 1
        // spread over the step so a long frame (the speed) does not bunch them
        this.add(emit.tip, emit.dir, this.rand() * dt, DROP_R[0] + (DROP_R[1] - DROP_R[0]) * this.rand(), ROSE_R)
      }
      // full: the emission waits instead of building up a burst
      if (this.n >= this.cap) this.acc = Math.min(this.acc, 1)
    } else this.acc = 0
    this.peak = Math.max(this.peak, this.n)
    return landed
  }
  resetCounts() {
    this.hits = 0
    this.misses = 0
    this.peak = this.n
  }
  private remove(i: number) {
    const l = --this.n
    if (i === l) return
    this.ox[i] = this.ox[l]
    this.oy[i] = this.oy[l]
    this.oz[i] = this.oz[l]
    this.vx[i] = this.vx[l]
    this.vy[i] = this.vy[l]
    this.vz[i] = this.vz[l]
    this.age[i] = this.age[l]
    this.rad[i] = this.rad[l]
  }
}

// ----------------------------------------------------------------------------------------------------------------- the wet soil

/** the soil darkens over 0.8 s and dries over 60 s (watering.md 3) */
export const WET_S = 0.8
export const DRY_S = 60
export const WET_FAST_S = 0.2
/** how much darker the wet soil is: its brightness 70 % as the eye sees it, i.e. a dark layer of this opacity over it (blended in linear light: 0.5 of the light is about 73 % of the sRGB value) */
export const WET_DARK = 0.5

export class Wetness {
  private w = new Map<string, number>()
  get(plant: string) {
    return this.w.get(plant) ?? 0
  }
  /** `landing`: water reaches this plant's soil in this step */
  step(plant: string, dt: number, landing: boolean, fast = false) {
    const w = this.get(plant)
    const next = landing ? Math.min(1, w + dt / (fast ? WET_FAST_S : WET_S)) : Math.max(0, w - dt / DRY_S)
    if (next > 0 || w > 0) this.w.set(plant, next)
    return next
  }
  /** the soil as the dark layer's opacity */
  opacity(plant: string) {
    return WET_DARK * this.get(plant)
  }
  active() {
    return [...this.w.entries()].filter(([, v]) => v > 0).map(([k]) => k)
  }
}

// --------------------------------------------------------------------------------------------------------------- the leaves sway

export const SWAY_RAD = (1.5 * Math.PI) / 180
export const SWAY_HZ = 2.1
export const SWAY_TAU = 0.6
/**
 * The plant, as one node, swings ±1.5° round its pot's foot while water hits it and dies away over 0.6 s after (watering.md 3): the swing's
 * amplitude follows the flow (rising in 0.2 s, falling with the 0.6 s time constant), the angle is that amplitude on a sine.
 */
export class Sway {
  amp = 0
  phase = 0
  step(dt: number, flow: number) {
    const target = flow > 0 ? 1 : 0
    const tau = target > this.amp ? 0.2 : SWAY_TAU
    this.amp += (target - this.amp) * (1 - Math.exp(-dt / tau))
    if (target === 0 && this.amp < 1e-3) this.amp = 0
    this.phase += dt * SWAY_HZ * Math.PI * 2
    return this.angle()
  }
  angle() {
    return SWAY_RAD * this.amp * Math.sin(this.phase)
  }
}

// ----------------------------------------------------------------------------------------------------------------- the leaf-tip drips

/** the leaf tips (by index) whose drop would fall inside the soil disc: those drips fall; the others stay on the leaf (Drips.trigger) */
export function dripTips(tips: { x: number; z: number }[], soil: { x: number; z: number; r: number }): number[] {
  return tips.flatMap((t, k) => (Math.hypot(t.x - soil.x, t.z - soil.z) <= soil.r ? [k] : []))
}

export type DripPhase = 'wait' | 'form' | 'fall' | 'shrink' | 'done'
export const DRIP_FORM_S = 1
/**
 * A drip whose drop would land outside the soil does not fall (watering.md 3, #393): formed, it glints (swells by `swell` and back over the last
 * `glintS` of the forming) and then shrinks away on the leaf in `shrinkS`
 */
export const DRIP_STAY = { glintS: 0.2, swell: 0.25, shrinkS: 0.3 } as const
export const DRIP_R = 0.0025
/** the first drip starts this long after the water began hitting the plant, each next leaf this much later */
export const DRIP_DELAY_S = 0.5
export const DRIP_STAGGER_S = 0.4

export interface Drip {
  phase: DripPhase
  /** s since the phase began (negative while it waits) */
  t: number
  /** the fall: how far it has dropped (m) and its speed */
  fell: number
  v: number
  /** it stays on the leaf (its drop would land outside the soil): glints and shrinks instead of falling */
  stay: boolean
}

/**
 * The drops that gather at 2 – 3 leaf tips once the plant is hit: wait, form for 1 s (growing to 5 mm across), fall under gravity until they have
 * dropped `heightAbove(k)` (the tip's height over the soil), then done. One whose drop would land outside the soil stays on the leaf instead:
 * formed, it glints and shrinks away in DRIP_STAY.shrinkS. A new watering starts them again.
 */
export class Drips {
  drips: Drip[] = []
  /** `count` leaf tips start their drips after the staggered delay; `stay[k]`: drip k stays on its leaf (it would land outside the soil) */
  trigger(count: number, stay: readonly boolean[] = []) {
    this.drips = Array.from({ length: count }, (_, k) => ({ phase: 'wait' as DripPhase, t: -(DRIP_DELAY_S + DRIP_STAGGER_S * k), fell: 0, v: 0, stay: !!stay[k] }))
  }
  get active() {
    return this.drips.some((d) => d.phase !== 'done')
  }
  step(dt: number, heightAbove: (k: number) => number) {
    this.drips.forEach((d, k) => {
      if (d.phase === 'done') return
      d.t += dt
      if (d.phase === 'wait' && d.t >= 0) d.phase = 'form'
      if (d.phase === 'form' && d.t >= DRIP_FORM_S && d.stay) {
        d.phase = 'shrink'
        d.t -= DRIP_FORM_S
      }
      if (d.phase === 'shrink' && d.t >= DRIP_STAY.shrinkS) d.phase = 'done'
      if (d.phase === 'form' && d.t >= DRIP_FORM_S) {
        d.phase = 'fall'
        d.t = 0
        d.fell = 0
        d.v = 0
      }
      if (d.phase === 'fall') {
        d.v += G * dt
        d.fell += d.v * dt
        if (d.fell >= heightAbove(k)) d.phase = 'done'
      }
    })
  }
  /** the drop's radius (m) now: growing while it forms (one that stays glints at the end of it), full while it falls, shrinking on the leaf, nothing otherwise */
  size(k: number) {
    const d = this.drips[k]
    if (!d) return 0
    if (d.phase === 'form') {
      const g = d.stay ? (d.t - (DRIP_FORM_S - DRIP_STAY.glintS)) / DRIP_STAY.glintS : -1
      const glint = g > 0 && g < 1 ? 1 + DRIP_STAY.swell * Math.sin(Math.PI * g) : 1
      return DRIP_R * (0.15 + 0.85 * ease(d.t / DRIP_FORM_S)) * glint
    }
    if (d.phase === 'shrink') return DRIP_R * (1 - ease(Math.min(1, d.t / DRIP_STAY.shrinkS)))
    return d.phase === 'fall' ? DRIP_R : 0
  }
  /** how far below its leaf's tip the drop is (m): hanging a little under it while it forms */
  below(k: number) {
    const d = this.drips[k]
    if (!d) return 0
    // hanging under the tip by its own size while it forms or shrinks
    return d.phase === 'fall' ? d.fell + DRIP_R : this.size(k)
  }
}
