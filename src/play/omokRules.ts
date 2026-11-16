// #603 (play.md 11) the rules of omok, apart from any drawing (the wooden board, #538's hologram): five rules to choose from, what wins under
// each, and black's forbidden points (renju: 3-3, 4-4, overline; the domestic rule: 3-3 only). Pure, on a bare board (y * 15 + x; 0 empty,
// 1 black, 2 white).
//
// Renju as the RIF plays it:
//  - a five wins first: a move that makes black's five is never forbidden, whatever else it makes (5 우선)
//  - a four is a line one stone short of a five: the points that would complete it, grouped by the stones of the five they make, so a
//    straight four (two points, the same four stones) counts once and ●_●●●_● (two fives of different stones) counts twice (4-4 in one line)
//  - a three is a line one stone short of a straight four, where that stone could really be played: a point that is itself forbidden does not
//    make the three (거짓 3, checked again on the board with it; the recursion stops at FALSE_DEPTH)

import type { Color } from './omok'

export const N = 15
const EMPTY = 0

export type RuleId = 'renju' | 'domestic' | 'free' | 'exact' | 'swap'

/** the HUD names and the chooser's one-line hints (play.md 11.1), in the chooser's order */
export const RULES: readonly { id: RuleId; name: string; hint: string }[] = [
  { id: 'renju', name: '렌주', hint: '흑은 3-3 · 4-4 · 장목 금지' },
  { id: 'domestic', name: '국내', hint: '흑만 3-3 금지' },
  { id: 'free', name: '자유', hint: '금수 없음 · 흑이 유리' },
  { id: 'exact', name: '정확히 5', hint: '여섯 이상은 이김이 아님' },
  { id: 'swap', name: '스왑', hint: '렌주 + 처음 세 수 뒤 색 고르기' },
]
export const RULE_BY_ID = Object.fromEntries(RULES.map((r) => [r.id, r])) as Record<RuleId, (typeof RULES)[number]>

export type Forbid = '33' | '44' | 'overline'
/** the guidance's words for each (play.md 11.4: 금수예요 · 3-3) */
export const FORBID_NAME: Record<Forbid, string> = { '33': '3-3', '44': '4-4', overline: '장목' }

const DIRS: readonly [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]]
/** how deep a three's own point is checked for being forbidden (renju's false threes) */
const FALSE_DEPTH = 3

const at = (board: Uint8Array, x: number, y: number) => (x >= 0 && x < N && y >= 0 && y < N ? board[y * N + x] : -1)

/** the run of `color` through `cell` along one direction (cell included as if it were `color`): its cells, from one end to the other */
function runAlong(board: Uint8Array, cell: number, color: Color, d: number): number[] {
  const [dx, dy] = DIRS[d]
  const cx = cell % N
  const cy = (cell / N) | 0
  const out = [cell]
  for (const sg of [1, -1]) {
    let x = cx + dx * sg
    let y = cy + dy * sg
    while (at(board, x, y) === color) {
      out.push(y * N + x)
      x += dx * sg
      y += dy * sg
    }
  }
  return out
}

/** does a run of this length win for this colour under the rule */
export function winningLength(rule: RuleId, color: Color, len: number): boolean {
  if (rule === 'exact') return len === 5
  if ((rule === 'renju' || rule === 'swap') && color === 1) return len === 5
  return len >= 5
}

/** the winning line `color` makes by standing at `cell` (the stone may or may not be on the board yet), or null */
export function winLineAt(board: Uint8Array, cell: number, color: Color, rule: RuleId): number[] | null {
  for (let d = 0; d < 4; d++) {
    const run = runAlong(board, cell, color, d)
    if (winningLength(rule, color, run.length)) return run
  }
  return null
}

/** the rule bans some of black's points */
export const hasForbids = (rule: RuleId) => rule === 'renju' || rule === 'swap' || rule === 'domestic'

/** the empty cells along direction d through `cell` that would make black's exact five there (with `cell` black) */
function fivePoints(board: Uint8Array, cell: number, d: number): { point: number; stones: string }[] {
  const [dx, dy] = DIRS[d]
  const cx = cell % N
  const cy = (cell / N) | 0
  const out: { point: number; stones: string }[] = []
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue
    const x = cx + dx * k
    const y = cy + dy * k
    if (at(board, x, y) !== EMPTY) continue
    const p = y * N + x
    board[p] = 1
    const run = runAlong(board, p, 1, d)
    board[p] = EMPTY
    if (run.length === 5 && run.includes(cell)) out.push({ point: p, stones: run.filter((c) => c !== p).sort((a, b) => a - b).join(',') })
  }
  return out
}

/** the fours along direction d through `cell` (black at `cell`): distinct by the stones of the five they would make */
function foursAlong(board: Uint8Array, cell: number, d: number): number {
  return new Set(fivePoints(board, cell, d).map((f) => f.stones)).size
}

/** a straight (open) four along d through `cell`: one four with two points to complete it */
function straightFour(board: Uint8Array, cell: number, d: number): boolean {
  const pts = fivePoints(board, cell, d)
  return pts.length >= 2 && new Set(pts.map((f) => f.stones)).size === 1
}

/** a three along d through `cell` (black at `cell`): a point on the line that makes a straight four there and could really be played */
function threeAlong(board: Uint8Array, cell: number, d: number, rule: RuleId, depth: number): boolean {
  const [dx, dy] = DIRS[d]
  const cx = cell % N
  const cy = (cell / N) | 0
  for (let k = -4; k <= 4; k++) {
    if (k === 0) continue
    const x = cx + dx * k
    const y = cy + dy * k
    if (at(board, x, y) !== EMPTY) continue
    const q = y * N + x
    board[q] = 1
    const four = straightFour(board, cell, d) && runAlong(board, q, 1, d).includes(cell)
    board[q] = EMPTY
    if (!four) continue
    // the point must be playable: not itself forbidden (a false three otherwise); deep enough, take it as playable
    if (depth >= FALSE_DEPTH || !forbiddenWith(board, q, rule, depth + 1)) return true
  }
  return false
}

/** black at `cell` on a board that already has it there */
function forbiddenWith(board: Uint8Array, cell: number, rule: RuleId, depth: number): Forbid | null {
  const had = board[cell]
  board[cell] = 1
  try {
    // a five first (the domestic rule wins with five or more)
    for (let d = 0; d < 4; d++) if (winningLength(rule, 1, runAlong(board, cell, 1, d).length)) return null
    if (rule !== 'domestic') {
      for (let d = 0; d < 4; d++) if (runAlong(board, cell, 1, d).length >= 6) return 'overline'
      let fours = 0
      for (let d = 0; d < 4; d++) fours += foursAlong(board, cell, d)
      if (fours >= 2) return '44'
    }
    let threes = 0
    for (let d = 0; d < 4; d++) if (threeAlong(board, cell, d, rule, depth)) threes++
    return threes >= 2 ? '33' : null
  } finally {
    board[cell] = had
  }
}

/** why black may not stand at `cell` under the rule (an empty point), or null; white is never forbidden */
export function forbiddenAt(board: Uint8Array, cell: number, rule: RuleId, color: Color = 1): Forbid | null {
  if (color !== 1 || !hasForbids(rule) || board[cell] !== EMPTY) return null
  const b = board.slice()
  return forbiddenWith(b, cell, rule, 0)
}

/** the empty cells where `color` would win under the rule (two or more: the other side cannot stop both) */
export function winPoints(board: Uint8Array, color: Color, rule: RuleId): number[] {
  const out: number[] = []
  for (let c = 0; c < N * N; c++) if (board[c] === EMPTY && winLineAt(board, c, color, rule)) out.push(c)
  return out
}
