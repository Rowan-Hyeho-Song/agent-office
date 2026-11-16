// #538 (stage 2) the game frame: what every table game gives the hologram table, apart from any drawing. Rules, a deterministic AI,
// its state and how it is saved. Omok (omok.ts), chess (#604, chess.ts) and alkkagi (#605) each give one; the table (who plays,
// the hands, the hologram, the HUD) reads only this.
//
//  - pure: a state is never changed in place; `play` gives a new one (or null for a move the rules do not allow)
//  - deterministic: the same state, level and seed give the same move in every browser (no clock, no Math.random)
//  - a game's own move type stays its own; `moveText` / `parseMove` are its words (chess: UCI e2e4, e7e8q; omok: H8)

/** who moves: 0 the side that opens (white in chess, black in omok), 1 the other */
export type Side = 0 | 1

/** the AI's three levels (the HUD's 쉬움 · 보통 · 강함, the same words as the visitor's omok) */
export type Level = 'easy' | 'normal' | 'strong'
export const LEVELS: readonly Level[] = ['easy', 'normal', 'strong']

export type Outcome =
  | { kind: 'playing' }
  /** `reason`: the game's own word for how (chess: 'checkmate'; omok: 'five') */
  | { kind: 'win'; side: Side; reason: string }
  /** chess: 'stalemate' · 'fifty' · 'repetition' · 'material'; omok: 'full' */
  | { kind: 'draw'; reason: string }

export interface BoardGame<S, M> {
  readonly id: string
  /** the HUD's name */
  readonly name: string
  /** the sides' names, the opening side first */
  readonly sides: readonly [string, string]
  start(): S
  toMove(s: S): Side
  /** the moves are continuous (alkkagi's flick: aim and power), so `moves` is a sample to choose from; any valid move plays */
  readonly continuous?: boolean
  /** every move the rules allow now (none once the game is over); a sample for a continuous game */
  moves(s: S): M[]
  /** the state after the move, or null when the rules do not allow it */
  play(s: S, m: M): S | null
  outcome(s: S): Outcome
  /** the AI's move for the side to move (the game is not over) */
  ai(s: S, level: Level, seed: number): M
  moveText(m: M): string
  /** a move in the game's words, if it is legal now */
  parseMove(s: S, text: string): M | null
  /** the whole state as text (a saved game, the timelapse); `load(save(s))` plays on as `s` */
  save(s: S): string
  load(text: string): S | null
}

/** the state after these moves from the start (or from `from`), or null at the first illegal one */
export function replayMoves<S, M>(g: BoardGame<S, M>, moves: readonly string[], from: S = g.start()): S | null {
  let s: S | null = from
  for (const t of moves) {
    const m: M | null = s && g.parseMove(s, t)
    s = s && m !== null ? g.play(s, m) : null
    if (!s) return null
  }
  return s
}
