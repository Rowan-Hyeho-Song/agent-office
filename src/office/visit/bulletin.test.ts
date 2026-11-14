import { describe, expect, it } from 'vitest'
import { PAPERS, paperOf, wrap } from './bulletinLayout'

// a fake measure: every character 10 px
const g = { measureText: (t: string) => ({ width: [...t].length * 10 }) as TextMetrics }

describe('the sticky notes (#460, the designer)', () => {
  it('the words in at most three lines, … only when cut and still inside the width', () => {
    expect(wrap(g, '가'.repeat(20), 100, 3)).toEqual(['가'.repeat(10), '가'.repeat(10)])
    expect(wrap(g, '가'.repeat(30), 100, 3)).toEqual(['가'.repeat(10), '가'.repeat(10), '가'.repeat(10)])
    const long = wrap(g, '가'.repeat(80), 100, 3)
    expect(long).toHaveLength(3)
    expect(long[2].endsWith('…')).toBe(true)
    expect([...long[2]].length * 10).toBeLessThanOrEqual(100)
  })
  it('a 20-character name is cut at the paper with …', () => {
    const name = wrap(g, '— ' + '이'.repeat(20), 100, 1)
    expect(name).toHaveLength(1)
    expect(name[0].endsWith('…')).toBe(true)
    expect([...name[0]].length * 10).toBeLessThanOrEqual(100)
    expect(wrap(g, '— 팬', 100, 1)).toEqual(['— 팬'])
  })
  it('the paper is fixed per note: canary about 60 %, apricot 25 %, light green 15 %', () => {
    expect(paperOf(7)).toBe(paperOf(7))
    const n: Record<string, number> = {}
    for (let id = 1; id <= 10_000; id++) n[paperOf(id)] = (n[paperOf(id)] ?? 0) + 1
    for (const p of PAPERS) expect(Math.abs(n[p.color] / 100 - p.share)).toBeLessThan(2)
  })
})
