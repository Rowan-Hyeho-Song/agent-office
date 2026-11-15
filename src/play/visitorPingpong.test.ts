// #137 ③ the visitor's paddle against an agent (play.md 3 · 5.4 · 7): hits within reach, misses past it, easy mode's Space, three points,
// the serve every point, the speed, and the agent's contact known as soon as the visitor hits (its timetable).
import { describe, expect, it } from 'vitest'
import { DEFAULT_DIMS } from './pingpong'
import {
  ballOf, followPaddle, landing, paddlePoint, rallyOf, serveVisitorPP, spaceVisitorPP, startVisitorPP, stepVisitorPP, visitorPlaneX, VISITOR_PP,
  type Paddle, type PPEvent, type VisitorPP,
} from './visitorPingpong'

const DT = 1 / 60
const mid: Paddle = { y: 0.2, z: 0, vz: 0 }

/** play on with a paddle chosen each frame; serves as soon as it may; until the match is over or `maxS` */
function play(g0: VisitorPP, paddle: (g: VisitorPP) => Paddle, maxS = 120, onFrame?: (g: VisitorPP) => VisitorPP) {
  let g = g0
  const events: PPEvent[] = []
  for (let k = 0; k < maxS / DT && g.phase !== 'over'; k++) {
    const p = paddle(g)
    if (g.phase === 'serve') {
      const r = serveVisitorPP(g, p)!
      g = r.g
      events.push(...r.events)
    }
    const r = stepVisitorPP(g, DT, p)
    g = onFrame ? onFrame(r.g) : r.g
    events.push(...r.events)
  }
  return { g, events }
}

describe('a match', () => {
  it('the visitor serves first; a paddle always where the ball crosses returns every ball', () => {
    const { g, events } = play(startVisitorPP('agent_3', 7), (x) => followPaddle(x, mid))
    expect(g.phase).toBe('over')
    const points = events.filter((e) => e.kind === 'point')
    // the agent's points are its own faults or the visitor's (net / long), never a ball the visitor's paddle was under
    expect(events.filter((e) => e.kind === 'hit' && e.side === 0).length).toBeGreaterThan(points.length)
    const over = events.find((e) => e.kind === 'over')!
    expect(Math.max(...over.score)).toBe(VISITOR_PP.winPoints)
  })

  it('a paddle far from the ball misses it: the point is the agent', () => {
    let g = startVisitorPP('agent_3', 11)
    // the visitor serves, then holds the paddle off at the side
    g = serveVisitorPP(g, mid)!.g
    const far: Paddle = { y: 0.2, z: -1.0, vz: 0 }
    const { events } = play(g, () => far, 20)
    const k = events.findIndex((e) => e.kind === 'point')
    expect(k).toBeGreaterThanOrEqual(0)
    // up to the first point the visitor never hits (the agent's ball passes the paddle, or a fault comes first)
    expect(events.slice(0, k).filter((e) => e.kind === 'hit' && e.side === 0).length).toBe(0)
    // and a good ball from the agent that reaches the visitor is the agent's point
    const g2 = play(g, () => far, 60).events.filter((e) => e.kind === 'point') as Extract<PPEvent, { kind: 'point' }>[]
    expect(g2.filter((e) => e.winner === 1).length).toBeGreaterThan(0)
  })

  it('three points end it; the serve changes every point', () => {
    const servers: (0 | 1)[] = []
    let last = -1
    const { g } = play(startVisitorPP('agent_1', 3), (x) => followPaddle(x, mid), 200, (x) => {
      const n = x.score[0] + x.score[1]
      if (n !== last && x.decided === null) {
        last = n
        servers.push(x.server)
      }
      return x
    })
    expect(g.phase).toBe('over')
    expect(Math.max(...g.score)).toBe(3)
    for (let k = 1; k < servers.length; k++) expect(servers[k]).not.toBe(servers[k - 1])
  })

  it('the same match for the same seed and paddles (no frame randomness)', () => {
    const a = play(startVisitorPP('agent_0', 5), (x) => followPaddle(x, mid))
    const b = play(startVisitorPP('agent_0', 5), (x) => followPaddle(x, mid))
    expect(a.g.score).toEqual(b.g.score)
    expect(a.events.length).toBe(b.events.length)
  })
})

describe('the ball to the visitor', () => {
  /** the visitor serves; play until the agent's good return is on its way */
  function incoming(seed: number, speed: VisitorPP['speed'] = 'normal', easy = false) {
    for (let k = 0; k < 40; k++) {
      let g = startVisitorPP('agent_3', seed + k, speed, easy)
      g = serveVisitorPP(g, mid)!.g
      for (let f = 0; f < 600; f++) {
        g = stepVisitorPP(g, DT, mid).g
        if (g.decided !== null) break
        if (g.shot?.hitter === 1 && g.shot.outcome === 'good' && g.phase === 'flight') return g
      }
    }
    throw new Error('no return')
  }

  it('the agent reads where it will meet the visitor ball as it leaves the paddle (play.md 7)', () => {
    let g = startVisitorPP('agent_3', 21)
    g = serveVisitorPP(g, mid)!.g
    const s = g.shot!
    if (s.outcome === 'good') {
      const c = g.contacts.find((x) => x.side === 1)!
      expect(c.t).toBeCloseTo(s.t0 + s.tPlaneS * 1000, 6)
      expect(c.from).toBe(s.t0)
      expect(rallyOf(g, mid).contacts).toContainEqual(c)
    }
  })

  it('within reach of the paddle middle it is hit; 0.18 m is the same at any speed', () => {
    for (const speed of ['slow', 'normal', 'fast'] as const) {
      const g = incoming(31, speed)
      const s = g.shot!
      const at = ballOf({ ...g, t: s.t0 + s.tPlaneS * 1000 }, mid)!
      const near: Paddle = { y: at[1] - DEFAULT_DIMS.ballR + 0.17, z: at[2], vz: 0 }
      const far: Paddle = { y: at[1] - DEFAULT_DIMS.ballR + 0.19, z: at[2], vz: 0 }
      const run = (p: Paddle) => {
        let x = g
        const ev: PPEvent[] = []
        for (let f = 0; f < 600 && x.decided === null; f++) {
          const r = stepVisitorPP(x, DT, p)
          x = r.g
          ev.push(...r.events)
          if (ev.some((e) => e.kind === 'hit' && e.side === 0)) break
        }
        return ev
      }
      expect(run(near).some((e) => e.kind === 'hit' && e.side === 0)).toBe(true)
      const missed = run(far)
      expect(missed.some((e) => e.kind === 'hit' && e.side === 0)).toBe(false)
      expect(missed.find((e) => e.kind === 'point')).toMatchObject({ winner: 1 })
    }
  })

  it('the hit is pulled 30% toward the paddle middle', () => {
    const g = incoming(41)
    const s = g.shot!
    const at = ballOf({ ...g, t: s.t0 + s.tPlaneS * 1000 }, mid)!
    const p: Paddle = { y: at[1] - DEFAULT_DIMS.ballR + 0.1, z: at[2] - 0.1, vz: 0 }
    let x = g
    let hit: Extract<PPEvent, { kind: 'hit' }> | undefined
    for (let f = 0; f < 600 && !hit; f++) {
      const r = stepVisitorPP(x, DT, p)
      x = r.g
      hit = r.events.find((e) => e.kind === 'hit' && e.side === 0) as typeof hit
    }
    const pp = paddlePoint(p)
    expect(hit!.at[0]).toBeCloseTo(visitorPlaneX(), 6)
    expect(hit!.at[1]).toBeCloseTo(at[1] + (pp[1] - at[1]) * 0.3, 6)
    expect(hit!.at[2]).toBeCloseTo(at[2] + (pp[2] - at[2]) * 0.3, 6)
  })

  it('easy mode: Space within 0.25 s of the crossing hits it (early or late); none misses', () => {
    const g = incoming(51, 'normal', true)
    const s = g.shot!
    const cross = s.t0 + s.tPlaneS * 1000
    const mul = VISITOR_PP.mul.normal
    const p = followPaddle(g, mid)
    // until `at` match time, Space there, then on until the hit or the point
    const run = (spaceAt: number | null) => {
      let x = g
      const ev: PPEvent[] = []
      let pressed = false
      for (let f = 0; f < 600 && x.decided === null; f++) {
        if (spaceAt !== null && !pressed && x.t >= spaceAt) {
          pressed = true
          const r = spaceVisitorPP(x, p)
          if (r) {
            x = r.g
            ev.push(...r.events)
          }
        }
        const r = stepVisitorPP(x, DT, p)
        x = r.g
        ev.push(...r.events)
        if (ev.some((e) => e.kind === 'hit' && e.side === 0)) break
      }
      return ev.some((e) => e.kind === 'hit' && e.side === 0)
    }
    expect(run(cross - 200 * mul)).toBe(true)
    expect(run(cross + 200 * mul)).toBe(true)
    expect(run(cross - 400 * mul)).toBe(false)
    expect(run(null)).toBe(false)
  })

  it('slower is slower in real time; the landing ring knows where and when', () => {
    const real = (speed: VisitorPP['speed']) => {
      const g = incoming(61, speed)
      const l = landing(g)!
      expect(l.at[0]).toBeLessThan(0) // on the visitor's half
      return (g.shot!.T1 * 1000) / VISITOR_PP.mul[speed]
    }
    expect(real('slow')).toBeGreaterThan(real('fast'))
  })
})
