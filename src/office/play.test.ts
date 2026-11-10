import { describe, expect, it } from 'vitest'
import { BLOCK_MINUTES, NIGHT_PLAYS, PLAYS, blockOf, playAt, soloAt } from './play'

const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const ALL_SPOTS = new Set(PLAYS.flatMap((p) => p.spots))
const PAIR_KINDS = new Set(PLAYS.filter((p) => p.pair).map((p) => p.kind))
const BLOCKS = 500
const minuteOf = (b: number) => 1_000_000 * BLOCK_MINUTES + b * BLOCK_MINUTES

function checkInvariants(minute: number, busy: Set<string>) {
  const out = playAt(minute, AGENTS, busy)
  const ctx = `minute=${minute} busy=${[...busy]}`
  for (const a of AGENTS) {
    if (busy.has(a)) expect(out[a], ctx).toBeUndefined()
    else expect(out[a], `${a} ${ctx}`).toBeDefined()
  }
  const spots = Object.values(out).map((o) => o.spot)
  expect(new Set(spots).size, `shared spot ${ctx}`).toBe(spots.length)
  for (const [a, o] of Object.entries(out)) {
    expect(ALL_SPOTS.has(o.spot), ctx).toBe(true)
    const def = PLAYS.find((p) => p.kind === o.kind)!
    expect(def.spots, ctx).toContain(o.spot)
    if (PAIR_KINDS.has(o.kind)) {
      expect(o.partner, `pair w/o partner ${a} ${ctx}`).toBeDefined()
      expect(out[o.partner!], ctx).toBeDefined()
      expect(out[o.partner!].partner, ctx).toBe(a)
      expect(out[o.partner!].kind, ctx).toBe(o.kind)
      expect(out[o.partner!].spot, ctx).not.toBe(o.spot)
    } else {
      expect(o.partner, ctx).toBeUndefined()
    }
  }
  return out
}

describe('playAt determinism', () => {
  it('same minute + roster gives deep-equal output', () => {
    expect(playAt(12345, AGENTS)).toEqual(playAt(12345, AGENTS))
  })
  it('roster order does not matter', () => {
    for (let b = 0; b < 50; b++) {
      const m = minuteOf(b)
      expect(playAt(m, [...AGENTS].reverse())).toEqual(playAt(m, AGENTS))
      expect(playAt(m, ['agent_2', 'agent_0', 'agent_3', 'agent_1'])).toEqual(playAt(m, AGENTS))
    }
  })
  it('blockOf groups BLOCK_MINUTES minutes', () => {
    expect(blockOf(0)).toBe(0)
    expect(blockOf(BLOCK_MINUTES - 1)).toBe(0)
    expect(blockOf(BLOCK_MINUTES)).toBe(1)
  })
  it('minutes inside one block give the same output', () => {
    for (let b = 0; b < 30; b++) {
      const first = playAt(b * BLOCK_MINUTES, AGENTS)
      for (let i = 1; i < BLOCK_MINUTES; i++) expect(playAt(b * BLOCK_MINUTES + i, AGENTS)).toEqual(first)
    }
  })
  it('output changes across blocks', () => {
    const outs = new Set<string>()
    for (let b = 0; b < 20; b++) outs.add(JSON.stringify(playAt(b * BLOCK_MINUTES, AGENTS)))
    expect(outs.size).toBeGreaterThan(1)
  })
})

describe('playAt invariants', () => {
  it('hold for everyone free over many blocks', () => {
    for (let b = 0; b < BLOCKS; b++) checkInvariants(minuteOf(b), new Set())
  })
  it('hold with any single agent busy', () => {
    for (const busy of AGENTS) for (let b = 0; b < BLOCKS; b++) checkInvariants(minuteOf(b), new Set([busy]))
  })
  it('hold with every pair of agents busy', () => {
    for (let b = 0; b < 100; b++) {
      for (let i = 0; i < AGENTS.length; i++) {
        for (let j = i + 1; j < AGENTS.length; j++) checkInvariants(minuteOf(b), new Set([AGENTS[i], AGENTS[j]]))
      }
    }
  })
  it('everyone busy gives an empty result', () => {
    for (let b = 0; b < 50; b++) expect(playAt(minuteOf(b), AGENTS, new Set(AGENTS))).toEqual({})
  })
  it('both pair activities occur in the sample (sanity)', () => {
    const kinds = new Set<string>()
    for (let b = 0; b < BLOCKS; b++) for (const o of Object.values(playAt(minuteOf(b), AGENTS))) kinds.add(o.kind)
    expect(kinds.has('pingpong')).toBe(true)
    expect(kinds.has('boardgame')).toBe(true)
  })
})

describe('playAt stability under busy', () => {
  it('others keep their assignment when one agent is busy', () => {
    for (const gone of AGENTS) {
      for (let b = 0; b < BLOCKS; b++) {
        const m = minuteOf(b)
        const full = playAt(m, AGENTS)
        const part = playAt(m, AGENTS, new Set([gone]))
        for (const a of AGENTS) {
          if (a === gone || full[a].partner === gone) continue
          expect(part[a], `${a} gone=${gone} minute=${m}`).toEqual(full[a])
        }
      }
    }
  })
  it('a player whose partner became busy gets a solo activity', () => {
    let seen = 0
    for (const gone of AGENTS) {
      for (let b = 0; b < BLOCKS; b++) {
        const m = minuteOf(b)
        const full = playAt(m, AGENTS)
        const part = playAt(m, AGENTS, new Set([gone]))
        for (const a of AGENTS) {
          if (a === gone || full[a].partner !== gone) continue
          seen++
          expect(part[a]).toBeDefined()
          expect(part[a].partner).toBeUndefined()
          expect(PAIR_KINDS.has(part[a].kind)).toBe(false)
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('likes (#28)', () => {
  const agents = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
  // over many blocks, who plays what
  const tally = () => {
    const t: Record<string, Record<string, number>> = {}
    for (let b = 0; b < 3000; b++) {
      const out = playAt(b * BLOCK_MINUTES, agents)
      for (const [a, p] of Object.entries(out)) {
        t[a] ??= {}
        t[a][p.kind] = (t[a][p.kind] ?? 0) + 1
      }
    }
    return t
  }
  const t = tally()
  const share = (a: string, k: string) => (t[a][k] ?? 0) / 3000

  it('the coder plays ping-pong the most', () => {
    for (const other of ['agent_0', 'agent_1', 'agent_2']) expect(share('agent_3', 'pingpong')).toBeGreaterThan(share(other, 'pingpong'))
  })
  it('the planner and the 3D agent play board games more than ping-pong, and more than the others do', () => {
    for (const a of ['agent_0', 'agent_1']) {
      expect(share(a, 'boardgame')).toBeGreaterThan(share(a, 'pingpong'))
      expect(share(a, 'boardgame')).toBeGreaterThan(share('agent_3', 'boardgame'))
    }
  })
  it('they are bad at ping-pong, not banned from it', () => {
    expect(share('agent_0', 'pingpong')).toBeGreaterThan(0)
    expect(share('agent_1', 'pingpong')).toBeGreaterThan(0)
  })
  it('likes are the same for every visitor (same minute, same answer)', () => {
    expect(playAt(12345, agents)).toEqual(playAt(12345, [...agents].reverse()))
  })
})

describe('soloAt (night duty, #110)', () => {
  it('is quiet and alone, and stable per minute block', () => {
    for (let m = 0; m < 300; m += BLOCK_MINUTES) {
      const p = soloAt(m, 'agent_2')
      expect(NIGHT_PLAYS).toContain(p.kind)
      expect(p.partner).toBeUndefined()
      expect(soloAt(m + 1, 'agent_2')).toEqual(p)
    }
  })
})

describe('five agents (#193)', () => {
  const FIVE = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
  it('everybody free gets a place of their own, five at a time, and echo takes part in pairs', () => {
    let echoPairs = 0
    let echoBoard = 0
    for (let b = 0; b < 600; b++) {
      const out = playAt(b * BLOCK_MINUTES, FIVE)
      expect(Object.keys(out).sort()).toEqual(FIVE)
      const spots = Object.values(out).map((o) => o.spot)
      expect(new Set(spots).size).toBe(5)
      const e = out.agent_4
      if (e.partner) {
        echoPairs++
        expect(out[e.partner].partner).toBe('agent_4')
        if (e.kind === 'boardgame') echoBoard++
      }
    }
    expect(echoPairs).toBeGreaterThan(100)
    expect(echoBoard).toBeGreaterThan(0)
  })
  it('with echo busy at its desk the other four are the same as the four-agent roster would give them where they do not depend on echo', () => {
    const out = playAt(777, FIVE, new Set(['agent_4']))
    expect(out.agent_4).toBeUndefined()
    expect(Object.keys(out).sort()).toEqual(['agent_0', 'agent_1', 'agent_2', 'agent_3'])
  })
})

// Reading (#280) is a seated errand (readRun.ts): the book is taken from the low table, read on sofa seat 0 (1 when 0 is taken) and put back. Two rules of the standing reader at the
// side table (#193) are gone with it, each for a reason the day simulation (traffic.day.test.ts: no pair under 2R, no wait over 60 s, no mismatch) confirms:
//  - "reading and ping-pong never share a block": the standing reader closed the aisle south of the table and the east player the one round its end, which walled in whoever napped
//    or came back from the plants. The reader now stands one body at a time in the knee row for about a second and then sits, away from the ping-pong table;
//  - "no head-on change of places between the sofa and the side table": that was a sleeper leaving the sofa while the reader walked to it along a one-body aisle; the reader now
//    goes to a seat itself (and a former napper simply reads from the seat it is on), and the knee row lets one standing body in at a time.
describe('reading on the schedule (#280)', () => {
  const FIVE = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
  it('is handed out, to one reader at a time (one book), and never to the night shift', () => {
    let blocks = 0
    for (let b = 0; b < 2000; b++) {
      const readers = Object.values(playAt(b * BLOCK_MINUTES, FIVE)).filter((o) => o.kind === 'books')
      expect(readers.length, `block ${b}`).toBeLessThanOrEqual(1)
      if (readers.length) blocks++
    }
    expect(blocks).toBeGreaterThan(100)
    expect(NIGHT_PLAYS).not.toContain('books')
    for (let b = 0; b < 500; b++) expect(soloAt(b * BLOCK_MINUTES, 'agent_2').kind).not.toBe('books')
  })
  it('may share a block with ping-pong and with a napper on the sofa (the reader sits, away from the table and the aisles)', () => {
    let withPingpong = 0
    let withNap = 0
    for (let b = 0; b < 2000; b++) {
      const kinds = Object.values(playAt(b * BLOCK_MINUTES, FIVE)).map((o) => o.kind)
      if (!kinds.includes('books')) continue
      if (kinds.includes('pingpong')) withPingpong++
      if (kinds.includes('sofa')) withNap++
    }
    expect(withPingpong).toBeGreaterThan(0)
    expect(withNap).toBeGreaterThan(0)
  })
  it('somebody who napped on the sofa may read the block after (it reads from the seat it is on or the next)', () => {
    let found = 0
    for (let b = 1; b < 2000; b++) {
      const now = playAt(b * BLOCK_MINUTES, FIVE)
      const was = playAt((b - 1) * BLOCK_MINUTES, FIVE)
      const reader = Object.entries(now).find(([, o]) => o.kind === 'books')
      if (reader && was[reader[0]]?.kind === 'sofa') found++
    }
    expect(found).toBeGreaterThan(0)
  })
})
