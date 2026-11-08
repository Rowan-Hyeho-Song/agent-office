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

describe('a whole day through the planner', () => {
  it('no two agents ever come closer than 2R', () => {
    const t0 = Date.now()
    const r = simulateDay({ fromMin: 0, toMin: 24 * 60 })
    const q = (p: number) => r.planMs[Math.min(r.planMs.length - 1, Math.floor(r.planMs.length * p))]?.toFixed(1)
    const line = `day sim: min pair distance ${r.min.toFixed(3)} m (2R = ${2 * TRAFFIC.bodyR}); min between exempt sofa pairs ${r.minExempt.toFixed(3)} m; replans ${r.replans} (median ${q(0.5)} ms, p95 ${q(0.95)} ms, max ${q(1)} ms); ${r.samples} samples; ${Date.now() - t0} ms total`
    console.log(line)
    if (r.worst.length) console.log(JSON.stringify(incidents(r.worst).slice(0, 10)))
    expect(r.worst.slice(0, 5)).toEqual([])
    expect(r.min).toBeGreaterThanOrEqual(2 * TRAFFIC.bodyR)
  }, 120_000)
})
