// Watering (#184): the stream has to land on the plant's soil, not the floor. Pure maths: the plants' soil (centre, height, radius),
// where the can is held for a plant, and where the stream from the spout lands. The soil numbers come from office_bake.py's pot3():
// soil top = pot base + pot height − 1.5 cm + 3 mm, radius = pot top radius − 6 mm.

import { Matrix4, Quaternion, Vector3, type Object3D } from 'three'

export interface Plant {
  name: string
  /** soil centre (x, z), soil surface height, soil circle radius, m */
  x: number
  z: number
  soilY: number
  r: number
}

/** the four plants of the office (office_bake.py PLANTS and the desk succulent) */
export const PLANTS: Plant[] = [
  { name: 'plant_corner', x: 4.22, z: 3.18, soilY: 0.02 + 0.36 - 0.015 + 0.003, r: 0.19 - 0.006 }, // fiddle-leaf fig
  { name: 'plant_sofa', x: 0.905, z: 2.75, soilY: 0.02 + 0.26 - 0.015 + 0.003, r: 0.14 - 0.006 }, // monstera
  { name: 'plant_desk', x: -3.75, z: -3.2, soilY: 0.28 + 0.22 - 0.015 + 0.003, r: 0.12 - 0.006 }, // sansevieria on its stand, at the window's west end since #195
  { name: 'succulent', x: -4.32, z: -1.36, soilY: 0.74 + 0.05 - 0.015 + 0.003, r: 0.04 - 0.006 }, // 휴's desk
]

/** the plant the first test and the debug tools use */
export const WATERED = PLANTS[0]

/**
 * Where an agent stands to water each plant: beside the pot, as close as the walkable floor allows (the planter and canopy block the grid
 * within about 0.45 m of the fig and the desk's sansevieria; the grid planner can walk to each of these, propsHome / water tests check it).
 * Found by scanning the floor around each pot, room side first, then around to the opposite side.
 */
export const STANDS: Record<string, { x: number; z: number }> = {
  plant_corner: { x: 4.14, z: 2.59 }, // 0.60 m, on the room side of the corner
  plant_sofa: { x: 1.13, z: 2.35 }, // 0.45 m, between the side table and the sofa's front
  plant_desk: { x: -3.75, z: -2.7 }, // 0.50 m, in front of the stand (found by scanning the walkable footprint, stream error < 0.7 soil radius)
  succulent: { x: -3.84, z: -1.21 }, // 0.50 m, at HUE's desk side
  // the can's own stand (#228, #259): where the agent takes the can up and puts it back. Since #259 the can rests on its low stand in front of the
  // fig (CAN_HOME), 0.46 m from the fig's own stand: the same floor, within arm's reach of both (watering.md 1.1). So watering the fig is turning
  // to the can, lifting it, turning back to the pot, pouring and putting it back without a step; for the other plants it is taken from here
  watering_can: { x: 4.14, z: 2.59 },
  vine: { x: 4.0, z: -2.86 }, // 0.50 m in front of the shelf; the vine's soil is at 2.2 m, so the can is raised to it (not on the schedule)
}
export const standOf = (p: Plant) => STANDS[p.name]
/** where the watering can rests (office_bake.py: prop_watering_can; docs/design/watering.md) and the stand to take it from / put it back on */
export const CAN_HOME = { x: 3.68, z: 2.65, y: 0.595 } // on its stand in front of the fig, spout south-west (#259, office.glb prop_watering_can)
export const canStand = () => STANDS.watering_can
/**
 * How far from its body an agent can take hold of or carry something (m, horizontal, from the body's centre). The hands' own poses
 * (rig.ts handPose) reach 0.6 m ahead at most (the wrap-up's card at the board: 0.1 sideways, 0.6 forward); 0.75 leaves 0.15 m for the
 * body leaning in and the width of the thing held. Anything further is a hand flying to a prop, not an arm reaching.
 */
export const REACH = 0.75
/**
 * A stand an agent cannot use while another agent rests at one of these spots: they are closer than two body radii (0.6 m) plus the planner's gap, so
 * the planner would keep the water agent waiting for as long as the other stays. plant_sofa's stand is 0.58 m from the sofa's first seat.
 */
export const STAND_BLOCKERS: Record<string, string[]> = { plant_sofa: ['sofa_0'], plant_desk: ['desk_side_0'] }
/**
 * A plant whose stand cannot be reached while another agent rests at one of these spots (the way there runs past it). plant_desk stands in the
 * pocket at the window's west end (#195): the only way in is the north lane past the memo seat, 0.41 m of free floor beside a seated body when the
 * planner needs 0.44 + its gap, and the west lane (work_1, work_2) is as narrow. So the plant is skipped while the memo seat is taken (its owner can still water it).
 */
export const PATH_BLOCKERS: Record<string, string[]> = { plant_desk: ['work_0'] }
/** the plants the schedule waters (the floor plants; the desk succulent is left to its owner) */
export const WATER_PLANTS = [PLANTS[0], PLANTS[1], PLANTS[2]]
/** heading (rad, rig convention: it faces its −z) that looks from (x, z) at (tx, tz) */
export const headingTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z))

/** the stream leaves the spout along its +z at this speed, then falls (m/s, m/s²) */
export const STREAM_V = 0.5
export const G = 9.81
/** the can tips this far when pouring (grips.md: 30°) */
export const POUR_TILT = (30 * Math.PI) / 180

/** the can carried at the side, the hand hanging 0.55 m high (watering.md 2: arm straight down) */
export const CARRY_HOLD: Hold = { fwd: 0.06, lat: 0.22, y: 0.55 }

/** how long the stages of one watering last, s: settle the can up to the pour hold, tip, hold (per plant: watering.md 1), tip back, lower it to the carrying hold */
export const POUR_S = { settle: 0.5, up: 0.6, down: 0.6, back: 0.4 }
export const POUR_HOLD_S: Record<string, number> = { plant_corner: 1.6, plant_sofa: 1.4, plant_desk: 0.8 }
export const pourHoldOf = (plant: string) => POUR_HOLD_S[plant] ?? 1.2
export const pourTotal = (plant: string) => POUR_S.settle + POUR_S.up + pourHoldOf(plant) + POUR_S.down + POUR_S.back

/**
 * The pour at `u` s after arriving at the plant's stand: how far the can is from the carrying hold to the pour hold (0 … 1) and how far
 * it is tipped (0 … 1). Settle up to the hold, tip, pour, tip back, then lower it again: continuous everywhere, so the can never jumps.
 */
export function pourAt(plant: string, u: number): { hold: number; tilt: number } {
  const e = (k: number) => {
    const c = Math.min(1, Math.max(0, k))
    return c * c * (3 - 2 * c)
  }
  const { settle, up, down, back } = POUR_S
  const t1 = settle
  const t2 = t1 + up
  const t3 = t2 + pourHoldOf(plant)
  const t4 = t3 + down
  return { hold: e(u / settle) * (1 - e((u - t4) / back)), tilt: e((u - t1) / up) * (1 - e((u - t3) / down)) }
}

/** a hold part of the way from `a` to `b` */
export const lerpHold = (a: Hold, b: Hold, k: number): Hold => ({ fwd: a.fwd + (b.fwd - a.fwd) * k, lat: a.lat + (b.lat - a.lat) * k, y: a.y + (b.y - a.y) * k })

const UP = new Vector3(0, 1, 0)
const AXIS_Y = new Vector3(0, 1, 0)
const AXIS_Z = new Vector3(0, 0, 1)

export interface Hold {
  /** how far in front of the body (m, along the heading) and sideways to the right the can's origin is, and how high */
  fwd: number
  lat: number
  y: number
}
export const HOLD_DEFAULT: Hold = { fwd: 0.36, lat: 0.2, y: 1.02 }

/** the can's world pose for a body at (x, z) facing `heading`, held at `hold`, tipped by `tilt` (0 … 1 of POUR_TILT) */
export function canPose(x: number, z: number, heading: number, hold: Hold, tilt: number, out = new Matrix4()): Matrix4 {
  const body = new Quaternion().setFromAxisAngle(AXIS_Y, heading)
  const right = new Vector3(1, 0, 0).applyQuaternion(body)
  const fwd = new Vector3(0, 0, -1).applyQuaternion(body)
  const pos = new Vector3(x, hold.y, z).addScaledVector(right, hold.lat).addScaledVector(fwd, hold.fwd)
  // the spout (+x of the can) points forward, then tips down about the can's own z
  const q = body.clone().multiply(new Quaternion().setFromAxisAngle(AXIS_Y, Math.PI / 2)).multiply(new Quaternion().setFromAxisAngle(AXIS_Z, -POUR_TILT * tilt))
  return out.compose(pos, q, new Vector3(1, 1, 1))
}

/** the spout's tip and the water's direction in the world for a can pose (`spoutLocal`: the spout node in the can's frame, +z = water) */
export function spoutOf(can: Matrix4, spoutLocal: Matrix4) {
  const m = new Matrix4().multiplyMatrices(can, spoutLocal)
  return { tip: new Vector3().setFromMatrixPosition(m), dir: new Vector3(0, 0, 1).transformDirection(m) }
}

/** a drop `tau` seconds after leaving the spout */
export function dropAt(tip: Vector3, dir: Vector3, tau: number, out = new Vector3()) {
  out.copy(tip).addScaledVector(dir, STREAM_V * tau)
  out.y -= 0.5 * G * tau * tau
  return out
}

/** where the stream meets the height `y`: the time since the spout and the point, or null if it never gets down to it */
export function landing(tip: Vector3, dir: Vector3, y: number): { tau: number; at: Vector3 } | null {
  // tip.y + v·dir.y·τ − g/2·τ² = y
  const a = -0.5 * G
  const b = STREAM_V * dir.y
  const c = tip.y - y
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const tau = (-b - Math.sqrt(disc)) / (2 * a)
  return tau > 0 ? { tau, at: dropAt(tip, dir, tau) } : null
}

export interface Pour {
  hold: Hold
  /** where the stream lands on the soil plane, and its distance from the soil centre, m */
  at: Vector3
  err: number
  tip: Vector3
}

/**
 * Where to hold the can so the stream lands on the middle of `plant`'s soil: the can's forward and sideways offset from the body,
 * found by a small search (the spout's place in the can comes from the model). The body stands at (x, z) facing `heading`.
 */
export function solvePour(plant: Plant, x: number, z: number, heading: number, spoutLocal: Matrix4): Pour {
  const goal = new Vector3(plant.x, plant.soilY, plant.z)
  const eval_ = (hold: Hold) => {
    const { tip, dir } = spoutOf(canPose(x, z, heading, hold, 1), spoutLocal)
    const l = landing(tip, dir, plant.soilY)
    return { tip, at: l ? l.at : new Vector3(1e3, 0, 1e3), err: l ? l.at.distanceTo(goal) : 1e3 }
  }
  // the can's height too: a plant on a high shelf (the vine, soil at 2.2 m) is reached by raising it; low plants keep it near the chest
  const cost = (h: Hold) => {
    const r = eval_(h)
    // the stream lands on the middle, and the spout itself is over the soil too (not beside the pot)
    const tipOff = Math.hypot(r.tip.x - plant.x, r.tip.z - plant.z)
    return { r, c: r.err + 0.01 * Math.abs(h.y - HOLD_DEFAULT.y) + 2 * Math.max(0, tipOff - 0.6 * plant.r) }
  }
  let hold: Hold = { ...HOLD_DEFAULT, y: Math.max(HOLD_DEFAULT.y, plant.soilY + 0.45) }
  let cur = cost(hold)
  let best = cur.r
  let step = 0.2
  for (let it = 0; it < 300 && step > 1e-5; it++) {
    let moved = false
    for (const [df, dl, dy] of [[step, 0, 0], [-step, 0, 0], [0, step, 0], [0, -step, 0], [0, 0, step], [0, 0, -step], [step, step, 0], [-step, -step, 0], [step, -step, 0], [-step, step, 0]] as const) {
      const h = { fwd: Math.min(0.9, Math.max(0.15, hold.fwd + df)), lat: Math.min(0.4, Math.max(-0.15, hold.lat + dl)), y: Math.min(2.5, Math.max(0.8, hold.y + dy)) }
      const r = cost(h)
      if (r.c < cur.c - 1e-9) {
        hold = h
        cur = r
        best = r.r
        moved = true
      }
    }
    if (!moved) step *= 0.5
  }
  return { hold, at: best.at, err: best.err, tip: best.tip }
}

/** the plant in front of a body (the nearest one within `reach` m, roughly ahead), or null */
export function plantAhead(x: number, z: number, heading: number, reach = 1.6, plants: Plant[] = PLANTS): Plant | null {
  const fx = -Math.sin(heading)
  const fz = -Math.cos(heading)
  let best: Plant | null = null
  let bd = reach
  for (const p of plants) {
    const dx = p.x - x
    const dz = p.z - z
    const d = Math.hypot(dx, dz)
    if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.5) {
      best = p
      bd = d
    }
  }
  return best
}
void UP

/**
 * The soil of each plant from the model's empties (`soil_<plant>`: at the middle of the soil top, extras r = the soil circle's radius),
 * or the estimate above where the model has none. A model with soil empties waters exactly the plants that have one.
 */
export function plantsFrom(scene: { getObjectByName(n: string): Object3D | undefined }): Plant[] {
  const out: Plant[] = []
  const names = [...PLANTS.map((p) => p.name), 'vine']
  for (const name of names) {
    const o = scene.getObjectByName('soil_' + name)
    if (!o) continue
    const w = o.getWorldPosition(new Vector3())
    const est = PLANTS.find((p) => p.name === name)
    out.push({ name, x: w.x, z: w.z, soilY: w.y, r: (o.userData.r as number | undefined) ?? est?.r ?? 0.06 })
  }
  return out.length ? out : PLANTS
}
