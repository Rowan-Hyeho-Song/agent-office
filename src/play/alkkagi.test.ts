// #605 alkkagi: the simulation is deterministic, never gains energy, and knows when a stone is off the board; the rules, the AI, and the
// game frame (save · load · the same seed the same game).
import { describe, expect, it } from 'vitest'
import { rng } from '../office/play'
import { replayMoves } from './boardGame'
import {
  aiFlick, ALK, ALK_AI, alkkagi, flickText, onBoard, outcome, parseFlick, play, simulate, startPosition, validFlick, type AlkkagiState, type Flick, type Stone,
} from './alkkagi'

/** a board with just these stones, side 0 to move */
const board = (stones: Omit<Stone, 'out'>[], toMove: 0 | 1 = 0, turn = 0): AlkkagiState => ({ stones: stones.map((s) => ({ ...s, out: false })), toMove, turn })

/** a seeded spread of flicks from the start and from crowded boards */
function someFlicks(count: number) {
  const r = rng(42)
  const out: { s: AlkkagiState; f: Flick }[] = []
  for (let k = 0; k < count; k++) {
    const crowd = board(
      Array.from({ length: 10 }, (_, i) => ({ x: Math.round((r() * 12 - 6) * 100) / 100, y: Math.round((r() * 12 - 6) * 100) / 100, side: (i % 2) as 0 | 1 })),
    )
    // a crowd may start overlapping: pushing those apart must not add energy either
    const s = k % 2 ? startPosition() : crowd
    const mine = s.stones.map((st, i) => (st.side === 0 ? i : -1)).filter((i) => i >= 0)
    out.push({ s, f: { stone: mine[Math.floor(r() * mine.length)], dx: Math.round(r() * 2000 - 1000) || 1, dy: Math.round(r() * 2000 - 1000), power: 1 + Math.floor(r() * 1000) } })
  }
  return out
}

describe('the simulation', () => {
  it('the same flick gives the same run, step for step', () => {
    for (const { s, f } of someFlicks(12)) expect(JSON.stringify(simulate(s, f, 1))).toBe(JSON.stringify(simulate(s, f, 1)))
    const s = startPosition()
    const f = { stone: 2, dx: 0, dy: 1000, power: 600 }
    expect(JSON.stringify(simulate(s, { ...f, power: 601 }).end)).not.toBe(JSON.stringify(simulate(s, f).end))
  })
  it('energy never goes up: not by friction, not by a collision, not by pushing stones apart', () => {
    let hits = 0
    for (const { s, f } of someFlicks(40)) {
      const t = simulate(s, f, 1)
      hits += t.events.filter((e) => e.kind === 'hit').length
      for (let i = 1; i < t.energy.length; i++) expect(t.energy[i]).toBeLessThanOrEqual(t.energy[i - 1] + 1e-9)
      expect(t.energy[t.energy.length - 1]).toBe(0)
    }
    expect(hits).toBeGreaterThan(20) // the runs really did collide
  })
  it('on open wood a stone slides v²/2a and stops', () => {
    const s = board([{ x: 0, y: -8, side: 0 }, { x: 8, y: 8, side: 1 }])
    const v = 0.5 * ALK.maxSpeed
    const end = simulate(s, { stone: 0, dx: 0, dy: 1000, power: 500 }).end
    expect(end.stones[0].y - -8).toBeCloseTo((v * v) / (2 * ALK.friction), 1)
    expect(end.stones[0].x).toBe(0)
  })
  it('a straight hit passes the speed on (equal stones): the struck one goes on, the striker nearly stops', () => {
    const s = board([{ x: 0, y: -4, side: 0 }, { x: 0, y: 0, side: 1 }])
    const t = simulate(s, { stone: 0, dx: 0, dy: 1000, power: 400 })
    const [a, b] = t.end.stones
    expect(t.events.filter((e) => e.kind === 'hit')).toHaveLength(1)
    expect(b.y - 0).toBeGreaterThan(5 * (a.y - -4 - 4 + 2 * ALK.radius))
    expect(a.y).toBeLessThan(b.y - 2 * ALK.radius + 1e-9)
    expect(a.x).toBe(0)
    expect(b.x).toBe(0)
  })
  it('even at full power a stone does not pass through another (no tunnelling)', () => {
    const s = board([{ x: 0, y: -9, side: 0 }, { x: 0, y: -7, side: 1 }])
    const t = simulate(s, { stone: 0, dx: 0, dy: 1000, power: 1000 })
    expect(t.events[0]).toMatchObject({ kind: 'hit', a: 0, b: 1 })
    expect(ALK.maxSpeed * ALK.dt).toBeLessThan(ALK.radius)
  })
  it('off the board once the centre is past the edge; a stone that stops before it stays', () => {
    const s = board([{ x: 0, y: 0, side: 0 }, { x: 5, y: 5, side: 1 }])
    const gone = simulate(s, { stone: 0, dx: 1000, dy: 0, power: 1000 })
    expect(gone.end.stones[0].out).toBe(true)
    expect(gone.events).toContainEqual(expect.objectContaining({ kind: 'out', a: 0 }))
    // just enough to stop short: v² = 2a·d with d = edge - 0.2
    const d = ALK.edge - 0.2
    const power = Math.floor((Math.sqrt(2 * ALK.friction * d) / ALK.maxSpeed) * 1000)
    const kept = simulate(s, { stone: 0, dx: 1000, dy: 0, power }).end.stones[0]
    expect(kept.out).toBe(false)
    expect(kept.x).toBeGreaterThan(ALK.edge - 0.6)
    expect(kept.x).toBeLessThanOrEqual(ALK.edge)
  })
  it('knocking a stone off: the struck one goes out, the striker stays', () => {
    const s = board([{ x: 0, y: 6, side: 0 }, { x: 0, y: 8, side: 1 }, { x: -5, y: 0, side: 1 }])
    const end = play(s, { stone: 0, dx: 0, dy: 1000, power: 450 })!
    expect(end.stones[1].out).toBe(true)
    expect(end.stones[0].out).toBe(false)
  })
})

describe('the rules', () => {
  it('the start: five a side, side 0 first', () => {
    const s = startPosition()
    expect(onBoard(s, 0)).toBe(5)
    expect(onBoard(s, 1)).toBe(5)
    expect(s.toMove).toBe(0)
    expect(outcome(s)).toEqual({ kind: 'playing' })
  })
  it('only your own stone on the board, a real direction, power 1..1000', () => {
    const s = startPosition()
    expect(validFlick(s, { stone: 0, dx: 0, dy: 1000, power: 500 })).toBe(true)
    expect(validFlick(s, { stone: 7, dx: 0, dy: 1000, power: 500 })).toBe(false) // the other side's
    expect(validFlick(s, { stone: 0, dx: 0, dy: 0, power: 500 })).toBe(false)
    expect(validFlick(s, { stone: 0, dx: 0, dy: 1000, power: 0 })).toBe(false)
    expect(validFlick(s, { stone: 0, dx: 0, dy: 1000, power: 1001 })).toBe(false)
    expect(validFlick(s, { stone: 0, dx: 0.5, dy: 1000, power: 500 })).toBe(false)
    const gone = { ...s, stones: s.stones.map((st, i) => (i === 0 ? { ...st, out: true } : st)) }
    expect(validFlick(gone, { stone: 0, dx: 0, dy: 1000, power: 500 })).toBe(false)
    expect(play(s, { stone: 0, dx: 0, dy: 1000, power: 1 })!.toMove).toBe(1)
  })
  it('a side with no stones left loses; both at once is a draw; at the turn limit more stones wins', () => {
    const one = board([{ x: 0, y: 6, side: 0 }, { x: 0, y: 8, side: 1 }])
    expect(outcome(play(one, { stone: 0, dx: 0, dy: 1000, power: 450 })!)).toEqual({ kind: 'win', side: 0, reason: 'cleared' })
    const both = { ...one, stones: one.stones.map((st) => ({ ...st, out: true })) }
    expect(outcome(both)).toEqual({ kind: 'draw', reason: 'both cleared' })
    const late = board([{ x: 0, y: 0, side: 0 }, { x: 3, y: 0, side: 0 }, { x: 0, y: 5, side: 1 }], 0, ALK.maxTurns)
    expect(outcome(late)).toEqual({ kind: 'win', side: 0, reason: 'turns' })
    expect(play(late, { stone: 0, dx: 0, dy: 1000, power: 100 })).toBeNull()
  })
})

describe('the AI', () => {
  it('the same position, level and seed give the same flick; seeds differ at the easy level', () => {
    const s = startPosition()
    for (const lv of ['easy', 'normal', 'strong'] as const) expect(aiFlick(s, lv, 5)).toEqual(aiFlick(s, lv, 5))
    expect(new Set(Array.from({ length: 8 }, (_, k) => flickText(aiFlick(s, 'easy', k)))).size).toBeGreaterThan(1)
  })
  it('a lone stone near the edge: the strong level knocks it off', () => {
    const s = board([{ x: 0, y: 3, side: 0 }, { x: -6, y: -6, side: 0 }, { x: 0.4, y: 7, side: 1 }, { x: 6, y: -6, side: 1 }])
    const after = play(s, aiFlick(s, 'strong', 1))!
    expect(onBoard(after, 1)).toBe(1)
    expect(onBoard(after, 0)).toBe(2)
  })
  it('stronger levels take more stones off over a few games, every game ends, and one flick is bounded work', () => {
    const takes = { easy: 0, strong: 0 }
    for (const lv of ['easy', 'strong'] as const)
      for (let g = 0; g < 3; g++) {
        let s = startPosition()
        while (outcome(s).kind === 'playing') {
          const f = aiFlick(s, s.toMove === 0 ? lv : 'normal', 100 * g + s.turn)
          const before = onBoard(s, (1 - s.toMove) as 0 | 1)
          const mover = s.toMove
          s = play(s, f)!
          if (mover === 0) takes[lv] += before - onBoard(s, 1)
        }
        expect(s.turn).toBeLessThanOrEqual(ALK.maxTurns)
      }
    expect(takes.strong).toBeGreaterThan(takes.easy)
    // counted, not timed (a clock fails on a busy machine, #604): a flick simulates each of its candidates (own stone × their stone × tries) for at
    // most ALK.maxSteps steps
    for (const lv of ['easy', 'normal', 'strong'] as const) expect(ALK.perSide * ALK.perSide * ALK_AI[lv].tries.length * ALK.maxSteps, lv).toBeLessThanOrEqual(500_000)
  }, 60_000)
})

describe('the game frame', () => {
  it('a flick reads back from its words; nonsense does not', () => {
    const s = startPosition()
    const f = { stone: 3, dx: 120, dy: 990, power: 640 }
    expect(flickText(f)).toBe('3:120,990@640')
    expect(parseFlick(s, '3:120,990@640')).toEqual(f)
    expect(parseFlick(s, '3:120,990')).toBeNull()
    expect(parseFlick(s, '7:0,1000@500')).toBeNull()
  })
  it('the AI alone: the same seed plays the same game; its words replay it; save → load plays on the same', () => {
    const run = () => {
      let s = alkkagi.start()
      const words: string[] = []
      const saves: string[] = []
      while (alkkagi.outcome(s).kind === 'playing') {
        const m = alkkagi.ai(s, s.toMove === 0 ? 'normal' : 'easy', 7 + s.turn)
        words.push(alkkagi.moveText(m))
        expect(alkkagi.parseMove(s, alkkagi.moveText(m))).toEqual(m)
        s = alkkagi.play(s, m)!
        saves.push(alkkagi.save(s))
      }
      return { s, words, saves }
    }
    const a = run()
    expect(run().words).toEqual(a.words)
    expect(alkkagi.save(replayMoves(alkkagi, a.words)!)).toBe(alkkagi.save(a.s))
    for (const text of a.saves.slice(0, 6)) {
      const s = alkkagi.load(text)!
      expect(alkkagi.save(s)).toBe(text)
      if (alkkagi.outcome(s).kind === 'playing') expect(alkkagi.ai(s, 'strong', 3)).toEqual(alkkagi.ai(alkkagi.load(text)!, 'strong', 3))
    }
    expect(alkkagi.load('{')).toBeNull()
    expect(alkkagi.load(JSON.stringify({ stones: [{ x: 'a' }], toMove: 0, turn: 0 }))).toBeNull()
    expect(alkkagi.continuous).toBe(true)
    expect(alkkagi.moves(alkkagi.start()).every((m) => alkkagi.play(alkkagi.start(), m) !== null)).toBe(true)
  }, 60_000)
})
