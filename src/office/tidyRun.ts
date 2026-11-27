// #718 ②-b (play.md 9.7 ①, #732): the one left at a broken ping-pong game tidies the table. Pure: no three.js, no Date.
//   take       at its own end: its own paddle into the left hand, blade up (a tray)
//   toBall     along the north side to the ball (its home by the net, 3D #735)
//   pick       the right hand picks the ball up …
//   lay        … and lays it on the left paddle's blade
//   toPartner  to the partner's end
//   grip       the right hand takes the partner's paddle by its handle
//   toSide     to pp_side, by the net on the north side
//   put        both paddles laid side by side (pp_tidy_paddle_a / _b), the ball staying on the one it rides
// A walk that does not arrive in TIDY_S.walkMax goes on to the next stage anyway (another body in the way): the tidy-up never hangs.

export type TidyStage = 'take' | 'toBall' | 'pick' | 'lay' | 'toPartner' | 'grip' | 'toSide' | 'put'
export type Side = 'a' | 'b'

export interface TidyRun {
  /** the end the agent played from: its own paddle */
  own: Side
  /** the stay it belongs to (one tidy-up per broken game) */
  block: number
  stage: TidyStage
  /** office ms the stage began */
  t0: number
}

/** each timed stage, s; walkMax: the longest a walk waits for its arrival */
export const TIDY_S = { take: 1.0, pick: 0.9, lay: 0.6, grip: 0.9, put: 1.4, walkMax: 6 } as const

const NEXT: Record<TidyStage, TidyStage | null> = { take: 'toBall', toBall: 'pick', pick: 'lay', lay: 'toPartner', toPartner: 'grip', grip: 'toSide', toSide: 'put', put: null }
const WALKS: ReadonlySet<TidyStage> = new Set(['toBall', 'toPartner', 'toSide'])

export const other = (s: Side): Side => (s === 'a' ? 'b' : 'a')
export const startTidy = (own: Side, block: number, now: number): TidyRun => ({ own, block, stage: 'take', t0: now })

/** the place of a stage: where the body stands (a spot; the ball's stand is a slot by the net) */
export function tidyPlace(run: TidyRun): 'own' | 'ball' | 'partner' | 'side' {
  if (run.stage === 'take') return 'own'
  if (run.stage === 'toBall' || run.stage === 'pick' || run.stage === 'lay') return 'ball'
  if (run.stage === 'toPartner' || run.stage === 'grip') return 'partner'
  return 'side'
}

/** advance one frame; `done` once both paddles are down */
export function stepTidy(run: TidyRun, inp: { now: number; arrived: (place: ReturnType<typeof tidyPlace>) => boolean }): { run: TidyRun; done: boolean } {
  const r = { ...run }
  for (let guard = 0; guard < 8; guard++) {
    const el = (inp.now - r.t0) / 1000
    if (WALKS.has(r.stage)) {
      if (!inp.arrived(tidyPlace(r)) && el < TIDY_S.walkMax) break
    } else if (r.stage === 'take') {
      if (!inp.arrived('own') && el < TIDY_S.walkMax) break
      if (inp.arrived('own') && el < TIDY_S.take) break
    } else if (el < TIDY_S[r.stage as 'pick' | 'lay' | 'grip' | 'put']) break
    const next = NEXT[r.stage]
    if (!next) return { run: r, done: true }
    r.stage = next
    r.t0 = inp.now
  }
  return { run: r, done: false }
}

/** what each hand holds in a stage: the left its own paddle from `take` to the end of `put`; the right the ball (pick), then the partner's paddle (grip on) */
export function tidyHands(stage: TidyStage): { left: boolean; right: 'ball' | 'paddle' | null } {
  const right = stage === 'pick' || stage === 'lay' ? 'ball' : stage === 'grip' || stage === 'toSide' || stage === 'put' ? 'paddle' : null
  return { left: true, right }
}

/** the ball rides on the left paddle's blade from the end of `lay` on */
export const ballOnBlade = (stage: TidyStage) => stage === 'toPartner' || stage === 'grip' || stage === 'toSide' || stage === 'put'
