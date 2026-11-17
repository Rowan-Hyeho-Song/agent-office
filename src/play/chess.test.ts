// #604 chess: the move generator against the standard perft counts, the special rules, the end of a game, the AI's determinism and
// its time per move, and the game frame (save · load · replay).
import { describe, expect, it } from 'vitest'
import { replayMoves } from './boardGame'
import {
  aiMove, chess, CHESS_AI, fromFen, insufficient, legalMoves, moveText, outcome, parseMove, perft, play, positionKey, startPosition, toFen,
  type ChessState,
} from './chess'

const at = (fen: string) => fromFen(fen)!
const after = (moves: string[], from = startPosition()) => {
  const s = replayMoves(chess, moves, from)
  if (!s) throw new Error(`illegal in ${moves.join(' ')}`)
  return s
}

describe('perft (chessprogramming.org)', () => {
  const POSITIONS: [string, string, number[]][] = [
    ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['position 3 (en passant, pins)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['position 4 (promotions, castling)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
  ]
  for (const [name, fen, counts] of POSITIONS)
    it(name, () => {
      const s = at(fen)
      counts.forEach((n, i) => expect(perft(s, i + 1), `depth ${i + 1}`).toBe(n))
    })
})

describe('FEN', () => {
  it('reads and writes the same text; refuses broken ones', () => {
    for (const f of ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'r3k2r/8/8/8/3pP3/8/8/R3K2R b Kq e3 0 23']) expect(toFen(at(f))).toBe(f)
    expect(fromFen('8/8/8/8/8/8/8/8 w - - 0 1')).toBeNull() // no kings
    expect(fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1')).toBeNull() // seven ranks
    expect(fromFen('4k3/8/8/8/8/8/8/4R1K1 w - - 0 1')).toBeNull() // black in check with white to move
  })
})

describe('special rules', () => {
  it('castling: the king two squares, the rook over it; rights lost with a king or rook move or a rook taken', () => {
    const s = after(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'])
    const c = play(s, parseMove(s, 'e1g1')!)!
    expect(toFen(c).split(' ')[0]).toBe('r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1')
    expect(toFen(c).split(' ')[2]).toBe('kq')
    // a rook move takes its side only
    const r = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    expect(toFen(play(r, parseMove(r, 'h1h2')!)!).split(' ')[2]).toBe('Qkq')
    // taking a rook at home takes the other side's right
    const x = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    expect(toFen(play(x, parseMove(x, 'a1a8')!)!).split(' ')[2]).toBe('Kk')
  })
  it('no castling out of, through or into check, nor with a piece between', () => {
    const moves = (fen: string) => legalMoves(at(fen)).map(moveText)
    expect(moves('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')).toEqual(expect.arrayContaining(['e1g1', 'e1c1']))
    expect(moves('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1').filter((m) => m === 'e1g1' || m === 'e1c1')).toHaveLength(2)
    expect(moves('4k3/8/8/8/8/8/8/R3K1NR w KQ - 0 1')).not.toContain('e1g1') // a knight between
    expect(moves('4k3/8/8/8/8/8/8/RN2K2R w KQ - 0 1')).not.toContain('e1c1') // b1 taken (only the rook's way)
    expect(moves('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toContain('e1c1')
    expect(moves('4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1').filter((m) => m === 'e1g1' || m === 'e1c1')).toEqual([]) // in check
    expect(moves('5rk1/8/8/8/8/8/8/R3K2R w KQ - 0 1')).not.toContain('e1g1') // through f1
    expect(moves('k5r1/p7/8/8/8/8/8/R3K2R w KQ - 0 1')).not.toContain('e1g1') // into g1
    expect(moves('1r4k1/8/8/8/8/8/8/R3K2R w KQ - 0 1')).toContain('e1c1') // b1 attacked: the king does not cross it
  })
  it('en passant: right after the double step only, and it takes the pawn beside', () => {
    const s = after(['e2e4', 'a7a6', 'e4e5', 'd7d5'])
    expect(toFen(s).split(' ')[3]).toBe('d6')
    const c = play(s, parseMove(s, 'e5d6')!)!
    expect(toFen(c).split(' ')[0]).toBe('rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR')
    // one move later the chance is gone
    const late = after(['g1f3', 'g8f6'], s)
    expect(parseMove(late, 'e5d6')).toBeNull()
    // an en passant that would leave the king in check is not allowed (the pinned pair on the fifth rank)
    expect(legalMoves(at('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1')).map(moveText)).not.toContain('e5d6')
  })
  it('promotion: four pieces to choose; no letter means the queen', () => {
    const s = at('8/P6k/8/8/8/8/8/K7 w - - 0 1')
    expect(legalMoves(s).map(moveText).filter((m) => m.startsWith('a7a8')).sort()).toEqual(['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r'])
    expect(toFen(play(s, parseMove(s, 'a7a8')!)!).split(' ')[0]).toBe('Q7/7k/8/8/8/8/8/K7')
    expect(toFen(play(s, parseMove(s, 'a7a8n')!)!).split(' ')[0]).toBe('N7/7k/8/8/8/8/8/K7')
    expect(parseMove(s, 'a7a8k')).toBeNull()
  })
  it('a pinned piece stays; in check only the moves that end it', () => {
    expect(legalMoves(at('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1')).map(moveText).filter((m) => m.startsWith('e2'))).toEqual([])
    const check = at('4k3/8/8/8/8/8/3P4/r3K3 w - - 0 1')
    expect(legalMoves(check).map(moveText).sort()).toEqual(['e1e2', 'e1f2'])
  })
  it('illegal moves are refused', () => {
    const s = startPosition()
    expect(parseMove(s, 'e2e5')).toBeNull()
    expect(parseMove(s, 'e7e5')).toBeNull() // not white's
    expect(parseMove(s, 'zz')).toBeNull()
    expect(play(s, 12345)).toBeNull()
  })
})

describe('the end of a game', () => {
  it('checkmate: the side that mated wins', () => {
    expect(outcome(after(['f2f3', 'e7e5', 'g2g4', 'd8h4']))).toEqual({ kind: 'win', side: 1, reason: 'checkmate' })
    expect(outcome(after(['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']))).toEqual({ kind: 'win', side: 0, reason: 'checkmate' })
  })
  it('stalemate', () => {
    expect(outcome(at('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toEqual({ kind: 'draw', reason: 'stalemate' })
  })
  it('fifty moves: 100 half-moves without a pawn move or a capture; a mate on the hundredth still wins', () => {
    const s = at('k7/8/8/8/8/8/8/K6R w - - 99 80')
    expect(outcome(s).kind).toBe('playing')
    expect(outcome(play(s, parseMove(s, 'h1h2')!)!)).toEqual({ kind: 'draw', reason: 'fifty' })
    const m = at('k7/8/1K6/8/8/8/8/7R w - - 99 80')
    expect(outcome(play(m, parseMove(m, 'h1h8')!)!)).toEqual({ kind: 'win', side: 0, reason: 'checkmate' })
  })
  it('the same position a third time (same side, rights, en passant chance)', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
    expect(outcome(after(shuffle)).kind).toBe('playing')
    expect(outcome(after([...shuffle, ...shuffle]))).toEqual({ kind: 'draw', reason: 'repetition' })
    // a pawn move starts the count again
    expect(after([...shuffle, 'e2e4']).keys).toHaveLength(1)
    // an en passant nobody can take is not part of the position
    expect(positionKey(after(['e2e4'])).endsWith(' -')).toBe(true)
    expect(positionKey(after(['e2e4', 'a7a6', 'e4e5', 'd7d5'])).endsWith(' d6')).toBe(true)
  })
  it('material that cannot mate', () => {
    const ins = (fen: string) => insufficient(at(fen).board)
    expect(ins('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).toBe(true)
    expect(ins('4k3/8/8/8/8/8/8/2N1K3 w - - 0 1')).toBe(true)
    expect(ins('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1')).toBe(true)
    expect(ins('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1')).toBe(false) // c8 and c1: opposite colours
    expect(ins('3bk3/8/8/8/8/8/8/2B1K3 w - - 0 1')).toBe(true) // d8 and c1: both dark
    expect(ins('4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1')).toBe(false)
    expect(ins('4k3/8/8/8/8/8/P7/4K3 w - - 0 1')).toBe(false)
    expect(outcome(at('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'))).toEqual({ kind: 'draw', reason: 'material' })
  })
})

describe('the AI', () => {
  const POSITIONS = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
  ]
  it('the same position, level and seed give the same move; the seed sways the easy level', () => {
    for (const f of POSITIONS)
      for (const lv of ['easy', 'normal', 'strong'] as const) expect(aiMove(at(f), lv, 7), `${lv} ${f}`).toBe(aiMove(at(f), lv, 7))
    const firsts = new Set(Array.from({ length: 12 }, (_, k) => moveText(aiMove(startPosition(), 'easy', k))))
    expect(firsts.size).toBeGreaterThan(1)
  })
  // a node budget, not a clock: a clock fails on a busy machine (#604: 461 ms in a full run). The budget is what keeps a move short (strong: 48 ms measured)
  it('one move never searches more than the node budget of its level', () => {
    for (const lv of ['easy', 'normal', 'strong'] as const)
      for (const f of POSITIONS) {
        const stats = { nodes: 0 }
        aiMove(at(f), lv, 3, stats)
        expect(stats.nodes, `${lv} ${f}`).toBeGreaterThan(0)
        expect(stats.nodes, `${lv} ${f}`).toBeLessThanOrEqual(CHESS_AI[lv].nodes + 1)
      }
    expect(CHESS_AI.easy.nodes).toBeLessThan(CHESS_AI.normal.nodes)
    expect(CHESS_AI.normal.nodes).toBeLessThan(CHESS_AI.strong.nodes)
  })
  it('mates in one, and takes a hanging queen', () => {
    for (const lv of ['easy', 'normal', 'strong'] as const) expect(moveText(aiMove(at('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), lv, 1))).toBe('a1a8')
    for (const lv of ['normal', 'strong'] as const) expect(moveText(aiMove(at('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1'), lv, 1))).toBe('c3d5')
  })
  it('the stronger level beats the easy one more often than not, and every game ends', () => {
    let strong = 0
    let easy = 0
    for (let g = 0; g < 4; g++) {
      let s: ChessState = startPosition()
      const strongSide = g % 2
      for (let ply = 0; ply < 400 && outcome(s).kind === 'playing'; ply++) s = play(s, aiMove(s, s.side === strongSide ? 'normal' : 'easy', 100 + g))!
      const o = outcome(s)
      if (o.kind === 'win') o.side === strongSide ? strong++ : easy++
    }
    expect(strong).toBeGreaterThan(easy)
  }, 60_000)
})

describe('the game frame', () => {
  it('save and load play on as the same game (the repetition record too)', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8']
    const s = after([...shuffle, 'g1f3', 'g8f6', 'f3g1'])
    const back = chess.load(chess.save(s))!
    expect(toFen(back)).toBe(toFen(s))
    expect(chess.outcome(chess.play(back, chess.parseMove(back, 'f6g8')!)!)).toEqual({ kind: 'draw', reason: 'repetition' })
    expect(chess.load('not json')).toBeNull()
    expect(chess.load(JSON.stringify({ fen: 'bad' }))).toBeNull()
  })
  it('over: no moves, no play', () => {
    const mate = after(['f2f3', 'e7e5', 'g2g4', 'd8h4'])
    expect(chess.moves(mate)).toEqual([])
    expect(chess.parseMove(mate, 'a2a3')).toBeNull()
    expect(chess.toMove(startPosition())).toBe(0)
    expect(chess.sides).toEqual(['백', '흑'])
  })
})
