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
  { name: 'plant_sofa', x: 0.925, z: 2.75, soilY: 0.02 + 0.26 - 0.015 + 0.003, r: 0.14 - 0.006 }, // monstera
  { name: 'plant_desk', x: 0.0, z: -3.2, soilY: 0.28 + 0.22 - 0.015 + 0.003, r: 0.12 - 0.006 }, // sansevieria on its stand
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
  plant_desk: { x: 0.0, z: -2.7 }, // 0.50 m, in front of the stand
  succulent: { x: -3.84, z: -1.21 }, // 0.50 m, at HUE's desk side
  vine: { x: 4.0, z: -2.86 }, // 0.50 m in front of the shelf; the vine's soil is at 2.2 m, so the can is raised to it (not on the schedule)
}
export const standOf = (p: Plant) => STANDS[p.name]
/** the plants the schedule waters (the floor plants; the desk succulent is left to its owner) */
export const WATER_PLANTS = [PLANTS[0], PLANTS[1], PLANTS[2]]
/** heading (rad, rig convention: it faces its −z) that looks from (x, z) at (tx, tz) */
export const headingTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z))

/** the stream leaves the spout along its +z at this speed, then falls (m/s, m/s²) */
export const STREAM_V = 0.5
export const G = 9.81
/** the can tips this far when pouring (grips.md: 30°) */
export const POUR_TILT = (30 * Math.PI) / 180

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
