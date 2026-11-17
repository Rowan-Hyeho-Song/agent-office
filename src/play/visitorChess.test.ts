import { describe, expect, it } from 'vitest'
import { fromFen, mv, play, squareAt } from './chess'
import { CHESS_HAND, CHESS_THINK, chessAt, resetChessCache } from './chessTimeline'
import { VISITOR_OMOK } from './visitorOmok'
import {
  CHESS_LINES,
  CHESS_STRENGTH_LEVEL,
  chessIdleLeft,
  chessLastMoveLine,
  chessMoveLine,
  chessResultLine,
  chessStatusLine,
  chessViewOf,
  describeMove,
  endChess,
  legalTargets,
  restartChess,
  setChessStrength,
  startVisitorChess,
  stepVisitorChess,
  undoChess,
  visitorChessMove,
  visitorChessTurn,
  visitorPieceAt,
  type ChessEvent,
  type ChessResult,
  type VisitorChess,
} from './visitorChess'

// #604 ②: a visitor plays hologram chess against an agent, in their own tab.
const sq = (name: string) => squareAt(name)!
const said = (ev: ChessEvent[]) => ev.filter((e) => e.kind === 'say').map((e) => (e as { text: string }).text)
const fen = (f: string) => fromFen(f)!
const landAt = (g: VisitorChess) => g.pending!.at + g.pending!.thinkMs + CHESS_HAND.land

/** the visitor moves, as a result (never null / needsPromotion) */
function go(g: VisitorChess, from: string, to: string, now: number, promo?: number): ChessResult {
  const r = visitorChessMove(g, sq(from), sq(to), now, promo)
  if (!r || r === 'needsPromotion') throw new Error(`not played ${from}${to}: ${String(r)}`)
  return r
}
/** the visitor moves, then the clock runs until the agent's piece has landed */
function turn(g: VisitorChess, from: string, to: string, now: number) {
  const r = go(g, from, to, now)
  const events = [...r.events]
  if (!r.g.pending) return { g: r.g, events, now }
  const t = landAt(r.g)
  const s = stepVisitorChess(r.g, t)
  return { g: s.g, events: [...events, ...s.events], now: t }
}
/** a game where the agent's next move is the given one (instead of the engine's) */
const forced = (g: VisitorChess, move: number, at = 0, thinkMs = 600): VisitorChess => ({ ...g, pending: { ply: describeMove(g.s, move, 'agent'), at, thinkMs } })

describe('the visitor\'s moves', () => {
  it('white moves first; a legal move lands at once, an illegal one (or a wrong colour) is refused', () => {
    const g = startVisitorChess('agent_0', 7, 0)
    expect(g.color).toBe(0)
    expect(visitorChessTurn(g)).toBe(true)
    expect(visitorChessMove(g, sq('e2'), sq('e5'), 10)).toBeNull()
    expect(visitorChessMove(g, sq('e7'), sq('e5'), 10), 'black\'s pawn').toBeNull()
    expect(visitorChessMove(g, sq('e4'), sq('e5'), 10), 'an empty square').toBeNull()
    const r = go(g, 'e2', 'e4', 1000)
    expect(r.g.s.board[sq('e4')]).toBe(1)
    expect(r.g.s.board[sq('e2')]).toBe(0)
    expect(r.g.plies).toHaveLength(1)
    expect(r.events).toContainEqual({ kind: 'face', face: 'think' })
    expect(visitorChessTurn(r.g)).toBe(false)
    expect(visitorChessMove(r.g, sq('d2'), sq('d4'), 1100), 'not while the agent thinks').toBeNull()
  })

  it('the helpers: where a piece may go (captures marked), and what stands on a square', () => {
    const g = startVisitorChess('agent_0', 7, 0)
    expect(legalTargets(g, sq('e2'))).toEqual(expect.arrayContaining([{ to: sq('e3'), capture: false }, { to: sq('e4'), capture: false }]))
    expect(legalTargets(g, sq('e2'))).toHaveLength(2)
    expect(legalTargets(g, sq('e7')), 'not the visitor\'s piece').toEqual([])
    expect(visitorPieceAt(g, sq('g1'))).toEqual({ kind: 2, side: 0, mine: true })
    expect(visitorPieceAt(g, sq('d8'))).toEqual({ kind: 5, side: 1, mine: false })
    expect(visitorPieceAt(g, sq('e4'))).toBeNull()
    const c = fen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')
    expect(legalTargets(startVisitorChess('a', 1, 0, 'normal', 0, c), sq('e4'))).toEqual(expect.arrayContaining([{ to: sq('d5'), capture: true }, { to: sq('e5'), capture: false }]))
    expect(legalTargets(go(g, 'e2', 'e4', 5).g, sq('d2'))).toEqual([])
  })

  it('a pawn reaching the last rank needs a choice: the marker, then the promotion; a wrong choice is refused', () => {
    const base = fen('8/P7/7k/8/8/8/8/4K3 w - - 0 1')
    const g = startVisitorChess('agent_0', 3, 0, 'normal', 0, base)
    expect(visitorChessMove(g, sq('a7'), sq('a8'), 10)).toBe('needsPromotion')
    expect(legalTargets(g, sq('a7'))).toEqual([{ to: sq('a8'), capture: false }])
    expect(visitorChessMove(g, sq('a7'), sq('a8'), 10, 6)).toBeNull()
    expect(visitorChessMove(g, sq('a7'), sq('a8'), 10, 1)).toBeNull()
    const r = go(g, 'a7', 'a8', 10, 5)
    expect(r.g.s.board[sq('a8')]).toBe(5)
    expect(r.g.plies[0].promo).toBe(5)
    expect(describeMove(base, mv(sq('a7'), sq('a8'), 2), 'visitor').promo).toBe(2)
    expect(chessMoveLine(r.g.plies[0])).toContain('퀸으로 승진')
  })
})

describe('the agent\'s reply', () => {
  it('thinks 0.6–1.6 s, its hand lands at think + 920 ms; the move counts from the landing', () => {
    const g = startVisitorChess('agent_0', 7, 0)
    const r = go(g, 'e2', 'e4', 1000)
    const p = r.g.pending!
    expect(p.at).toBe(1000)
    expect(p.thinkMs).toBeGreaterThanOrEqual(CHESS_THINK.min)
    expect(p.thinkMs).toBeLessThanOrEqual(CHESS_THINK.max)
    const t = 1000 + p.thinkMs + CHESS_HAND.land
    const before = stepVisitorChess(r.g, t - 1).g
    expect(before.pending, 'still in the hand').not.toBeNull()
    expect(before.plies).toHaveLength(1)
    const s = stepVisitorChess(r.g, t).g
    expect(s.pending).toBeNull()
    expect(s.plies).toHaveLength(2)
    expect(s.plies[1].by).toBe('agent')
    expect(s.plies[1].side).toBe(1)
    expect(s.s.side).toBe(0)
    expect(visitorChessTurn(s)).toBe(true)
  })

  it('more legal moves think longer (25 ms each, a seeded wobble of at most 100 ms), within the range', () => {
    const open = go(startVisitorChess('agent_0', 1, 0), 'e2', 'e4', 0).g.pending!.thinkMs // 20 replies
    const few = go(startVisitorChess('agent_0', 1, 0, 'normal', 0, fen('7k/8/8/8/8/8/6q1/K7 w - - 0 1')), 'a1', 'b1', 0)
    expect(few.g.pending!.thinkMs).toBeLessThanOrEqual(CHESS_THINK.min + 40 * 25 + 100)
    expect(open).toBeGreaterThan(CHESS_THINK.min + 15 * 25 - 100)
    for (let seed = 1; seed < 12; seed++) {
      const t = go(startVisitorChess('agent_1', seed, 0), 'd2', 'd4', 0).g.pending!.thinkMs
      expect(t).toBeGreaterThanOrEqual(CHESS_THINK.min)
      expect(t).toBeLessThanOrEqual(CHESS_THINK.max)
    }
  })

  it('deterministic: the same seed gives the same game, other seeds other ones', () => {
    const run = (seed: number) => {
      let g = startVisitorChess('agent_3', seed, 0)
      let now = 0
      for (const [a, b] of [['e2', 'e4'], ['g1', 'f3'], ['f1', 'c4']]) ({ g, now } = turn(g, a, b, now + 500))
      return JSON.stringify([g.plies.map((p) => p.move), now])
    }
    expect(run(11)).toBe(run(11))
    expect(new Set([1, 2, 3, 4, 5, 6].map(run)).size).toBeGreaterThan(1)
    const th = (seed: number) => go(startVisitorChess('agent_3', seed, 0), 'e2', 'e4', 0).g.pending!.thinkMs
    expect(th(4)).toBe(th(4))
  })

  it('a check says 체크예요; a piece moved out of attack says the avoid line, once a game', () => {
    const chk = forced(startVisitorChess('agent_0', 1, 0, 'normal', 0, fen('r3k3/8/8/8/8/8/8/4K3 b - - 0 1')), mv(sq('a8'), sq('a1')))
    expect(chk.pending!.ply.check).toBe(true)
    const r = stepVisitorChess(chk, 600 + CHESS_HAND.land)
    expect(said(r.events)).toEqual([CHESS_LINES.check])
    expect(CHESS_LINES.check).toBe('체크예요')

    const base = fen('4k3/8/8/3n4/4P3/8/8/4K3 b - - 0 1')
    const flee = forced(startVisitorChess('agent_0', 1, 0, 'normal', 0, base), mv(sq('d5'), sq('b6')))
    expect(flee.pending!.ply.fled).toBe(true)
    const f = stepVisitorChess(flee, 600 + CHESS_HAND.land)
    expect(said(f.events)).toEqual(['어, 이건 피해야겠어요'])
    // a second time in the same game: the line is not repeated
    const again = { ...forced({ ...f.g, s: base, plies: [], landed: null }, mv(sq('d5'), sq('b6'))), said: f.g.said }
    expect(said(stepVisitorChess(again, 600 + CHESS_HAND.land).events)).toEqual([])
    // a piece that was not attacked says nothing
    const calm = forced(startVisitorChess('agent_0', 1, 0, 'normal', 0, fen('4k3/8/8/3n4/8/8/8/4K3 b - - 0 1')), mv(sq('d5'), sq('b6')))
    expect(calm.pending!.ply.fled).toBe(false)
    expect(said(stepVisitorChess(calm, 600 + CHESS_HAND.land).events)).toEqual([])
  })

  it('en passant and castling are described for the hand', () => {
    const ep = describeMove(fen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2'), mv(sq('e5'), sq('d6')), 'visitor')
    expect(ep.capture).toBe(1)
    expect(ep.captureAt).toBe(sq('d5'))
    const ca = describeMove(fen('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'), mv(sq('e1'), sq('g1')), 'visitor')
    expect(ca.castle).toEqual({ from: sq('h1'), to: sq('f1') })
  })
})

describe('sides, strength, undo', () => {
  it('the visitor has white in the first game; the sides swap with each restart, and the agent opens when it has white', () => {
    const g0 = startVisitorChess('agent_0', 9, 0, 'strong')
    expect(g0.color).toBe(0)
    expect(g0.pending).toBeNull()
    const g1 = restartChess(g0, 5000)
    expect(g1.game).toBe(1)
    expect(g1.color).toBe(1)
    expect(g1.strength).toBe('strong')
    expect(g1.pending, 'the agent opens').not.toBeNull()
    expect(g1.pending!.ply.side).toBe(0)
    expect(visitorChessTurn(g1)).toBe(false)
    const l = stepVisitorChess(g1, landAt(g1)).g
    expect(l.plies).toHaveLength(1)
    expect(visitorChessTurn(l)).toBe(true)
    expect(chessViewOf(g0, 0).white).toBe(1)
    expect(chessViewOf(g1, 5000).white).toBe(0)
    expect(restartChess(g1, 9000).color).toBe(0)
  })

  it('strength maps to the engine levels and speaks as in omok', () => {
    expect(CHESS_STRENGTH_LEVEL).toEqual({ easy: 'easy', normal: 'normal', strong: 'strong' })
    const g = startVisitorChess('agent_0', 1, 0)
    expect(setChessStrength(g, 'normal', 5).events).toEqual([])
    const e = setChessStrength(g, 'easy', 5)
    expect(e.g.strength).toBe('easy')
    expect(said(e.events)).toEqual(['천천히 둘게요'])
    expect(said(setChessStrength(g, 'strong', 5).events)).toEqual(['진지하게 둘게요'])
  })

  it('undo takes back the visitor\'s move and the agent\'s answer, three times, not after the end', () => {
    let t = turn(startVisitorChess('agent_0', 5, 0), 'e2', 'e4', 100)
    expect(t.g.plies).toHaveLength(2)
    const u = undoChess(t.g, t.now + 10)!
    expect(u.g.plies).toHaveLength(0)
    expect(u.removed).toHaveLength(2)
    expect(u.g.s.board[sq('e2')]).toBe(1)
    expect(u.g.undos).toBe(1)
    expect(said(u.events)).toEqual([CHESS_LINES.firstUndo])
    expect(u.events).toContainEqual({ kind: 'face', face: 'nod' })
    expect(undoChess(u.g, 1)).toBeNull() // nothing to take back
    let g = u.g
    let now = t.now + 20
    for (let i = 1; i < VISITOR_OMOK.undoMax; i++) {
      t = turn(g, 'e2', 'e4', now)
      const x = undoChess(t.g, t.now + 1)!
      expect(x.events, 'the line only the first time').toEqual([])
      g = x.g
      now = t.now + 5
    }
    expect(g.undos).toBe(VISITOR_OMOK.undoMax)
    t = turn(g, 'e2', 'e4', now)
    expect(undoChess(t.g, t.now + 1), 'the fourth').toBeNull()
    expect(undoChess(endChess(turn(startVisitorChess('a', 1, 0), 'e2', 'e4', 0).g, 'quit', 9).g, 10)).toBeNull()
  })

  it('undo while the agent thinks takes back only the visitor\'s move; with black the agent\'s opening stays', () => {
    const r = go(startVisitorChess('agent_0', 5, 0), 'e2', 'e4', 100)
    const u = undoChess(r.g, 200)!
    expect(u.g.plies).toHaveLength(0)
    expect(u.g.pending).toBeNull()
    expect(visitorChessTurn(u.g)).toBe(true)
    // black: agent's opening, visitor's reply, agent's answer
    let g = restartChess(startVisitorChess('agent_0', 5, 0), 0)
    g = stepVisitorChess(g, landAt(g)).g
    expect(undoChess(g, 1), 'only the agent\'s opening').toBeNull()
    const opening = g.plies[0].move
    const reply = legalTargets(g, sq('e7'))[0]
    const t = turn(g, 'e7', reply.to === sq('e6') ? 'e6' : 'e5', 5000)
    expect(t.g.plies).toHaveLength(3)
    const x = undoChess(t.g, t.now + 1)!
    expect(x.g.plies.map((p) => p.move)).toEqual([opening])
    expect(visitorChessTurn(x.g)).toBe(true)
  })
})

describe('the end', () => {
  const win = fen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 31')

  it('the visitor mates: the result line, the agent embarrassed and asks for another', () => {
    const r = go(startVisitorChess('agent_0', 1, 0, 'normal', 0, win), 'a1', 'a8', 1000)
    expect(r.g.end).toMatchObject({ result: 'white', reason: 'checkmate' })
    expect(r.g.pending).toBeNull()
    expect(said(r.events)).toEqual([CHESS_LINES.visitorWon])
    expect(r.events).toContainEqual({ kind: 'face', face: 'embarrassed' })
    expect(chessResultLine(r.g)).toBe('백 승 · 체크메이트 · 31수')
    expect(chessStatusLine(r.g, '메모', 1500)).toBe('백 승 · 체크메이트 · 31수')
    expect(undoChess(r.g, 1600)).toBeNull()
  })

  it('the agent mates: it is glad, the result counts from the landing', () => {
    const g = startVisitorChess('agent_0', 1, 0, 'strong', 1, win) // the visitor has black: the agent (white) opens
    const f = forced(g, mv(sq('a1'), sq('a8')), 0, 700)
    const s = stepVisitorChess(f, 5000)
    expect(s.g.end).toMatchObject({ result: 'white', reason: 'checkmate', at: 700 + CHESS_HAND.land })
    expect(said(s.events)).toEqual([CHESS_LINES.agentWon])
    expect(s.events).toContainEqual({ kind: 'face', face: 'joy' })
    expect(chessResultLine(s.g)).toBe('백 승 · 체크메이트 · 31수')
    const v = chessViewOf(s.g, 700 + CHESS_HAND.land + 300)
    expect(v.phase).toBe('result')
    expect(v.end).toMatchObject({ kind: 'win', side: 0, reason: 'checkmate', sinceMs: 300 })
    expect(v.move).toBeNull()
  })

  it('draws: stalemate, fifty moves, three repetitions, material', () => {
    const stale = go(startVisitorChess('a', 1, 0, 'normal', 0, fen('7k/5K2/8/8/8/8/8/6Q1 w - - 0 40')), 'g1', 'g6', 5).g
    expect(stale.end).toMatchObject({ result: 'draw', reason: 'stalemate' })
    expect(chessResultLine(stale)).toBe('무승부 · 스테일메이트 · 40수')
    expect(stale.pending).toBeNull()

    const fifty = go(startVisitorChess('a', 1, 0, 'normal', 0, fen('4k3/8/8/8/8/8/8/R3K3 w - - 99 60')), 'a1', 'a2', 5).g
    expect(chessResultLine(fifty)).toBe('무승부 · 50수 규칙 · 60수')

    const b0 = fen('4k3/8/8/8/8/8/8/R3K3 w - - 10 60')
    const key = play(b0, mv(sq('a1'), sq('a2')))!.keys.at(-1)!
    const rep = go(startVisitorChess('a', 1, 0, 'normal', 0, { ...b0, keys: [...b0.keys, key, key] }), 'a1', 'a2', 5).g
    expect(chessResultLine(rep)).toBe('무승부 · 3회 반복 · 60수')

    const mat = go(startVisitorChess('a', 1, 0, 'normal', 0, fen('4k3/8/8/8/8/8/1n6/B3K3 w - - 0 5')), 'a1', 'b2', 5).g
    expect(chessResultLine(mat)).toBe('무승부 · 기물 부족 · 5수')
    expect(chessViewOf(mat, 10).end).toMatchObject({ kind: 'draw', reason: 'material' })
  })

  it('quit, work and resign end the game like omok; a quiet visitor is let go after the idle time', () => {
    const g = turn(startVisitorChess('agent_0', 1, 0), 'e2', 'e4', 100)
    const q = endChess(g.g, 'quit', 9000)
    expect(q.g.end?.result).toBe('quit')
    expect(q.events).toEqual([])
    expect(chessStatusLine(q.g, '메모', 9001)).toBe('중단 · 1수')
    expect(visitorChessMove(q.g, sq('d2'), sq('d4'), 9100)).toBeNull()
    const w = endChess(g.g, 'work', 9000)
    expect(said(w.events)).toEqual([CHESS_LINES.work])
    expect(chessStatusLine(w.g, '메모', 9001)).toBe('중단 · 메모가 일하러 감')
    const r = endChess(g.g, 'resign', 9000)
    expect(chessResultLine(r.g)).toBe('흑 승 · 기권 · 1수')
    expect(chessViewOf(r.g, 9001).end).toMatchObject({ kind: 'win', side: 1, reason: 'resign' })
    expect(endChess(q.g, 'work', 9500).g).toBe(q.g)

    const idle0 = g.g.lastInput
    expect(stepVisitorChess(g.g, idle0 + VISITOR_OMOK.idleMs - 1).g.end).toBeNull()
    expect(chessIdleLeft(g.g, idle0 + VISITOR_OMOK.idleMs - 5000)).toBe(5000)
    expect(chessIdleLeft(g.g, idle0 + 1000)).toBeNull()
    const i = stepVisitorChess(g.g, idle0 + VISITOR_OMOK.idleMs)
    expect(i.g.end?.result).toBe('idle')
    expect(said(i.events)).toEqual([CHESS_LINES.idle])
    // not while the agent is thinking
    const think = go(startVisitorChess('agent_0', 1, 0), 'e2', 'e4', 0).g
    expect(stepVisitorChess({ ...think, lastInput: -VISITOR_OMOK.idleMs }, 100).g.end).toBeNull()
  })
})

describe('the words', () => {
  it('the status line: the visitor\'s circle, the agent, whose turn, the move number', () => {
    const g = startVisitorChess('agent_0', 1, 0, 'normal', 0, fen('4k3/8/8/8/8/8/8/R3K3 w - - 0 12'))
    expect(chessStatusLine(g, '메모', 0)).toBe('○ 체스 · 메모와 대국 · 당신(백) 차례 · 12수')
    expect(chessStatusLine(g, '메모', 0, '일 호출')).toContain('메모와 대국 · 일 호출')
    const t = go(g, 'a1', 'a2', 1000).g
    expect(chessStatusLine(t, '메모', 1000)).toBe('○ 체스 · 메모와 대국 · 메모가 생각 중.')
    expect(chessStatusLine(t, '메모', 1400)).toBe('○ 체스 · 메모와 대국 · 메모가 생각 중..')
    const black = restartChess(startVisitorChess('agent_0', 1, 0), 0)
    const done = stepVisitorChess(black, landAt(black)).g
    expect(chessStatusLine(done, '메모', 9999)).toBe('● 체스 · 메모와 대국 · 당신(흑) 차례 · 1수')
  })

  it('the screen-reader lines', () => {
    const start = startVisitorChess('agent_0', 1, 0)
    const e4 = describeMove(start.s, mv(sq('e2'), sq('e4')), 'visitor')
    expect(chessMoveLine(e4, '메모')).toBe('백 폰 e2에서 e4. 메모가 생각 중')
    expect(chessMoveLine(e4)).toBe('백 폰 e2에서 e4')
    const nf6 = describeMove(fen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'), mv(sq('g8'), sq('f6')), 'agent')
    expect(chessMoveLine(nf6)).toBe('흑 나이트 g8에서 f6')
    const cap = describeMove(fen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1'), mv(sq('e4'), sq('d5')), 'visitor')
    expect(chessMoveLine(cap)).toBe('백 폰 e4에서 d5 잡음 흑 폰')
    const chk = describeMove(fen('r3k3/8/8/8/8/8/8/4K3 b - - 0 1'), mv(sq('a8'), sq('a1')), 'agent')
    expect(chessMoveLine(chk)).toBe('흑 룩 a8에서 a1. 체크')
    const r = go(start, 'e2', 'e4', 10).g
    expect(chessLastMoveLine(r, '메모')).toBe('백 폰 e2에서 e4. 메모가 생각 중')
    expect(chessLastMoveLine(start, '메모')).toBeNull()
  })
})

describe('the view for the stage', () => {
  it('has the shape of an agents\' game view (the same keys, the same move keys)', () => {
    resetChessCache()
    let tm = 0
    let agents = chessAt(3, ['a', 'b'], tm, 4)
    while (!agents.move && tm < 20_000) agents = chessAt(3, ['a', 'b'], (tm += 100), 4)
    expect(agents.move).not.toBeNull()
    const g = go(startVisitorChess('agent_0', 1, 0), 'e2', 'e4', 1000).g
    const v = chessViewOf(g, 1200)
    expect(Object.keys(v).sort()).toEqual(Object.keys(agents).sort())
    expect(Object.keys(v.move!).sort()).toEqual(Object.keys(agents.move!).sort())
    const e = chessViewOf(go(startVisitorChess('a', 1, 0, 'normal', 0, fen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 31')), 'a1', 'a8', 5).g, 6)
    expect(Object.keys(e.end!).sort()).toEqual(['kind', 'plies', 'reason', 'side', 'sinceMs'])
  })

  it('the visitor\'s move lands at once; the agent\'s goes through thinking, pick, place with the hand timing', () => {
    const g0 = startVisitorChess('agent_0', 1, 0)
    const r = go(g0, 'e2', 'e4', 1000)
    const v0 = chessViewOf(r.g, 1000)
    expect(v0.board[sq('e4')]).toBe(1)
    expect(v0.moveIndex).toBe(1)
    expect(v0.lastMove).toEqual({ from: sq('e2'), to: sq('e4') })
    expect(v0.toMove).toBe(1)
    expect(v0.phase).toBe('thinking')
    expect(v0.move).toMatchObject({ mover: 0, side: 1, sinceMs: 0, thinkMs: r.g.pending!.thinkMs })
    const T = r.g.pending!.thinkMs
    expect(chessViewOf(r.g, 1000 + T + CHESS_HAND.pick - 1).phase).toBe('thinking')
    expect(chessViewOf(r.g, 1000 + T + CHESS_HAND.pick).phase).toBe('pick')
    const pend = chessViewOf(r.g, 1000 + T + CHESS_HAND.land - 1)
    expect(pend.phase).toBe('pick')
    expect(pend.moveIndex, 'not landed yet').toBe(1)
    const m = r.g.pending!.ply
    expect(pend.board[m.move & 63], 'its piece still on the start square').not.toBe(0)
    const land = stepVisitorChess(r.g, 1000 + T + CHESS_HAND.land).g
    const placed = chessViewOf(land, 1000 + T + CHESS_HAND.land)
    expect(placed.phase).toBe('place')
    expect(placed.moveIndex).toBe(2)
    expect(placed.move).not.toBeNull()
    expect(chessViewOf(land, 1000 + T + CHESS_HAND.end - 1).move).not.toBeNull()
    const back = chessViewOf(land, 1000 + T + CHESS_HAND.end)
    expect(back.move).toBeNull()
    expect(back.phase).toBe('thinking')
  })

  it('check square, pieces taken by each side, and the visitor\'s own capture', () => {
    const base = fen('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1')
    const g = go(startVisitorChess('agent_0', 1, 0, 'normal', 0, base), 'e4', 'd5', 10).g
    expect(chessViewOf(g, 10).takenByWhite).toEqual([1])
    expect(chessViewOf(g, 10).takenByBlack).toEqual([])
    const chk = stepVisitorChess(forced(startVisitorChess('agent_0', 1, 0, 'normal', 0, fen('r3k3/8/8/8/8/8/8/4K3 b - - 0 1')), mv(sq('a8'), sq('a1'))), 5000).g
    expect(chessViewOf(chk, 6000).check).toBe(sq('e1'))
    expect(chessViewOf(startVisitorChess('a', 1, 0), 0).check).toBeNull()
  })
})
