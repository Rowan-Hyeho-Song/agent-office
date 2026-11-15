// #455 (office-ui.md 12.2): a visitor's treat taken in a free hand by a robot resting or playing. The flying icon reaches the hand, the hand closes on the
// treat (the baked prop_treat_<kind>), holds it before the chest for holdS, a coffee is sipped once, then it fades out of the hand. Pure: the times and the
// hold's place in the body's frame; PlayStage drives the hand and draws the prop.

import type { TreatKind } from '../visit/treat'

export type SnackKind = Exclude<TreatKind, 'cheer'>

export const TREAT_PROP: Record<SnackKind, string> = { coffee: 'prop_treat_coffee', cookie: 'prop_treat_cookie', apple: 'prop_treat_apple' }

export const TREAT_HOLD = {
  /** the hand comes up to the hold (the treat appears in it as the icon lands) */
  reachS: 0.35,
  /** it is in the hand this long, then fades */
  holdS: 8,
  fadeS: 0.4,
  /** the hand goes back to its own pose */
  letGoS: 0.3,
  /** a coffee: one sip from sipAt, up and back down over sipS (the rim to the face screen's bottom edge, #457's height) */
  sipAt: 2.5,
  sipS: 0.7,
  /** treat.take sounds once the hand has it; within takeGapS of treat.arrive only treat.arrive sounds (sound.md 4.4) */
  takeAtS: 0.35,
  takeGapS: 0.2,
  /** the hold before the chest, from the head's rest (body frame: x toward the hand's side, y under the head, z forward) */
  hold: { side: 0.14, belowHead: 0.2, forward: 0.27 },
  /** the sip: before the face, the cup tipped back */
  sip: { belowHead: 0.1, forward: 0.17, tiltDeg: 35 },
} as const

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

/** the hold at `u` s since the treat landed: the hand's weight, how much of the treat shows, how far a sip has lifted it (0 … 1); null once it is over */
export function treatPhase(kind: SnackKind, u: number, reduced: boolean): { w: number; opacity: number; sip: number } | null {
  const end = TREAT_HOLD.holdS + Math.max(TREAT_HOLD.fadeS, TREAT_HOLD.letGoS)
  if (u < 0 || u >= end) return null
  const w = u < TREAT_HOLD.holdS ? (reduced ? 1 : smooth(u / TREAT_HOLD.reachS)) : 1 - (reduced ? 1 : smooth((u - TREAT_HOLD.holdS) / TREAT_HOLD.letGoS))
  const opacity = u < TREAT_HOLD.holdS ? 1 : reduced ? 0 : 1 - smooth((u - TREAT_HOLD.holdS) / TREAT_HOLD.fadeS)
  const k = (u - TREAT_HOLD.sipAt) / TREAT_HOLD.sipS
  const sip = kind !== 'coffee' || reduced || k <= 0 || k >= 1 ? 0 : Math.sin(k * Math.PI)
  return { w, opacity, sip }
}

/** whether treat.take sounds (it is not when the hand closes within takeGapS of the arrival) */
export const takeSounds = () => TREAT_HOLD.takeAtS >= TREAT_HOLD.takeGapS
/** the top of the sip (drink.sip, sound.md 4.4) */
export const SIP_TOP_S = TREAT_HOLD.sipAt + TREAT_HOLD.sipS / 2
