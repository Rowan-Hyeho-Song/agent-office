import { describe, expect, it } from 'vitest'
import { BOWL_S, BOWL_SPOT, bowlHolding, bowlPlace, startBowl, stepBowl } from './bowlRun'
import { Director } from './director'
import { BLOCK_MINUTES, playAt } from './play'
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
  it('fetch → lift → carry → put at the corner, then it sits at game_a; the next block without a record takes it home; no pair game meanwhile', () => {
    // a block with a record placed alone, followed by one without
    let m = 1_000_000
    while (!(Object.values(playAt(m, AGENTS)).some((x) => x.kind === 'boardgame_solo') && !Object.values(playAt(m + BLOCK_MINUTES, AGENTS)).some((x) => x.kind === 'boardgame_solo'))) m += BLOCK_MINUTES
    const solo = Object.entries(playAt(m, AGENTS)).find(([, x]) => x.kind === 'boardgame_solo')![0]
    const d = new Director(AGENTS)
    const idle = Object.fromEntries(AGENTS.map((a) => [a, { state: 'idle' as const, since: 0 }]))
    // everybody arrives wherever it is sent one step later
    let goals: ReturnType<Director['goals']> = {}
    const arrived = (a: string) => goals[a]?.spot ?? null
    let t = m * 60000
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
    // the next block: nobody places a record; somebody free (the one who did, first) takes the bowl home
    t = (m + BLOCK_MINUTES) * 60000
    step(m + BLOCK_MINUTES)
    const back = Object.entries(goals).find(([, g]) => g.bowl)
    expect(back?.[1].bowl).toMatchObject({ way: 'home', stage: 'fetch' })
    expect(back?.[1].spot).toBe(BOWL_SPOT.corner)
    for (let k = 0; k < 40 && d.bowlRest() !== 'home'; k++) step(m + BLOCK_MINUTES)
    expect(d.bowlRest()).toBe('home')
  })
})
