import { describe, expect, it } from 'vitest'
import {
  EDGES,
  buildGraph,
  dist,
  facing,
  patchSpots,
  pathLength,
  routeFromEdge,
  shortestPath,
  type NavKind,
  type NavSpot,
} from './nav'

// the nav_* empties of the 9 x 7 m layout (#109): 34 spots incl. hall_back
const RAW = `bulletin 2.55 -2.6 0 stand; coffee 3.56 -2 -1.5708 stand; desk_side_0 -1.85 -2.52 1.5182 stand; desk_side_1 -0.05 -2.52 1.5182 stand; desk_side_2 -3.59 -2.07 3.089 stand; desk_side_3 -3.59 -0.27 3.089 stand; door -3.95 2.6 1.5708 door; game_a -2.2 2.2 -1.5708 stool; game_b -1 2.2 1.5708 stool; hall_back 2 -1.7 0 hall; hall_door -3.3 2.6 0 hall; hall_east 3.1 -1.3 0 hall; hall_front 0.2 1.3 0 hall; hall_game -1.6 1.2 0 hall; hall_lounge 3.95 1.6 0 hall; hall_mid -1 -0.6 0 hall; hall_ne 4.1 0 0 hall; hall_west -3 1.4 0 hall; hall_work -2.2 -1.5 0 hall; meet_a -1.4 -0.6 -1.5708 meet; meet_b -0.6 -0.6 1.5708 meet; meet_c 0.79 -1.9 -0.7854 meet; meet_d 1.41 -1.9 0.7854 meet; pingpong_a 0.87 0 -1.5708 play; pingpong_b 3.53 0 1.5708 play; shelf 3.75 -2.6 0 stand; sofa_0 1.67 2.55 0 sofa; sofa_1 2.2 2.55 0 sofa; sofa_2 2.73 2.55 0 sofa; whiteboard 1.1 -2.6 0 stand; work_0 -2.8 -2.57 0 work; work_1 -1 -2.57 0 work; work_2 -3.64 -1.12 1.5708 work; work_3 -3.64 0.68 1.5708 work`

const SPOTS: NavSpot[] = RAW.split(';').map((s) => {
  const [id, x, z, ry, kind] = s.trim().split(/\s+/)
  return { id, x: +x, z: +z, ry: +ry, kind: kind as NavKind }
})
const byId = Object.fromEntries(SPOTS.map((s) => [s.id, s]))

const sp = (id: string, x: number, z: number): NavSpot => ({ id, x, z, ry: 0, kind: 'hall' })

describe('real spot list and EDGES', () => {
  it('has 34 spots', () => expect(SPOTS).toHaveLength(34))

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
  it('meet_a and meet_b face each other', () => {
    expect(Math.abs(facing(byId.meet_a, byId.meet_b) - byId.meet_a.ry)).toBeLessThan(1e-3)
    expect(Math.abs(facing(byId.meet_b, byId.meet_a) - byId.meet_b.ry)).toBeLessThan(1e-3)
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
  const sides = new Set(['desk_side_0', 'desk_side_1', 'desk_side_2', 'desk_side_3'])

  it('a quiet route never walks through a desk side', () => {
    for (const a of SPOTS) {
      for (const b of SPOTS) {
        if (sides.has(a.id) || sides.has(b.id)) continue
        const p = shortestPath(g, a.id, b.id, sides)
        expect(p, a.id + ' to ' + b.id).not.toBeNull()
        for (const id of p!) expect(sides.has(id)).toBe(false)
      }
    }
  })

  it('the night shift keeps clear of the desks on its coffee and shelf trips', () => {
    for (const from of ['work_0', 'work_1', 'work_2', 'work_3', 'coffee', 'shelf']) {
      for (const to of ['coffee', 'shelf']) {
        const p = shortestPath(g, from, to, sides)!
        expect(p.some((id) => sides.has(id))).toBe(false)
      }
    }
  })
})
