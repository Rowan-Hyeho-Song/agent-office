// Watering as an errand (#228): the can is taken from where it rests, carried to the plant, and carried back and put down. Pure and
// deterministic like wrap.ts: a small state machine fed with the clock and whether the agent has arrived where it was sent, and the one
// place that says which stage it is in (the Director turns it into goals, PlayStage draws the hands from the goal's stage and time).
// The design: docs/design/watering.md (#185), grips.md; the rule (#184, #228): no prop moves on its own, a hand takes it where it rests.

import { CAN_HOME, WATER_PLANTS, canStand, pourTotal, standOf, type Plant } from './water'

export type WaterStage =
  /** walking to the can's stand */
  | 'fetch'
  /** the hand takes hold of the handle and lifts (grip: reach, close, then the can rises into the carrying hold) */
  | 'lift'
  /** carrying it to the plant's stand */
  | 'carry'
  /** settle, tip, pour, tip back (water.ts pourAt) */
  | 'pour'
  /** carrying it back to the can's stand */
  | 'return'
  /** lowered to where it came from, the hand lets go */
  | 'put'

/** what each stage shows (the debug panel; the chip when the agent is called to work while it still holds the can) */
export const WATER_LABEL: Record<WaterStage, string> = {
  fetch: '물뿌리개 가지러 가는 중',
  lift: '물뿌리개 드는 중',
  carry: '물뿌리개 들고 가는 중',
  pour: '물 주는 중',
  return: '물뿌리개 갖다 두는 중',
  put: '물뿌리개 내려놓는 중',
}

export const WATER_S = {
  /** the hand reaches (0.3 s), closes (0.12 s), and the can rises into the carrying hold (0.35 s) */
  lift: 1.0,
  /** lowering it to where it rests, then the hand opens and lets go */
  lower: 0.6,
  put: 1.0,
  /** reduced motion: nothing walks and nothing flies, the can is just in the hand while it pours and gone from it after */
  putReduced: 0.3,
  /** the stand is taken (an agent in the way never leaves, the planner keeps waiting): give up the walk after this long. Not yet holding the can: forget it; holding it: bring it back unused */
  fetchMax: 45,
  carryMax: 30,
} as const

/** the spots the errand's goals are labelled with (the planner takes the standing place from the goal's slot) */
export const CAN_SPOT = 'water_can'
export const plantSpot = (plant: string) => `water_${plant}`

export interface WaterRun {
  /** the plant it waters */
  plant: string
  /** the schedule's block it belongs to (a finished block is not started again) */
  block: number
  stage: WaterStage
  /** office ms the stage began */
  t0: number
  /** reduced motion (watering.md 5): it walks to the plant empty-handed, the can is in its hand only while it pours, and gone from it after: nothing is carried, nothing flies */
  reduced: boolean
}

export const plantByName = (name: string): Plant => WATER_PLANTS.find((p) => p.name === name) ?? WATER_PLANTS[0]

export const startWater = (plant: string, block: number, now: number, reduced: boolean): WaterRun => ({ plant, block, stage: reduced ? 'carry' : 'fetch', t0: now, reduced })

/** the can is in the hand in these stages (an agent called away in one of them first finishes bringing it back); reduced motion walks empty-handed */
export const holding = (run: WaterRun) => (run.stage === 'carry' && !run.reduced) || run.stage === 'pour' || run.stage === 'return' || run.stage === 'put'

/** advance one frame; `done` once the can is down and let go */
export function stepWater(run: WaterRun, inp: { now: number; at: (spot: string) => boolean }): { run: WaterRun; done: boolean } {
  const r = { ...run }
  for (let guard = 0; guard < 6; guard++) {
    const el = (inp.now - r.t0) / 1000
    if (r.stage === 'fetch') {
      if (!inp.at(CAN_SPOT)) {
        if (el > WATER_S.fetchMax) return { run: r, done: true }
        break
      }
      r.stage = 'lift'
    } else if (r.stage === 'lift') {
      if (el < WATER_S.lift) break
      r.stage = 'carry'
    } else if (r.stage === 'carry') {
      if (!inp.at(plantSpot(r.plant))) {
        if (el <= WATER_S.carryMax) break
        if (r.reduced) return { run: r, done: true }
        r.stage = 'return'
      } else r.stage = 'pour'
    } else if (r.stage === 'pour') {
      if (el < pourTotal(r.plant)) break
      r.stage = r.reduced ? 'put' : 'return'
    } else if (r.stage === 'return') {
      if (!inp.at(CAN_SPOT)) break
      r.stage = 'put'
    } else {
      if (el < (r.reduced ? WATER_S.putReduced : WATER_S.put)) break
      return { run: r, done: true }
    }
    r.t0 = inp.now
  }
  return { run: r, done: false }
}

/** where the body is sent and how it faces, for a run's stage */
export function placeOf(run: WaterRun): { spot: string; stand: { x: number; z: number }; face: { x: number; z: number } } {
  const plant = plantByName(run.plant)
  // reduced motion: everything happens at the plant's stand
  const atPlant = run.reduced || run.stage === 'carry' || run.stage === 'pour'
  return atPlant
    ? { spot: plantSpot(plant.name), stand: standOf(plant), face: { x: plant.x, z: plant.z } }
    : { spot: CAN_SPOT, stand: canStand(), face: { x: CAN_HOME.x, z: CAN_HOME.z } }
}
