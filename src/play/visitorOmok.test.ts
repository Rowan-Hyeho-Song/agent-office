import { describe, expect, it } from 'vitest'
import { HAND_MS, N, PLACE_AT } from './omok'
import {
  OMOK_LINES, VISITOR_OMOK, canUndo, cellName, endGame, idleLeft, restart, setStrength, startVisitorGame, statusLine, stepVisitorGame, undo,
  viewOf, visitorMove, visitorTurn, type OmokEvent, type VisitorGame,
} from './visitorOmok'

// #137 ② (play.md 2 · 5): a visitor plays black against the agent placing a record alone, in their own tab.
const at = (x: number, y: number) => y * N + x
const said = (ev: OmokEvent[]) => ev.filter((e) => e.kind === 'say').map((e) => (e as { text: string }).text)

/** a game with these moves already on the board (black first), without the AI choosing any */
function withMoves(agent: string, seed: number, moves: number[], strength: VisitorGame['strength'] = 'normal'): VisitorGame {
  let g = startVisitorGame(agent, seed, 0, strength)
  for (const m of moves) {
    const s = g.s
    const b = s.board.slice()
    b[m] = s.toMove
    g = { ...g, s: { ...s, board: b, toMove: (s.toMove === 1 ? 2 : 1) as 1 | 2, moveIndex: s.moveIndex + 1, lastMove: m }, moves: [...g.moves, m] }
  }
  return g
}
/** the first free point from `cell` on (reading order) */
const free = (g: VisitorGame, cell: number) => {
  let c = cell
  while (g.s.board[c]) c = (c + 1) % (N * N)
  return c
}

/** the visitor plays `cell`, then the clock runs until the agent's stone has landed */
function turn(g: VisitorGame, cell: number, now: number) {
  const r = visitorMove(g, cell, now)
  if (!r) throw new Error(`illegal ${cellName(cell)}`)
  const events = [...r.events]
  let x = r.g
  if (x.pending) {
    const land = x.pending.at + x.pending.thinkMs + HAND_MS * PLACE_AT
    const s = stepVisitorGame(x, land)
    events.push(...s.events)
    x = s.g
    return { g: x, events, now: land }
  }
  return { g: x, events, now }
}

describe('a visitor game', () => {
  it('the visitor is black and moves first; the agent thinks 0.6–1.4 s, then its stone lands when its hand gets there', () => {
    const g = startVisitorGame('agent_0', 7, 0)
    expect(visitorTurn(g)).toBe(true)
    const r = visitorMove(g, at(7, 7), 1000)!
    expect(r.g.s.board[at(7, 7)]).toBe(1)
    expect(visitorTurn(r.g)).toBe(false)
    expect(visitorMove(r.g, at(8, 8), 1100), 'not while the agent is thinking').toBeNull()
    const p = r.g.pending!
    expect(p.thinkMs).toBeGreaterThanOrEqual(VISITOR_OMOK.thinkMs[0])
    expect(p.thinkMs).toBeLessThanOrEqual(VISITOR_OMOK.thinkMs[1])
    expect(r.events).toContainEqual({ kind: 'face', face: 'think' })
    const land = p.at + p.thinkMs + HAND_MS * PLACE_AT
    expect(stepVisitorGame(r.g, land - 1).g.pending, 'still in the hand').not.toBeNull()
    const s = stepVisitorGame(r.g, land).g
    expect(s.pending).toBeNull()
    expect(s.s.board[p.cell]).toBe(2)
    expect(visitorTurn(s)).toBe(true)
  })

  it('a taken point, or a game that is over, takes no stone', () => {
    const t = turn(startVisitorGame('agent_0', 7, 0), at(7, 7), 0)
    expect(visitorMove(t.g, at(7, 7), t.now + 10)).toBeNull()
    const q = endGame(t.g, 'quit', t.now + 20).g
    expect(visitorMove(q, at(0, 0), t.now + 30)).toBeNull()
  })

  it('the same game from the same seed (deterministic), a different one from another', () => {
    const play3 = (seed: number) => {
      let g = startVisitorGame('agent_3', seed, 0)
      let now = 0
      for (const c of [at(7, 7), at(8, 7), at(6, 8)]) ({ g, now } = turn(g, free(g, c), now + 500))
      return g.moves
    }
    expect(play3(11)).toEqual(play3(11))
    expect(new Set([1, 2, 3, 4, 5].map((s) => play3(s).join(','))).size).toBeGreaterThan(1)
  })

  it('five wins for the visitor: the agent is embarrassed and asks for another; the line is kept for the board', () => {
    // black (3..6, 7) closed on the left by white: the agent could block, but the visitor gets there first
    const g = withMoves('agent_0', 1, [at(3, 7), at(2, 7), at(4, 7), at(0, 0), at(5, 7), at(0, 14), at(6, 7), at(14, 0)])
    const r = visitorMove(g, at(7, 7), 1000)!
    expect(r.g.end?.result).toBe('black')
    expect(r.g.end?.line?.length).toBe(5)
    expect(said(r.events)).toEqual([OMOK_LINES.visitorWon])
    expect(r.events).toContainEqual({ kind: 'face', face: 'embarrassed' })
    const v = viewOf(r.g, 1500)
    expect(v.phase).toBe('won')
    expect(v.winner).toBe(1)
    expect(v.wonMs).toBe(500)
    expect(statusLine(r.g, '메모', 1500)).toBe('흑 승 · 9수')
  })

  it('the agent takes its own five (and is glad), and blocks the visitor\'s four with a word', () => {
    // black (2..4, 5), closed on the left by white (1, 5): black makes four, the agent must block the right end
    const g = withMoves('agent_1', 3, [at(2, 5), at(1, 5), at(3, 5), at(10, 10), at(4, 5), at(10, 11)])
    const r = turn(g, at(5, 5), 0)
    expect(r.g.end, 'the four is closed at one end: no resign').toBeNull()
    expect(r.g.s.board[at(6, 5)], 'blocked').toBe(2)
    expect(said(r.events)).toContain(OMOK_LINES.block)
    // white (12, 2..5) to move: its stone at (12, 6) makes five
    const w = withMoves('agent_1', 3, [at(0, 0), at(12, 2), at(0, 2), at(12, 3), at(0, 4), at(12, 4), at(0, 6), at(12, 5), at(14, 14)])
    const s = stepVisitorGame({ ...w, pending: { cell: at(12, 6), at: 0, thinkMs: 600 } }, 600 + HAND_MS * PLACE_AT)
    expect(s.g.end?.result).toBe('white')
    expect(said(s.events)).toContain(OMOK_LINES.agentWon)
    expect(s.events).toContainEqual({ kind: 'face', face: 'joy' })
  })

  it('nothing left to stop (two ways to five): the agent lays its stone down', () => {
    // black (5..7, 7) open at both ends, white far away; black plays (8, 7): an open four
    const g = withMoves('agent_0', 5, [at(5, 7), at(0, 0), at(6, 7), at(0, 14), at(7, 7), at(14, 0)])
    const r = visitorMove(g, at(8, 7), 1000)!
    expect(r.g.end?.result).toBe('resign')
    expect(said(r.events)).toEqual([OMOK_LINES.resign])
    expect(statusLine(r.g, '메모', 1000)).toBe('흑 승 · 7수')
  })

  it('undo takes back a pair, three times a game; the first time the agent says it is fine', () => {
    let t = turn(startVisitorGame('agent_2', 9, 0), at(7, 7), 0)
    t = turn(t.g, free(t.g, at(6, 6)), t.now + 400)
    expect(t.g.moves.length).toBe(4)
    const u1 = undo(t.g, t.now + 100)!
    expect(u1.g.moves.length).toBe(2)
    expect(u1.removed.length).toBe(2)
    expect(said(u1.events)).toEqual([OMOK_LINES.firstUndo])
    // while the agent thinks: only the visitor's stone goes, the agent's answer is dropped
    const r = visitorMove(u1.g, free(u1.g, at(9, 9)), t.now + 200)!
    const u2 = undo(r.g, t.now + 300)!
    expect(u2.g.moves).toEqual(u1.g.moves)
    expect(u2.g.pending).toBeNull()
    expect(said(u2.events)).toEqual([])
    const u3 = undo(u2.g, t.now + 400)!
    expect(u3.g.moves).toEqual([])
    expect(canUndo(u3.g), 'three used (and nothing to take back)').toBe(false)
    expect(undo(u3.g, t.now + 500)).toBeNull()
  })

  it('a quiet visitor: the HUD counts the last 10 s, a touch starts the 90 s again, then the agent lets the game go', () => {
    const t = turn(startVisitorGame('agent_0', 2, 0), at(7, 7), 0)
    const from = t.now
    expect(idleLeft(t.g, from + VISITOR_OMOK.idleMs - VISITOR_OMOK.warnMs - 1)).toBeNull()
    expect(idleLeft(t.g, from + VISITOR_OMOK.idleMs - 4000)).toBe(4000)
    expect(stepVisitorGame(t.g, from + VISITOR_OMOK.idleMs - 1).g.end).toBeNull()
    const s = stepVisitorGame(t.g, from + VISITOR_OMOK.idleMs)
    expect(s.g.end?.result).toBe('idle')
    expect(said(s.events)).toEqual([OMOK_LINES.idle])
    expect(statusLine(s.g, '메모', 0)).toBe('중단 · 2수')
  })

  it('called to work: a word and the game ends; 그만두기 ends it quietly; 다시 두기 starts the next game at the same strength', () => {
    const g = setStrength(startVisitorGame('agent_4', 4, 0), 'strong', 10)
    expect(said(g.events)).toEqual([OMOK_LINES.strong])
    expect(said(setStrength(g.g, 'easy', 20).events)).toEqual([OMOK_LINES.easy])
    expect(setStrength(g.g, 'strong', 20).events).toEqual([])
    expect(said(endGame(g.g, 'work', 30).events)).toEqual([OMOK_LINES.work])
    expect(endGame(g.g, 'quit', 30).events).toEqual([])
    const n = restart(endGame(g.g, 'quit', 30).g, 40)
    expect(n.game).toBe(1)
    expect(n.strength).toBe('strong')
    expect(n.moves).toEqual([])
  })

  it('easy misses an open three now and then; strong never does', () => {
    // black (5..7, 7) open at both ends after the visitor's move: does the agent close an end?
    const blocks = (st: VisitorGame['strength']) =>
      Array.from({ length: 60 }, (_, seed) => {
        const g = withMoves('agent_0', seed, [at(5, 7), at(1, 1), at(6, 7), at(13, 1)], st)
        const r = turn(g, at(7, 7), 0)
        return [at(4, 7), at(8, 7), at(3, 7), at(9, 7)].includes(r.g.moves[r.g.moves.length - 1])
      }).filter(Boolean).length
    const easy = blocks('easy')
    const strong = blocks('strong')
    expect(strong).toBe(60)
    expect(easy).toBeLessThan(55)
    expect(easy).toBeGreaterThan(20)
  })

  it('every strength takes its five, and blocks the visitor\'s', () => {
    for (const st of ['easy', 'normal', 'strong'] as const) {
      // white (9..12, 9) open at both ends; black plays far away: white makes five
      const win = withMoves('agent_2', 6, [at(3, 3), at(9, 9), at(4, 3), at(10, 9), at(0, 14), at(11, 9), at(14, 14), at(12, 9)], st)
      expect(turn(win, at(0, 0), 0).g.end?.result, st).toBe('white')
      // black (2..4, 5) closed on the left; black makes four: every strength blocks the right end
      const block = withMoves('agent_2', 6, [at(2, 5), at(1, 5), at(3, 5), at(10, 10), at(4, 5), at(10, 11)], st)
      expect(turn(block, at(5, 5), 0).g.s.board[at(6, 5)], st).toBe(2)
    }
  })

  it('the view: the agent\'s move for its hand (thinking → pick → place → withdrawing), the visitor holds black, the win line', () => {
    const r = visitorMove(startVisitorGame('agent_0', 8, 0), at(7, 7), 0)!
    const p = r.g.pending!
    const v0 = viewOf(r.g, 10)
    expect(v0.black).toBe(1)
    expect(v0.phase).toBe('thinking')
    expect(v0.move).toEqual({ mover: 0, cell: p.cell, sinceMs: 10, thinkMs: p.thinkMs })
    expect(viewOf(r.g, p.thinkMs + HAND_MS * 0.2).phase).toBe('pick')
    expect(viewOf(r.g, p.thinkMs + HAND_MS * 0.6).phase).toBe('place')
    const landed = stepVisitorGame(r.g, p.thinkMs + HAND_MS * PLACE_AT).g
    const w = viewOf(landed, p.thinkMs + HAND_MS * 0.8)
    expect(w.board[p.cell]).toBe(2)
    expect(w.move?.cell, 'the hand withdraws').toBe(p.cell)
    expect(viewOf(landed, p.thinkMs + HAND_MS + 1).move).toBeNull()
  })

  it('names and the status line', () => {
    expect(cellName(at(7, 7))).toBe('H8')
    expect(cellName(at(0, 14))).toBe('A1')
    expect(cellName(at(14, 0))).toBe('O15')
    const g = startVisitorGame('agent_0', 1, 0)
    expect(statusLine(g, '메모', 0)).toBe('● 오목 · 메모와 대국 · 당신(흑) 차례 · 1수')
    const r = visitorMove(g, at(7, 7), 0)!
    expect(statusLine(r.g, '메모', 0)).toBe('● 오목 · 메모와 대국 · 메모가 생각 중.')
    expect(statusLine(r.g, '메모', 900)).toBe('● 오목 · 메모와 대국 · 메모가 생각 중...')
  })
})
