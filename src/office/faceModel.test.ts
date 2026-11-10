// The LED pixel face (#193 2/2, robots.md 3-5): every agent x expression stays in the 24 x 14 grid, the pictures differ, the eyes are the agent's own.
import { describe, expect, it } from 'vitest'
import { dimOf, EVENT_EXPRESSIONS, EVENT_SECONDS, EXPRESSIONS, FACE_H, FACE_W, litCount, newGrid, newParams, P, renderFace } from './faceModel'

const draw = (agent: number, expr: (typeof EXPRESSIONS)[number], extra: Partial<ReturnType<typeof newParams>> = {}) => {
  const g = newGrid()
  Object.assign(newParams(), {})
  renderFace(g, { ...newParams(), agent, expr, ...extra })
  return g
}
const rows = (g: ReturnType<typeof newGrid>) => Array.from({ length: FACE_H }, (_, y) => Array.from(g.cells.slice(y * FACE_W, (y + 1) * FACE_W)).map((c) => (c ? '#' : '.')).join(''))

describe('every agent shows every expression', () => {
  for (let agent = 0; agent < 5; agent++)
    for (const expr of EXPRESSIONS)
      it(`agent ${agent} / ${expr}: lit, inside the grid, only known colours`, () => {
        const g = draw(agent, expr)
        expect(g.cells.length).toBe(FACE_W * FACE_H)
        expect(litCount(g)).toBeGreaterThan(5)
        expect(Math.max(...g.cells)).toBeLessThanOrEqual(P.RED)
        // nothing was dropped at an edge by a shifted eye: the same with the gaze at every corner
        for (const [gx, gy] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) expect(litCount(draw(agent, expr, { gx, gy }))).toBeGreaterThan(5)
      })

  it('the 15 expressions are 15 different pictures for each agent', () => {
    for (let agent = 0; agent < 5; agent++) expect(new Set(EXPRESSIONS.map((e) => rows(draw(agent, e)).join('/'))).size).toBe(15)
  })
  it('the five agents differ in the same expression (the arches and crosses are shared by the four with eyes; Echo is a line)', () => {
    for (const e of EXPRESSIONS) expect(new Set([0, 1, 2, 3, 4].map((a) => rows(draw(a, e)).join('/'))).size).toBeGreaterThanOrEqual(2)
    for (const e of ['neutral', 'surprised', 'focused'] as const) expect(new Set([0, 1, 2, 3, 4].map((a) => rows(draw(a, e)).join('/'))).size).toBe(5)
  })
})

describe('the eyes of each agent (robots.md 3)', () => {
  const eyes = (agent: number) => rows(draw(agent, 'neutral')).slice(2, 7).map((r) => r.slice(0, 12))
  it('메모: bars 2 x 4', () => expect(eyes(0).filter((r) => r.includes('##'))).toHaveLength(4))
  it('메시: hollow 4 x 4', () => {
    const g = draw(1, 'neutral')
    expect(g.cells[4 * FACE_W + 7]).toBe(P.OFF) // the inside of the left eye
    expect(g.cells[3 * FACE_W + 7]).toBe(P.MAIN)
    expect(g.cells[4 * FACE_W + 6]).toBe(P.MAIN)
  })
  it('휴: round eyes and pink cheeks', () => {
    const g = draw(2, 'neutral')
    expect(g.cells[3 * FACE_W + 6]).toBe(P.OFF) // a cut corner
    expect(g.cells[3 * FACE_W + 7]).toBe(P.MAIN)
    expect(g.cells[8 * FACE_W + 4]).toBe(P.PINK)
    expect(g.cells[8 * FACE_W + 19]).toBe(P.PINK)
  })
  it('루프: blocks 3 x 4 and a blinking _ cursor', () => {
    expect(eyes(3).filter((r) => r.includes('###'))).toHaveLength(4)
    expect(rows(draw(3, 'neutral', { cursor: true }))[11]).toContain('###')
    expect(rows(draw(3, 'neutral', { cursor: false }))[11]).not.toContain('#')
  })
  it('에코: no eyes, a waveform line across the whole width', () => {
    const g = draw(4, 'neutral')
    for (let x = 0; x < FACE_W; x++) expect(Array.from({ length: FACE_H }, (_, y) => g.cells[y * FACE_W + x]).some((c) => c !== P.OFF)).toBe(true)
  })
  it('the eyes are mirrored around the middle of the 24 columns', () => {
    for (const a of [0, 1, 2, 3]) {
      const g = draw(a, 'neutral')
      for (let y = 2; y < 8; y++) for (let x = 0; x < 12; x++) expect(g.cells[y * FACE_W + x]).toBe(g.cells[y * FACE_W + (FACE_W - 1 - x)])
    }
  })
})

describe('colours and dimming', () => {
  it('symbols are ivory, the sweat is #8fd3ff blue, the rest is the agent colour', () => {
    expect(draw(0, 'surprised').cells).toContain(P.IVORY)
    expect(draw(0, 'embarrassed').cells).toContain(P.SWEAT)
    expect(draw(0, 'embarrassed').cells).not.toContain(P.IVORY)
    expect(draw(1, 'neutral').cells).not.toContain(P.IVORY)
  })
  it('the failure paints the main colour red, the sweat stays blue', () => {
    const g = draw(1, 'embarrassed', { red: true })
    expect(g.cells).toContain(P.RED)
    expect(g.cells).not.toContain(P.MAIN)
    expect(g.cells).toContain(P.SWEAT)
  })
  it('sleepy 60 %, asleep 45 %, the rest full', () => {
    expect(dimOf('sleepy')).toBe(0.6)
    expect(dimOf('asleep')).toBe(0.45)
    expect(EXPRESSIONS.filter((e) => dimOf(e) < 1)).toEqual(['sleepy', 'asleep'])
  })
  it('asleep has zzz (all three at rest), thinking has the dots, question a ?', () => {
    expect(litCount(draw(0, 'asleep'))).toBeGreaterThan(litCount(draw(0, 'asleep', { anim: 1 })))
    expect(rows(draw(0, 'thinking'))[6].slice(19)).toBe('#.#.#')
  })
})

describe('blinks, gaze, the mouth', () => {
  it('a blink shrinks the eyes to two rows, then one', () => {
    const open = litCount(draw(0, 'neutral'))
    const half = litCount(draw(0, 'neutral', { blink: 1 }))
    const shut = litCount(draw(0, 'neutral', { blink: 2 }))
    expect(open).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(shut)
  })
  it('a blink hides the expression: the eyes of any expression are the same shut line', () => {
    const eyesOf = (e: (typeof EXPRESSIONS)[number]) => rows(draw(0, e, { blink: 2 })).slice(0, 8).map((r) => r.slice(0, 18)).join('/')
    expect(eyesOf('proud')).toBe(eyesOf('neutral'))
    expect(eyesOf('embarrassed')).toBe(eyesOf('surprised'))
  })
  it('the gaze moves the eyes one pixel', () => {
    const a = rows(draw(1, 'neutral'))
    const b = rows(draw(1, 'neutral', { gx: 1 }))
    expect(b[3]).toBe('.' + a[3].slice(0, 23))
    expect(rows(draw(1, 'neutral', { gy: 1 }))[4]).toBe(a[3])
  })
  it('the talking mouth has three shapes', () => {
    expect(new Set([0, 1, 2].map((m) => rows(draw(0, 'neutral', { mouth: m })).slice(8).join('/'))).size).toBe(3)
  })
  it('Echo blends two waveforms by their brightness', () => {
    const g = draw(4, 'neutral', { from: 'asleep', blend: 0.5 })
    expect(new Set(g.lum)).toContain(128)
  })
})

describe('priority and durations (robots.md 4)', () => {
  it('seven events, each with its time', () => {
    expect([...EVENT_EXPRESSIONS].sort()).toEqual(['embarrassed', 'greeting', 'joy', 'proud', 'question', 'surprised', 'yielding'])
    expect(EVENT_SECONDS).toEqual({ proud: 3, embarrassed: 3, surprised: 1.2, greeting: 2, joy: 2.5, question: 2, yielding: 1.5 })
  })
})
