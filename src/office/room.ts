// ONE source of truth for the room's geometry (#109). The glb's `room` node carries extras room = [HX, HZ, WALL_H]
// (half width x, half depth z, wall height); the defaults below are the same numbers, so the app works before the
// model is read. Pure data + small functions: no three.js.

export type WallId = 'n' | 'e' | 's' | 'w'

/** the room: inner faces of the four walls. Mutated once by setRoomFromExtras when the glb is loaded. */
export const ROOM = { hx: 4.8, hz: 4.1, wallH: 2.6 }

/** read userData.room of the `room` node; ignores anything that is not three positive finite numbers */
export function setRoomFromExtras(extras: unknown): boolean {
  if (!Array.isArray(extras) || extras.length < 3) return false
  const [hx, hz, h] = extras.map(Number)
  if (![hx, hz, h].every((v) => Number.isFinite(v) && v > 0)) return false
  ROOM.hx = hx
  ROOM.hz = hz
  ROOM.wallH = h
  return true
}

export const floorRect = () => ({ minX: -ROOM.hx, maxX: ROOM.hx, minZ: -ROOM.hz, maxZ: ROOM.hz })

/** default camera / target (#280: the 9.6 x 8.2 m room; the old view direction, 14.7 m from the target: measured on screen the robots are 95 % of the old robot size, and the whole room is inside the frame at 1280 x 800) and the floor lamp's point light */
export const DEFAULT_CAMERA = [9.56, 7.8, 10.54] as const
export const DEFAULT_TARGET = [1.0, 0.6, 1.0] as const
export const CAMERA_FAR = 80
export const LAMP_POS = [1.95, 1.55, 3.8] as const

export const WALL_THICKNESS = 0.14

/** fallback cap rect of a wall (the glb's own wall box wins at runtime): centre and size on the ground plane */
export function wallRect(w: WallId): { cx: number; cz: number; sx: number; sz: number } {
  const t = WALL_THICKNESS
  const { hx, hz } = ROOM
  switch (w) {
    case 'n': return { cx: 0, cz: -hz - t / 2, sx: 2 * hx + 2 * t, sz: t }
    case 's': return { cx: 0, cz: hz + t / 2, sx: 2 * hx + 2 * t, sz: t }
    case 'w': return { cx: -hx - t / 2, cz: 0, sx: t, sz: 2 * hz }
    case 'e': return { cx: hx + t / 2, cz: 0, sx: t, sz: 2 * hz }
  }
}
