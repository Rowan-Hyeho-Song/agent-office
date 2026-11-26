import { ACT_LABEL, ACT_PLACE, type ActKind } from './lounge'
import { WATER_PLANTS, standOf } from './water'
import { SPOTS } from './navSpots.fixture'

// Deterministic play: who does what during free time, from the clock alone. Every visitor computes the same
// scene for the same minute, so the office looks shared without a server. Pure: no three.js, no Date.

export type PlayKind = 'pingpong' | 'boardgame' | 'boardgame_solo' | 'coffee' | 'sofa' | 'water' | 'books' | ActKind

/** the hologram board games that share the one table (hologram.md 10.2) */
export type BoardGameKind = 'omok' | 'chess' | 'alkkagi'

/**
 * Which game the empty table gets, by weight (hologram.md 10.2): omok 4 · chess 4 · alkkagi 2 (#605 turned alkkagi on).
 */
export const GAME_WEIGHTS: Record<BoardGameKind, number> = { omok: 4, chess: 4, alkkagi: 2 }

/** the game for the table's first occupant(s), from a seed string (the day, the time, who sits down): the same in every browser */
export function chooseGame(seed: string): BoardGameKind {
  const kinds = Object.keys(GAME_WEIGHTS) as BoardGameKind[]
  const total = kinds.reduce((a, k) => a + GAME_WEIGHTS[k], 0)
  let r = rng(hash(`game|${seed}`))() * total
  for (const k of kinds) if ((r -= GAME_WEIGHTS[k]) < 0) return k
  return 'omok'
}

/** what a board game is called as a pair, as a record / practice alone, and watched (hologram.md 10.2) */
export const BOARD_LABEL: Record<BoardGameKind, { pair: string; solo: string; watch: string }> = {
  omok: { pair: '오목', solo: '기보 놓기', watch: '오목 구경' },
  chess: { pair: '체스', solo: '체스 문제 풀기', watch: '체스 구경' },
  alkkagi: { pair: '알까기', solo: '알까기 연습', watch: '알까기 구경' },
}

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

/** FNV-1a over a string: a stable seed (the day and the roster, a game, a stay) */
export function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}


// ---- each agent's own schedule (#490, docs/design/play.md 9) -------------------------------------------------------------
// No blocks: every agent has its own run of stays (a play for a while), each followed by a short gap (a stretch, a stroll, a look out of the
// window) and the next stay. The whole roster's day is laid out once from KST 04:00 (everybody asleep then: nobody is seen to change at the
// seam) as if nobody were busy; who is working or gone home is taken out on top, so one agent called to its desk moves nobody else.

const MIN = 60_000
/** how long a stay at each play lasts, minutes (play.md 9.1); the errands are about as long as the errand itself */
export const STAY_MIN: Record<PlayKind | 'watch', readonly [number, number]> = {
  pingpong: [4, 8],
  boardgame: [6, 12],
  boardgame_solo: [4, 8],
  coffee: [3, 6],
  sofa: [8, 20],
  books: [6, 14],
  water: [1, 1.5],
  fridge: [0.75, 1],
  dispenser: [0.5, 0.75],
  record: [0.75, 1],
  watch: [1, 3],
}
/** how long a board game stays, minutes, per game (hologram.md 10.2); omok is STAY_MIN.boardgame / boardgame_solo */
export const BOARD_STAY: Record<BoardGameKind, { pair: readonly [number, number]; solo: readonly [number, number] }> = {
  omok: { pair: STAY_MIN.boardgame, solo: STAY_MIN.boardgame_solo },
  chess: { pair: [8, 14], solo: [4, 8] },
  alkkagi: { pair: [4, 8], solo: [3, 6] },
}
/** a play's stay range, minutes; the board games by their game */
export const stayRange = (kind: PlayKind | 'watch', game?: BoardGameKind): readonly [number, number] =>
  game && kind === 'boardgame' ? BOARD_STAY[game].pair : game && kind === 'boardgame_solo' ? BOARD_STAY[game].solo : STAY_MIN[kind]
/** a game is watched only with this much of it left, and the watcher goes this long before it ends (play.md 9.2 구경, #517) */
export const WATCH_LEFT_MS = 2 * MIN
export const WATCH_LEAVE_MS = MIN
/** the gap between two stays (play.md 9.3), s */
export const GAP_S: readonly [number, number] = [20, 50]
export type GapKind = 'stretch' | 'wander' | 'window' | 'spines'
export const GAP_LABEL: Record<GapKind, string> = { stretch: '쉬는 중 · 기지개', wander: '쉬는 중 · 서성이는 중', window: '쉬는 중 · 창밖 보는 중', spines: '쉬는 중 · 책등 보는 중' }
/** a pair's partner is whoever finishes its stay or gap first within this long after a pair game is drawn; the one that drew it goes on with its gap till then (play.md 9.2 ②, #516) */
export const PAIR_SOON_MS = 30_000
/** at most this many agents leave their play in any one minute; a stay is stretched up to EXTEND_MAX_MS to keep to it (play.md 9.4) */
export const LEAVE_CAP = 2
export const LEAVE_WINDOW_MS = MIN
export const EXTEND_MAX_MS = 2 * MIN
/** a stroll goes to a hall spot this far from where the agent is (m) */
const WANDER_M: readonly [number, number] = [1.5, 4]
/** the hall spots by the window (north wall), and where they look */
const WINDOW_SPOTS = ['hall_north', 'hall_memo_back']
const WINDOW_FACE_Z = -4.2
/** where a watcher stands by each table, and the table's middle it looks at (play.md 9.2 구경) */
export const WATCH: Record<'pingpong' | 'boardgame', { spot: string; face: { x: number; z: number }; label: string }> = {
  pingpong: { spot: 'hall_back', face: { x: 1.6, z: 0.7 }, label: '탁구 구경' },
  boardgame: { spot: 'hall_game', face: { x: -1.9, z: 2.4 }, label: '오목 구경' },
}
/** where a play happens in the room (the walk to a stroll's spot is measured from here; the errands are run from the agent's desk) */
const DESK = 'desk'

export interface PlayAssignment {
  kind: PlayKind | 'gap' | 'watch'
  label: string
  spot: string
  /** this stay (or gap) and no other: the Director's errands count "done" per stay */
  stay: number
  /** when it began and when it ends (ms) */
  since: number
  until: number
  /** the other player of a pair activity */
  partner?: string
  face?: { x: number; z: number }
  stand?: { x: number; z: number }
  /** water: the plant's name (water.ts); the Director runs it as an errand (waterRun.ts, #228) */
  plant?: string
  gap?: GapKind
  /** a watcher: the table it watches */
  watch?: 'pingpong' | 'boardgame'
  /** a pair game: when both players are there (the first one waits until then: 기보 놓기 at the board, the ball at the table) */
  pairAt?: number
  /** the board game (boardgame, boardgame_solo, or the one a watcher watches) */
  game?: BoardGameKind
  /** #718 (play.md 9.7 ②): a face shown once as this begins (a watcher whose game broke: 의문 for 1 s); `key` says which time */
  cue?: { expr: 'question'; key: string; dur: number }
}

/** one stretch of an agent's day in the plan */
export interface Seg {
  kind: PlayKind | 'gap' | 'watch'
  start: number
  end: number
  /** the play's spot (DESK for an errand: it is run from the desk) */
  spot: string
  stay: number
  partner?: string
  pairAt?: number
  gap?: GapKind
  watch?: 'pingpong' | 'boardgame'
  plant?: string
  /** the board game of a boardgame / boardgame_solo stay, or of the one a watcher watches */
  game?: BoardGameKind
  /** a record placed alone cut short by a partner sitting down opposite (play.md 9.2 ①): the game they start is a stay of its own */
  joined?: boolean
}

const KST_MS = 9 * 60 * MIN
const DAY_MS = 24 * 60 * MIN
const DAY_START_MS = 4 * 60 * MIN
/** the plan's day for a time: the KST day that began at 04:00, and that moment (ms since the epoch) */
export function planDay(ms: number): { day: number; start: number } {
  const day = Math.floor((ms + KST_MS - DAY_START_MS) / DAY_MS)
  return { day, start: day * DAY_MS + DAY_START_MS - KST_MS }
}

/** where the nav spots are (the baked layout, navSpots.fixture.ts, generated from office.glb): a stroll picks a hall spot by its distance */
const spotsAt: Record<string, { x: number; z: number }> = Object.fromEntries(SPOTS.map((s) => [s.id, { x: s.x, z: s.z }]))

const plans = new Map<string, Seg[][]>()

/** an agent's spot in the room: a desk errand is at its desk */
const placeOf = (agent: string, spot: string) => spotsAt[spot === DESK ? `work_${agent.split('_')[1]}` : spot]

/**
 * The whole roster's day (play.md 9.5), as if nobody were busy: each agent's segments in time order. Same day, same roster: same plan, in
 * every browser. Built once per day (about 150 changes for five agents).
 */
export function dayPlan(day: number, agents: readonly string[]): Seg[][] {
  const roster = [...agents].sort()
  const key = `${day}|${roster.join(',')}`
  const known = plans.get(key)
  if (known) return known
  const rand = rng(hash(key))
  const start = day * DAY_MS + DAY_START_MS - KST_MS
  const end = start + DAY_MS
  const segs: Seg[][] = roster.map(() => [])
  const leaves: number[] = []
  const held: { spot: string; from: number; to: number }[] = []
  let stays = 0
  const nextStay = () => day * 100_000 + ++stays
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
  const free = (spot: string, from: number, to: number) => spot === DESK || !held.some((h) => h.spot === spot && h.from < to && from < h.to)
  const hold = (spot: string, from: number, to: number) => spot !== DESK && held.push({ spot, from, to })
  /**
   * The first end at or after `at` (within EXTEND_MAX_MS) that keeps every minute to LEAVE_CAP leavers, with `n` leaving together; else an earlier one down to
   * `earliest` (the play's minimum); null when none fits (the play is not chosen then: the cap always holds)
   */
  const capEnd = (at: number, n: number, earliest = at, latest = at + EXTEND_MAX_MS): number | null => {
    const fits = (t: number) => leaves.filter((x) => Math.abs(x - t) < LEAVE_WINDOW_MS).length + n <= LEAVE_CAP
    for (let t = at; t <= latest; t += 1000) if (fits(t)) return t
    for (let t = at - 1000; t >= earliest; t -= 1000) if (fits(t)) return t
    return null
  }
  const leave = (at: number, n: number) => {
    for (let k = 0; k < n; k++) leaves.push(at)
  }
  /** a leaving given back (a stay that ends otherwise now) */
  const unleave = (at: number) => {
    const j = leaves.indexOf(at)
    if (j >= 0) leaves.splice(j, 1)
  }
  /** a place held from `from` to `to` now held to `until` instead */
  const rehold = (spot: string, from: number, to: number, until: number) => {
    const h = held.find((x) => x.spot === spot && x.from === from && x.to === to)
    if (h) h.to = until
  }
  const stayMs = (k: PlayKind | 'watch', game?: BoardGameKind) => {
    const [lo, hi] = stayRange(k, game)
    return between(lo, hi) * MIN
  }
  const lastStay = (i: number) => [...segs[i]].reverse().find((s) => s.kind !== 'gap')
  /** the last play that counts for "never the same play twice": not a gap, watching or a short errand (#524) */
  const lastPlay = (i: number) => [...segs[i]].reverse().find((s) => !['gap', 'watch', 'water', 'fridge', 'dispenser', 'record'].includes(s.kind))
  /** the partner of its last pair game */
  const lastPartner = (i: number) => [...segs[i]].reverse().find((s) => s.partner)?.partner
  // the sofa's middle seat (1) and its corner (2) are never both taken: the corner is reached, and left, in front of the middle one, and nobody passes a
  // body resting there (traffic.ts seat pass); one of them, the west seat and the east one is the most the row holds
  const BESIDE: Record<string, string> = { sofa_1: 'sofa_2', sofa_2: 'sofa_1' }
  const spotOfDef = (p: PlayDef, from: number, to: number) => p.spots.find((s) => free(s, from, to) && (!BESIDE[s] || free(BESIDE[s], from, to)))
  /** a promised partner comes straight to the pair when its own stay ends */
  const invites = new Map<number, Seg>()

  const pick = <T,>(items: T[], w: (t: T) => number): T | undefined => {
    const total = items.reduce((a, t) => a + w(t), 0)
    if (total <= 0) return undefined
    let r = rand() * total
    for (const t of items) if ((r -= w(t)) < 0) return t
    return items[items.length - 1]
  }

  /** a solo stay of `p` for agent i from `t` (or the end of a stay already under way at the day's start) */
  const soloStay = (i: number, p: PlayDef, t: number, phase = 0): Seg | null => {
    const a = roster[i]
    // a record / practice alone: the game is chosen first (the empty table's first occupant), then the stay by the game
    const game = p.kind === 'boardgame_solo' ? chooseGame(`${key}|${t}|${a}|${stays + 1}`) : undefined
    const len = stayMs(p.kind, game)
    const from = t - len * phase
    const errand = p.kind === 'water' || isErrand(p.kind)
    const spot = errand ? DESK : spotOfDef(p, t, from + len)
    if (!spot) return null
    const e = capEnd(from + len, 1, Math.max(t + 1000, from + stayRange(p.kind, game)[0] * MIN))
    if (e === null) return null
    hold(spot, t, e)
    leave(e, 1)
    const plant = p.kind === 'water' ? WATER_PLANTS[hash(`${key}|water|${a}|${stays + 1}`) % WATER_PLANTS.length].name : undefined
    return { kind: p.kind, start: t, end: e, spot: errand ? DESK : spot, stay: nextStay(), ...(plant ? { plant } : {}), ...(game ? { game } : {}) }
  }

  // the day's start: everybody is somewhere in a solo stay, so the ends are spread out (play.md 9.4)
  const solos = SCHEDULED.filter((p) => !p.pair)
  const order = roster.map((_, i) => i).sort(() => rand() - 0.5)
  for (const i of order) {
    let first: Seg | null = null
    const left = [...solos]
    while (!first && left.length) {
      const p = pick(left, (q) => q.weight * like(roster[i], q.kind) * (spotOfDef(q, start, start + 1) || isErrand(q.kind) || q.kind === 'water' ? 1 : 0))
      if (!p) break
      left.splice(left.indexOf(p), 1)
      first = soloStay(i, p, start, rand())
    }
    segs[i].push(first ?? { kind: 'gap', gap: 'stretch', start, end: start + 30_000, spot: DESK, stay: nextStay() })
  }

  const endOf = (i: number) => segs[i][segs[i].length - 1].end
  type Option = { p?: PlayDef; pair?: boolean; watch?: 'pingpong' | 'boardgame' }
  const PAIRS = SCHEDULED.filter((p) => p.pair)
  const GAME = PLAYS.find((p) => p.kind === 'boardgame')!
  const RECORD = PLAYS.find((p) => p.kind === 'boardgame_solo')!
  /** the same play for "never twice in a row": the board games (omok, chess, alkkagi; pair or alone) are one play (hologram.md 10.2) */
  const samePlay = (x: PlayKind, y: PlayKind | 'gap' | 'watch' | undefined) => y !== undefined && y !== 'gap' && y !== 'watch' && playPose(x) === playPose(y)
  const atBoard = (k: PlayKind | 'gap' | 'watch' | undefined) => k === 'boardgame' || k === 'boardgame_solo'
  /**
   * A pair game drawn by agent i at t, in its gap `gap` (play.md 9.2, #516): ① sit down opposite one placing a record alone; ② a partner whose stay or gap ends
   * within PAIR_SOON_MS: a free table by weight, this one going on with its gap till then and both setting off together; ③ no partner: no ping-pong, the board
   * for a record placed alone if it is free. False when none of these: the solo plays are drawn again.
   */
  const pairUp = (i: number, t: number, gap: Seg): boolean => {
    const a = roster[i]
    const before = lastPlay(i)?.kind
    // the same two as in the last pair game only when nobody else would do (#524)
    const again = (k: number) => lastPartner(i) === roster[k] || lastPartner(k) === a
    // ① one at the board alone: the record is swept up and a game starts for both, the board's own length from now; they leave together
    const join = (k: number): boolean => {
      const solo = segs[k][segs[k].length - 1]
      // the partner joins the game that is on (hologram.md 10.2)
      const game = solo.game ?? 'omok'
      if (atBoard(before) || !free(GAME.spots[1], t, t + stayRange('boardgame', game)[0] * MIN)) return false
      unleave(solo.end)
      const e = capEnd(t + stayMs('boardgame', game), 2, t + stayRange('boardgame', game)[0] * MIN)
      if (e === null) {
        leave(solo.end, 1)
        return false
      }
      rehold(solo.spot, solo.start, solo.end, e)
      solo.end = t
      solo.joined = true
      hold(GAME.spots[1], t, e)
      leave(e, 2)
      const stay = nextStay()
      segs[k].push({ kind: 'boardgame', start: t, end: e, spot: GAME.spots[0], stay, partner: a, pairAt: t, game })
      segs[i].push({ kind: 'boardgame', start: t, end: e, spot: GAME.spots[1], stay, partner: roster[k], pairAt: t, game })
      return true
    }
    // ② a partner free within PAIR_SOON_MS (its stay or its gap ends): a free table by weight, not what either played last
    const soon = (k: number): boolean => {
      const at = endOf(k)
      const tables = PAIRS.filter((p) => !samePlay(p.kind, before) && !samePlay(p.kind, lastPlay(k)?.kind) && p.spots.every((s) => free(s, at, at + STAY_MIN[p.kind][0] * MIN)))
      const p = pick(tables, (q) => q.weight * like(a, q.kind) * like(roster[k], q.kind))
      // a table for the board: the game is chosen first, then the stay by the game
      const game = p?.kind === 'boardgame' ? chooseGame(`${key}|${at}|${a}|${roster[k]}`) : undefined
      const e = p ? capEnd(at + stayMs(p.kind, game), 2, at + stayRange(p.kind, game)[0] * MIN) : null
      if (!p || e === null || !free(gap.spot, gap.end, at)) return false
      // this one's gap goes on till the partner is free; both walk to the table from then (the wait there is only the difference of the walks)
      rehold(gap.spot, gap.start, gap.end, at)
      gap.end = at
      hold(p.spots[0], at, e)
      hold(p.spots[1], at, e)
      leave(e, 2)
      const stay = nextStay()
      segs[i].push({ kind: p.kind, start: at, end: e, spot: p.spots[0], stay, partner: roster[k], pairAt: at, ...(game ? { game } : {}) })
      invites.set(k, { kind: p.kind, start: at, end: e, spot: p.spots[1], stay, partner: a, pairAt: at, ...(game ? { game } : {}) })
      return true
    }
    const alone = roster.findIndex((_, x) => x !== i && !invites.has(x) && segs[x][segs[x].length - 1].kind === 'boardgame_solo' && segs[x][segs[x].length - 1].start < t && endOf(x) > t)
    const soonest = roster
      .map((_, x) => x)
      .filter((x) => x !== i && !invites.has(x) && endOf(x) >= t && endOf(x) <= t + PAIR_SOON_MS)
      .sort((x, y) => endOf(x) - endOf(y))
    // somebody new: the board, then the first one free; never the last game's partner again (#524: the two would go from game to game together; a record
    // placed alone or a solo play instead)
    if (alone >= 0 && !again(alone) && join(alone)) return true
    for (const k of soonest) if (!again(k) && soon(k)) return true
    // ③ nobody to play with: no ping-pong; a record placed alone if the board is free (another may sit down opposite, ①)
    if (atBoard(before)) return false
    const one = soloStay(i, RECORD, t)
    if (!one) return false
    segs[i].push(one)
    return true
  }
  /** a stay for agent i from t on this option, if it keeps the leaving cap */
  const tryOption = (i: number, t: number, o: Option): boolean => {
    if (o.watch) {
      // at most the watch's own length, and gone WATCH_LEAVE_MS before the game ends (#517: no clapping at an empty table, not leaving with the players)
      const game = segs.flat().find((x) => x.kind === o.watch && x.partner && x.pairAt !== undefined && x.pairAt <= t && x.end > t)!
      const last = game.end - WATCH_LEAVE_MS
      const e = capEnd(Math.min(last, t + stayMs('watch')), 1, t + STAY_MIN.watch[0] * MIN, last)
      if (e === null) return false
      hold(WATCH[o.watch].spot, t, e)
      leave(e, 1)
      segs[i].push({ kind: 'watch', watch: o.watch, start: t, end: e, spot: WATCH[o.watch].spot, stay: nextStay(), ...(game.game ? { game: game.game } : {}) })
      return true
    }
    const one = soloStay(i, o.p!, t)
    if (!one) return false
    segs[i].push(one)
    return true
  }
  for (;;) {
    let i = -1
    for (let k = 0; k < roster.length; k++) if (endOf(k) < end && (i < 0 || endOf(k) < endOf(i))) i = k
    if (i < 0) break
    const a = roster[i]
    const t = endOf(i)
    const done = segs[i][segs[i].length - 1]
    // a promised pair: straight there when its stay or its gap ends (no gap of its own)
    const inv = invites.get(i)
    if (inv) {
      invites.delete(i)
      segs[i].push({ ...inv, start: t })
      continue
    }
    if (done.kind !== 'gap') {
      // the gap (play.md 9.3): not the same as the last one
      const last = [...segs[i]].reverse().find((s) => s.kind === 'gap')?.gap
      const len = between(GAP_S[0], GAP_S[1]) * 1000
      // an errand was run from where the agent stood and ends at its own place (#517)
      const errandPlace = done.spot === DESK ? PLAYS.find((p) => p.kind === done.kind)?.spots[0] : undefined
      const here = errandPlace ? spotsAt[errandPlace] : placeOf(a, done.spot)
      // the kinds other than the last one, in a seeded order; the first that has a place (a stretch is where the agent is)
      // off the sofa the gap moves away: a stretch standing at the seat would close the knee row for whoever goes to the next seat (traffic.day: waits over 60 s)
      const seated = done.kind === 'sofa'
      // no stretch after an errand either: it would be a walk back to where the errand was (#525)
      const kinds = (['stretch', 'wander', 'window'] as const).filter((g) => g !== last && !((seated || done.spot === DESK) && g === 'stretch'))
      if (rand() < 0.5) kinds.reverse()
      const placeFor = (g: GapKind): string | null => {
        // a stretch where it is, if nobody's next play is there (#525)
        if (g === 'stretch') return done.spot !== DESK && free(done.spot, t, t + len) ? done.spot : null
        if (g === 'window') return WINDOW_SPOTS.find((s) => free(s, t, t + len)) ?? null
        const open = Object.keys(spotsAt).filter((s) => s.startsWith('hall_') && here && free(s, t, t + len))
        const dist = (s: string) => Math.hypot(spotsAt[s].x - here!.x, spotsAt[s].z - here!.z)
        const near = open.filter((s) => dist(s) >= WANDER_M[0] && dist(s) <= WANDER_M[1])
        if (near.length) return near[Math.floor(rand() * near.length)]
        // none that close: the nearest one further off (the same gap twice in a row reads as standing about)
        const far = open.filter((s) => dist(s) > WANDER_M[1]).sort((x, y) => dist(x) - dist(y))
        return far[0] ?? null
      }
      let g: GapKind = kinds[0]
      let spot = placeFor(g)
      if (spot === null && kinds[1]) {
        g = kinds[1]
        spot = placeFor(g)
      }
      // off the sofa with nowhere else free: the last kind again rather than standing in the knee row
      if (spot === null && seated && last && last !== 'stretch') {
        g = last
        spot = placeFor(g)
      }
      if (spot === null) {
        // nowhere free: where it is (after an errand: the errand's place, looking round there rather than a stretch)
        g = errandPlace ? 'wander' : 'stretch'
        spot = errandPlace ?? done.spot
      }
      hold(spot, t, t + len)
      segs[i].push({ kind: 'gap', gap: g, start: t, end: t + len, spot, stay: nextStay() })
      continue
    }
    // the next stay: not the play just done; a pair game (who with and where: pairUp); watching a pair game under way
    const before = lastPlay(i)?.kind
    const prev = lastStay(i)?.kind
    const options: Option[] = []
    for (const p of SCHEDULED) {
      if (samePlay(p.kind, before) || samePlay(p.kind, prev)) continue
      if (p.pair) options.push({ p, pair: true })
      else if (isErrand(p.kind) || p.kind === 'water' || spotOfDef(p, t, t + STAY_MIN[p.kind][0] * MIN)) options.push({ p })
    }
    for (const kind of ['pingpong', 'boardgame'] as const) {
      // a pair game under way at t with nobody watching it, WATCH_LEFT_MS or more of it left (#517); not watching twice in a row
      const on = segs.some((ss, k) => k !== i && ss.some((s) => s.kind === kind && s.partner && s.pairAt !== undefined && s.pairAt <= t && s.end >= t + WATCH_LEFT_MS))
      if (on && prev !== 'watch' && free(WATCH[kind].spot, t, t + STAY_MIN.watch[1] * MIN)) options.push({ watch: kind })
    }
    const weightOf = (x: Option) => (x.watch ? 1 : x.p!.weight * like(a, x.p!.kind))
    // the first option (by weight) that keeps the leaving cap; a pair game drawn is settled by pairUp, and if it finds none only the solo plays are left
    let placed = false
    while (!placed && options.length) {
      const o = pick(options, weightOf)!
      options.splice(options.indexOf(o), 1)
      if (o.pair) {
        placed = pairUp(i, t, done)
        if (!placed) for (const x of options.filter((y) => y.pair)) options.splice(options.indexOf(x), 1)
        continue
      }
      placed = tryOption(i, t, o)
    }
    if (!placed) {
      // nothing fits: another short gap where it stands, unlike the last one
      const g: GapKind = done.gap === 'stretch' ? 'window' : 'stretch'
      const w = g === 'window' ? WINDOW_SPOTS.find((x) => free(x, t, t + 30_000)) : done.spot
      segs[i].push({ kind: 'gap', gap: w ? g : 'stretch', start: t, end: t + 30_000, spot: w ?? done.spot, stay: nextStay() })
      if (w) hold(w, t, t + 30_000)
    }
  }
  // a partner promised past the day's end still comes (its stay ends after the plan's last change)
  for (const [k, inv] of invites) segs[k].push({ ...inv, start: endOf(k) })
  if (plans.size >= 4) plans.delete(plans.keys().next().value!)
  plans.set(key, segs)
  return segs
}

const isErrand = (k: PlayKind) => k === 'fridge' || k === 'dispenser' || k === 'record'

/** the segment an agent is in at `ms` */
const segAt = (segs: Seg[], ms: number) => segs.find((s) => s.start <= ms && ms < s.end)

/**
 * What each free agent does at `ms` (play.md 9.5): the day's plan, with the agents in `busy` (working, gone home) taken out. A pair player whose
 * partner is busy keeps the table alone: at the board it places a record (기보 놓기), at the table it waits with the ball.
 */
export function playAt(ms: number, agents: string[], busy: ReadonlySet<string> = new Set(), alone?: Alone): Record<string, PlayAssignment> {
  const roster = [...agents].sort()
  const plan = dayPlan(planDay(ms).day, roster)
  const out: Record<string, PlayAssignment> = {}
  /** the ones whose place is picked here rather than in the plan: picked below, clear of the places given already (#718) */
  const made = new Map<string, { from: number; make: (skip: (spot: string) => boolean) => PlayAssignment }>()
  roster.forEach((a, i) => {
    if (busy.has(a)) return
    const s = segAt(plan[i], ms)
    if (!s) return
    // a ping-pong pair broken by a partner gone to work (play.md 9.2, #516): the one left, and the one back, play on alone; never ping-pong again
    if (s.kind === 'pingpong' && s.partner && s.pairAt !== undefined && ms >= s.pairAt && (busy.has(s.partner) || alone?.broken.has(s.stay))) {
      const broke = alone?.broken.get(s.stay) ?? s.pairAt
      // never after now (the debug clock moves the office time; the statuses keep the real one, #524)
      const own = Math.min(ms, Math.max(broke, alone?.back?.[a] ?? -Infinity))
      made.set(a, { from: own, make: (skip) => aloneAt(plan, roster, a, s, own, ms, skip) })
      return
    }
    // a watcher of a game broken by a player gone to work leaves it at once (#517): gaps near where it stood, for the rest of the watch
    if (s.kind === 'watch') {
      const k = plan.findIndex((segs) => segs.some((x) => x.kind === s.watch && x.partner && x.pairAt !== undefined && x.pairAt <= ms && ms < x.end))
      const game = k >= 0 ? plan[k].find((x) => x.kind === s.watch && x.partner && x.pairAt! <= ms && ms < x.end) : undefined
      const broke = game ? alone?.broken.get(game.stay) : undefined
      if (!game || broke !== undefined || busy.has(roster[k]) || busy.has(game.partner!)) {
        // #718 (play.md 9.7): the chain at once, watching left out
        const from = Math.max(s.start, broke ?? s.start)
        // #718 (play.md 9.7 ②): 의문 for a second as the game breaks (only near that moment: a visitor arriving later does not see it)
        const cue = ms - from < CUE_WINDOW_MS ? { cue: { expr: 'question' as const, key: `broke:${s.stay}:${from}`, dur: BROKE_QUESTION_S } } : {}
        made.set(a, { from, make: (skip) => ({ ...fillChain(plan, ms, from, s.end, { agent: a, own: s.stay, exclude: ['watch'], skip }), ...cue }) })
        return
      }
    }
    out[a] = assignmentOf(a, s, ms, (b) => !busy.has(b))
  })
  // places picked here (a game left, a watcher off) give way to the plan's, and to each other: the one whose rest began first keeps its pick (then roster order)
  const taken = new Set<string>(roster.filter((a) => out[a]).map((a) => out[a].spot))
  for (const a of [...made.keys()].sort((x, y) => made.get(x)!.from - made.get(y)!.from || roster.indexOf(x) - roster.indexOf(y))) {
    out[a] = made.get(a)!.make((spot) => taken.has(spot))
    taken.add(out[a].spot)
  }
  return out
}

/** #517: the hall spot nearest `near` (not by the window) that `skip` does not rule out, or null */
export function hallNear(near: string, skip: (spot: string) => boolean): string | null {
  const at = spotsAt[near]
  if (!at) return null
  return (
    Object.keys(spotsAt)
      .filter((h) => h.startsWith('hall_') && h !== near && !WINDOW_SPOTS.includes(h) && !skip(h))
      .sort((x, y) => Math.hypot(spotsAt[x].x - at.x, spotsAt[x].z - at.z) - Math.hypot(spotsAt[y].x - at.x, spotsAt[y].z - at.z))[0] ?? null
  )
}

/**
 * #517 (play.md 9.1): an agent whose errand waits its turn, or is over before its stay is, rests near the errand's place instead of sitting at its desk: gaps
 * by turns (a stroll to the nearest free hall spot, the window) from the stay's start. From the plan only.
 */
export function restNear(ms: number, agents: string[], p: PlayAssignment): PlayAssignment {
  const plan = dayPlan(planDay(ms).day, [...agents].sort())
  return gapsFrom(plan, { kind: 'gap', start: p.since, end: p.until, spot: p.spot, stay: p.stay }, p.spot, p.since, p.until, ms)
}

/** #718 (play.md 9.7 ②): a watcher whose game breaks is puzzled (의문) this long, s; the cue is given only this long after the break, ms */
export const BROKE_QUESTION_S = 1
const CUE_WINDOW_MS = 5_000

/**
 * #718 (?debug=1, play.md 9.2 · 9.7): one left at the ping-pong table from `from` to `until` outside the plan (a forced game whose partner was sent to work): the
 * stroll near the table for ALONE_GAP_MS, then the fill chain. The schedule's own broken games go through aloneAt
 */
export function aloneChain(ms: number, agents: string[], agent: string, from: number, until: number): PlayAssignment {
  const plan = dayPlan(planDay(ms).day, [...agents].sort())
  const used = usedIn(plan, -1)
  const table = spotsAt.pingpong_a
  const dist = (h: string) => (table ? Math.hypot(spotsAt[h].x - table.x, spotsAt[h].z - table.z) : 0)
  if (ms < from + ALONE_GAP_MS) {
    const spot = Object.keys(spotsAt).filter((h) => h.startsWith('hall_') && !WINDOW_SPOTS.includes(h) && dist(h) >= WANDER_M[0] && !used(h, from, from + ALONE_GAP_MS)).sort((x, y) => dist(x) - dist(y))[0] ?? 'hall_back'
    return { kind: 'gap', gap: 'wander', label: GAP_LABEL.wander, spot, stay: -1, since: from, until: from + ALONE_GAP_MS }
  }
  return fillChain(plan, ms, from + ALONE_GAP_MS, until, { agent, own: -1 })
}

/** #715: an errand over at least this long before its stay ends is followed by the fill chain (fillChain), not one place for all of it */
export const FILL_MIN_MS = 60_000
/** #718 (play.md 9.7): the longest one place is stood at: the look-around takes turns at the window and the spines this long */
export const LOOK_MS = 90_000
/** the second bookshelf's stand (shelfRun.ts SHELF_STAND): the spines are looked over from it */
export const SPINES = { spot: 'shelf', stand: { x: 4.66, z: -3.16 }, face: { x: 4.66, z: -3.764 } } as const
/** #718: resting on a free sofa seat in the fill chain */
export const FILL_SOFA_LABEL = '쉬는 중 · 소파'
/** the sofa seats never given out together (dayPlan: the corner is reached in front of the middle one) */
const SOFA_BESIDE: Record<string, string> = { sofa_1: 'sofa_2', sofa_2: 'sofa_1' }

export type FillKind = 'coffee' | 'books' | 'boardgame_solo' | 'watch' | 'sofa'

export interface FillOpts {
  /** whose rest it is (a record placed alone is seeded by it) */
  agent: string
  /** the stay the rest belongs to: its own plan segments are not "used" */
  own: number
  /** the stay the fill is reported as (default `own`; an errand's leftover takes one of its own, so the errand's done mark does not cover it) */
  stay?: number
  /** the n-th free one (the two left at a ping-pong table: the second takes the next) */
  n?: number
  /** places given to others already (by playAt, or by the Director) */
  skip?: (spot: string) => boolean
  /** not these (a broken watcher does not watch again; a books stay's leftover does not read again) */
  exclude?: readonly FillKind[]
}

/**
 * #718 (play.md 9.7): the rest of a stay from `from` to `until` with nothing of its own. The first of these nobody's plan uses then (and `skip` leaves):
 * coffee; books (the low table or the second bookshelf, as the Director chooses); a record placed alone; watching a pair game with 2 min or more left (till
 * 60 s before it ends, then the chain again); a free sofa seat. Last the look-around: the window and the spines in turns of LOOK_MS (the last turn keeps
 * going when what is left is LOOK_MS or less), so nobody stands at one place longer than that. From the plan only: the same in every browser.
 */
export function fillChain(plan: Seg[][], ms: number, from: number, until: number, o: FillOpts): PlayAssignment {
  const used = usedIn(plan, o.own)
  const skip = o.skip ?? (() => false)
  const free = (spot: string, a = from, b = until) => !used(spot, a, b) && !skip(spot)
  const no = new Set<FillKind>(o.exclude ?? [])
  const stay = o.stay ?? o.own
  const base = { stay, since: from, until }
  const picks: PlayAssignment[] = []
  const coffee = PLAYS.find((x) => x.kind === 'coffee')!
  if (!no.has('coffee') && free(coffee.spots[0])) picks.push({ kind: 'coffee', label: coffee.label, spot: coffee.spots[0], ...base })
  const books = PLAYS.find((x) => x.kind === 'books')!
  if (!no.has('books') && free(books.spots[0])) picks.push({ kind: 'books', label: books.label, spot: books.spots[0], ...base, ...(books.face ? { face: books.face } : {}), ...(books.stand ? { stand: books.stand } : {}) })
  if (!no.has('boardgame_solo') && free('game_a') && free('game_b')) {
    const game = chooseGame(`fill|${stay}|${o.agent}`)
    picks.push({ kind: 'boardgame_solo', label: BOARD_LABEL[game].solo, spot: 'game_a', ...base, game })
  }
  if (!no.has('watch'))
    for (const kind of ['pingpong', 'boardgame'] as const) {
      const game = plan.flat().find((x) => x.kind === kind && x.partner && x.stay !== o.own && x.pairAt !== undefined && x.pairAt <= from && x.end >= from + WATCH_LEFT_MS)
      if (!game) continue
      const end = Math.min(until, game.end - WATCH_LEAVE_MS)
      if (!free(WATCH[kind].spot, from, end)) continue
      // the watch over: the chain again for what is left (not watching twice)
      if (ms >= end) return fillChain(plan, ms, end, until, { ...o, exclude: [...no, 'watch'] })
      picks.push({ kind: 'watch', watch: kind, label: kind === 'boardgame' && game.game ? BOARD_LABEL[game.game].watch : WATCH[kind].label, spot: WATCH[kind].spot, face: WATCH[kind].face, ...base, until: end, ...(game.game ? { game: game.game } : {}) })
      break
    }
  if (!no.has('sofa')) {
    const sofa = PLAYS.find((x) => x.kind === 'sofa')!
    const seat = sofa.spots.find((s) => free(s) && (!SOFA_BESIDE[s] || free(SOFA_BESIDE[s])))
    if (seat) picks.push({ kind: 'sofa', label: FILL_SOFA_LABEL, spot: seat, ...base })
  }
  const n = o.n ?? 0
  return picks[n] ?? lookAround(ms, from, until, n - picks.length, free, stay)
}

/** #718: the look-around: equal turns of LOOK_MS at most from `from`, the window first (`n` turns on for the n-th agent) */
function lookAround(ms: number, from: number, until: number, n: number, free: (spot: string, a: number, b: number) => boolean, stay: number): PlayAssignment {
  // equal turns of LOOK_MS at most: no short last turn, and none longer
  const turns = Math.max(1, Math.ceil((until - from) / LOOK_MS))
  const len = (until - from) / turns
  const k = Math.min(turns - 1, Math.max(0, Math.floor((ms - from) / len)))
  const t = from + k * len
  const end = k === turns - 1 ? until : t + len
  // the window on even turns, the spines on odd ones; a turn whose place is taken is a stroll (not the other one again: two turns at one place is too long)
  if ((k + n) % 2 === 1) {
    if (free(SPINES.spot, t, end)) return { kind: 'gap', gap: 'spines', label: GAP_LABEL.spines, spot: SPINES.spot, stand: SPINES.stand, face: SPINES.face, stay, since: t, until: end }
  } else {
    const w = WINDOW_SPOTS.find((h) => free(h, t, end))
    if (w) return { kind: 'gap', gap: 'window', label: GAP_LABEL.window, spot: w, stay, since: t, until: end, face: { x: spotsAt[w].x, z: WINDOW_FACE_Z } }
  }
  // a stroll: another hall spot each turn (never one place for longer than a turn)
  const halls = Object.keys(spotsAt).filter((h) => h.startsWith('hall_') && !WINDOW_SPOTS.includes(h) && h !== WATCH.pingpong.spot && h !== WATCH.boardgame.spot && free(h, t, end))
  const spot = halls[(k + n) % Math.max(1, halls.length)] ?? 'hall_lounge'
  return { kind: 'gap', gap: 'wander', label: GAP_LABEL.wander, spot, stay, since: t, until: end }
}

/**
 * #516: ping-pong pairs broken by a partner gone to work, for playAt (the Director keeps them): the stay → when it broke (the partner's work began, or the
 * game, the later), and per agent when it came back from work (its idle state's start). Kept from the status timeline, so the timelapse and seeking show
 * the same.
 */
export interface Alone {
  broken: ReadonlyMap<number, number>
  back?: Readonly<Record<string, number>>
}

/** the stroll after the paddle is put down (play.md 9.2) */
const ALONE_GAP_MS = 30_000

/**
 * One left at the ping-pong table (or back from work to a broken game), from `own`: a stroll (to a free hall spot near the table), then the fill chain for
 * the rest (#718, play.md 9.7; the two in roster order, the second taking the next one). From the plan only: the same in every browser.
 */
function aloneAt(plan: Seg[][], roster: string[], agent: string, s: Seg, own: number, ms: number, skip: (spot: string) => boolean = () => false): PlayAssignment {
  const used = (spot: string, a: number, b: number) => plan.some((segs) => segs.some((x) => x.spot === spot && x.stay !== s.stay && x.start < b && a < x.end))
  const table = spotsAt[s.spot]
  const dist = (h: string) => (table ? Math.hypot(spotsAt[h].x - table.x, spotsAt[h].z - table.z) : 0)
  const halls = Object.keys(spotsAt).filter((h) => h.startsWith('hall_') && !WINDOW_SPOTS.includes(h) && dist(h) >= WANDER_M[0]).sort((x, y) => dist(x) - dist(y))
  const second = roster.indexOf(agent) > roster.indexOf(s.partner!)
  const n = second ? 1 : 0
  const since = own + ALONE_GAP_MS
  const stroll = (from: number, until: number): PlayAssignment => {
    const spot = halls.filter((h) => !used(h, from, until) && !skip(h))[n] ?? halls[0] ?? s.spot
    return { kind: 'gap', gap: 'wander', label: GAP_LABEL.wander, spot, stay: s.stay, since: from, until }
  }
  if (ms < since || since >= s.end) return stroll(own, Math.min(since, s.end))
  // #718 (play.md 9.7): the fill chain for the rest; the second of the two left takes the next one
  return fillChain(plan, ms, since, s.end, { agent, own: s.stay, n, skip })
}

/** whether a place is in anybody's plan (other than the stay `stay`) between a and b */
/** where a plan segment is in the room: an errand is planned from the desk but run at its own place (#718: the chain must not pick the bar while an errand is due there) */
const segSpot = (x: Seg) => (x.spot === DESK ? (PLAYS.find((p) => p.kind === x.kind)?.spots[0] ?? DESK) : x.spot)
const usedIn = (plan: Seg[][], stay: number) => (spot: string, a: number, b: number) => plan.some((segs) => segs.some((x) => segSpot(x) === spot && x.stay !== stay && x.start < b && a < x.end))

/**
 * Resting near `near` from `from` to `until`: the hall spot nearest it (a window spot too) nobody's plan uses then, one place for all of it (#525: not
 * a stroll and then another place; the window breathes, a hall spot looks round). `slot` takes that free place in the order (the two left at a table, a
 * watcher: going at once they keep apart). From the plan only: the same in every browser.
 */
function gapsFrom(plan: Seg[][], s: Seg, near: string, from: number, until: number, _ms: number, slot = 0): PlayAssignment {
  const used = usedIn(plan, s.stay)
  const at = spotsAt[near]
  const dist = (h: string) => (at ? Math.hypot(spotsAt[h].x - at.x, spotsAt[h].z - at.z) : 0)
  const free = Object.keys(spotsAt).filter((h) => h.startsWith('hall_') && h !== near && !used(h, from, until)).sort((x, y) => dist(x) - dist(y))
  const spot = free[slot] ?? free[0] ?? near
  const kind: GapKind = WINDOW_SPOTS.includes(spot) ? 'window' : 'wander'
  const face = kind === 'window' && spotsAt[spot] ? { x: spotsAt[spot].x, z: WINDOW_FACE_Z } : undefined
  return { kind: 'gap', gap: kind, label: GAP_LABEL[kind], spot, stay: s.stay, since: from, until, ...(face ? { face } : {}) }
}

function assignmentOf(agent: string, s: Seg, ms: number, present: (a: string) => boolean): PlayAssignment {
  const base = { stay: s.stay, since: s.start, until: s.end }
  if (s.kind === 'gap') {
    const face = s.gap === 'window' && spotsAt[s.spot] ? { x: spotsAt[s.spot].x, z: WINDOW_FACE_Z } : undefined
    // #517: never at the desk (the day's first gap, one when nothing fits): the hall spot nearest it
    const spot = s.spot === DESK ? (hallNear(`work_${agent.split('_')[1]}`, () => false) ?? `work_${agent.split('_')[1]}`) : s.spot
    return { kind: 'gap', gap: s.gap, label: GAP_LABEL[s.gap!], spot, ...base, ...(face ? { face } : {}) }
  }
  if (s.kind === 'watch') {
    const w = WATCH[s.watch!]
    const label = s.watch === 'boardgame' && s.game ? BOARD_LABEL[s.game].watch : w.label
    return { kind: 'watch', watch: s.watch, label, spot: w.spot, face: w.face, ...base, ...(s.game ? { game: s.game } : {}) }
  }
  const def = PLAYS.find((p) => p.kind === s.kind)!
  if (def.pair) {
    const together = s.partner && present(s.partner) && s.pairAt !== undefined && ms >= s.pairAt
    if (together) return { kind: s.kind, label: s.game ? BOARD_LABEL[s.game].pair : def.label, spot: s.spot, partner: s.partner, pairAt: s.pairAt, ...base, ...(s.game ? { game: s.game } : {}) }
    // alone at the board (the partner gone to work): the first chair places a record; ping-pong is never alone (playAt: aloneAt)
    const game = s.game ?? 'omok'
    return { kind: 'boardgame_solo', label: BOARD_LABEL[game].solo, spot: 'game_a', ...base, game }
  }
  let p: PlayDef = def
  if (s.kind === 'water' && s.plant) {
    const plant = WATER_PLANTS.find((w) => w.name === s.plant) ?? WATER_PLANTS[0]
    p = { ...p, face: { x: plant.x, z: plant.z }, stand: standOf(plant) }
  }
  const soloGame = s.kind === 'boardgame_solo' ? (s.game ?? 'omok') : undefined
  return { kind: s.kind, label: soloGame ? BOARD_LABEL[soloGame].solo : p.label, spot: s.spot === DESK ? p.spots[0] : s.spot, ...base, ...(soloGame ? { game: soloGame } : {}), ...(s.plant ? { plant: s.plant } : {}), ...(p.face ? { face: p.face } : {}), ...(p.stand ? { stand: p.stand } : {}) }
}

/** the pose an assignment is drawn with: a gap or a watcher stands (play.md 9.2 · 9.3) */
export const schedulePose = (k: PlayAssignment['kind']) => (k === 'gap' || k === 'watch' ? ('idle' as const) : playPose(k))

/** the next moment any free agent's assignment changes after `ms` (the debug panel's "다음 변경") */
export function nextChange(ms: number, agents: string[]): number {
  const plan = dayPlan(planDay(ms).day, [...agents].sort())
  let next = Infinity
  for (const segs of plan) {
    const s = segAt(segs, ms)
    if (s) next = Math.min(next, s.end)
  }
  return next === Infinity ? planDay(ms).start + DAY_MS : next
}

/** what the night-duty agent may do: quiet and alone (no pair games, no sofa nap, no ping-pong) */
export const NIGHT_PLAYS: PlayKind[] = ['coffee']

const nights = new Map<string, Seg[]>()
/**
 * The night-duty agent's own run (play.md 9.1): coffee for 3–6 minutes, a gap, coffee again, from the day's start; the same for every visitor.
 */
export function soloAt(ms: number, agent: string): PlayAssignment {
  const { day, start } = planDay(ms)
  const key = `${day}|solo|${agent}`
  let segs = nights.get(key)
  if (!segs) {
    const rand = rng(hash(key))
    const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
    segs = []
    let n = 0
    let t = start - between(...STAY_MIN.coffee) * MIN * rand()
    let gap: GapKind = 'window'
    while (t < start + DAY_MS) {
      const e = t + between(...STAY_MIN.coffee) * MIN
      segs.push({ kind: 'coffee', start: t, end: e, spot: 'coffee', stay: day * 100_000 + 90_000 + ++n })
      // a quiet gap at night: a stretch or a look out of the window, never the same twice
      gap = gap === 'stretch' ? 'window' : 'stretch'
      const g = e + between(...GAP_S) * 1000
      segs.push({ kind: 'gap', gap, start: e, end: g, spot: gap === 'window' ? WINDOW_SPOTS[0] : 'coffee', stay: day * 100_000 + 90_000 + ++n })
      t = g
    }
    if (nights.size >= 8) nights.delete(nights.keys().next().value!)
    nights.set(key, segs)
  }
  const s = segAt(segs, ms) ?? segs[0]
  return assignmentOf(agent, s, ms, () => true)
}
