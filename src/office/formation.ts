// Where a meeting stands (agents.md 2.9, #141): ONE circle of radius SEAT_R round a meeting centre. With a decision the
// circle is open toward the whiteboard (the poster walks out of the gap, nobody crowds the board); without one it
// is closed. Angles are measured from the centre, 0° = toward the board (-z), growing toward +x. Pure: no three.js.

import { facing } from './nav'

type P = { x: number; z: number }
export interface Slot extends P {
  ry: number
}

/** the ring of the model's meeting circle (nav_meet_center extras ring, 0.9 m, desks.md 2.1.2) */
export const SEAT_R = 0.9
/**
 * The board side (0° ± 60°) stays empty in an open circle. Three and four seats stand 66-67° apart (the design says 60° and 50°: 0.75 m and 0.63 m): the traffic
 * planner keeps resting agents 2R + planGap = 0.72 m apart, and a cell of its grid can shift a seat by up to a cell's half diagonal
 * (0.1 m), so a pair that close never settled in the scene. 0.82 m settles wherever the cells fall.
 */
const OPEN: Record<number, number[]> = { 1: [180], 2: [90, 270], 3: [113, 180, 247], 4: [80, 147, 213, 280] }
const CLOSED: Record<number, number[]> = { 1: [180], 2: [90, 270], 3: [60, 180, 300], 4: [45, 135, 225, 315] }

/** `count` seats round `centre`, every one facing the centre; seat i of the script takes slot i */
export function formation(centre: P & { ry?: number }, count: number, open: boolean): Slot[] {
  // 0° is the board side: the centre's ry is the way to the whiteboard (nav_meet_center extras), so the whole ring turns by -ry
  const turn = -(centre.ry ?? 0)
  const angles = (open ? OPEN : CLOSED)[Math.min(4, Math.max(1, count))]
  return angles.slice(0, count).map((deg) => {
    const a = (deg * Math.PI) / 180 + turn
    const p = { x: centre.x + Math.sin(a) * SEAT_R, z: centre.z - Math.cos(a) * SEAT_R }
    return { ...p, ry: facing(p, centre) }
  })
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** the same seat turned `deg` toward `target` from where it faces now (never further than the target direction) */
export function turnToward(slot: Slot, target: P, deg: number): Slot {
  const d = wrap(facing(slot, target) - slot.ry)
  const m = (deg * Math.PI) / 180
  return { ...slot, ry: wrap(slot.ry + Math.max(-m, Math.min(m, d))) }
}

/** one step back from the centre (m further out), turned to face `toward` (null: straight outward) */
export function stepBack(centre: P, slot: Slot, m: number, toward: P | null): Slot {
  const d = Math.hypot(slot.x - centre.x, slot.z - centre.z) || 1
  const p = { x: slot.x + ((slot.x - centre.x) / d) * m, z: slot.z + ((slot.z - centre.z) / d) * m }
  return { ...p, ry: toward ? facing(p, toward) : facing(p, { x: p.x + (p.x - centre.x), z: p.z + (p.z - centre.z) }) }
}
