import { describe, expect, it } from 'vitest'
import { BOWL_S, BOWL_SPOT, bowlHolding, bowlPlace, startBowl, stepBowl } from './bowlRun'

describe('the white bowl carried to the corner and back (#137 ①)', () => {
  const walk = (way: 'out' | 'home', arriveAfter: number) => {
    let r = startBowl('agent_2', way, 7, 0)
    const seen: string[] = []
    let placed = false
    for (let t = 0; t < 120_000; t += 100) {
      const spot = bowlPlace(r).spot
      const s = stepBowl(r, { now: t, at: (x) => x === spot && t - r.t0 >= arriveAfter })
      if (!seen.includes(s.run.stage)) seen.push(s.run.stage)
      r = s.run
      if (s.done) {
        placed = s.placed
        break
      }
    }
    return { seen, placed }
  }
  it('out: fetch at its home, lift, carry to the corner, put; home: the other way', () => {
    expect(walk('out', 2000)).toEqual({ seen: ['fetch', 'lift', 'carry', 'put'], placed: true })
    const out = startBowl('a', 'out', 0, 0)
    expect(bowlPlace(out).spot).toBe(BOWL_SPOT.home)
    expect(bowlPlace({ ...out, stage: 'carry' }).spot).toBe(BOWL_SPOT.corner)
    const home = startBowl('a', 'home', 0, 0)
    expect(bowlPlace(home).spot).toBe(BOWL_SPOT.corner)
    expect(bowlPlace({ ...home, stage: 'put' }).spot).toBe(BOWL_SPOT.home)
  })
  it('in the hands only while lifted, carried and put', () => {
    const r = startBowl('a', 'out', 0, 0)
    expect(bowlHolding(r)).toBe(false)
    for (const stage of ['lift', 'carry', 'put'] as const) expect(bowlHolding({ ...r, stage })).toBe(true)
  })
  it('a walk to the bowl that never arrives is given up and nothing has moved; one carrying it goes on until it gets there', () => {
    expect(walk('out', Infinity)).toEqual({ seen: ['fetch'], placed: false })
    let r = { ...startBowl('a', 'home', 0, 0), stage: 'carry' as const }
    for (let t = 0; t < (BOWL_S.walkMax + 30) * 1000; t += 500) r = stepBowl(r, { now: t, at: () => false }).run as typeof r
    expect(r.stage).toBe('carry')
  })
})
