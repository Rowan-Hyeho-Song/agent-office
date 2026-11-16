// #538 (stage 2) omok behind the game frame (boardGame.ts): the same rules and AI as omok.ts, so the hologram table can hold omok,
// chess (#604) and alkkagi (#605) alike. Cells are named as the visitor's HUD names them (A..O across, 15..1 down: H8 the centre).

import { hash, rng } from '../office/play'
import type { BoardGame, Level } from './boardGame'
import { aiMove, legalMoves, N, newGame, personalityOf, play, type OmokState } from './omok'
import { RULE_BY_ID, type RuleId } from './omokRules'

const name = (cell: number) => `${String.fromCharCode(65 + (cell % N))}${N - ((cell / N) | 0)}`
function cellAt(text: string): number {
  const m = /^([A-Oa-o])(\d{1,2})$/.exec(text.trim())
  if (!m) return -1
  const x = m[1].toUpperCase().charCodeAt(0) - 65
  const y = N - Number(m[2])
  return y >= 0 && y < N ? y * N + x : -1
}

/** the visitor omok's levels (visitorOmok.ts agentPick): strong defends harder and never slips, easy misses a block 40% of the time */
const EASY_MISS = 0.4

/** omok under one rule, the AI with one agent's personality */
export function omokGame(rule: RuleId = 'renju', agent = 'agent_0'): BoardGame<OmokState, number> {
  return {
    id: 'omok',
    name: `오목 · ${RULE_BY_ID[rule].name}`,
    sides: ['흑', '백'],
    start: () => newGame(rule),
    toMove: (s) => (s.toMove === 1 ? 0 : 1),
    moves: (s) => legalMoves(s).filter((c) => play(s, c) !== null),
    play,
    outcome: (s) =>
      s.result === 'playing'
        ? { kind: 'playing' }
        : s.result === 'draw'
          ? { kind: 'draw', reason: 'full' }
          : { kind: 'win', side: s.result === 'black' ? 0 : 1, reason: 'five' },
    ai: (s, level: Level, seed) => {
      const p = personalityOf(agent)
      if (level === 'strong') return aiMove(s, { ...p, defn: Math.max(p.defn, 1.15), noise: 0.02, slip: 0 }, seed)
      if (level === 'easy' && rng(hash(`${seed}|easy`))() < EASY_MISS) return aiMove(s, { ...p, defn: 0 }, seed)
      return aiMove(s, p, seed)
    },
    moveText: name,
    parseMove: (s, t) => {
      const c = cellAt(t)
      return c >= 0 && play(s, c) ? c : null
    },
    // the board as it stands (omok's state keeps no move order): 225 digits, then who moves, the last stone, the result's line
    save: (s) => JSON.stringify({ rule: s.rule, board: Array.from(s.board).join(''), toMove: s.toMove, lastMove: s.lastMove, result: s.result, line: s.line }),
    load: (text) => {
      try {
        const o = JSON.parse(text) as Partial<Record<keyof OmokState, unknown>>
        if (typeof o.rule !== 'string' || !(o.rule in RULE_BY_ID) || typeof o.board !== 'string' || !/^[012]{225}$/.test(o.board)) return null
        if ((o.toMove !== 1 && o.toMove !== 2) || typeof o.lastMove !== 'number' || !['playing', 'black', 'white', 'draw'].includes(o.result as string)) return null
        const board = Uint8Array.from(o.board, (d) => Number(d))
        const line = Array.isArray(o.line) && o.line.every((c) => typeof c === 'number') ? (o.line as number[]) : null
        return { board, toMove: o.toMove, moveIndex: board.filter((v) => v).length, lastMove: o.lastMove, result: o.result as OmokState['result'], line, rule: o.rule as RuleId }
      } catch {
        return null
      }
    },
  }
}
