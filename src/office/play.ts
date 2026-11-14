import { ACT_LABEL, ACT_PLACE, type ActKind } from './lounge'
import { WATER_PLANTS, standOf } from './water'

// Deterministic play: who does what during free time, from the clock alone. Every visitor computes the same
// scene for the same minute, so the office looks shared without a server. Pure: no three.js, no Date.

export type PlayKind = 'pingpong' | 'boardgame' | 'boardgame_solo' | 'coffee' | 'sofa' | 'water' | 'books' | ActKind

/** the pose a play is drawn with: placing a game record alone (#137) sits at the board like a game */
export const playPose = (kind: PlayKind): Exclude<PlayKind, 'boardgame_solo'> => (kind === 'boardgame_solo' ? 'boardgame' : kind)

interface PlayDef {
  kind: PlayKind
  label: string
  /** spots for the players, in order; a pair activity needs all of them */
  spots: string[]
  pair?: boolean
  weight: number
  /** a point to face instead of the spot's own direction (the plant being watered) */
  face?: { x: number; z: number }
  /** where to stand instead of the spot's own place (watering: close enough that the stream reaches the soil, #184) */
  stand?: { x: number; z: number }
}

export const PLAYS: PlayDef[] = [
  { kind: 'pingpong', label: '탁구', spots: ['pingpong_a', 'pingpong_b'], pair: true, weight: 3 },
  { kind: 'boardgame', label: '보드게임', spots: ['game_a', 'game_b'], pair: true, weight: 3 },
  // one agent placing a game record alone (#137, play.md 5.5): half the pair game's weight; the other chair stays empty for a visitor ("같이 두기")
  { kind: 'boardgame_solo', label: '기보 놓기', spots: ['game_a'], weight: 1.5 },
  { kind: 'coffee', label: '커피', spots: ['coffee'], weight: 2 },
  // the seats in the order they are taken: the east seat (3, lying, head on the north armrest) before the corner (2, nav `last`: the one chosen last, lounge-props.md 1)
  { kind: 'sofa', label: '소파에서 낮잠', spots: ['sofa_0', 'sofa_1', 'sofa_3', 'sofa_2'], weight: 2 },
  // one of the floor plants (water.ts), chosen per block, watered from its own stand beside the pot
  { kind: 'water', label: '화분 물 주기', spots: ['hall_lounge'], weight: 1 },
  // the lounge acts (#280, lounge.ts): a short errand each, started when the agent has reached its stand; the fridge and the dispenser share the bar's spot, so only one
  // of them is on at a time. The Director runs them like the watering (an act, then back to the desk until the block ends)
  ...(['fridge', 'dispenser', 'record'] as const).map((k): PlayDef => ({ kind: k, label: ACT_LABEL[k], spots: [ACT_PLACE[k].spot], weight: 1, face: ACT_PLACE[k].face, stand: ACT_PLACE[k].stand })),
  // reading (#280, lounge-props.md 3): the book on the low table by the sofa (the model's only book prop) is taken from the stand north of sofa seat 0 (seat 1: the table's east
  // end), read sitting on the sofa and put back; an errand like the watering (readRun.ts), started by the Director when the agent is free, so `stand` / `face` here are only
  // the old standing pick (the grip tests and the debug close-up use them), not where the agent reads. One spot: one reader at a time (there is one book)
  { kind: 'books', label: '책 읽기', spots: ['shelf'], weight: 1, face: { x: 2.85, z: 2.55 }, stand: { x: 2.81, z: 2.88 } },
]

/** what the schedule hands out */
const SCHEDULED = PLAYS

/**
 * What each agent likes (#28 personalities): a multiplier on an activity's weight. The planner (메모) and the
 * 3D agent (메시) love board games and are bad at ping-pong (they still play, and miss); the coder (루프) loves
 * ping-pong. Anything not listed is 1.
 */
export const LIKES: Record<string, Partial<Record<PlayKind, number>>> = {
  agent_0: { boardgame: 3, pingpong: 0.4 },
  agent_1: { boardgame: 3, pingpong: 0.4 },
  agent_3: { pingpong: 3 },
  // echo (#193): drums along to the rally rather than playing it, and likes the click of the omok stones
  agent_4: { boardgame: 2, pingpong: 0.5 },
}
const like = (agent: string, kind: PlayKind) => LIKES[agent]?.[playPose(kind)] ?? 1

/** activities change every this many minutes (long enough to get there and play a while) */
export const BLOCK_MINUTES = 3

export interface PlayAssignment {
  kind: PlayKind
  label: string
  spot: string
  /** the other player of a pair activity */
  partner?: string
  face?: { x: number; z: number }
  stand?: { x: number; z: number }
  /** water: the plant's name (water.ts); the Director runs it as an errand (waterRun.ts, #228) */
  plant?: string
}

/** small fast PRNG (mulberry32): same seed, same sequence, in every browser */
export function rng(seed: number) {
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
export function hash(s: string) {
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
    let plantName: string | undefined
    if (p.kind === 'water') {
      const plant = WATER_PLANTS[hash(`${block}|water|${agent}`) % WATER_PLANTS.length]
      p = { ...p, face: { x: plant.x, z: plant.z }, stand: standOf(plant) }
      plantName = plant.name
    }
    out[agent] = { kind: p.kind, label: p.label, spot, ...(plantName ? { plant: plantName } : {}), ...(partner ? { partner } : {}), ...(p.face ? { face: p.face } : {}), ...(p.stand ? { stand: p.stand } : {}) }
  }

  const solos = SCHEDULED.filter((p) => !p.pair)
  for (let i = 0; i < order.length; i++) {
    const agent = order[i]
    if (out[agent]) continue
    const partner = order.slice(i + 1).find((a) => !out[a])
    // a pair needs all its spots (the board's chair may already hold someone placing a game record alone)
    const open = SCHEDULED.filter((p) => (p.pair ? partner && !taken.has(p.kind) && p.spots.every((s) => !used.has(s)) : freeSpot(p)))
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
export const NIGHT_PLAYS: PlayKind[] = ['coffee']

/** the night-duty agent's solo activity at this minute: same block length as the day schedule, same for every visitor */
export function soloAt(minute: number, agent: string): PlayAssignment {
  const rand = rng(hash(`${blockOf(minute)}|solo|${agent}`))
  const choices = SCHEDULED.filter((p) => NIGHT_PLAYS.includes(p.kind))
  const p = choices[Math.floor(rand() * choices.length)]
  return { kind: p.kind, label: p.label, spot: p.spots[0], ...(p.face ? { face: p.face } : {}), ...(p.stand ? { stand: p.stand } : {}) }
}
