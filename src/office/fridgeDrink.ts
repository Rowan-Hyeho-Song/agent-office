// The drink taken out of the fridge (#457, docs/design/lounge-props.md 5.3 · 5.5): which one, and what becomes of it once the fridge act is over.
// The left hand carries it to wherever the agent stays next, lifts it to the face screen twice there, and after a while (or when that hand is
// wanted for something else) it fades out in 0.3 s; the live prop is then back on its shelf, unseen (loungeActs.ts puts it there only with the
// door shut). Pure: no three.js, no Date; the Director keeps one per agent and tells the stage through Goal.drink.

import { DRINK_KINDS, type DrinkKind } from './lounge'
import { hash } from './play'
import type { Pose } from './director'

export const DRINK_T = {
  /** a lift to the face and down (s), twice, `gapS` apart; the first `firstS` after arriving where it stays */
  sipS: 0.6,
  gapS: 3,
  firstS: 0.5,
  /** how long it is kept after arriving where it stays (the snack's rule, office-ui.md 12.2), and at most after taking it, s */
  keepS: 20,
  maxS: 90,
  /** the fade out, s */
  fadeS: 0.3,
  /** reduced motion: it appears in the hand this fast (watering.md 5 · paper-pass.md) */
  appearS: 0.12,
} as const

/** the poses the drink stays in the hand through (nothing else wants the left hand there); anywhere else it fades on arriving */
export const DRINK_POSES: ReadonlySet<Pose> = new Set<Pose>(['idle', 'sofa'])

/** 60 can : 40 milk; not what this agent took already today (lounge-props.md 5.3), nor what somebody else has in hand; none at night */
export function drinkPick(o: { agent: string; block: number; night: boolean; had: readonly DrinkKind[]; held: readonly DrinkKind[] }): DrinkKind | null {
  if (o.night) return null
  const left = DRINK_KINDS.filter((k) => !o.had.includes(k) && !o.held.includes(k))
  if (left.length < 2) return left[0] ?? null
  return hash(`fridge|${o.agent}|${o.block}`) % 100 < 60 ? 'can' : 'milk'
}

/** one drink in a hand */
export interface Drink {
  kind: DrinkKind
  /** when the hand took it (office ms) */
  at: number
  /** where it stays after the fridge, and since when (office ms); null while it is still on its way */
  stay: { spot: string; at: number } | null
  /** when it began to fade (office ms) */
  fadeAt: number | null
}

/** what the stage draws: s since it was taken, s since arriving where it stays (-1: not there, or no sips: reduced motion), s into the fade (-1: not fading) */
export interface DrinkView {
  kind: DrinkKind
  u: number
  sip: number
  fade: number
}

/**
 * One step once the fridge act is over. `goal` is where the agent is sent now, `arrived` whether it is there, `errand` whether that goal wants the
 * hands (an errand or an act). Returns the drink as it is now, or null when it is gone.
 */
export function stepDrink(d: Drink, o: { now: number; spot: string; pose: Pose; arrived: boolean; errand: boolean }): Drink | null {
  let next = d
  if (!next.stay && o.arrived) next = { ...next, stay: { spot: o.spot, at: o.now } }
  if (next.fadeAt === null) {
    const kept = next.stay ? o.now - next.stay.at >= DRINK_T.keepS * 1000 : false
    const wanted = o.errand || (o.arrived && !DRINK_POSES.has(o.pose))
    if (kept || wanted || o.now - next.at >= DRINK_T.maxS * 1000) next = { ...next, fadeAt: o.now }
  }
  if (next.fadeAt !== null && o.now - next.fadeAt >= DRINK_T.fadeS * 1000) return null
  return next
}

export function drinkView(d: Drink, o: { now: number; spot: string; reduced: boolean }): DrinkView {
  const there = d.stay && d.stay.spot === o.spot && !o.reduced
  return { kind: d.kind, u: (o.now - d.at) / 1000, sip: there ? (o.now - d.stay!.at) / 1000 : -1, fade: d.fadeAt === null ? -1 : (o.now - d.fadeAt) / 1000 }
}

const ease = (k: number) => {
  const c = Math.min(1, Math.max(0, k))
  return c * c * (3 - 2 * c)
}

/** the sips' start times (s since arriving where it stays) */
export const SIPS: readonly number[] = [DRINK_T.firstS, DRINK_T.firstS + DRINK_T.sipS + DRINK_T.gapS]

/** how high the drink is lifted toward the face at `sip` s (0 before the chest, 1 at the face screen): up 0.25 s, held 0.1, down 0.25, twice */
export function sipLift(sip: number): number {
  if (sip < 0) return 0
  for (const s0 of SIPS) {
    const k = sip - s0
    if (k < 0 || k > DRINK_T.sipS) continue
    return ease(k / 0.25) - ease((k - 0.35) / 0.25)
  }
  return 0
}

/** the top of a sip (the hand highest), where drink.sip sounds (sound.md 4.4) */
export const SIP_TOPS: readonly number[] = SIPS.map((s) => s + 0.25)
