// #416 ③ (play.md 7): read the ball, take the paddle there while it flies, wait drawn back, swing so the face meets it.
import { describe, expect, it } from 'vitest'
import { STROKE, faceAt, strokeAt, type Contact } from './stroke'
import { DEFAULT_DIMS, rallyAt, type V3 } from './pingpong'

const GAP = 0.023
const HOME: V3 = [-1.55, 0.2, 0]
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const hit = (t: number, at: V3, extra: Partial<Contact> = {}): Contact => ({ side: 0, t, at, miss: false, from: 0, ...extra })

describe('one stroke (play.md 7)', () => {
  const c = hit(900, [-1.6, 0.3, 0.2])
  const face = faceAt(c, 1, GAP)
  const ready: V3 = [face[0] - STROKE.backM, face[1] - STROKE.downM, face[2]]

  it('reacts 0.15 s, is at the ready place 0.3 s before contact and waits there, swings the last 0.25 s, the face on the ball at contact', () => {
    expect(strokeAt([c], 100, HOME, 1, GAP)).toMatchObject({ phase: 'react', pos: HOME })
    expect(strokeAt([c], 400, HOME, 1, GAP).phase).toBe('move')
    expect(dist(strokeAt([c], 600, HOME, 1, GAP).pos, ready)).toBeLessThan(0.011)
    expect(strokeAt([c], 620, HOME, 1, GAP).phase).toBe('wait')
    expect(strokeAt([c], 620, HOME, 1, GAP).wrist).toBeCloseTo(-STROKE.wristBack, 6)
    expect(strokeAt([c], 700, HOME, 1, GAP).phase).toBe('swing')
    const at = strokeAt([c], 900, HOME, 1, GAP)
    expect(dist(at.pos, face)).toBeLessThan(1e-9)
    // the face's centre is on the ball's near side: ball radius + half the blade from its centre, never through it
    expect(dist(at.pos, c.at)).toBeCloseTo(GAP, 9)
    expect(at.wrist).toBeCloseTo(STROKE.wristThrough, 6)
  })

  it('follows through 0.15 m, then is back at the ready place 0.4 s later', () => {
    const f = strokeAt([c], 900 + STROKE.followMs, HOME, 1, GAP)
    expect(f.pos[0] - face[0]).toBeCloseTo(STROKE.followM, 2)
    expect(strokeAt([c], 900 + STROKE.followMs + STROKE.backMs + 1, HOME, 1, GAP)).toMatchObject({ phase: 'rest', pos: HOME, wrist: 0 })
  })

  it('never jumps: a millimetre at most per millisecond over the whole exchange (the swing peaks near 2 m/s)', () => {
    let prev = strokeAt([c], -100, HOME, 1, GAP).pos
    let worst = 0
    for (let t = -99; t < 2000; t++) {
      const p = strokeAt([c], t, HOME, 1, GAP).pos
      worst = Math.max(worst, dist(p, prev))
      prev = p
    }
    expect(worst).toBeLessThan(0.0025)
  })

  it('a fast ball (under 0.55 s): no waiting, the move runs into the swing, still on the ball at contact', () => {
    const fast = hit(450, [-1.6, 0.25, -0.1])
    const phases = new Set<string>()
    for (let t = 0; t <= 450; t += 5) phases.add(strokeAt([fast], t, HOME, 1, GAP).phase)
    expect(phases.has('wait')).toBe(false)
    expect(dist(strokeAt([fast], 450, HOME, 1, GAP).pos, faceAt(fast, 1, GAP))).toBeLessThan(1e-9)
  })

  it('a ball that wins the point is swung at 0.25 m beside it; a ball on the far side is a backhand', () => {
    const miss = hit(900, [-1.6, 0.3, 0.2], { miss: true })
    expect(Math.abs(strokeAt([miss], 900, HOME, 1, GAP).pos[2] - 0.2)).toBeCloseTo(STROKE.whiffM, 6)
    expect(strokeAt([hit(900, [-1.6, 0.3, -0.3])], 800, HOME, 1, GAP).backhand).toBe(true)
    expect(strokeAt([hit(900, [-1.6, 0.3, 0.3])], 800, HOME, 1, GAP).backhand).toBe(false)
    // the other side faces −x: its paddle hand is on −z
    expect(strokeAt([hit(900, [1.6, 0.3, 0.3], { side: 1 })], 800, [1.55, 0.2, 0], -1, GAP).backhand).toBe(true)
  })
})

describe('the rally gives every contact ahead of time (pingpong.ts contacts)', () => {
  it('over a minute of play: each contact is where the ball is at that moment, the next is known from the opponent\'s hit, and both paddles meet the ball at every hit without jumping', () => {
    const players: [string, string] = ['agent_0', 'agent_1']
    const seen = new Map<string, Contact>()
    // a jump is a step that suddenly differs from the frame before; fast but smooth moves (a far ball: ~0.8 m in 0.4 s) are not
    const prev: Record<number, V3 | null> = { 0: null, 1: null }
    const step: Record<number, number | null> = { 0: null, 1: null }
    let worst = 0
    for (let t = 0; t < 60_000; t += 16) {
      const r = rallyAt(12345, players, t)
      for (const c of r.contacts) seen.set(`${c.side}|${c.t}`, c)
      for (const side of [0, 1] as const) {
        const dir = side === 0 ? 1 : -1
        const home: V3 = [-dir * (DEFAULT_DIMS.L / 2 + DEFAULT_DIMS.reach) + dir * 0.12, 0.2, 0]
        const p = strokeAt(r.contacts.filter((c) => c.side === side), t, home, dir, GAP).pos
        if (prev[side]) {
          const d = dist(p, prev[side]!)
          if (step[side] !== null) worst = Math.max(worst, Math.abs(d - step[side]!))
          step[side] = d
        }
        prev[side] = p
      }
    }
    expect(seen.size).toBeGreaterThan(20)
    for (const c of seen.values()) {
      const r = rallyAt(12345, players, c.t)
      // the ball is at the contact point then (a whiff: at the hitting plane), and the side could move for it before
      if (r.ballPos) expect(dist(r.ballPos, c.at), `${c.side} at ${c.t}`).toBeLessThan(0.02)
      expect(c.from).toBeLessThan(c.t)
      const dir = c.side === 0 ? 1 : -1
      const home: V3 = [-dir * (DEFAULT_DIMS.L / 2 + DEFAULT_DIMS.reach) + dir * 0.12, 0.2, 0]
      const p = strokeAt(r.contacts.filter((x) => x.side === c.side), c.t, home, dir, GAP).pos
      expect(dist(p, faceAt(c, dir, GAP)), `face on the ball, ${c.side} at ${c.t}`).toBeLessThan(0.05)
    }
    // from one 16 ms frame to the next the step changes by at most 4 cm: a far ball's eased move speeds up by ~2.3 cm a frame at most and
    // the contact by ~1.3 cm, while a jump (a teleport between strokes, points or games) is a whole move in one frame, 10 cm and more
    expect(worst).toBeLessThan(0.04)
  })
})
