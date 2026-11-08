// The numbers of the room enter/exit animation (rowansong.dev #6 spec, section 8). Same names as the desk's
// DOOR_FX; only the office-side ones are used here. Swap values here, nothing else changes.
export const DOOR_FX = {
  officeIntroMs: 1600, // O: camera from the door back to the default view, power2.out
  officeDoorDist: 2.4, // m in front of the door screen (2.0-2.6 if furniture gets in the way)
  exitLeadMs: 450,
  // extras (not in the spec's block)
  x1Ms: 700, // X1: dive into the door screen, power3.in
  x1Dist: 0.35, // m from the screen where the dive ends
  introRiseShare: 0.4, // the path has risen most of its height by this share of the time
  introRise: 0.9, // ...this much of it
  enteredTimeoutMs: 5000, // no `entered` from the desk: pull back on our own
  pressFlashMs: 80, // door screen: one amber 60% flash
  pressFlashAlpha: 0.6,
  reducedDimMs: 120,
} as const
