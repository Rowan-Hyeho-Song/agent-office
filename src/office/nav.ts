// Navigation graph over the glb's nav_* empties (office_bake.py build_nav): agents glide from spot to spot
// along these edges only, so they never teleport and never cross furniture. Pure: no three.js.

export type NavKind = 'work' | 'stand' | 'sofa' | 'stool' | 'play' | 'meet' | 'door' | 'hall'

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

const desks = [0, 1, 2, 3]

/**
 * The aisles. Every edge was checked against the baked furniture (?debug=1 casts rays along each one and
 * draws a blocked edge red). Spots on furniture (sofa, stools) are entered from the open side only.
 */
export const EDGES: [string, string][] = [
  // work corner: seats and desk sides hang off the work aisle; the far seats share the west aisle
  ...desks.flatMap((i): [string, string][] => [[`work_${i}`, 'hall_work']]),
  ['work_3', 'hall_west'],
  ['desk_side_0', 'hall_work'],
  ['desk_side_1', 'hall_mid'],
  ['desk_side_1', 'meet_c'],
  ['desk_side_2', 'hall_work'],
  ['desk_side_2', 'desk_side_3'],
  ['desk_side_3', 'hall_west'],
  ['hall_work', 'hall_mid'],
  ['hall_work', 'hall_west'],
  // left side: coffee counter, door, board game (passed on the open side, below the table)
  ['hall_west', 'coffee'],
  ['hall_west', 'hall_door'],
  ['hall_west', 'game_a'],
  ['hall_west', 'hall_game'],
  ['hall_game', 'hall_front'],
  ['hall_game', 'hall_mid'],
  ['coffee', 'hall_door'],
  ['hall_door', 'door'],
  // middle: talk spots and the wall (whiteboard, bulletin, shelf)
  ['hall_mid', 'meet_a'],
  ['hall_mid', 'meet_b'],
  ['meet_a', 'meet_b'],
  ['hall_mid', 'meet_c'],
  ['hall_mid', 'meet_d'],
  ['meet_c', 'meet_d'],
  ['meet_c', 'whiteboard'],
  ['meet_d', 'whiteboard'],
  ['hall_mid', 'whiteboard'],
  ['hall_mid', 'hall_east'],
  ['hall_mid', 'hall_front'],
  ['hall_mid', 'pingpong_a'],
  ['hall_east', 'bulletin'],
  ['hall_east', 'shelf'],
  ['hall_east', 'meet_d'],
  ['bulletin', 'shelf'],
  // lounge: ping-pong, sofa, board game. The far end of the sofa is reached along the seat (the ping-pong
  // table blocks it from the front), and the lounge corner only around the table's back side.
  ['hall_front', 'pingpong_a'],
  ['hall_front', 'game_b'],
  ['hall_front', 'sofa_0'],
  ['hall_front', 'sofa_1'],
  ['sofa_1', 'sofa_2'],
  ['hall_lounge', 'pingpong_b'],
  ['hall_east', 'hall_ne'],
  ['hall_ne', 'pingpong_b'],
  ['hall_ne', 'shelf'],
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

export function buildGraph(spots: NavSpot[], edges: [string, string][] = EDGES): NavGraph {
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
