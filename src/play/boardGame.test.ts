// #538 (stage 2) the game frame's contract, the same for every game behind it (omok, chess, alkkagi): a game by the AI
// alone ends, the same seed plays the same game, a move reads back from its own words, and a saved game loads and plays on the same.
import { describe, expect, it } from 'vitest'
import { replayMoves, type BoardGame, type Level } from './boardGame'
import { alkkagi } from './alkkagi'
import { chess } from './chess'
import { omokGame } from './omokGame'

/** a game by the AI alone, as move words (levels alternate by side), and its end */
function selfPlay<S, M>(g: BoardGame<S, M>, seed: number, levels: [Level, Level], cap: number) {
  let s = g.start()
  const words: string[] = []
  const saves: string[] = []
  for (let ply = 0; ply < cap && g.outcome(s).kind === 'playing'; ply++) {
    const m = g.ai(s, levels[g.toMove(s)], seed * 1000 + ply)
    words.push(g.moveText(m))
    // the move reads back from its own words, and the rules agree it is one of theirs
    expect(g.parseMove(s, g.moveText(m))).toEqual(m)
    // a continuous game (alkkagi) offers a sample: its AI may play off it
    if (ply % 7 === 0 && !g.continuous) expect(g.moves(s)).toContainEqual(m)
    s = g.play(s, m)!
    expect(s).not.toBeNull()
    if (ply % 10 === 0) saves.push(g.save(s))
  }
  return { s, words, saves }
}

const GAMES: [string, BoardGame<unknown, unknown>, number][] = [
  ['chess', chess as BoardGame<unknown, unknown>, 300],
  ['omok (renju)', omokGame('renju', 'agent_1') as BoardGame<unknown, unknown>, 225],
  ['omok (free)', omokGame('free', 'agent_3') as BoardGame<unknown, unknown>, 225],
  ['alkkagi', alkkagi as BoardGame<unknown, unknown>, 100],
]

describe.each(GAMES)('%s behind the frame', (_name, g, cap) => {
  it('the AI alone finishes a game; the same seed plays the same one, move by move', () => {
    const a = selfPlay(g, 11, ['normal', 'easy'], cap)
    const b = selfPlay(g, 11, ['normal', 'easy'], cap)
    expect(b.words).toEqual(a.words)
    expect(g.outcome(a.s).kind).not.toBe('playing')
    // and its words replay to the same end
    expect(g.save(replayMoves(g, a.words)!)).toBe(g.save(a.s))
  }, 60_000)
  it('save → load is the same game: the same save, the same moves, the same AI move', () => {
    const { saves } = selfPlay(g, 4, ['strong', 'normal'], 40)
    for (const text of saves) {
      const s = g.load(text)!
      expect(s).not.toBeNull()
      expect(g.save(s)).toBe(text)
      if (g.outcome(s).kind === 'playing') expect(g.moveText(g.ai(s, 'normal', 9))).toBe(g.moveText(g.ai(g.load(text)!, 'normal', 9)))
    }
    expect(g.load('{')).toBeNull()
    expect(g.load('{}')).toBeNull()
  }, 60_000)
  it('the start: the opening side moves, two side names, moves to choose from', () => {
    expect(g.toMove(g.start())).toBe(0)
    expect(g.sides).toHaveLength(2)
    expect(g.moves(g.start()).length).toBeGreaterThan(0)
    expect(g.parseMove(g.start(), 'nonsense')).toBeNull()
  })
})
