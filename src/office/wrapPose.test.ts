import { describe, expect, it } from 'vitest'
import { REACH } from './water'
import { WRAP, planBoard, planDesk, tidyBeats, type Beat } from './wrap'
import { HELD, LINES_MAX, NEXT_FLIP, WRITE_CARD, doneBehind, flipOf, heldCard, nibAt, wrapBack, wrapHand, wrapHead, type HandSpec } from './wrapPose'

const REST: [number, number, number] = [0.24, 0.86, -0.1]
/** the head's centre seated at a desk (rig.ts headCentre: the head node's rest) */
const HEAD: [number, number, number] = [0, 1.15, 0]
const hand = (side: 'l' | 'r', pose: 'write' | 'cardpost', b: Beat, u: number, o: { reduced?: boolean } = {}): HandSpec =>
  wrapHand(side, pose, { kind: b.kind, u, k: b.k, piece: b.piece, v: b.v, end: b.end }, 3, { rest: REST, head: HEAD, sit: pose === 'write' ? 0 : -0.25, m: 1, reduced: !!o.reduced })
const dist = (a: HandSpec, b: HandSpec) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])
const DEG = Math.PI / 180

describe('the bundle held in front of the chest (#532, wrapup.md 9.1 · 9.4)', () => {
  const beat = (kind: string, u: number, k = 0) => ({ kind, u, k }) as unknown as Parameters<typeof heldCard>[0]
  it('the front card 0.30 m ahead of the head, 0.22 m below it, 0.05 m toward the holding hand; its face 40° up', () => {
    const h = heldCard(beat('line', 0.5), { reduced: false })
    expect(h.c).toEqual([-0.05, -0.22, -0.3])
    expect(h.tilt).toBeCloseTo(40 * DEG, 9)
  })
  it('reading: up to 0.22 m before the face and back; reduced motion: it stays (the head bows instead)', () => {
    const mid = heldCard(beat('readUp', 0.5), { reduced: false })
    expect(mid.c[2]).toBeCloseTo(-HELD.readFwd, 9)
    expect(mid.c[1]).toBeGreaterThan(-HELD.down)
    expect(mid.tilt).toBeCloseTo(HELD.readTiltDeg * DEG, 9)
    expect(heldCard(beat('readUp', 1), { reduced: false })).toEqual(heldCard(beat('line', 0), { reduced: false }))
    expect(heldCard(beat('readUp', 0.5), { reduced: true })).toEqual(heldCard(beat('line', 0), { reduced: true }))
    expect(wrapHead('write', { kind: 'readUp', u: 0.5, k: 0 }, 0, true).pitch).toBeLessThan(wrapHead('write', { kind: 'line', u: 0.5, k: 0 }, 0, true).pitch)
  })
  it('the wait comes with the beat (wrap.ts viewOf: the reread beat carries how long it has waited)', () => {
    const b = (wait: number) => ({ kind: 'readUp', u: 0, k: 3, wait }) as unknown as Parameters<typeof heldCard>[0]
    expect(heldCard(b(HELD.waitS - 1), { reduced: false }).tilt).toBeCloseTo(HELD.tiltDeg * DEG, 9)
    expect(heldCard(b(HELD.waitS + 5), { reduced: false }).c[1]).toBeCloseTo(-HELD.down - HELD.waitDown, 9)
  })

  it('waiting long at the desk for the board: 5 cm lower and 20° up', () => {
    const w = heldCard(beat('readUp', 0), { reduced: false, waitS: HELD.waitS + 5 })
    expect(w.c[1]).toBeCloseTo(-HELD.down - HELD.waitDown, 9)
    expect(w.tilt).toBeCloseTo(HELD.waitTiltDeg * DEG, 9)
    expect(heldCard(beat('line', 0), { reduced: false, waitS: HELD.waitS - 1 }).tilt).toBeCloseTo(HELD.tiltDeg * DEG, 9)
  })
  it("'next': the card goes over between 0.15 s and 0.45 s and is behind from then on; reduced motion: behind at once, never turning over", () => {
    const at = (s: number) => beat('next', s / WRAP.next, 2)
    expect(flipOf(at(NEXT_FLIP.from - 0.01))).toBe(0)
    expect(flipOf(at((NEXT_FLIP.from + NEXT_FLIP.to) / 2))).toBeCloseTo(0.5, 6)
    expect(flipOf(at(NEXT_FLIP.to + 0.01))).toBe(1)
    expect(doneBehind(at(0.1))).toBe(2)
    expect(doneBehind(at(0.5))).toBe(3)
    expect(doneBehind(at(0.1), true)).toBe(3)
    expect(flipOf(at(0.3), true)).toBe(0)
    expect(doneBehind(beat('line', 0.5, 4))).toBe(4)
  })
})

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

  it('reduced motion keeps the writing posture only: no flourish moves the holding hand (the card is not lifted to the face)', () => {
    const kinds = ['tapPen', 'strike', 'readUp', 'next'] as const
    for (const k of kinds) {
      const still = hand('l', 'write', { kind: 'line', k: 0, dur: 2, piece: 'line', v: 0 }, 0.5, { reduced: true })
      const h = hand('l', 'write', { kind: k, k: 0, dur: 1, piece: k, v: 0 }, 0.5, { reduced: true })
      expect(h.pos).toEqual(still.pos)
    }
  })

  it('the pen hand holds the pen (tripod), the other holds the bundle from behind (support, palm toward it) and lifts it toward the face to read it (#532)', () => {
    const line: Beat = { kind: 'line', k: 0, dur: 2, piece: 'line', v: 1 }
    expect(hand('r', 'write', line, 0.5).curl).toBe('pen')
    expect(hand('l', 'write', line, 0.5)).toMatchObject({ curl: 'support', palm: 'up' })
    const up: Beat = { kind: 'readUp', k: 0, dur: 1.8, piece: 'readUp', v: 1 }
    const at = (u: number) => hand('l', 'write', up, u).pos
    const toHead = (p: [number, number, number]) => Math.hypot(p[0] - HEAD[0], p[1] - HEAD[1], p[2] - HEAD[2])
    expect(toHead(at(0.5))).toBeLessThan(toHead(at(0)) - 0.05)
    // down again at the end
    expect(Math.hypot(at(1)[0] - at(0)[0], at(1)[1] - at(0)[1], at(1)[2] - at(0)[2])).toBeLessThan(1e-9)
  })

  it('a line is written left to right 5 cm', () => {
    const l = (row: number, u: number) => hand('r', 'write', { kind: 'line', k: 0, dur: 2, piece: 'line', v: row }, u).pos
    // the wobble is added on the pen; the sweep dominates
    expect(l(0, 1)[0] - l(0, 0)[0]).toBeGreaterThan(0.04)
    expect(l(0, 1)[0] - l(0, 0)[0]).toBeLessThan(0.06 + 0.012)
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
    // bowed 18° toward the held card (#532)
    expect(wrapHead('write', { kind: 'readUp', u: 0, k: 0 }, 0, false).pitch).toBeCloseTo((-18 * Math.PI) / 180, 2)
  })

  it('the tidy-up still ends the same (the beats are the old ones)', () => {
    expect(tidyBeats().map((b) => b.kind)).toEqual(['gather', 'tap', 'tap', 'keys', 'lean'])
  })
})

describe("the pen's tip on the held card (#481 · #532, wrapup.md 9.2 · 9.3)", () => {
  const beat = (kind: string, u: number, v = 0) => ({ kind, u, k: 0, v }) as unknown as Parameters<typeof nibAt>[0]
  it('on the front card while it writes a line or strikes one out, inside it; off 1 cm on a new line, 1.6 cm between taps', () => {
    for (let i = 0; i <= 40; i++) {
      const u = i / 40
      for (const [kind, maxLift] of [['line', 0], ['strike', 0], ['newline', 0.01], ['tapPen', 0.016]] as const)
        for (const row of [0, 3, LINES_MAX, 6]) {
          const [x, lift, z] = nibAt(beat(kind, u, row), u * 3, { reduced: false, m: 1 })
          expect(lift, `${kind} lift`).toBeLessThanOrEqual(maxLift + 1e-9)
          expect(lift).toBeGreaterThanOrEqual(0)
          expect(Math.abs(x), `${kind} across the card`).toBeLessThan(WRITE_CARD.w / 2 - 0.005)
          expect(Math.abs(z), `${kind} down the card`).toBeLessThan(WRITE_CARD.d / 2 - 0.005)
        }
    }
    // the line's left end 1.2 cm in from the card's left edge, the first line 1.5 cm down from its top edge, 5 cm lines 8 mm apart
    const [x0, , z0] = nibAt(beat('line', 0), 0, { reduced: false, m: 0 })
    expect(x0 + WRITE_CARD.w / 2).toBeCloseTo(WRITE_CARD.inLeft, 6)
    expect(z0 + WRITE_CARD.d / 2).toBeCloseTo(WRITE_CARD.inFar, 6)
    expect(nibAt(beat('line', 1), 0, { reduced: false, m: 0 })[0] - x0).toBeCloseTo(WRITE_CARD.lineLen, 6)
    expect(nibAt(beat('line', 0, 1), 0, { reduced: false, m: 0 })[2] - z0).toBeCloseTo(WRITE_CARD.lineGap, 6)
  })
  it("'next': to the top corner, up with the card going over, down at the new card's first line", () => {
    const at = (s: number) => nibAt(beat('next', s / WRAP.next, 4), 0, { reduced: false, m: 0 })
    expect(at(NEXT_FLIP.from)[2]).toBeLessThan(-WRITE_CARD.d / 2 + 0.01)
    expect(at((NEXT_FLIP.from + NEXT_FLIP.to) / 2)[1]).toBeGreaterThan(0.03)
    const first = nibAt(beat('line', 0, 0), 0, { reduced: false, m: 0 })
    at(WRAP.next).forEach((c, i) => expect(c).toBeCloseTo(first[i], 9))
  })
  it('reduced motion: the tip stands still on the line', () => {
    const a = nibAt(beat('strike', 0.1), 1, { reduced: true, m: 0.3 })
    const b = nibAt(beat('tapPen', 0.5), 1, { reduced: true, m: 0.3 })
    expect(a[1]).toBe(0)
    expect(b[1]).toBe(0)
  })
})
