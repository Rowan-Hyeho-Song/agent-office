// Reading as an errand (#280, docs/design/lounge-props.md 3): the book is taken from the low table, read sitting on the sofa, and put back where it came
// from. Pure and deterministic like waterRun.ts: a small state machine fed with the clock and whether the agent has arrived where it was sent, and the one
// place that says which stage it is in (the Director turns it into goals, PlayStage draws the hands from the goal's stage and time). The rule (#184, #228):
// no prop moves on its own, a hand takes it where it rests and puts it back there.

export type ReadStage =
  /** walking to the stand beside the table */
  | 'fetch'
  /** the hand takes hold of the book where it rests and lifts it (grip: reach, close, rise into the carrying hold) */
  | 'pick'
  /** carrying it to the sofa seat and sitting down */
  | 'carry'
  /** seated, the book open (150°), a leaf turns now and then */
  | 'read'
  /** standing up and carrying it back to the stand */
  | 'return'
  /** closed and lowered to where it came from, the hand lets go */
  | 'put'

export const READ_LABEL: Record<ReadStage, string> = {
  fetch: '책 가지러 가는 중',
  pick: '책 집는 중',
  carry: '책 들고 앉으러 가는 중',
  read: '책 읽는 중',
  return: '책 갖다 두러 가는 중',
  put: '책 내려놓는 중',
}

export const READ_S = {
  /** the hand reaches (0.3 s), closes (0.12 s) and the book rises into the carrying hold (0.35 s): at the table's east end the stop is under 1.5 s (lounge-props.md 3) */
  pick: 1.0,
  /** seated and reading, to the end of the last leaf that fits (a leaf every 6 s) */
  read: 60,
  /** seated: it opens (and the right hand comes to it) in `open` s; `close` s before the end of the reading it closes again; then lowering it to where it rests, and the hand opens and lets go */
  open: 0.5,
  close: 0.5,
  lower: 0.5,
  put: 1.0,
  /** the stand is taken (the planner keeps waiting): give up the walk after this long. Not yet holding the book: forget it; holding it: bring it back unused */
  fetchMax: 45,
  carryMax: 30,
} as const

/**
 * Seated, the book is held lower and further out than it is carried (#395, the same rule as the sheet, paper-pass.md 5): seen from the front its top edge, the
 * turning leaf and both hands stay 1 cm under the face screen's bottom edge (readErrand.test.ts). Metres in the body's frame, reached as the body sits down
 * (`sitM` of the head's drop), so nothing jumps; the head's bow is not changed.
 */
export const READ_HOLD = { down: 0.18, forward: 0.1, sitM: 0.25 } as const

/** where the book rests (the baked `table_low_slot_2`) and the two places it is taken from, one for each seat that reads (the stand of seat 0: the knee row in front of it; seat 1: the table's east end) */
export const BOOK_AT = { x: 2.8, z: 2.51 }
export const READ_STANDS = [
  { x: 2.81, z: 2.88 },
  { x: 3.12, z: 2.72 },
] as const
/** the seats that read: 0, or 1 when 0 is taken. The corner (2) and the east (3) are too far from the table */
export const READ_SEATS = [0, 1] as const
export type ReadSeat = (typeof READ_SEATS)[number]

export const pickSpot = (seat: number) => `read_pick_${seat}`
export const seatSpot = (seat: number) => `sofa_${seat}`

export interface ReadRun {
  seat: ReadSeat
  /** the schedule's block it belongs to (a finished block is not started again) */
  block: number
  stage: ReadStage
  /** office ms the stage began */
  t0: number
}

/** seat 0 when nobody has it (rests on it or is on the way), else seat 1, else none: this reading is skipped */
export function chooseSeat(taken: (spot: string) => boolean): ReadSeat | null {
  return READ_SEATS.find((s) => !taken(seatSpot(s))) ?? null
}

export const startRead = (seat: ReadSeat, block: number, now: number): ReadRun => ({ seat, block, stage: 'fetch', t0: now })

/** the book is in the hand in these stages (an agent called away in one of them first brings it back) */
export const holding = (run: ReadRun) => run.stage !== 'fetch'

/** called away: a book in the hand is brought back and put down; one not taken yet is forgotten (the caller drops the run) */
export const callAway = (run: ReadRun, now: number): ReadRun => (run.stage === 'pick' || run.stage === 'carry' || run.stage === 'read' ? { ...run, stage: 'return', t0: now } : run)

/** advance one frame; `done` once the book is down and let go */
export function stepRead(run: ReadRun, inp: { now: number; at: (spot: string) => boolean }): { run: ReadRun; done: boolean } {
  const r = { ...run }
  for (let guard = 0; guard < 6; guard++) {
    const el = (inp.now - r.t0) / 1000
    if (r.stage === 'fetch') {
      if (!inp.at(pickSpot(r.seat))) {
        if (el > READ_S.fetchMax) return { run: r, done: true }
        break
      }
      r.stage = 'pick'
    } else if (r.stage === 'pick') {
      if (el < READ_S.pick) break
      r.stage = 'carry'
    } else if (r.stage === 'carry') {
      if (!inp.at(seatSpot(r.seat))) {
        if (el <= READ_S.carryMax) break
        r.stage = 'return'
      } else r.stage = 'read'
    } else if (r.stage === 'read') {
      if (el < READ_S.read) break
      r.stage = 'return'
    } else if (r.stage === 'return') {
      if (!inp.at(pickSpot(r.seat))) break
      r.stage = 'put'
    } else {
      if (el < READ_S.put) break
      return { run: r, done: true }
    }
    r.t0 = inp.now
  }
  return { run: r, done: false }
}

/** where the body is sent for a run's stage: the stand beside the table (with the standing slot), or the sofa seat (no slot: seated like a napper) */
export function placeOf(run: ReadRun): { spot: string; stand?: { x: number; z: number }; face?: { x: number; z: number } } {
  const sitting = run.stage === 'carry' || run.stage === 'read'
  return sitting ? { spot: seatSpot(run.seat) } : { spot: pickSpot(run.seat), stand: READ_STANDS[run.seat], face: BOOK_AT }
}
