// ONE source of truth for the room's geometry (#109). The glb's `room` node carries extras room = [HX, HZ, WALL_H]
// (half width x, half depth z, wall height); the defaults below are the same numbers, so the app works before the
// model is read. Pure data + small functions: no three.js.

export type WallId = 'n' | 'e' | 's' | 'w'

/** the room: inner faces of the four walls. Mutated once by setRoomFromExtras when the glb is loaded. */
export const ROOM = { hx: 4.5, hz: 3.5, wallH: 2.6 }

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

/** default camera / target (the designer-approved framing) and the floor lamp's point light */
export const DEFAULT_CAMERA = [8.5, 8.0, 9.5] as const
export const DEFAULT_TARGET = [-0.3, 0.6, -0.3] as const
export const CAMERA_FAR = 80
export const LAMP_POS = [3.5, 1.55, 2.85] as const

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
