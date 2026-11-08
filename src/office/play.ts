// Deterministic play: who does what during free time, from the clock alone. Every visitor computes the same
// scene for the same minute, so the office looks shared without a server. Pure: no three.js, no Date.

export type PlayKind = 'pingpong' | 'boardgame' | 'coffee' | 'sofa' | 'water' | 'books'

interface PlayDef {
  kind: PlayKind
  label: string
  /** spots for the players, in order; a pair activity needs all of them */
  spots: string[]
  pair?: boolean
  weight: number
  /** a point to face instead of the spot's own direction (the plant being watered) */
  face?: { x: number; z: number }
}

export const PLAYS: PlayDef[] = [
  { kind: 'pingpong', label: '탁구', spots: ['pingpong_a', 'pingpong_b'], pair: true, weight: 3 },
  { kind: 'boardgame', label: '보드게임', spots: ['game_a', 'game_b'], pair: true, weight: 3 },
  { kind: 'coffee', label: '커피', spots: ['coffee'], weight: 2 },
  { kind: 'sofa', label: '소파에서 낮잠', spots: ['sofa_0', 'sofa_1', 'sofa_2'], weight: 2 },
  // the big planter in the lounge corner (office_bake.py: (3.15, 2.35)), watered from the lounge aisle
  { kind: 'water', label: '화분 물 주기', spots: ['hall_lounge'], weight: 1, face: { x: 3.15, z: 2.35 } },
  { kind: 'books', label: '책 고르기', spots: ['shelf'], weight: 1 },
]

/**
 * What each agent likes (#28 personalities): a multiplier on an activity's weight. The planner (메모) and the
 * 3D agent (메시) love board games and are bad at ping-pong (they still play, and miss); the coder (루프) loves
 * ping-pong. Anything not listed is 1.
 */
export const LIKES: Record<string, Partial<Record<PlayKind, number>>> = {
  agent_0: { boardgame: 3, pingpong: 0.4 },
  agent_1: { boardgame: 3, pingpong: 0.4 },
  agent_3: { pingpong: 3 },
}
const like = (agent: string, kind: PlayKind) => LIKES[agent]?.[kind] ?? 1

/** activities change every this many minutes (long enough to get there and play a while) */
export const BLOCK_MINUTES = 3

export interface PlayAssignment {
  kind: PlayKind
  label: string
  spot: string
  /** the other player of a pair activity */
  partner?: string
  face?: { x: number; z: number }
}

/** small fast PRNG (mulberry32): same seed, same sequence, in every browser */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over a string: a stable seed from the block number and the roster */
function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const blockOf = (minute: number) => Math.floor(minute / BLOCK_MINUTES)

/**
 * What each free agent plays at this minute.
 *
 * The pairing is drawn for the whole roster, then agents in `busy` (working, gone home) are taken out. That way
 * one agent leaving for its desk doesn't reshuffle everyone else: the others keep their game, and only a
 * player left without a partner switches to something solo.
 *
 * @param minute  whole minutes since the epoch (Math.floor(Date.now() / 60000))
 * @param agents  the roster (order does not matter)
 * @param busy    agents that are not free to play right now
 */
export function playAt(minute: number, agents: string[], busy: ReadonlySet<string> = new Set()): Record<string, PlayAssignment> {
  const roster = [...agents].sort()
  const block = blockOf(minute)
  const rand = rng(hash(`${block}|${roster.join(',')}`))

  // shuffle (Fisher-Yates) so the first pick isn't always the same agent
  const order = [...roster]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }

  const used = new Set<string>() // spots taken
  const taken = new Set<PlayKind>() // pair activities already running (one table each)
  const out: Record<string, PlayAssignment> = {}
  const freeSpot = (p: PlayDef) => p.spots.find((s) => !used.has(s))

  // a pair game is as likely as both players like it
  const weight = (p: PlayDef, agent: string, partner?: string) =>
    p.weight * like(agent, p.kind) * (p.pair && partner ? like(partner, p.kind) : 1)
  const pick = (candidates: PlayDef[], agent: string, partner?: string) => {
    const total = candidates.reduce((sum, p) => sum + weight(p, agent, partner), 0)
    let r = rand() * total
    for (const p of candidates) {
      r -= weight(p, agent, partner)
      if (r < 0) return p
    }
    return candidates[candidates.length - 1]
  }

  const assign = (agent: string, p: PlayDef, spot: string, partner?: string) => {
    used.add(spot)
    out[agent] = { kind: p.kind, label: p.label, spot, ...(partner ? { partner } : {}), ...(p.face ? { face: p.face } : {}) }
  }

  const solos = PLAYS.filter((p) => !p.pair)
  for (let i = 0; i < order.length; i++) {
    const agent = order[i]
    if (out[agent]) continue
    const partner = order.slice(i + 1).find((a) => !out[a])
    const open = PLAYS.filter((p) => (p.pair ? partner && !taken.has(p.kind) : freeSpot(p)))
    const p = pick(open.length ? open : solos, agent, partner)
    if (p.pair && partner) {
      taken.add(p.kind)
      assign(agent, p, p.spots[0], partner)
      assign(partner, p, p.spots[1], agent)
    } else {
      const spot = freeSpot(p)
      if (spot) assign(agent, p, spot)
    }
  }

  // take the busy agents out; a pair player left alone goes to the first solo activity with room
  for (const a of busy) {
    if (out[a]) used.delete(out[a].spot)
    delete out[a]
  }
  for (const a of Object.keys(out).sort()) {
    const as = out[a]
    if (!as.partner || out[as.partner]) continue
    used.delete(as.spot)
    delete out[a]
    const solo = solos.slice(Math.floor(rand() * solos.length)).concat(solos).find((p) => freeSpot(p))
    if (solo) assign(a, solo, freeSpot(solo)!)
  }
  return out
}

/** what the night-duty agent may do: quiet and alone (no pair games, no sofa nap, no ping-pong) */
export const NIGHT_PLAYS: PlayKind[] = ['coffee', 'books']

/** the night-duty agent's solo activity at this minute: same block length as the day schedule, same for every visitor */
export function soloAt(minute: number, agent: string): PlayAssignment {
  const rand = rng(hash(`${blockOf(minute)}|solo|${agent}`))
  const choices = PLAYS.filter((p) => NIGHT_PLAYS.includes(p.kind))
  const p = choices[Math.floor(rand() * choices.length)]
  return { kind: p.kind, label: p.label, spot: p.spots[0], ...(p.face ? { face: p.face } : {}) }
}
