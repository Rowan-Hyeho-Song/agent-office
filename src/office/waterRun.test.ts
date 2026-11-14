import { describe, expect, it } from 'vitest'
import { Director } from './director'
import { BLOCK_MINUTES, playAt } from './play'
import type { StatusMap } from './status'
import { CAN_SPOT, WATER_LABEL, WATER_S, holding, plantSpot, startWater, stepWater, type WaterRun } from './waterRun'
import { pourTotal } from './water'

const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const idle = (): StatusMap => Object.fromEntries(AGENTS.map((a) => [a, { state: 'idle' as const, since: 0 }]))

/** step a run with the agent standing where `at()` says, a frame every 100 ms */
function drive(run: WaterRun, at: (t: number) => string | null, seconds: number, t0 = 0) {
  const seen: string[] = []
  let r = run
  let done = -1
  for (let t = 0; t <= seconds; t += 0.1) {
    const res = stepWater(r, { now: t0 + t * 1000, at: (spot) => at(t) === spot })
    r = res.run
    if (seen[seen.length - 1] !== r.stage) seen.push(r.stage)
    if (res.done) {
      done = t
      break
    }
  }
  return { seen, done, run: r }
}

describe('stepWater: the errand in stages (#228)', () => {
  it('fetch → lift → carry → pour → return → put, each only once the agent is where the stage sends it', () => {
    const run = startWater('plant_corner', 0, 0, false)
    // arrives at the can at 5 s, at the plant at 12 s, back at the can at 25 s
    const at = (t: number) => (t < 5 ? null : t < 6.5 ? CAN_SPOT : t < 12 ? null : t < 12 + pourTotal('plant_corner') + 0.5 ? plantSpot('plant_corner') : t < 25 ? null : CAN_SPOT)
    const r = drive(run, at, 60)
    expect(r.seen).toEqual(['fetch', 'lift', 'carry', 'pour', 'return', 'put'])
    expect(r.done).toBeGreaterThan(25 + WATER_S.put - 0.2)
  })

  it('the hand needs the time to take hold and lift before the walk begins, and to put the can down before the next thing', () => {
    expect(WATER_S.lift).toBeGreaterThanOrEqual(0.3 + 0.12 + 0.35)
    expect(WATER_S.put).toBeGreaterThanOrEqual(WATER_S.lower + 0.06 + 0.3)
  })

  it('nothing is carried before the can is lifted, and an agent called away then is not holding it', () => {
    const run = startWater('plant_sofa', 0, 0, false)
    expect(holding(run)).toBe(false)
    expect(holding({ ...run, stage: 'lift' })).toBe(false)
    for (const stage of ['carry', 'pour', 'return', 'put'] as const) expect(holding({ ...run, stage }), stage).toBe(true)
  })

  it('a stand that stays taken: the walk to the can is given up after fetchMax; carrying the can the agent brings it back unused', () => {
    const fetch = drive(startWater('plant_desk', 0, 0, false), () => null, WATER_S.fetchMax + 5)
    expect(fetch.seen).toEqual(['fetch'])
    expect(fetch.done, 'gives up').toBeGreaterThan(WATER_S.fetchMax)
    // it takes the can, then never reaches the plant: back to the can without pouring
    const at = (t: number) => (t < 2 ? CAN_SPOT : t > 2 + WATER_S.lift + WATER_S.carryMax + 4 ? CAN_SPOT : null)
    const carry = drive(startWater('plant_sofa', 0, 0, false), at, 120)
    expect(carry.seen).toEqual(['lift', 'carry', 'return', 'put'])
  })

  it('reduced motion: walks to the plant empty-handed, the can only while it pours, gone after (watering.md 5)', () => {
    const run = startWater('plant_corner', 0, 0, true)
    expect(run.stage).toBe('carry')
    expect(holding(run)).toBe(false)
    const r = drive(run, (t) => (t < 4 ? null : plantSpot('plant_corner')), 60)
    expect(r.seen).toEqual(['carry', 'pour', 'put'])
    expect(r.done).toBeGreaterThan(0)
    // a taken stand: nothing in the hand, so it just gives up
    const stuck = drive(run, () => null, WATER_S.carryMax + 5)
    expect(stuck.seen).toEqual(['carry'])
    expect(stuck.done).toBeGreaterThan(WATER_S.carryMax)
  })

  it('every stage has words (the debug panel, and the chip of an agent called to work while it still holds the can)', () => {
    for (const stage of ['fetch', 'lift', 'carry', 'pour', 'return', 'put'] as const) expect(WATER_LABEL[stage].length).toBeGreaterThan(3)
    expect(WATER_LABEL.fetch).toBe('물뿌리개 가지러 가는 중')
    expect(WATER_LABEL.pour).toBe('물 주는 중')
    expect(WATER_LABEL.return).toBe('물뿌리개 갖다 두는 중')
  })
})

describe('Director: the schedule sends one agent at a time for the can', () => {
  // a block where somebody waters, and the minute (in that block) to ask at
  const block = (() => {
    for (let m = 3_000_000; ; m += BLOCK_MINUTES) if (Object.values(playAt(m, AGENTS)).some((a) => a.kind === 'water')) return m - (m % BLOCK_MINUTES)
  })()
  const waterer = Object.entries(playAt(block, AGENTS)).find(([, a]) => a.kind === 'water')![0]

  it('the assigned agent goes for the can (its own stand, facing it), carrying on whatever the schedule says next', () => {
    const d = new Director(AGENTS)
    const arrived: Record<string, string | null> = {}
    let now = block * 60000
    let g = d.goals(now, block, idle(), (a) => arrived[a] ?? null)
    expect(g[waterer]).toMatchObject({ spot: CAN_SPOT, pose: 'water', water: { stage: 'fetch' } })
    expect(g[waterer].slot).toBeTruthy()
    // arrives: lift, then (after the lift time) carry to the plant
    arrived[waterer] = CAN_SPOT
    g = d.goals(now, block, idle(), (a) => arrived[a] ?? null)
    expect(g[waterer].water?.stage).toBe('lift')
    now += (WATER_S.lift + 0.1) * 1000
    // the block is over: the errand is not (the can is always brought back)
    const next = block + BLOCK_MINUTES
    g = d.goals(now + BLOCK_MINUTES * 60000, next, idle(), (a) => arrived[a] ?? null)
    expect(g[waterer].water?.stage, 'carry, in a later block').toBe('carry')
    expect(g[waterer].spot.startsWith('water_')).toBe(true)
  })

  it('only one errand at a time: a second agent assigned water waits at its desk', () => {
    // two agents in a row (the next block's water agent is someone else)
    let m = block
    let second: string | null = null
    for (; m < block + 3000 && !second; m += BLOCK_MINUTES) {
      const a = Object.entries(playAt(m, AGENTS)).find(([, x]) => x.kind === 'water')
      // the next block's water agent as the Director sees it: with the first still away on its errand the schedule is re-planned without it,
      // and nobody else is away (no lounge act or reading starts in that block, they would be taken out of it too)
      const errandFree = (p: ReturnType<typeof playAt>) => Object.values(p).every((x) => !['fridge', 'dispenser', 'record', 'books'].includes(x.kind))
      const without = a ? playAt(m + BLOCK_MINUTES, AGENTS, new Set([a[0]])) : null
      // (an act started in the first block would still be waiting for its agent to arrive in the second: none there either)
      const b = a && without && errandFree(playAt(m, AGENTS)) && errandFree(playAt(m + BLOCK_MINUTES, AGENTS)) && errandFree(without) ? Object.entries(without).find(([, x]) => x.kind === 'water') : undefined
      if (a && b && a[0] !== b[0]) second = b[0]
    }
    expect(second).toBeTruthy()
    const first = Object.entries(playAt(m - BLOCK_MINUTES, AGENTS)).find(([, x]) => x.kind === 'water')![0]
    const d = new Director(AGENTS)
    const arrived: Record<string, string | null> = {}
    const t0 = (m - BLOCK_MINUTES) * 60000
    const at = (a: string) => arrived[a] ?? null
    d.goals(t0, m - BLOCK_MINUTES, idle(), at)
    arrived[first] = CAN_SPOT
    d.goals(t0 + 1000, m - BLOCK_MINUTES, idle(), at)
    d.goals(t0 + 3000, m - BLOCK_MINUTES, idle(), at) // lifted
    arrived[first] = null // and never gets to the plant: it brings the can back unused after carryMax
    d.goals(t0 + 170_000, m - BLOCK_MINUTES, idle(), at)
    // the next block: the first is still on its errand
    const g = d.goals(t0 + BLOCK_MINUTES * 60000, m, idle(), at)
    expect(g[first].water, 'the first is still on it').toBeTruthy()
    expect(g[second!].water, 'the second does not start').toBeUndefined()
    expect(g[second!]).toMatchObject({ spot: `work_${second!.split('_')[1]}`, pose: 'idle' })
    expect(g[second!].label).toContain('차례')
  })

  it('an agent carrying the can is not called away to a talk until the can is down', () => {
    const d = new Director(AGENTS)
    const arrived: Record<string, string | null> = {}
    d.forceWater('agent_2', 'plant_corner', 0)
    d.goals(0, 0, idle(), (a) => arrived[a] ?? null)
    arrived.agent_2 = CAN_SPOT
    d.goals(100, 0, idle(), (a) => arrived[a] ?? null)
    d.goals(100 + (WATER_S.lift + 0.1) * 1000, 0, idle(), (a) => arrived[a] ?? null)
    expect(d.carries('agent_2')).toBe(true)
    d.receive({ id: 't', kind: 'talk', from: 'agent_0', to: 'agent_2', at: 0 })
    const g = d.goals(2000, 0, idle(), (a) => arrived[a] ?? null)
    expect(g.agent_2.water?.stage).toBe('carry')
    expect(g.agent_0.lookAt, 'agent_0 is not sent to talk').toBeUndefined()
  })

  it('called to work while carrying: it finishes the errand and shows it in words (the chip says so), then goes to work', () => {
    const d = new Director(AGENTS)
    const arrived: Record<string, string | null> = {}
    d.forceWater('agent_2', 'plant_corner', 0)
    d.goals(0, 0, idle(), (a) => arrived[a] ?? null)
    arrived.agent_2 = CAN_SPOT
    d.goals(100, 0, idle(), (a) => arrived[a] ?? null)
    d.goals(100 + (WATER_S.lift + 0.1) * 1000, 0, idle(), (a) => arrived[a] ?? null) // lifted: it holds the can
    const st = idle()
    st.agent_2 = { state: 'working', since: 0, activity: 'edit' }
    const g = d.goals(2000, 0, st, (a) => arrived[a] ?? null)
    expect(g.agent_2.water?.stage).toBe('carry')
    expect(d.shown.agent_2).toMatchObject({ kind: 'work', detail: WATER_LABEL.carry })
  })

  it('called to work before it has the can: the errand is dropped, nothing to bring back', () => {
    const d = new Director(AGENTS)
    d.forceWater('agent_2', 'plant_corner', 0)
    d.goals(0, 0, idle(), () => null)
    const st = idle()
    st.agent_2 = { state: 'working', since: 0, activity: 'edit' }
    const g = d.goals(1000, 0, st, () => null)
    expect(g.agent_2).toMatchObject({ spot: 'work_2', pose: 'type' })
    expect(g.agent_2.water).toBeUndefined()
  })
})

describe('Director: a prop goes back by hand before the agent walks off (#228)', () => {
  it('whoever was playing coffee / ping-pong / omok / reading stands 0.8 s after the play ends; others set off at once', () => {
    let found: { m: number; agent: string } | null = null
    for (let m = 3_000_000; !found && m < 3_003_000; m += BLOCK_MINUTES) {
      const a = playAt(m, AGENTS)
      const b = playAt(m + BLOCK_MINUTES, AGENTS)
      for (const [id, x] of Object.entries(a)) if (['coffee', 'books', 'pingpong', 'boardgame'].includes(x.kind) && b[id] && b[id].spot !== x.spot && b[id].kind !== 'water') found = { m, agent: id }
    }
    expect(found).toBeTruthy()
    const d = new Director(AGENTS)
    const at = () => null
    const m = found!.m - (found!.m % BLOCK_MINUTES)
    d.goals(m * 60000, m, idle(), at)
    const now = (m + BLOCK_MINUTES) * 60000
    const g = d.goals(now, m + BLOCK_MINUTES, idle(), at)
    expect(g[found!.agent].depart, 'held back until the prop is down').toBe(now + 800)
    // the same hold on the next frame (the planner is asked the same thing)
    expect(d.goals(now + 16, m + BLOCK_MINUTES, idle(), at)[found!.agent].depart).toBe(now + 800)
    // and the same after the time has passed: a request that changes is a replan, it must not change again
    expect(d.goals(now + 900, m + BLOCK_MINUTES, idle(), at)[found!.agent].depart).toBe(now + 800)
    expect(d.goals(now + 916, m + BLOCK_MINUTES, idle(), at)[found!.agent].depart).toBe(now + 800)
  })
})
