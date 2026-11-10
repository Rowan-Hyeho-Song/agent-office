import { describe, expect, it } from 'vitest'
import { TRAFFIC } from './traffic'
import { simulateDay } from './traffic.sim'

// 24 h of the real schedule through the planner: the smallest centre distance over every pair and every 50 ms the
// agents move must stay >= 2R (except two agents resting on a designed sofa pair).
/** cluster violation samples (within 1 s) into incidents: first time, smallest distance, who, goals */
function incidents(w: { t: number; d: number; who: string; goals: string; at: string }[]) {
  const out: { t: number; min: number; who: string; goals: string; at: string; n: number }[] = []
  for (const v of w) {
    const last = out[out.length - 1]
    if (last && v.t - last.t < 1 + last.n * 0.05 && last.who === v.who) {
      last.min = Math.min(last.min, v.d)
      last.n++
    } else out.push({ t: Math.round(v.t), min: v.d, who: v.who, goals: v.goals, at: v.at, n: 1 })
  }
  return out
}

let day: ReturnType<typeof simulateDay> | undefined
const wholeDay = () => (day ??= simulateDay({ fromMin: 0, toMin: 24 * 60 }))

describe('a whole day through the planner', () => {
  it('no two agents ever come closer than 2R', () => {
    const t0 = Date.now()
    const r = wholeDay()
    const q = (p: number) => r.planMs[Math.min(r.planMs.length - 1, Math.floor(r.planMs.length * p))]?.toFixed(1)
    const line = `day sim: min pair distance ${r.min.toFixed(3)} m (2R = ${2 * TRAFFIC.bodyR}); min between exempt sofa pairs ${r.minExempt.toFixed(3)} m; min seated-pair (row) ${r.minSeated.toFixed(3)} m; min to a body resting on a row seat ${r.minSeatRest.toFixed(3)} m; max drift off a seat once arrived ${r.maxSeatDrift.toFixed(3)} m; replans ${r.replans} (median ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${q(1)} ms); ${r.samples} samples; ${Date.now() - t0} ms total`
    console.log(line)
    if (r.worst.length) console.log(JSON.stringify(incidents(r.worst).slice(0, 10)))
    expect(r.worst.slice(0, 5)).toEqual([])
    expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
    // nobody comes nearer than the seat pitch (the closest two seats of the row, read off the nav graph; two heads are 0.42 m wide) to a body resting on a sofa seat (#280)
    expect(r.seatPassM).toBeGreaterThan(0.42)
    expect(r.minSeatRest).toBeGreaterThanOrEqual(r.seatPassM - 0.005)
    // a body on a sofa seat is never moved off it for someone else
    expect(r.maxSeatDrift).toBeLessThanOrEqual(0.02)
  }, 120_000)

  // #186: what an agent shows is what its body does (one decision in the director), and nobody waits for a spot another holds
  it('shown state and behaviour never disagree; nobody waits more than 60 s for a goal', () => {
    const r = wholeDay()
    console.log(`day sim (#186): ${r.mismatch.length} mismatch frames of ${r.frames}; longest wait for a goal ${r.maxWait.s.toFixed(1)} s (${r.maxWait.who} -> ${r.maxWait.spot} at ${Math.round(r.maxWait.t)} s); waits over 60 s: ${r.longWaits.length}`)
    if (r.mismatch.length) console.log(JSON.stringify(r.mismatch.slice(0, 8)))
    if (r.longWaits.length) console.log(JSON.stringify(r.longWaits.slice(0, 8)))
    expect(r.mismatch.slice(0, 5)).toEqual([])
    expect(r.longWaits).toEqual([])
  }, 120_000)

  // #228: the watering errand is walked like any other (the planner keeps the carrier clear of the others, the two tests above), one can, and it happens
  it('watering errands run through the day: the can is fetched, carried, brought back and put down, one agent at a time', () => {
    const r = wholeDay()
    console.log(`day sim (#228): watering errands ${JSON.stringify(r.errands)}; most at once ${r.errandsAtOnce}`)
    expect(r.errands.fetch, 'errands started').toBeGreaterThan(5)
    expect(r.errands.done, 'errands finished').toBeGreaterThanOrEqual(r.errands.fetch - 4) // a few are called away at the day's end or give up on a taken stand
    expect(r.errandsAtOnce, 'one can').toBeLessThanOrEqual(1)
  }, 120_000)
})

// #280: reading is an errand like the watering: the book is taken from the low table, read seated, put back; one book, so one reader
describe('reading through the day', () => {
  it('the book is fetched, picked, carried to a seat, read, brought back and put down, one agent at a time, on seat 0 and also on seat 1', () => {
    const r = wholeDay()
    console.log(`day sim (#280): reading errands ${JSON.stringify(r.reads)}; most at once ${r.readsAtOnce}`)
    expect(r.reads.fetch, 'readings started').toBeGreaterThan(5)
    // a reading called to work before it reached the table forgets the book (nothing to bring back); one that has taken the book always puts it back (the day's last one may be cut off)
    expect(r.reads.pick, 'most readings reach the table').toBeGreaterThan(r.reads.fetch * 0.8)
    expect(r.reads.done, 'every book taken is put back').toBeGreaterThanOrEqual(r.reads.pick - 1)
    expect(r.reads.seat0, 'seat 0 is the first choice').toBeGreaterThan(r.reads.seat1)
    expect(r.readsAtOnce, 'one book').toBeLessThanOrEqual(1)
  }, 120_000)
})

// #280: the lounge acts run through the day like any other errand: they are sent, reach their stands and run to their end, never two at the bar, never two at the turntable
describe('the lounge acts through the day', () => {
  it('the fridge, the dispenser and the turntable are all visited; one at the bar, one at the turntable', () => {
    const r = wholeDay()
    console.log(`day sim (#280): lounge acts ${JSON.stringify(r.acts)}; most at once ${r.actsAtOnce}; bodies inside the fridge door's swing while it was held: ${r.sweptBreaches}`)
    for (const k of ['fridge', 'dispenser', 'record'] as const) {
      expect(r.acts[k].sent, `${k} sent`).toBeGreaterThan(5)
      expect(r.acts[k].done, `${k} finished`).toBeGreaterThanOrEqual(r.acts[k].reached - 4)
    }
    expect(r.actsAtOnce, 'the bar and the turntable').toBeLessThanOrEqual(2)
    expect(r.sweptBreaches, 'nobody but the one at the fridge stands in the area its door sweeps').toBe(0)
  }, 120_000)
})
