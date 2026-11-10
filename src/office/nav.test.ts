import { describe, expect, it } from 'vitest'
import {
  EDGES,
  buildGraph,
  dist,
  facing,
  MEET_SEAT_R,
  patchSpots,
  pathLength,
  routeFromEdge,
  shortestPath,
  type NavKind,
  type NavSpot,
} from './nav'
import { SPOTS as FIXTURE_SPOTS } from './navSpots.fixture'

// the nav_* empties of the baked layout (generated from the glb: modelData.test.ts)
const SPOTS: NavSpot[] = FIXTURE_SPOTS
const byId = Object.fromEntries(SPOTS.map((s) => [s.id, s]))

const sp = (id: string, x: number, z: number): NavSpot => ({ id, x, z, ry: 0, kind: 'hall' })

describe('real spot list and EDGES', () => {
  it('has the five work spots, five desk sides, the meeting centre and the two chat spots (#195 안 2)', () => {
    for (let i = 0; i < 5; i++) {
      expect(byId[`work_${i}`]?.kind).toBe('work')
      expect(byId[`desk_side_${i}`]?.kind).toBe('stand')
    }
    expect(byId.meet_center?.kind).toBe('meet_center')
    expect([byId.chat_0?.kind, byId.chat_1?.kind]).toEqual(['chat', 'chat'])
    expect(byId.hall_north?.kind).toBe('hall')
    expect(byId.board_tray?.kind).toBe('stand')
  })

  it('every EDGES endpoint is a known spot id', () => {
    for (const [a, b] of EDGES) {
      expect(byId[a], a).toBeDefined()
      expect(byId[b], b).toBeDefined()
    }
  })

  it('has no self-loops', () => {
    for (const [a, b] of EDGES) expect(a).not.toBe(b)
  })

  it('is connected: every spot reaches every other', () => {
    const g = buildGraph(SPOTS)
    for (const a of SPOTS) for (const b of SPOTS) expect(shortestPath(g, a.id, b.id), `${a.id}->${b.id}`).not.toBeNull()
  })

  it('shortest paths are symmetric in length and use adjacent hops', () => {
    const g = buildGraph(SPOTS)
    for (const a of SPOTS) {
      for (const b of SPOTS) {
        const p = shortestPath(g, a.id, b.id)!
        const q = shortestPath(g, b.id, a.id)!
        expect(pathLength(g, p)).toBeCloseTo(pathLength(g, q), 9)
        expect(p[0]).toBe(a.id)
        expect(p[p.length - 1]).toBe(b.id)
        for (let i = 1; i < p.length; i++) expect(g.adj[p[i - 1]]).toContain(p[i])
      }
    }
  })
})

describe('buildGraph', () => {
  it('makes edges undirected and skips edges with missing spots', () => {
    const g = buildGraph([sp('a', 0, 0), sp('b', 1, 0)], [['a', 'b'], ['a', 'zzz']])
    expect(g.adj.a).toEqual(['b'])
    expect(g.adj.b).toEqual(['a'])
    expect(g.adj.zzz).toBeUndefined()
  })
})

describe('shortestPath', () => {
  // a - b - c along x, plus a long detour a - d - c
  const g = buildGraph(
    [sp('a', 0, 0), sp('b', 1, 0), sp('c', 2, 0), sp('d', 1, 5), sp('lonely', 9, 9)],
    [['a', 'b'], ['b', 'c'], ['a', 'd'], ['d', 'c']],
  )

  it('returns [from] when from === to', () => expect(shortestPath(g, 'a', 'a')).toEqual(['a']))
  it('returns null for unknown ids', () => {
    expect(shortestPath(g, 'nope', 'a')).toBeNull()
    expect(shortestPath(g, 'a', 'nope')).toBeNull()
    expect(shortestPath(g, 'nope', 'nope')).toBeNull()
  })
  it('returns null for an unreachable node', () => {
    expect(shortestPath(g, 'a', 'lonely')).toBeNull()
    expect(shortestPath(g, 'lonely', 'a')).toBeNull()
  })
  it('picks the shorter of two routes', () => {
    expect(shortestPath(g, 'a', 'c')).toEqual(['a', 'b', 'c'])
    expect(pathLength(g, ['a', 'b', 'c'])).toBeCloseTo(2)
  })
  it('picks by distance, not by hop count', () => {
    // direct a-c is 1 m; the a-b-c detour via a far point is much longer
    const h = buildGraph([sp('a', 0, 0), sp('b', 5, 5), sp('c', 1, 0)], [['a', 'b'], ['b', 'c'], ['a', 'c']])
    expect(shortestPath(h, 'a', 'c')).toEqual(['a', 'c'])
    // here the 2-hop route is shorter than a long direct edge
    const k = buildGraph([sp('a', 0, 0), sp('b', 1, 0), sp('c', 2, 0)], [['a', 'b'], ['b', 'c']])
    expect(shortestPath(k, 'a', 'c')).toEqual(['a', 'b', 'c'])
  })
})

describe('routeFromEdge', () => {
  const g = buildGraph([sp('A', 0, 0), sp('B', 10, 0), sp('C', 20, 0)], [['A', 'B'], ['B', 'C']])

  it('a point near A going to A goes back via A', () => {
    expect(routeFromEdge(g, { x: 1, z: 0 }, 'A', 'B', 'A')).toEqual(['A'])
  })
  it('a point near B going to C goes via B', () => {
    expect(routeFromEdge(g, { x: 9, z: 0 }, 'A', 'B', 'C')).toEqual(['B', 'C'])
  })
  it('starts with one of the two edge ends', () => {
    for (const to of ['A', 'B', 'C']) {
      for (const x of [0.5, 3, 5, 7, 9.5]) {
        const r = routeFromEdge(g, { x, z: 0 }, 'A', 'B', to)!
        expect(['A', 'B']).toContain(r[0])
        expect(r[r.length - 1]).toBe(to)
      }
    }
  })
  it('returns null when unreachable', () => {
    const h = buildGraph([sp('A', 0, 0), sp('B', 1, 0), sp('Z', 5, 5)], [['A', 'B']])
    expect(routeFromEdge(h, { x: 0.5, z: 0 }, 'A', 'B', 'Z')).toBeNull()
  })
  it('works on the real graph: always starts at an edge end', () => {
    const rg = buildGraph(SPOTS)
    for (const [a, b] of EDGES) {
      const mid = { x: (byId[a].x + byId[b].x) / 2, z: (byId[a].z + byId[b].z) / 2 }
      for (const to of ['whiteboard', 'door', 'sofa_2', 'work_3']) {
        const r = routeFromEdge(rg, mid, a, b, to)!
        expect([a, b]).toContain(r[0])
        expect(r[r.length - 1]).toBe(to)
      }
    }
  })
})

describe('dist', () => {
  it('is euclidean on the floor plane', () => expect(dist({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5))
})

describe('facing', () => {
  const o = { x: 0, z: 0 }
  it('target straight at -z gives 0', () => expect(facing(o, { x: 0, z: -1 })).toBeCloseTo(0))
  it('target at -x gives +pi/2', () => expect(facing(o, { x: -1, z: 0 })).toBeCloseTo(Math.PI / 2))
  it('target at +x gives -pi/2', () => expect(facing(o, { x: 1, z: 0 })).toBeCloseTo(-Math.PI / 2))
  it('target at +z gives +-pi', () => expect(Math.abs(facing(o, { x: 0, z: 1 }))).toBeCloseTo(Math.PI))
  it('rotating local -z by ry points at the target', () => {
    const to = { x: 2, z: -3 }
    const ry = facing(o, to)
    // rotation about y of (0,0,-1) is (-sin ry, -cos ry) in (x, z)
    const len = Math.hypot(to.x, to.z)
    expect(-Math.sin(ry)).toBeCloseTo(to.x / len)
    expect(-Math.cos(ry)).toBeCloseTo(to.z / len)
  })
  it('the meeting circle brings talk seats: the first two face each other across the centre, all face the centre, turned with its ry (#147, #195)', () => {
    const g = buildGraph(SPOTS)
    const c = g.spots.meet_center
    const a = g.spots.meet_talk_0
    const b = g.spots.meet_talk_1
    expect(Math.abs(facing(a, b) - a.ry)).toBeLessThan(1e-3)
    expect(Math.abs(facing(b, a) - b.ry)).toBeLessThan(1e-3)
    // the pair stands across the way to the whiteboard (ry): the line between them is square to it
    const board = { x: -Math.sin(c.ry), z: -Math.cos(c.ry) }
    expect(Math.abs((b.x - a.x) * board.x + (b.z - a.z) * board.z)).toBeLessThan(1e-6)
    for (const id in g.spots)
      if (id.startsWith('meet_talk_')) {
        expect(dist(g.spots[id], c)).toBeCloseTo(MEET_SEAT_R)
        expect(g.adj[id]).toContain(c.id)
      }
    expect(Object.keys(g.spots).filter((id) => id.startsWith('meet_talk_'))).toHaveLength(4) // the circle moved to (0.7, -1.97) (#280): the board-side seat now stands 0.73 m from the whiteboard spot, clear of 2R
  })
  it('the two chat spots face each other 1.0 m apart', () => {
    const g = buildGraph(SPOTS)
    const a = g.spots.chat_0
    const b = g.spots.chat_1
    expect(dist(a, b)).toBeCloseTo(1.0, 2)
    expect(Math.abs(facing(a, b) - a.ry)).toBeLessThan(1e-3)
    expect(Math.abs(facing(b, a) - b.ry)).toBeLessThan(1e-3)
  })
  it('no two destinations (seats included) stand closer than two bodies, but the sofa row', () => {
    const g = buildGraph(SPOTS)
    const dests = Object.values(g.spots).filter((s) => s.kind !== 'hall' && s.kind !== 'meet_center')
    const close: string[] = []
    for (let i = 0; i < dests.length; i++)
      for (let j = i + 1; j < dests.length; j++) if (dist(dests[i], dests[j]) < 0.6) close.push(`${dests[i].id}/${dests[j].id}`)
    expect(close.sort()).toEqual(['board_tray/whiteboard', 'sofa_0/sofa_1', 'sofa_1/sofa_2'])
  })
})

describe('patchSpots (?debug=1&nav=)', () => {
  it('moves existing spots, adds missing ones, keeps ry and kind when left out', () => {
    const base = [sp('a', 0, 0), { ...sp('b', 1, 1), ry: 2, kind: 'stand' as NavKind }]
    const out = patchSpots(base, 'b:5:6,c:7:8')
    expect(out.find((s) => s.id === 'b')).toEqual({ id: 'b', x: 5, z: 6, ry: 2, kind: 'stand' })
    expect(out.find((s) => s.id === 'c')).toEqual({ id: 'c', x: 7, z: 8, ry: 0, kind: 'hall' })
    expect(out.find((s) => s.id === 'a')).toEqual(sp('a', 0, 0))
    expect(patchSpots(base, '')).toBe(base)
  })
})

describe('blocked spots (#110)', () => {
  const g = buildGraph(SPOTS)
  const sides = new Set(['desk_side_0', 'desk_side_1', 'desk_side_2', 'desk_side_3', 'desk_side_4'])

  it('a quiet route never walks through a desk side', () => {
    for (const a of SPOTS) {
      for (const b of SPOTS) {
        if (sides.has(a.id) || sides.has(b.id)) continue
        // a seat whose only door is its desk side (the west row's lane) can only be entered through it
        if (g.adj[b.id].every((n) => sides.has(n)) || g.adj[a.id].every((n) => sides.has(n))) continue
        const p = shortestPath(g, a.id, b.id, sides)
        expect(p, a.id + ' to ' + b.id).not.toBeNull()
        for (const id of p!) expect(sides.has(id)).toBe(false)
      }
    }
  })

  it('the night shift keeps clear of the desks on its coffee and shelf trips', () => {
    // (work_1 / work_2 sit in the west lane: their only door is their own desk side, so they are left out)
    for (const from of ['work_0', 'work_3', 'work_4', 'coffee', 'shelf']) {
      for (const to of ['coffee', 'shelf']) {
        const p = shortestPath(g, from, to, sides)!
        expect(p.some((id) => sides.has(id))).toBe(false)
      }
    }
  })
})
