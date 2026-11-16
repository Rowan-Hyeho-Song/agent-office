// #603 (play.md 11.5): renju's standard cases (3-3, 4-4 in two lines and in one, the overline, a five first, a false three) and what wins
// under each of the five rules.
import { describe, expect, it } from 'vitest'
import { forbiddenAt, RULES, winLineAt, winPoints, type RuleId } from './omokRules'

const N = 15
/** a board from rows of text ('X' black, 'O' white, '.' empty, '*' the point asked about), its top-left at (x0, y0) */
function board(rows: string[], x0 = 3, y0 = 3): { b: Uint8Array; at: number } {
  const b = new Uint8Array(N * N)
  let at = -1
  rows.forEach((r, y) =>
    [...r.replace(/ /g, '')].forEach((c, x) => {
      const i = (y0 + y) * N + x0 + x
      if (c === 'X') b[i] = 1
      else if (c === 'O') b[i] = 2
      else if (c === '*') at = i
    }),
  )
  return { b, at }
}

describe('renju: black forbidden points', () => {
  it('3-3: two open threes at once', () => {
    const { b, at } = board([
      '. . . . . . .',
      '. . . X . . .',
      '. . . X . . .',
      '. X X * . . .',
      '. . . . . . .',
      '. . . . . . .',
    ])
    expect(forbiddenAt(b, at, 'renju')).toBe('33')
    expect(forbiddenAt(b, at, 'swap')).toBe('33')
    expect(forbiddenAt(b, at, 'domestic')).toBe('33')
    expect(forbiddenAt(b, at, 'free')).toBeNull()
    expect(forbiddenAt(b, at, 'renju', 2)).toBeNull() // white is never forbidden
  })
  it('a three closed at one end does not count (one open three is fine)', () => {
    const { b, at } = board([
      '. . . . . . .',
      '. . . X . . .',
      '. . . X . . .',
      'O X X * . . .',
      '. . . . . . .',
    ])
    // the horizontal three O X X * . . can still become  O X X * X .  (a four, not a straight four): not a three
    expect(forbiddenAt(b, at, 'renju')).toBeNull()
  })
  it('4-4 in two lines', () => {
    const { b, at } = board([
      '. . . . X . .',
      '. . . . X . .',
      '. . . . X . .',
      '. X X X * . .',
      '. . . . . . .',
    ])
    expect(forbiddenAt(b, at, 'renju')).toBe('44')
    expect(forbiddenAt(b, at, 'domestic')).toBeNull() // the domestic rule bans only 3-3
  })
  it('4-4 in one line: X . X X * . X', () => {
    const { b, at } = board(['X . X X * . X'])
    expect(forbiddenAt(b, at, 'renju')).toBe('44')
  })
  it('a straight four is one four (allowed)', () => {
    const { b, at } = board(['. X X X * . .'])
    expect(forbiddenAt(b, at, 'renju')).toBeNull()
  })
  it('the overline: six or more', () => {
    const { b, at } = board(['X X X * X X'])
    expect(forbiddenAt(b, at, 'renju')).toBe('overline')
    expect(forbiddenAt(b, at, 'domestic')).toBeNull() // five or more wins there: a five first
    expect(forbiddenAt(b, at, 'exact')).toBeNull() // no bans; not a win either
  })
  it('a five first: the point that makes five is never forbidden, whatever else it makes', () => {
    const { b, at } = board([
      '. . . . X . .',
      '. . . . X . .',
      '. . . . X . .',
      'X X X X * . .',
      '. . . . . . .',
    ])
    // a five across and a four down (4-4 would be forbidden): the five wins
    expect(forbiddenAt(b, at, 'renju')).toBeNull()
    expect(winLineAt(b, at, 1, 'renju')).toHaveLength(5)
  })
  it('a false three: its straight-four points are both forbidden (4-4), so 3-3 is only one three and allowed', () => {
    const rows = [
      '. X . . . X .',
      '. X . . X X .',
      '. X . . X X .',
      '. . X X * . .',
      '. . . . . . .',
      '. . . . . . .',
    ]
    // across:  . . X X * . .  becomes a straight four only beside it, at x 1 or x 5, and each of those makes 4-4 with its column: a false three.
    // down: the two stones over the point make a real three. One real three: allowed
    const { b, at } = board(rows)
    expect(forbiddenAt(b, at, 'renju')).toBeNull()
    // without the columns the same shape is a real 3-3
    const plain = board(['. . . . . . .', '. . . . X . .', '. . . . X . .', '. . X X * . .', '. . . . . . .', '. . . . . . .'])
    expect(forbiddenAt(plain.b, plain.at, 'renju')).toBe('33')
  })
})

describe('what wins under each rule', () => {
  const six = board(['X X X * X X'])
  const sixW = board(['O O O * O O'])
  const five = board(['. X X * X X .'])
  const fiveW = board(['. O O * O O .'])
  const wins = (rule: RuleId) => ({
    black5: !!winLineAt(five.b, five.at, 1, rule),
    black6: !!winLineAt(six.b, six.at, 1, rule),
    white5: !!winLineAt(fiveW.b, fiveW.at, 2, rule),
    white6: !!winLineAt(sixW.b, sixW.at, 2, rule),
  })
  it('renju and swap: black exactly five, white five or more', () => {
    for (const r of ['renju', 'swap'] as const) expect(wins(r)).toEqual({ black5: true, black6: false, white5: true, white6: true })
  })
  it('domestic and free: five or more for both', () => {
    for (const r of ['domestic', 'free'] as const) expect(wins(r)).toEqual({ black5: true, black6: true, white5: true, white6: true })
  })
  it('exactly five: both exactly five', () => {
    expect(wins('exact')).toEqual({ black5: true, black6: false, white5: true, white6: false })
  })
  it('five rules in the chooser order; the win points', () => {
    expect(RULES.map((r) => r.id)).toEqual(['renju', 'domestic', 'free', 'exact', 'swap'])
    expect(winPoints(five.b, 1, 'renju')).toContain(five.at)
  })
})
