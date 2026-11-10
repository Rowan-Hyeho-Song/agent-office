// The expression state machine (#193 2/2, robots.md 4-5): priority, durations, the blink that hides a change, Echo's blend,
// the random blinks, the talking mouth, reduced motion, x16, and the redraw budget.
import { describe, expect, it } from 'vitest'
import { ANXIOUS_AFTER_MS, baseExpression, FaceMind, newInput, type FaceInput } from './faceMind'
import { newParams } from './faceModel'

/** runs the mind at 60 fps from t0 for `s` seconds, calling `f` every frame; returns the last time */
function run(m: FaceMind, i: FaceInput, t0: number, s: number, f?: (t: number) => void) {
  let t = t0
  for (; t < t0 + s; t += 1 / 60) {
    i.t = t
    m.update(i)
    f?.(t)
  }
  return t
}
const mk = (agent = 0) => ({ m: new FaceMind(agent), i: newInput() })

describe('the state tier (baseExpression)', () => {
  it('maps the statuses', () => {
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'edit' })).toBe('focused')
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'test' })).toBe('focused')
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'build' })).toBe('focused')
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'think' })).toBe('thinking')
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'read' })).toBe('neutral')
    expect(baseExpression({ pose: 'boardgame', state: 'idle', chin: true })).toBe('thinking')
    expect(baseExpression({ pose: 'doze', state: 'off' })).toBe('asleep')
    expect(baseExpression({ pose: 'sofa', state: 'idle' })).toBe('asleep')
    expect(baseExpression({ pose: 'idle', state: 'off', night: 'duty' })).toBe('sleepy')
    expect(baseExpression({ pose: 'idle', state: 'idle', idleMs: 11 * 60_000 })).toBe('bored')
    expect(baseExpression({ pose: 'idle', state: 'idle', idleMs: 9 * 60_000 })).toBe('neutral')
    expect(baseExpression({ pose: 'pingpong', state: 'idle', idleMs: 99 * 60_000 })).toBe('neutral')
  })
})

describe('priority: event > aim > talk > state', () => {
  it('an event wins over a nod and over the state; then the state comes back', () => {
    const { m, i } = mk(1)
    i.base = 'focused'
    i.talk = 'nodding'
    let t = run(m, i, 0, 1)
    expect(m.shown).toBe('nodding')
    m.fire('surprised', t)
    t = run(m, i, t, 0.5)
    expect(m.shown).toBe('surprised')
    t = run(m, i, t, 1)
    expect(m.shown).toBe('nodding')
    i.talk = null
    run(m, i, t, 1)
    expect(m.shown).toBe('focused')
  })
  it('aim sits under an event, over the talk tier', () => {
    const { m, i } = mk(2)
    i.talk = 'nodding'
    i.aim = 'focused'
    let t = run(m, i, 0, 0.5)
    expect(m.shown).toBe('focused')
    m.fire('proud', t)
    t = run(m, i, t, 0.5)
    expect(m.shown).toBe('proud')
  })
  it('a newer event replaces an older one', () => {
    const { m, i } = mk(0)
    m.fire('proud', 0)
    let t = run(m, i, 0, 0.5)
    m.fire('surprised', t)
    t = run(m, i, t, 0.5)
    expect(m.shown).toBe('surprised')
  })
  it('anxious: one second in four, only over the calm states, never over sleep', () => {
    const { m, i } = mk(0)
    i.anxious = true
    const seen: boolean[] = []
    run(m, i, 100, 8, () => seen.push(m.shown === 'anxious'))
    const on = seen.filter(Boolean).length / 60
    expect(on).toBeGreaterThan(1.8)
    expect(on).toBeLessThan(2.2)
    const z = mk(0)
    z.i.anxious = true
    z.i.base = 'asleep'
    run(z.m, z.i, 100, 5)
    expect(z.m.shown).toBe('asleep')
    expect(ANXIOUS_AFTER_MS).toBe(30 * 60_000)
  })
})

describe('durations (robots.md 4)', () => {
  const lasts = (expr: Parameters<FaceMind['fire']>[0], agent = 1) => {
    const { m, i } = mk(agent)
    run(m, i, 0, 1)
    m.fire(expr, 1)
    let last = -1
    run(m, i, 1, 6, (t) => {
      if (m.shown === expr) last = t
    })
    return last - 1
  }
  it('proud 3 s, embarrassed 3 s, surprised 1.2 s, greeting 2 s, joy 2.5 s, question 2 s, yielding 1.5 s', () => {
    const want = { proud: 3, embarrassed: 3, surprised: 1.2, greeting: 2, joy: 2.5, question: 2, yielding: 1.5 } as const
    for (const [e, s] of Object.entries(want)) {
      const d = lasts(e as keyof typeof want)
      expect(d).toBeGreaterThan(s - 0.2)
      expect(d).toBeLessThanOrEqual(s + 0.15) // the blink back to the state adds up to its own frames
    }
  })
  it('a failure is red for 1.5 s inside its 3 s', () => {
    const { m, i } = mk(1)
    run(m, i, 0, 1)
    m.fail(1)
    const p = newParams()
    let red = 0
    let emb = 0
    run(m, i, 1, 4, () => {
      m.fill(p)
      if (p.red) red += 1 / 60
      if (m.shown === 'embarrassed') emb += 1 / 60
    })
    expect(red).toBeCloseTo(1.5, 0)
    expect(emb).toBeGreaterThan(2.7)
    expect(emb).toBeLessThan(3.2)
  })
  it('a timed nod starts when asked', () => {
    const { m, i } = mk(0)
    m.nod(2, 1)
    run(m, i, 0, 1.9)
    expect(m.shown).toBe('neutral')
    run(m, i, 2, 0.5)
    expect(m.shown).toBe('nodding')
  })
})

describe('a change is hidden by a blink', () => {
  it('the eyes are shut (blink 2) at the moment the expression changes, for about 60 ms', () => {
    const { m, i } = mk(1)
    i.base = 'neutral'
    // start right after a random blink so none interferes
    const t = run(m, i, 0, 0.5)
    const p = newParams()
    i.base = 'focused'
    const log: { blink: number; expr: string }[] = []
    run(m, i, t, 0.3, () => {
      m.fill(p)
      log.push({ blink: p.blink, expr: p.expr })
    })
    const swap = log.find((l) => l.expr === 'focused')!
    expect(swap.blink).toBe(2)
    expect(log.filter((l) => l.blink === 2).length / 60).toBeCloseTo(0.06, 1)
    expect(log[0].expr).toBe('focused') // the swap happens at the first frame, behind the closed eyes
    expect(log[log.length - 1].blink).toBe(0)
  })
  it('during a blink that is already closed the change hides behind it', () => {
    const { m, i } = mk(0)
    let t = 0
    const p = newParams()
    for (; t < 10; t += 1 / 60) {
      i.t = t
      m.update(i)
      m.fill(p)
      if (p.blink === 2) break
    }
    expect(p.blink).toBe(2)
    i.base = 'focused'
    i.t = t + 1 / 60
    m.update(i)
    m.fill(p)
    expect(p.expr).toBe('focused')
    expect(p.blink).toBe(2)
  })
  it('Echo has no blink: it blends over 120 ms', () => {
    const { m, i } = mk(4)
    i.base = 'neutral'
    const t = run(m, i, 0, 0.5)
    i.base = 'focused'
    const p = newParams()
    const blends: number[] = []
    run(m, i, t, 0.3, () => {
      m.fill(p)
      expect(p.blink).toBe(0)
      if (p.from) blends.push(p.blend)
    })
    expect(blends.length / 60).toBeCloseTo(0.12, 1)
    expect(blends[0]).toBeLessThan(blends[blends.length - 1])
  })
})

describe('random blinks', () => {
  it('one every 3-6 s: 80 ms closed then 40 ms half', () => {
    const { m, i } = mk(2)
    const p = newParams()
    const starts: number[] = []
    let prev = 0
    let closed = 0
    let half = 0
    run(m, i, 0, 60, (t) => {
      m.fill(p)
      if (p.blink === 2 && prev === 0) starts.push(t)
      if (p.blink === 2) closed++
      if (p.blink === 1) half++
      prev = p.blink
    })
    expect(starts.length).toBeGreaterThanOrEqual(9)
    expect(starts.length).toBeLessThanOrEqual(20)
    for (let k = 1; k < starts.length; k++) {
      expect(starts[k] - starts[k - 1]).toBeGreaterThan(3 - 0.05)
      expect(starts[k] - starts[k - 1]).toBeLessThan(6 + 0.2)
    }
    expect(closed / 60 / starts.length).toBeCloseTo(0.08, 1)
    expect(half / 60 / starts.length).toBeCloseTo(0.04, 1)
  })
  it('none for sleepy, asleep and Echo', () => {
    for (const [agent, base] of [[0, 'sleepy'], [0, 'asleep'], [4, 'neutral']] as const) {
      const { m, i } = mk(agent)
      i.base = base
      const p = newParams()
      let blinks = 0
      run(m, i, 0, 30, () => {
        m.fill(p)
        if (p.blink) blinks++
      })
      // only the swap into the state (behind a blink, not for Echo)
      expect(blinks).toBeLessThanOrEqual(agent === 4 ? 0 : 8)
    }
  })
})

describe('the mouth, the cursor, the gaze', () => {
  it('the mouth cycles three shapes at 8 fps while speaking, and stops with the text', () => {
    const { m, i } = mk(1)
    i.speaking = true
    const p = newParams()
    const shapes: number[] = []
    let last = -2
    run(m, i, 0, 1, () => {
      m.fill(p)
      if (p.mouth !== last) shapes.push(p.mouth)
      last = p.mouth
    })
    expect(new Set(shapes)).toEqual(new Set([0, 1, 2]))
    expect(shapes.length).toBeGreaterThanOrEqual(7)
    expect(shapes.length).toBeLessThanOrEqual(9)
    i.speaking = false
    run(m, i, 1, 0.2)
    m.fill(p)
    expect(p.mouth).toBe(-1)
  })
  it("Loop's cursor blinks every second", () => {
    const { m, i } = mk(3)
    const p = newParams()
    let flips = 0
    let prev = true
    run(m, i, 0, 4, () => {
      m.fill(p)
      if (p.cursor !== prev) flips++
      prev = p.cursor
    })
    expect(flips).toBeGreaterThanOrEqual(7)
    expect(flips).toBeLessThanOrEqual(9)
  })
  it('the gaze is one pixel at most', () => {
    const { m, i } = mk(0)
    const p = newParams()
    i.gaze.x = 1
    i.gaze.y = -0.9
    run(m, i, 0, 0.2)
    m.fill(p)
    expect([p.gx, p.gy]).toEqual([1, -1])
    i.gaze.x = 0.1
    run(m, i, 0.2, 0.2)
    m.fill(p)
    expect(p.gx).toBe(0)
  })
  it("Echo's amplitude follows the voice", () => {
    const { m, i } = mk(4)
    const p = newParams()
    i.voice = 0.9
    run(m, i, 0, 0.2)
    m.fill(p)
    expect(p.amp).toBeCloseTo(0.875, 2)
    i.voice = 0
    run(m, i, 0.2, 0.2)
    m.fill(p)
    expect(p.amp).toBe(0)
  })
})

describe('reduced motion and x16', () => {
  it('reduced: no blinks, no mouth, no gaze, a steady cursor; the expression switches at once; the symbols stay', () => {
    const { m, i } = mk(3)
    i.reduced = true
    i.speaking = true
    i.gaze.x = 1
    const p = newParams()
    let moved = 0
    run(m, i, 0, 20, () => {
      m.fill(p)
      if (p.blink || p.mouth >= 0 || p.gx || !p.cursor) moved++
    })
    expect(moved).toBe(0)
    m.fire('surprised', 20)
    i.t = 20.001
    m.update(i)
    m.fill(p)
    expect(p.expr).toBe('surprised')
    expect(p.blink).toBe(0)
  })
  it('x16: only events, 0.3 s each; nothing else; no blinks', () => {
    const { m, i } = mk(1)
    i.fast = true
    i.base = 'focused'
    i.talk = 'nodding'
    const p = newParams()
    const t = run(m, i, 0, 1, () => {
      m.fill(p)
      expect(p.blink).toBe(0)
    })
    expect(m.shown).toBe('neutral')
    m.fire('joy', t)
    let on = 0
    run(m, i, t, 2, () => {
      if (m.shown === 'joy') on += 1 / 60
    })
    expect(on).toBeGreaterThan(0.25)
    expect(on).toBeLessThan(0.36)
    expect(m.shown).toBe('neutral')
  })
})

describe('the redraw budget', () => {
  it('draws only on change, never more than 12 in any second', () => {
    const { m, i } = mk(1)
    const times: number[] = []
    i.speaking = true
    let flip = false
    run(m, i, 0, 20, (t) => {
      if ((Math.floor(t / 0.3) % 2 === 0) !== flip) {
        flip = !flip
        i.base = flip ? 'focused' : 'neutral'
      }
      if (m.dirty(t)) {
        m.drawnAt(t)
        times.push(t)
      }
    })
    expect(times.length).toBeGreaterThan(50)
    for (let k = 12; k < times.length; k++) expect(times[k] - times[k - 12]).toBeGreaterThanOrEqual(1 - 1e-9)
  })
  it('a quiet face redraws only for its blinks, a reduced still one once', () => {
    const { m, i } = mk(0)
    let n = 0
    run(m, i, 0, 30, (t) => {
      if (m.dirty(t)) {
        m.drawnAt(t)
        n++
      }
    })
    expect(n).toBeLessThan(1 + 10 * 3 + 2)
    const r = mk(0)
    r.i.reduced = true
    let k = 0
    run(r.m, r.i, 0, 30, (t) => {
      if (r.m.dirty(t)) {
        r.m.drawnAt(t)
        k++
      }
    })
    expect(k).toBe(1)
  })
  it('Echo animates its wave at a few steps a second only', () => {
    const { m, i } = mk(4)
    let n = 0
    run(m, i, 0, 10, (t) => {
      if (m.dirty(t)) {
        m.drawnAt(t)
        n++
      }
    })
    expect(n).toBeLessThanOrEqual(65)
  })
})
