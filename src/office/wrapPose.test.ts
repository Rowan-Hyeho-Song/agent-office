import { describe, expect, it } from 'vitest'
import { REACH } from './water'
import { planBoard, planDesk, tidyBeats, type Beat } from './wrap'
import { wrapBack, wrapHand, wrapHead, type HandSpec } from './wrapPose'

const REST: [number, number, number] = [0.24, 0.86, -0.1]
const READ: [number, number, number] = [-0.02, 1.25, -0.27]
const hand = (side: 'l' | 'r', pose: 'write' | 'cardpost', b: Beat, u: number, o: { reduced?: boolean } = {}): HandSpec =>
  wrapHand(side, pose, { kind: b.kind, u, k: b.k, piece: b.piece, v: b.v, end: b.end }, 3, { rest: REST, read: READ, sit: -0.25, m: 1, reduced: !!o.reduced })
const dist = (a: HandSpec, b: HandSpec) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])

describe('the hands of the wrap-up pieces (#229)', () => {
  it('every hand target is within an arm\'s reach of the body (horizontal, from the body centre), above the desk top', () => {
    const seats = [
      { pose: 'write' as const, beats: planDesk('agent_2', 5, 60, null).beats },
      { pose: 'cardpost' as const, beats: planBoard('agent_2', 5, 5, 70) },
    ]
    for (const { pose, beats } of seats)
      for (const b of beats)
        for (const side of ['l', 'r'] as const)
          for (let u = 0; u <= 1.0001; u += 0.1) {
            const h = hand(side, pose, b, Math.min(1, u))
            expect(Math.hypot(h.pos[0], h.pos[2])).toBeLessThanOrEqual(REACH)
            expect(h.pos[1]).toBeGreaterThanOrEqual(0.79 - 0.25 * (pose === 'cardpost' ? 1 : 0) - 1e-9)
            for (const c of h.pos) expect(Number.isFinite(c)).toBe(true)
          }
  })

  it('a hand does not jump from one beat to the next (the springs only smooth, they do not carry it across the desk)', () => {
    for (const a of ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'])
      for (let since = 0; since < 10; since++)
        for (const [pose, beats] of [['write', planDesk(a, since, 50, null).beats], ['cardpost', planBoard(a, since, 4, 50)]] as const)
          for (let i = 1; i < beats.length; i++)
            for (const side of ['l', 'r'] as const) {
              const gap = dist(hand(side, pose, beats[i - 1], 1), hand(side, pose, beats[i], 0))
              // a held card read at the face is 0.45 m up; the rest are a few cm to a hand's width
              expect(gap, `${pose} ${beats[i - 1].kind}->${beats[i].kind} ${side}`).toBeLessThan(0.3)
            }
  })

  it('reduced motion keeps the writing posture only: no flourish moves the left hand off the card', () => {
    const kinds = ['tapPen', 'strike', 'readUp', 'next'] as const
    for (const k of kinds) {
      const still = hand('l', 'write', { kind: 'line', k: 0, dur: 2, piece: 'line', v: 0 }, 0.5, { reduced: true })
      const h = hand('l', 'write', { kind: k, k: 0, dur: 1, piece: k, v: 0 }, 0.5, { reduced: true })
      expect(h.pos).toEqual(still.pos)
    }
  })

  it('the pen hand holds the pen grip while writing (tripod), the left hand presses the card flat (support) until it lifts it', () => {
    const line: Beat = { kind: 'line', k: 0, dur: 2, piece: 'line', v: 1 }
    expect(hand('r', 'write', line, 0.5).curl).toBe('pen')
    expect(hand('l', 'write', line, 0.5)).toMatchObject({ curl: 'support', palm: 'down' })
    const up: Beat = { kind: 'readUp', k: 0, dur: 1.8, piece: 'readUp', v: 1 }
    const mid = hand('l', 'write', up, 0.5)
    expect(mid.palm).toBe('up')
    expect(Math.hypot(mid.pos[0] - READ[0], mid.pos[1] - READ[1], mid.pos[2] - READ[2])).toBeLessThan(1e-6)
    // down again at the end
    expect(hand('l', 'write', up, 1).pos[1]).toBeCloseTo(0.82, 5)
  })

  it('a line is written left to right 5 cm and the next line is 8 mm nearer', () => {
    const l = (row: number, u: number) => hand('r', 'write', { kind: 'line', k: 0, dur: 2, piece: 'line', v: row }, u).pos
    // the wobble is added on the pen; the sweep dominates
    expect(l(0, 1)[0] - l(0, 0)[0]).toBeGreaterThan(0.04)
    expect(l(0, 1)[0] - l(0, 0)[0]).toBeLessThan(0.06 + 0.012)
    expect(l(1, 0.5)[2] - l(0, 0.5)[2]).toBeGreaterThan(0.002)
  })

  it('moving takes the card from its cell and puts it in the other row of its column; the hand pinches, presses, lets go', () => {
    const b: Beat = { kind: 'move', k: 1, dur: 1.4, piece: 'move' }
    expect(hand('r', 'cardpost', b, 0.14).curl).toBe('pinch')
    expect(hand('r', 'cardpost', b, 0.9).curl).toBe('stamp')
    expect(hand('r', 'cardpost', b, 1).curl).toBe('rest')
    const from = hand('r', 'cardpost', b, 0.14).pos
    const to = hand('r', 'cardpost', b, 0.85).pos
    expect(from[1] - to[1]).toBeCloseTo(0.14, 1)
    expect(from[0]).toBeCloseTo(to[0], 1)
  })

  it('the three think habits are three different postures', () => {
    const at = (h: number) => hand('r', 'cardpost', { kind: 'think', k: 0, dur: 3, piece: 'think', v: h }, 0.5)
    expect(at(0).curl).toBe('fist')
    expect(at(0).pos[1]).toBeGreaterThan(at(1).pos[1])
    expect(at(1).pos[0]).toBeLessThan(0)
    expect(at(2).curl).toBe('rest')
    const tilt = wrapHead('cardpost', { kind: 'think', u: 0.5, k: 0, v: 2 }, 3, false)
    expect(tilt.roll).toBeCloseTo((8 * Math.PI) / 180, 5)
    expect(wrapHead('cardpost', { kind: 'think', u: 0.5, k: 0, v: 0 }, 3, false).roll).toBe(0)
  })

  it('stepping back is while stepping back, thinking and in the last look, not otherwise', () => {
    const b = (kind: Beat['kind']) => ({ kind, u: 0.5, k: 0 })
    for (const k of ['back', 'think', 'final'] as const) expect(wrapBack(b(k))).toBe(1)
    for (const k of ['forth', 'pick', 'move', 'swap', 'point', 'straighten', 'release'] as const) expect(wrapBack(b(k))).toBe(0)
    expect(wrapBack(undefined)).toBe(0)
  })

  it('the head nods about 2 degrees while pointing and in the last look; tilts 3 degrees tapping the pen; reads at the face lifted', () => {
    const deg = (r: number) => (r * 180) / Math.PI
    const point = (u: number) => wrapHead('cardpost', { kind: 'point', u, k: 0 }, 0, false).pitch
    expect(deg(point(0.5) - point(0))).toBeCloseTo(2, 0)
    expect(deg(wrapHead('write', { kind: 'tapPen', u: 0.5, k: 0 }, 0, false).roll)).toBeCloseTo(3, 0)
    expect(wrapHead('write', { kind: 'readUp', u: 0.5, k: 0 }, 0, false).pitch).toBeGreaterThan(-0.1)
    expect(wrapHead('write', { kind: 'readUp', u: 0, k: 0 }, 0, false).pitch).toBeCloseTo(-0.14, 1)
  })

  it('the tidy-up still ends the same (the beats are the old ones)', () => {
    expect(tidyBeats().map((b) => b.kind)).toEqual(['gather', 'tap', 'tap', 'keys', 'lean'])
  })
})
