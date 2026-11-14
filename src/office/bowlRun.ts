// #137 ① (play.md 5.5, designer's A′): an agent placing a game record alone first fetches the white bowl from the far side of the
// board with both hands and sets it down at its own right-hand corner, then sits and plays both colours; when the record is done it
// carries the bowl back. Nothing teleports: the bowl is only ever moved by two hands (#184, #228). A pure state machine like
// waterRun.ts, fed with the clock and whether the agent has arrived where it was sent; the Director turns it into goals and
// PlayStage draws the hands from the goal's stage and time.

export type BowlStage =
  /** walking to where the bowl rests */
  | 'fetch'
  /** both hands take it by the bulge and lift it into the carrying hold */
  | 'lift'
  /** carrying it in front of the body */
  | 'carry'
  /** lowering it where it goes; the hands let go */
  | 'put'

/** `out`: from its home by game_b to the corner by game_a; `home`: back */
export type BowlWay = 'out' | 'home'

export const BOWL_LABEL: Record<BowlStage, string> = {
  fetch: '돌통 가지러 가는 중',
  lift: '돌통 드는 중',
  carry: '돌통 들고 가는 중',
  put: '돌통 내려놓는 중',
}

export const BOWL_S = {
  /** reach both hands (0.3 s), close (0.15 s), lift into the hold (0.55 s) */
  lift: 1.0,
  /** lower (0.6 s), open the hands and step back a little */
  put: 1.0,
  /** the stand is taken or the way is blocked: give up the walk to the bowl after this long (nothing has moved yet) */
  walkMax: 40,
} as const

type XZ = { x: number; z: number }

/**
 * The places (the baked model, #453): the white bowl rests at (−1.61, 2.46) by game_b; the corner is to the right of the board
 * as seen from game_a (which faces +x, so its right is +z), in front of the black bowl at (−2.19, 2.46). The stands are close
 * enough for both hands to take the bowl without a long reach; the faces are the bowl.
 */
export const BOWL_HOME: XZ = { x: -1.61, z: 2.46 }
export const BOWL_CORNER: XZ = { x: -2.12, z: 2.64 }
export const BOWL_HOME_STAND: XZ = { x: -1.24, z: 2.46 }
export const BOWL_CORNER_STAND: XZ = { x: -2.5, z: 2.7 }

export interface BowlRun {
  agent: string
  way: BowlWay
  stage: BowlStage
  /** office ms the stage began */
  t0: number
  /** the schedule's block it was started in */
  block: number
}

export const startBowl = (agent: string, way: BowlWay, block: number, now: number): BowlRun => ({ agent, way, stage: 'fetch', t0: now, block })

/** the bowl is in the hands in these stages */
export const bowlHolding = (r: BowlRun) => r.stage === 'lift' || r.stage === 'carry' || r.stage === 'put'

/** the spot names the goals use (the planner takes the standing place from the goal's slot) */
export const BOWL_SPOT = { home: 'omok_bowl_home', corner: 'omok_bowl_corner' } as const

/** where the agent stands in this stage, and what it faces */
export function bowlPlace(r: BowlRun): { spot: string; stand: XZ; face: XZ } {
  // fetch / lift happen where the bowl is; carry / put where it goes
  const from = r.way === 'out' ? 'home' : 'corner'
  const to = r.way === 'out' ? 'corner' : 'home'
  const at = r.stage === 'fetch' || r.stage === 'lift' ? from : to
  return at === 'home' ? { spot: BOWL_SPOT.home, stand: BOWL_HOME_STAND, face: BOWL_HOME } : { spot: BOWL_SPOT.corner, stand: BOWL_CORNER_STAND, face: BOWL_CORNER }
}

/** one step. `done` when the bowl is down where it was going (or the walk to it was given up before it was in the hands) */
export function stepBowl(r: BowlRun, inp: { now: number; at: (spot: string) => boolean }): { run: BowlRun; done: boolean; placed: boolean } {
  const el = (inp.now - r.t0) / 1000
  const next = (stage: BowlStage): BowlRun => ({ ...r, stage, t0: inp.now })
  const here = inp.at(bowlPlace(r).spot)
  switch (r.stage) {
    case 'fetch':
      if (here) return { run: next('lift'), done: false, placed: false }
      // never reached it: nothing moved
      return el > BOWL_S.walkMax ? { run: r, done: true, placed: false } : { run: r, done: false, placed: false }
    case 'lift':
      return el >= BOWL_S.lift ? { run: next('carry'), done: false, placed: false } : { run: r, done: false, placed: false }
    case 'carry':
      // it has only two places to rest, so it is carried until it gets there
      return here ? { run: next('put'), done: false, placed: false } : { run: r, done: false, placed: false }
    case 'put':
      return el >= BOWL_S.put ? { run: r, done: true, placed: true } : { run: r, done: false, placed: false }
  }
}
