// The owner's line of a replayed meeting, shown on the door screen as a `ROWAN` message (plan.md 6.4: the office has no
// owner model, the door is where the owner "is"). The scene sets it; Door.tsx reads it each frame and redraws on change.

export interface DoorMessage {
  /** what shows so far (typed) */
  text: string
  /** a SECRET line: drawn as black bars, never as words */
  masked: boolean
}

let current: DoorMessage | null = null

export const getDoorMessage = () => current

/** set (or clear with null); the same content keeps the same object, so a snapshot read never changes without a change */
export function setDoorMessage(m: DoorMessage | null) {
  if (m === current) return
  if (m && current && m.text === current.text && m.masked === current.masked) return
  current = m
}
