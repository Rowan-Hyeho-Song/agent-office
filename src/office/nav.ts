// Navigation graph over the glb's nav_* empties (office_bake.py build_nav): agents glide from spot to spot
// along these edges only, so they never teleport and never cross furniture. Pure: no three.js.

export type NavKind = 'work' | 'stand' | 'sofa' | 'stool' | 'play' | 'meet' | 'meet_center' | 'chat' | 'door' | 'hall'

/** one nav_<id> empty: floor position (web meters, y = 0) and the way an agent faces there */
export interface NavSpot {
  id: string
  x: number
  z: number
  ry: number
  kind: NavKind
}

export interface NavGraph {
  spots: Record<string, NavSpot>
  adj: Record<string, string[]>
}

/** five desks (#195 안 2: a pod of five); the fifth has no agent yet (echo, #193 2/2) */
const desks = [0, 1, 2, 3, 4]

/**
 * The aisles. Every edge was checked against the baked furniture (?debug=1 casts rays along each one and
 * draws a blocked edge red). Spots on furniture (sofa, stools) are entered from the open side only.
 */
export const EDGES: [string, string][] = [
  // work pod (#195 안 2): two rows back to back, x -3.01 (seats 1, 2, facing east) and x -2.39 (seats 3, 4, facing west), the memo head
  // desk 0 at the north end under the window. The west row sits in a 0.7 m lane along the wall: its two ends open to the north / south
  // and nobody passes a seated agent there, so work_1 leaves south, work_2 north: each seat's door is its desk side (#110: a quiet route
  // never walks through a side, so those two seats are only reachable through theirs).
  ['work_0', 'desk_side_0'],
  ['work_0', 'chat_0'],
  ['work_1', 'desk_side_1'],
  ['work_2', 'desk_side_2'],
  ['desk_side_2', 'desk_side_0'],
  ['desk_side_0', 'chat_0'],
  ['desk_side_1', 'hall_west'],
  ['work_3', 'hall_work'],
  ['work_4', 'hall_mid'],
  ['desk_side_3', 'hall_work'],
  ['desk_side_4', 'hall_mid'],
  ['desk_side_4', 'hall_game'],
  ['hall_north', 'hall_work'],
  ['hall_work', 'hall_mid'],
  // north lane along the window: the second talk place (chat_0, chat_1 face each other) and the way to the whiteboard
  ['hall_north', 'chat_0'],
  ['hall_north', 'chat_1'],
  ['hall_north', 'whiteboard'],
  // the marker tray stand (#228): within reach of the markers on the whiteboard's tray
  ['board_tray', 'whiteboard'],
  ['board_tray', 'hall_north'],
  ['board_tray', 'chat_1'],
  // left front: door, board game
  ['hall_west', 'hall_door'],
  ['hall_west', 'game_a'],
  ['hall_west', 'hall_game'],
  ['hall_door', 'door'],
  ['hall_game', 'hall_front'],
  ['hall_game', 'hall_mid'],
  // middle: the meeting circle (#195: one circle; its talk seats hang off the centre, meetSeats), whiteboard
  ['hall_mid', 'meet_center'],
  ['meet_center', 'whiteboard'],
  ['meet_center', 'hall_back'],
  ['hall_mid', 'whiteboard'],
  ['hall_mid', 'hall_back'],
  ['hall_mid', 'hall_front'],
  ['hall_mid', 'pingpong_a'],
  // back right: bulletin, shelf, coffee
  ['hall_back', 'whiteboard'],
  ['hall_back', 'bulletin'],
  ['hall_back', 'shelf'],
  ['hall_back', 'hall_east'],
  ['bulletin', 'shelf'],
  ['hall_east', 'shelf'],
  ['hall_east', 'coffee'],
  ['hall_east', 'hall_ne'],
  // lounge (the front aisle hall_front - hall_lounge runs below the ping-pong table)
  ['hall_front', 'pingpong_a'],
  ['hall_front', 'game_b'],
  ['hall_front', 'sofa_0'],
  // (no hall_front–sofa_1: the ray crosses the sofa / side table; sofa_1 is reached via sofa_0 or sofa_2)
  ['hall_front', 'hall_lounge'],
  ['sofa_0', 'sofa_1'],
  ['sofa_1', 'sofa_2'],
  ['hall_lounge', 'sofa_2'],
  ['hall_lounge', 'pingpong_b'],
  ['hall_lounge', 'hall_ne'],
  ['hall_ne', 'pingpong_b'],
]

/**
 * Move or add spots: `id:x:z[:ry[:kind]]`, comma separated (ry defaults to the old value or 0, kind to the old
 * kind or "hall"). Used by ?debug=1&nav=… to try a spot with the ray test before it is baked into the model.
 */
export function patchSpots(spots: NavSpot[], spec: string): NavSpot[] {
  if (!spec) return spots
  const byId = new Map(spots.map((s) => [s.id, s]))
  for (const item of spec.split(',')) {
    const [id, x, z, ry, kind] = item.split(':')
    const old = byId.get(id)
    byId.set(id, {
      id,
      x: Number(x),
      z: Number(z),
      ry: ry !== undefined && ry !== '' ? Number(ry) : (old?.ry ?? 0),
      kind: (kind as NavKind) || old?.kind || 'hall',
    })
  }
  return [...byId.values()]
}

/** how far from the meeting centre its talk seats stand (inside the furniture-free circle; 1.0 m apart like the chat spots) */
export const MEET_SEAT_R = 0.5
/** a seat closer than this to another destination is left out (two bodies of R 0.3 m) */
const SEAT_CLEAR = 0.6
/** seat order around a centre, in floor angle (x = cos, z = sin) with the board direction at -z: left, right (two face each other), front (+z), back */
const SEAT_ANGLES = [Math.PI, 0, Math.PI / 2, -Math.PI / 2]

/**
 * The talk seats of the meeting circle (nav_meet_center): meet_talk_0.. at MEET_SEAT_R round the centre, turned with the centre's own ry
 * (the way to the whiteboard). The first two face each other across the centre (±90° from the board line), a third and fourth close the
 * circle; every seat faces the centre. A seat that would stand on another destination is skipped. This is the first talk place; the
 * second is the pair of chat spots by the window (desks.md 2.1.2: one circle never holds two pairs).
 */
export function meetSeats(center: NavSpot, others: NavSpot[]): NavSpot[] {
  const out: NavSpot[] = []
  for (const a0 of SEAT_ANGLES) {
    const a = a0 - center.ry
    const p = { x: center.x + Math.cos(a) * MEET_SEAT_R, z: center.z + Math.sin(a) * MEET_SEAT_R }
    // only destinations count (an aisle point, which may share the floor centre, is never stood on)
    if (others.some((o) => o.kind !== 'meet_center' && o.kind !== 'hall' && dist(o, p) < SEAT_CLEAR)) continue
    out.push({ id: `meet_talk_${out.length}`, ...p, ry: facing(p, center), kind: 'meet' })
  }
  return out
}

export function buildGraph(spots: NavSpot[], edges: [string, string][] = EDGES): NavGraph {
  // every talk circle brings its seats, each joined to the centre
  const seats = spots.filter((s) => s.kind === 'meet_center').flatMap((c) => meetSeats(c, spots).map((s) => ({ s, c: c.id })))
  spots = [...spots, ...seats.map(({ s }) => s)]
  edges = [...edges, ...seats.map(({ s, c }): [string, string] => [s.id, c])]
  const byId: Record<string, NavSpot> = {}
  for (const s of spots) byId[s.id] = s
  const adj: Record<string, string[]> = {}
  for (const s of spots) adj[s.id] = []
  for (const [a, b] of edges) {
    if (!byId[a] || !byId[b]) continue // a spot missing from this model: skip its edges
    adj[a].push(b)
    adj[b].push(a)
  }
  return { spots: byId, adj }
}

/** the spots beside the desks: standing there reads as waking the sleeper */
export const DESK_SIDES: ReadonlySet<string> = new Set(desks.map((i) => `desk_side_${i}`))

export const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Dijkstra over the spot graph: the spot ids from `from` to `to` (both included), or null if unreachable.
 * `blocked` spots are not walked through (#110: the night-duty agent keeps clear of the sleepers' desk sides).
 */
export function shortestPath(g: NavGraph, from: string, to: string, blocked?: ReadonlySet<string>): string[] | null {
  if (!g.spots[from] || !g.spots[to]) return null
  if (from === to) return [from]
  const best: Record<string, number> = { [from]: 0 }
  const prev: Record<string, string> = {}
  const done = new Set<string>()
  // the graph has ~30 nodes: a linear scan for the next node is simpler than a heap and fast enough
  for (;;) {
    let cur: string | null = null
    for (const id in best) if (!done.has(id) && (cur === null || best[id] < best[cur])) cur = id
    if (cur === null) return null
    if (cur === to) break
    done.add(cur)
    for (const n of g.adj[cur]) {
      if (blocked?.has(n) && n !== to) continue // never pass through a blocked spot (the ends are always allowed)
      const d = best[cur] + dist(g.spots[cur], g.spots[n])
      if (best[n] === undefined || d < best[n]) {
        best[n] = d
        prev[n] = cur
      }
    }
  }
  const path = [to]
  while (path[0] !== from) path.unshift(prev[path[0]])
  return path
}

export function pathLength(g: NavGraph, path: string[]): number {
  let len = 0
  for (let i = 1; i < path.length; i++) len += dist(g.spots[path[i - 1]], g.spots[path[i]])
  return len
}

/**
 * Route from a point on the edge a-b (an agent caught mid-glide) to `to`: back to a or on to b, whichever is
 * shorter overall. Both legs stay on the edge, so a change of plan never cuts across the floor.
 */
export function routeFromEdge(
  g: NavGraph,
  pos: { x: number; z: number },
  a: string,
  b: string,
  to: string,
  blocked?: ReadonlySet<string>,
): string[] | null {
  let best: string[] | null = null
  let bestLen = Infinity
  for (const via of [a, b]) {
    const p = shortestPath(g, via, to, blocked)
    if (!p) continue
    const len = dist(pos, g.spots[via]) + pathLength(g, p)
    if (len < bestLen) {
      best = p
      bestLen = len
    }
  }
  return best
}

/** ry that turns an agent's forward (local -z) from `from` toward `to` (same convention as the nav extras) */
export const facing = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.atan2(-(to.x - from.x), -(to.z - from.z))
