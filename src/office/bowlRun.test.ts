import { describe, expect, it } from 'vitest'
import { BOWL_S, BOWL_SPOT, bowlHolding, bowlPlace, startBowl, stepBowl } from './bowlRun'
import { Director } from './director'
import { playAt } from './play'

/**
 * #490: a moment when somebody has placed a record alone for long enough to fetch the bowl (90 s or more left), and the moment it is over, with nobody at the
 * board right after (the bowl goes home then)
 */
function soloStretch(agents: string[]): { t: number; end: number; solo: string } {
  for (let t = Date.UTC(2026, 10, 9, 1, 0, 0); ; t += 20_000) {
    const p = Object.entries(playAt(t, agents)).find(([, x]) => x.kind === 'boardgame_solo')
    if (!p || p[1].until - t < 90_000) continue
    const end = p[1].until + 1000
    if (Object.values(playAt(end, agents)).some((x) => x.kind === 'boardgame_solo' || x.kind === 'boardgame')) continue
    return { t, end, solo: p[0] }
  }
}
import { AGENTS } from './world'

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


describe('the Director carries the bowl over for a record placed alone, and back after (#137 ①)', () => {
  it('fetch → lift → carry → put at the corner, then it sits at game_a; once nobody places a record it goes home; no pair game meanwhile', () => {
    // a stay with a record placed alone, followed by none
    const { t: t0, end, solo } = soloStretch(AGENTS)
    const m = Math.floor(t0 / 60000)
    const d = new Director(AGENTS)
    const idle = Object.fromEntries(AGENTS.map((a) => [a, { state: 'idle' as const, since: 0 }]))
    // everybody arrives wherever it is sent one step later
    let goals: ReturnType<Director['goals']> = {}
    const arrived = (a: string) => goals[a]?.spot ?? null
    let t = t0
    const step = (min: number, ms = 500) => {
      goals = d.goals(t, min, idle, arrived)
      t += ms
      return goals
    }
    step(m)
    expect(goals[solo]).toMatchObject({ spot: BOWL_SPOT.home, pose: 'bowl', bowl: { stage: 'fetch', way: 'out' } })
    const seen: string[] = []
    for (let k = 0; k < 40 && d.bowlRest() !== 'corner'; k++) {
      const g = step(m)
      if (g[solo].bowl && !seen.includes(g[solo].bowl!.stage)) seen.push(g[solo].bowl!.stage)
      expect(Object.values(g).some((x) => x.pose === 'boardgame' && x !== g[solo]), 'no pair game while the bowl is away').toBe(false)
    }
    expect(seen).toEqual(['lift', 'carry', 'put'])
    expect(d.bowlRest()).toBe('corner')
    for (let k = 0; k < 4; k++) step(m)
    expect(goals[solo]).toMatchObject({ spot: 'game_a', pose: 'boardgame' })
    // the record is over: nobody places one; somebody free (the one who did, first) takes the bowl home
    t = end
    step(m + 3)
    const back = Object.entries(goals).find(([, g]) => g.bowl)
    expect(back?.[1].bowl).toMatchObject({ way: 'home', stage: 'fetch' })
    expect(back?.[1].spot).toBe(BOWL_SPOT.corner)
    for (let k = 0; k < 40 && d.bowlRest() !== 'home'; k++) step(m + 3)
    expect(d.bowlRest()).toBe('home')
  })
})

describe('reduced motion: nobody walks with the bowl (#456)', () => {
  it('no errand; at the corner the moment the agent sits at game_a, home again as soon as the record is over, no one sent for it', () => {
    const { t: t0, end, solo } = soloStretch(AGENTS)
    const m = Math.floor(t0 / 60000)
    const d = new Director(AGENTS)
    const idle = Object.fromEntries(AGENTS.map((a) => [a, { state: 'idle' as const, since: 0 }]))
    let seated = false
    const arrived = (a: string) => (a === solo && seated ? 'game_a' : null)
    let g = d.goals(t0, m, idle, arrived, { reduced: true })
    expect(g[solo]).toMatchObject({ spot: 'game_a', pose: 'boardgame' })
    expect(Object.values(g).some((x) => x.bowl)).toBe(false)
    expect(d.bowlRest()).toBe('home')
    seated = true
    g = d.goals(t0 + 5000, m, idle, arrived, { reduced: true })
    expect(d.bowlRest()).toBe('corner')
    g = d.goals(end, m + 3, idle, arrived, { reduced: true })
    expect(d.bowlRest()).toBe('home')
    expect(Object.values(g).some((x) => x.bowl)).toBe(false)
  })
})
