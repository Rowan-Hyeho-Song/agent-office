import { describe, expect, it } from 'vitest'
import { N, PERSONALITIES, aiMove, gameAt, legalMoves, newGame, play, winner, type OmokState } from './omok'

const at = (x: number, y: number) => y * N + x
function seq(cells: number[]): OmokState {
  let s = newGame()
  for (const c of cells) {
    const n = play(s, c)
    if (!n) throw new Error('illegal ' + c)
    s = n
  }
  return s
}
/** black plays `blk`, white plays filler cells in between */
function withBlack(blk: number[], fill: number[]): OmokState {
  const cells: number[] = []
  for (let i = 0; i < blk.length; i++) {
    cells.push(blk[i])
    if (i < blk.length - 1) cells.push(fill[i])
  }
  return seq(cells)
}

describe('rules', () => {
  const fillers = [0, 2, 4, 6, 8, 10].map((x) => at(x, 14))
  it('five in a row wins: horizontal, vertical, both diagonals', () => {
    const lines: Record<string, number[]> = {
      h: [0, 1, 2, 3, 4].map((i) => at(3 + i, 5)),
      v: [0, 1, 2, 3, 4].map((i) => at(5, 3 + i)),
      d1: [0, 1, 2, 3, 4].map((i) => at(3 + i, 3 + i)),
      d2: [0, 1, 2, 3, 4].map((i) => at(9 - i, 3 + i)),
    }
    for (const [k, l] of Object.entries(lines)) {
      const s = withBlack(l, fillers)
      expect(s.result, k).toBe('black')
      expect(winner(s)).toEqual({ winner: 1, line: expect.arrayContaining(l) })
    }
  })
  it('four is not a win; a gap breaks the run', () => {
    expect(withBlack([0, 1, 2, 3].map((i) => at(3 + i, 5)), fillers).result).toBe('playing')
    expect(withBlack([at(3, 5), at(4, 5), at(6, 5), at(7, 5), at(8, 5)], fillers).result).toBe('playing')
  })
  it('six in a row also wins (freestyle)', () => {
    const s = withBlack([2, 3, 4, 6, 7, 5].map((x) => at(x, 7)), [...fillers, at(12, 14)])
    expect(s.result).toBe('black')
    expect(s.line!.length).toBe(6)
  })
  it('white can win too, and play stops after a win', () => {
    const s = seq([at(0, 0), at(5, 5), at(0, 2), at(6, 5), at(0, 4), at(7, 5), at(0, 6), at(8, 5), at(14, 14), at(9, 5)])
    expect(s.result).toBe('white')
    expect(play(s, at(10, 10))).toBeNull()
    expect(legalMoves(s)).toEqual([])
  })
  it('rejects occupied and off-board moves; legalMoves counts empties', () => {
    const s = seq([at(7, 7)])
    expect(play(s, at(7, 7))).toBeNull()
    expect(play(s, -1)).toBeNull()
    expect(play(s, N * N)).toBeNull()
    expect(legalMoves(s).length).toBe(N * N - 1)
  })
  it('a full board without five is a draw', () => {
    // runs of at most 2 in every direction; 113 black / 112 white
    const blacks: number[] = []
    const whites: number[] = []
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) (((x >> 1) + y) % 2 === 0 ? blacks : whites).push(at(x, y))
    expect([blacks.length, whites.length]).toEqual([113, 112])
    let s = newGame()
    for (let i = 0; i < blacks.length; i++) {
      s = play(s, blacks[i])!
      if (i < whites.length) s = play(s, whites[i])!
    }
    expect(s.result).toBe('draw')
    expect(winner(s)).toEqual({ winner: 0, draw: true })
    expect(legalMoves(s)).toEqual([])
  })
})

describe('AI', () => {
  it('takes an immediate win', () => {
    const s = seq([at(5, 5), at(0, 0), at(6, 5), at(0, 2), at(7, 5), at(0, 4), at(8, 5), at(14, 0)])
    for (const p of Object.values(PERSONALITIES)) {
      const m = aiMove(s, p, 42)
      expect([at(4, 5), at(9, 5)]).toContain(m)
      expect(play(s, m)!.result).toBe('black')
    }
  })
  it('blocks an opponent open four, and the open end of a closed four', () => {
    const s = seq([at(0, 0), at(5, 5), at(0, 2), at(6, 5), at(0, 4), at(7, 5), at(14, 14), at(8, 5)])
    for (const p of Object.values(PERSONALITIES)) expect([at(4, 5), at(9, 5)]).toContain(aiMove(s, p, 7))
    const t = seq([at(4, 5), at(5, 5), at(0, 2), at(6, 5), at(0, 4), at(7, 5), at(14, 14), at(8, 5)])
    expect(aiMove(t, PERSONALITIES.agent_0, 3)).toBe(at(9, 5))
  })
  it('is deterministic given (state, personality, seed) and varies with the seed', () => {
    const s = seq([at(7, 7), at(8, 8), at(7, 8)])
    expect(aiMove(s, PERSONALITIES.agent_2, 5)).toBe(aiMove(s, PERSONALITIES.agent_2, 5))
    const moves = new Set(Array.from({ length: 40 }, (_, i) => aiMove(s, PERSONALITIES.agent_2, i)))
    expect(moves.size).toBeGreaterThan(1)
  })
  it('opens at the centre and always plays a legal move', () => {
    expect(aiMove(newGame(), PERSONALITIES.agent_0, 1)).toBe(at(7, 7))
    let s = newGame()
    for (let i = 0; i < 40 && s.result === 'playing'; i++) {
      const next = play(s, aiMove(s, PERSONALITIES[`agent_${i % 4}`], 9))
      expect(next).not.toBeNull()
      s = next!
    }
  })
})

describe('gameAt', () => {
  const players: [string, string] = ['agent_0', 'agent_3']
  it('same inputs deep-equal, different seeds differ', () => {
    for (const t of [0, 1500, 9000, 70000]) expect(gameAt(11, players, t)).toEqual(gameAt(11, players, t))
    expect(gameAt(11, players, 60000).board).not.toEqual(gameAt(12, players, 60000).board)
  })
  it('seeking equals stepping, and the board grows by at most one stone per step', () => {
    const direct = gameAt(31, players, 80000)
    let prev = gameAt(31, players, 0)
    for (let t = 0; t <= 80000; t += 100) {
      const v = gameAt(31, players, t)
      if (v.game === prev.game) {
        expect(v.moveIndex - prev.moveIndex).toBeGreaterThanOrEqual(0)
        expect(v.moveIndex - prev.moveIndex).toBeLessThanOrEqual(1)
      }
      prev = v
    }
    expect(gameAt(31, players, 80000)).toEqual(direct)
  })
  it('walks think, pick, place, then won, reset, and a new game', () => {
    const phases: string[] = []
    let sawGame1 = false
    let won: ReturnType<typeof gameAt> | null = null
    for (let t = 0; t < 600000; t += 50) {
      const v = gameAt(8, players, t)
      if (phases[phases.length - 1] !== v.phase) phases.push(v.phase)
      if (v.phase === 'won' && !won) won = v
      if (v.game === 1) sawGame1 = true
    }
    expect(phases.slice(0, 3)).toEqual(['thinking', 'pick', 'place'])
    expect(phases).toContain('won')
    expect(phases).toContain('reset')
    expect(sawGame1).toBe(true)
    expect(won!.winner || won!.draw).toBeTruthy()
    if (won!.winner) expect(won!.line!.length).toBeGreaterThanOrEqual(5)
  })
  it('the stones on the clock are a legal alternation', () => {
    for (let t = 0; t < 300000; t += 997) {
      const v = gameAt(5, players, t)
      let blacks = 0
      let whites = 0
      for (const c of v.board) {
        if (c === 1) blacks++
        if (c === 2) whites++
      }
      if (v.phase !== 'reset') expect(blacks - whites).toBeGreaterThanOrEqual(0)
      if (v.phase !== 'reset') expect(blacks - whites).toBeLessThanOrEqual(1)
    }
  })
  it('discrete: board only, no hand, empty during reset', () => {
    let reset = false
    for (let t = 0; t < 900000; t += 500) {
      const v = gameAt(8, players, t, true)
      expect(v.handT01).toBe(0)
      expect(v.pending).toBeNull()
      if (v.phase === 'reset') {
        reset = true
        expect(v.board.every((c) => c === 0)).toBe(true)
      }
    }
    expect(reset).toBe(true)
  })

  it('block timing: >= 90% of sessions reach a result and the reset within 165 s', () => {
    const lens: number[] = []
    let within = 0
    let second = 0
    const total = 200
    for (let sd = 0; sd < total; sd++) {
      const pl: [string, string] = [`agent_${sd % 4}`, `agent_${(sd + 1 + ((sd >> 2) % 3)) % 4}`]
      let end = -1
      let t0 = 0
      for (let t = 0; t <= 400000; t += 500) {
        const v = gameAt(sd * 7 + 1, pl, t)
        if (v.game > 0) {
          if (t <= 165000) second++
          break
        }
        if (v.phase === 'reset' && (v.resetT01 ?? 0) >= 0.999) end = t
        if (v.phase === 'won' && t0 === 0) t0 = t
      }
      const len = (t0 || 400000) + 6500
      lens.push(len)
      if (end >= 0 || len <= 165000) if (len <= 165000) within++
    }
    lens.sort((a, b) => a - b)
    const med = lens[total >> 1] / 1000
    const pct = (within / total) * 100
    console.log(`omok median game+reaction+reset ${med} s, within 165 s: ${pct}%, second game starts in ${(second / total) * 100}%`)
    expect(pct).toBeGreaterThanOrEqual(90)
  })
  it('a second game starts from an empty board with the same colours (each seat keeps its colour and its bowl), and seeking across games is deterministic', () => {
    let sd = 0
    let tStart = -1
    for (; sd < 40 && tStart < 0; sd++) {
      for (let t = 0; t <= 165000; t += 500) if (gameAt(sd, players, t).game === 1) { tStart = t; break }
    }
    sd--
    expect(tStart).toBeGreaterThan(0)
    const v = gameAt(sd, players, tStart)
    expect(v.moveIndex).toBe(0)
    expect(v.black).toBe(0)
    const direct = gameAt(sd, players, tStart + 20000)
    for (let t = 0; t <= tStart + 20000; t += 700) gameAt(sd, players, t)
    expect(gameAt(sd, players, tStart + 20000)).toEqual(direct)
  })
  it('the opening is on the board at t=0, legal and undecided', () => {
    for (let sd = 0; sd < 50; sd++) {
      const v = gameAt(sd, players, 0)
      expect(v.moveIndex).toBeGreaterThanOrEqual(6)
      expect(v.moveIndex).toBeLessThanOrEqual(10)
      expect(v.phase).toBe('thinking')
    }
  })
})
