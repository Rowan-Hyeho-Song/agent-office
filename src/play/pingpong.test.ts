import { describe, expect, it } from 'vitest'
import { DEFAULT_DIMS, TOSS_MS, ballAt, gameWon, initialState, nextShot, rallyAt, serverFor, type RallyState } from './pingpong'

const P: [string, string] = ['agent_3', 'agent_0']
const D = DEFAULT_DIMS
const seeds = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919)

function steps(seed: number, players: [string, string], count: number) {
  let st: RallyState = initialState(seed, players, D)
  const out = []
  for (let i = 0; i < count; i++) {
    const r = nextShot(st)
    out.push({ shot: r.shot, before: st })
    st = r.state
  }
  return out
}

describe('rally determinism', () => {
  it('same inputs give deep-equal output, different seeds differ', () => {
    for (const t of [0, 900, 5000, 33333, 120000]) expect(rallyAt(5, P, t, D)).toEqual(rallyAt(5, P, t, D))
    const a = Array.from({ length: 40 }, (_, i) => rallyAt(5, P, i * 2500, D))
    const b = Array.from({ length: 40 }, (_, i) => rallyAt(6, P, i * 2500, D))
    expect(a).not.toEqual(b)
  })
  it('evaluating at t directly equals evaluating after sweeping up to t', () => {
    const fresh = rallyAt(77, P, 91234, D)
    const other = rallyAt(77, ['agent_3', 'agent_1'], 91234, D) // separate cache entry, built independently
    for (let t = 0; t <= 91234; t += 250) rallyAt(77, P, t, D)
    expect(rallyAt(77, P, 91234, D)).toEqual(fresh)
    expect(other).toBeDefined()
  })
  it('discrete drops ball and swing but keeps the score', () => {
    for (const t of [3000, 40000, 100000]) {
      const full = rallyAt(9, P, t, D)
      const d = rallyAt(9, P, t, D, true)
      expect(d.ballPos).toBeNull()
      expect(d.swing).toBeNull()
      expect(d.score).toEqual(full.score)
      expect(d.phase).toEqual(full.phase)
    }
  })
})

describe('physics', () => {
  it('good shots clear the net, bounce once on the receiver half, never sink under the table over it', () => {
    let good = 0
    for (const seed of seeds) {
      for (const { shot } of steps(seed, P, 60)) {
        if (shot.outcome !== 'good') continue
        good++
        const r = D.ballR
        let bounces = 0
        let lastVy = 0
        let prev = ballAt(shot, D, 0)!
        const n = Math.ceil(shot.tEndS * 500)
        for (let i = 1; i <= n; i++) {
          const p = ballAt(shot, D, (shot.tEndS * i) / n)!
          if (Math.abs(p[0]) <= D.L / 2) expect(p[1]).toBeGreaterThanOrEqual(r - 1e-6)
          if (prev[0] * p[0] < 0) expect(p[1]).toBeGreaterThanOrEqual(D.netH)
          const vy = p[1] - prev[1]
          if (lastVy < 0 && vy > 0) {
            bounces++
            expect(Math.sign(p[0])).toBe(shot.d)
            expect(Math.abs(p[0])).toBeLessThanOrEqual(D.L / 2)
          }
          if (vy) lastVy = vy
          prev = p
        }
        expect(bounces).toBe(1)
        const end = ballAt(shot, D, shot.tEndS)!
        expect(end[1]).toBeGreaterThan(r + 0.05)
        expect(Math.abs(end[0])).toBeCloseTo(D.L / 2 + D.reach, 3)
      }
    }
    expect(good).toBeGreaterThan(100)
  })
  it('lost balls end under the table level (miss/long) or at the net', () => {
    const seen = new Set<string>()
    for (const seed of seeds) {
      for (const { shot } of steps(seed, ['agent_0', 'agent_1'], 80)) {
        if (shot.outcome === 'good') continue
        seen.add(shot.outcome)
        const e = ballAt(shot, D, shot.tEndS)!
        if (shot.outcome === 'net') expect(Math.abs(e[0])).toBeLessThan(D.L / 2)
        else expect(e[1]).toBeLessThan(0)
      }
    }
    expect([...seen].sort()).toEqual(['long', 'miss', 'net'])
  })
  it('ballPos is null between points', () => {
    let nulls = 0
    let balls = 0
    for (let t = 0; t < 200000; t += 100) {
      const r = rallyAt(3, P, t, D)
      if (r.phase === 'dead') {
        nulls++
        expect(r.ballPos).toBeNull()
      } else if (r.ballPos) balls++
    }
    expect(nulls).toBeGreaterThan(0)
    expect(balls).toBeGreaterThan(100)
  })
  it('a swing starts 150 ms before contact and contact is at t01 0.5', () => {
    const { shot } = steps(4, P, 1)[0]
    expect(rallyAt(4, P, shot.t0 - 150, D).swing?.t01).toBeCloseTo(0, 2)
    const at = rallyAt(4, P, shot.t0, D)
    expect(at.swing?.t01).toBeCloseTo(0.5, 2)
    expect(at.swing?.side).toBe(shot.hitter)
    expect(rallyAt(4, P, shot.t0 - 400, D).swing).toBeNull()
  })
  it('serves start with a toss before the first contact', () => {
    const r = rallyAt(4, P, TOSS_MS / 2, D)
    expect(r.phase).toBe('serve')
    expect(r.ballPos).not.toBeNull()
  })
})

describe('scoring', () => {
  it('game rules: 11, win by 2', () => {
    expect(gameWon(11, 9)).toBe(true)
    expect(gameWon(11, 10)).toBe(false)
    expect(gameWon(12, 10)).toBe(true)
    expect(gameWon(10, 10)).toBe(false)
    expect(gameWon(15, 14)).toBe(false)
  })
  it('serve changes every 2 points and every point at deuce', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => serverFor(0, n, 0))).toEqual([0, 0, 1, 1, 0, 0])
    expect([serverFor(0, 10, 10), serverFor(0, 11, 10), serverFor(0, 11, 11), serverFor(0, 12, 11)]).toEqual([0, 1, 0, 1])
  })
  it('simulated matches follow the rules point by point', () => {
    for (const seed of seeds) {
      let st: RallyState = initialState(seed, P, D)
      let games = 0
      for (let i = 0; i < 600 && games < 2; i++) {
        const { shot, state } = nextShot(st)
        if (shot.pointWinner !== null) {
          const s = [...st.score] as [number, number]
          s[shot.pointWinner]++
          if (gameWon(s[0], s[1])) {
            games++
            expect(state.score).toEqual([0, 0])
            expect(state.game).toBe(st.game + 1)
          } else {
            expect(state.score).toEqual(s)
            expect(state.server).toBe(serverFor(st.first, s[0], s[1]))
          }
        }
        st = state
      }
      expect(games).toBeGreaterThan(0)
    }
  })
  it('rallyAt reports a game over with its winner, then a new game at 0:0', () => {
    let over = false
    let reset = false
    for (let t = 0; t < 900000; t += 200) {
      const r = rallyAt(21, P, t, D)
      if (r.gameOver) {
        over = true
        expect(Math.max(...r.score)).toBeGreaterThanOrEqual(11)
        expect(r.score[r.winner!]).toBeGreaterThan(r.score[1 - r.winner!])
      }
      if (over && r.game > 0 && r.score[0] + r.score[1] === 0) reset = true
    }
    expect(over && reset).toBe(true)
  })
  it('skilled players win more: 루프 beats 메시', () => {
    let a = 0
    let b = 0
    for (let s = 0; s < 40; s++) {
      let st = initialState(s * 31 + 1, ['agent_3', 'agent_1'], D)
      for (let i = 0; i < 2000 && st.game < 1; i++) {
        const { shot, state } = nextShot(st)
        if (state.game > st.game) shot.pointWinner === 0 ? a++ : b++
        st = state
      }
    }
    expect(a).toBeGreaterThan(b)
  })
})

describe('human control', () => {
  it('a human whiff turns the incoming ball into a miss and the AI scores', () => {
    let found = false
    for (let seed = 0; seed < 30 && !found; seed++) {
      let st: RallyState = { ...initialState(seed, P, D), human: 1 }
      for (let i = 0; i < 12; i++) {
        const r = nextShot(st, st.hitter === 1 && st.n > 0 ? { quality: 1 } : undefined)
        if (r.shot.outcome === 'good' && r.state.hitter === 1) {
          const w = nextShot(r.state, { quality: 0 })
          expect(w.shot.whiff).toBe(true)
          expect(w.shot.pointWinner).toBe(0)
          expect(w.state.score[0]).toBe(r.state.score[0] + 1)
          found = true
          break
        }
        st = r.state
        if (st.n === 0) continue
      }
    }
    expect(found).toBe(true)
  })
  it('better timing faults less', () => {
    const faults = (q: number) => {
      let n = 0
      for (let s = 0; s < 400; s++) {
        const st = { ...initialState(s, P, D), human: 0 as const, n: 1, hitter: 0 as const, from: [-1.6, 0.3, 0] as [number, number, number] }
        const sh = nextShot(st, { quality: q, aimZ: 0 }).shot
        if (sh.outcome === 'net' || sh.outcome === 'long') n++
      }
      return n
    }
    expect(faults(1)).toBeLessThan(faults(0.05))
  })
})
