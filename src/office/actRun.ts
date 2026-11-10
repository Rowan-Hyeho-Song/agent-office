// One lounge act in progress (lounge.ts): the fridge, the water dispenser, the turntable. Like the watering errand (waterRun.ts) it is started by the schedule when the agent
// is free, runs through whatever the schedule says next, and is one place that says how far along it is: `u`, the seconds since the agent reached its stand (-1 while it
// is still on its way). Pure: no three.js, no Date.

import { ACT_PLACE, RECORD_T, actTotal, recordBeats, type ActKind, type RecordMode } from './lounge'

export interface ActRun {
  kind: ActKind
  /** the turntable: put a record on, or lift the arm */
  mode?: RecordMode
  /** the turntable: a record was already on the platter when this started */
  recordOn: boolean
  /** the schedule block it belongs to (an agent acts once per block) */
  block: number
  /** when the agent reached its stand (office ms); null on the way */
  t0: number | null
}

export const startAct = (kind: ActKind, block: number, mode: RecordMode | undefined, recordOn: boolean): ActRun => ({ kind, block, ...(mode ? { mode } : {}), recordOn, t0: null })

export const actSpot = (run: ActRun) => ACT_PLACE[run.kind].spot

/** seconds since it reached its stand, -1 on the way */
export const actU = (run: ActRun, now: number) => (run.t0 === null ? -1 : Math.max(0, (now - run.t0) / 1000))

export const actLength = (run: ActRun) => actTotal(run.kind, run.mode, run.recordOn)

/** one step: starts the clock on arriving, finishes after its length */
export function stepAct(run: ActRun, inp: { now: number; arrived: boolean }): { run: ActRun; done: boolean } {
  const t0 = run.t0 ?? (inp.arrived ? inp.now : null)
  if (t0 === null) return { run, done: false }
  const next = t0 === run.t0 ? run : { ...run, t0 }
  return { run: next, done: (inp.now - t0) / 1000 >= actLength(next) }
}

/** what the turntable shows once the run has got to `u`: a record is on the platter (put: from the moment the disc touches it), the needle went down (put) or up (lift) */
export function deckAfter(run: ActRun, u: number): { recordOn: boolean; needle: boolean | null } {
  const mode = run.mode ?? 'put'
  const b = recordBeats(mode, run.recordOn)
  return {
    recordOn: run.recordOn || (mode === 'put' && b.record && u >= RECORD_T.place),
    needle: u >= b.down ? mode === 'put' : null,
  }
}
