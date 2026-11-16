// #538 (hologram.md 4.3) the hand of the hologram board: a light stone has no weight, so it is taken from the player's stone fount with one
// thumb-index pinch and put down as it is, never re-gripped. A pure timeline (numbers only, PlayStage turns them into poses), anchored on the
// moment the stone lands, which gameAt keeps at the end of the thinking + 0.9 s (omok.ts HAND_MS · PLACE_AT): so the board, the sounds and the
// timelapse are where they were.
//
//   0 – 0.25 s        the hand comes from its rest to 4 cm over the fount and waits there while the player thinks ("멈칫")
//   L−0.74 – L−0.62   the thumb and the index open (2.4 cm)
//   L−0.62 – L−0.50   down to the fount, the pinch closes: the stone is made between the fingers (holo.pick, the fount flashes)
//   L−0.50 – L−0.10   an arc to 2 cm over the intersection (at most 6 cm over the board)
//   L−0.10 – L        down; the stone lands at L (holo.place, the ripple)
//   L – L+0.10        the pinch opens 1 cm, the hand lifts 0.5 cm
//   L+0.10 – L+0.43   back up and toward the body to its rest

import { ease } from './choreo'

export const PINCH = {
  /** the hand reaches the fount's hover, ms after the move began */
  reach: 250,
  /** the hover over the fount while thinking, m (the stone's centre over the fount) */
  hoverH: 0.04,
  /** ms before the landing: the fingers open, the descent to the fount begins, the pinch closes (the pick), the arc ends */
  openFrom: 740,
  pinchFrom: 620,
  pickAt: 500,
  arcEnd: 100,
  /** the arc ends this high over the intersection, and rises at most this high over the board, m */
  overCell: 0.02,
  arcTop: 0.06,
  /** after the landing: the pinch opens and the hand lifts (ms, m), then it goes back to rest (ms, m up, m toward the body) */
  release: 100,
  releaseLift: 0.005,
  back: 330,
  backRise: 0.06,
  backPull: 0.05,
} as const

export type PinchStage = 'rest' | 'reach' | 'hover' | 'pinch' | 'arc' | 'descend' | 'release' | 'back'

export interface Pinch {
  stage: PinchStage
  /** the hand's place: 0 = its own pose, 1 = on the stone's path */
  w: number
  /** along the way from the fount (0) to the intersection (1) */
  u: number
  /** the stone's centre over the straight line from the fount to the intersection, m */
  h: number
  /** the thumb and index: 0 = their pre pose, 1 = the pinch closed on the stone; `open` widens them past the pre pose (0..1) */
  close: number
  open: number
  /** the stone is between the fingers (from the pick to the landing) */
  held: boolean
  /** the stone is on the board */
  landed: boolean
  /** after the landing: the hand's extra rise and its pull toward the body, m */
  rise: number
  pull: number
}

/** ms since the move's start of its pick and its landing */
export const pinchTimes = (thinkMs: number) => {
  const land = thinkMs + 900
  return { land, pick: land - PINCH.pickAt, end: land + PINCH.release + PINCH.back }
}

/** where the hand is `sinceMs` into a move that thinks `thinkMs` (the stone lands at thinkMs + 900) */
export function pinchSequence(sinceMs: number, thinkMs: number): Pinch {
  const s = sinceMs
  const { land, pick, end } = pinchTimes(thinkMs)
  const base: Pinch = { stage: 'rest', w: 0, u: 0, h: 0, close: 0, open: 0, held: false, landed: s >= land, rise: 0, pull: 0 }
  if (s < 0 || s >= end) return base
  const out: Pinch = { ...base, w: ease(s / PINCH.reach), h: PINCH.hoverH }
  const pinchFrom = land - PINCH.pinchFrom
  if (s < pinchFrom) {
    out.stage = s < PINCH.reach ? 'reach' : 'hover'
    out.open = ease((s - (land - PINCH.openFrom)) / (PINCH.openFrom - PINCH.pinchFrom))
    return out
  }
  if (s < pick) {
    const k = (s - pinchFrom) / (pick - pinchFrom)
    out.stage = 'pinch'
    out.open = 1 - ease(k)
    out.h = PINCH.hoverH * (1 - ease(k))
    out.close = ease((k - 0.5) * 2)
    return out
  }
  out.close = 1
  const arcEnd = land - PINCH.arcEnd
  if (s < arcEnd) {
    const k = (s - pick) / (arcEnd - pick)
    out.stage = 'arc'
    out.held = true
    out.u = ease(k)
    out.h = PINCH.overCell * ease(k) + (PINCH.arcTop - PINCH.overCell) * Math.sin(Math.PI * k)
    return out
  }
  out.u = 1
  if (s < land) {
    out.stage = 'descend'
    out.held = true
    out.h = PINCH.overCell * (1 - ease((s - arcEnd) / PINCH.arcEnd))
    return out
  }
  const since = s - land
  out.h = 0
  if (since < PINCH.release) {
    out.stage = 'release'
    const k = ease(since / PINCH.release)
    out.close = 1 - 0.5 * k
    out.rise = PINCH.releaseLift * k
    return out
  }
  const k = ease((since - PINCH.release) / PINCH.back)
  out.stage = 'back'
  out.close = 0.5 * (1 - k)
  out.w = 1 - k
  out.rise = PINCH.releaseLift + PINCH.backRise * k
  out.pull = PINCH.backPull * k
  return out
}
