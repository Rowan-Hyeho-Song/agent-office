// #450 (lounge-props.md 6): a book from the second bookshelf, read standing in front of it and put back in the same slot. Pure and deterministic like
// readRun.ts: the clock and whether the agent has arrived drive the stages; the Director turns them into goals, PlayStage draws the hands and the book
// from the goal's stage and time. No prop moves on its own: the hand takes the book from its slot and puts it back there (exactly its home).

import { hash } from './play'

export type ShelfStage =
  /** walking to the stand in front of the second bookshelf */
  | 'fetch'
  /** the right hand pulls the book out of its slot (0.15 m forward) and brings it before the chest; for the low row the body sinks first */
  | 'pull'
  /** both hands take the open-book grips and it opens */
  | 'open'
  /** standing, reading; a page turns every 25–40 s */
  | 'read'
  /** it closes, the right hand takes the spine grip again */
  | 'close'
  /** pushed back into the same slot with the palm on the spine */
  | 'put'

export const SHELF_LABEL: Record<ShelfStage, string> = {
  fetch: '책장 책 읽기 · 고르는 중',
  pull: '책장 책 읽기 · 고르는 중',
  open: '책장 책 읽기 · 읽는 중',
  read: '책장 책 읽기 · 읽는 중',
  close: '책장 책 읽기 · 꽂는 중',
  put: '책장 책 읽기 · 꽂는 중',
}

/** the five books (office.glb `shelf: 2`): their row on the shelf (1: y 0.63, low; 3: y 1.48) */
export const SHELF_BOOKS = [
  { name: 'prop_shelfbook_0', row: 1 },
  { name: 'prop_shelfbook_1', row: 1 },
  { name: 'prop_shelfbook_2', row: 1 },
  { name: 'prop_shelfbook_3', row: 3 },
  { name: 'prop_shelfbook_4', row: 3 },
] as const

export const SHELF_S = {
  /**
   * the hand reaches the spine and closes (about 0.42 s), the book comes 0.15 m out of the slot (pullOut) and up before the chest (toChest): 1.2 s; the low
   * row: the body sinks 0.25 m in the first 0.5 s and rises in the last 0.5 s
   */
  pull: 1.2,
  pullOut: 0.35,
  toChest: 0.4,
  open: 0.5,
  /** read for this long (a seed in it per stay), a page every 25–40 s */
  read: [150, 330] as const,
  pageEvery: [25, 40] as const,
  pageS: 0.8,
  close: 0.4,
  /** the spine grip again, then before the slot and pushed in with the palm (home by putIn), and let go: 0.7 s */
  put: 0.7,
  putIn: 0.5,
  /** the stand is taken: give up the walk after this long */
  fetchMax: 45,
} as const

/** the low row sinks the body this far (m) while the book is taken out and put back */
export const SHELF_SINK_M = 0.25
/** how far the book comes out of its slot before it is lifted (m) */
export const SHELF_PULL_M = 0.15

/** the stand: 0.6 m in front of the spines, facing north (lounge-props.md 6); routed to through the nav spot `shelf` */
export const SHELF_STAND = { spot: 'shelf', stand: { x: 4.66, z: -3.16 }, face: { x: 4.66, z: -3.764 } } as const

export interface ShelfRun {
  agent: string
  /** the play stay it belongs to (read once per stay) */
  block: number
  book: (typeof SHELF_BOOKS)[number]['name']
  stage: ShelfStage
  /** office ms the stage began */
  t0: number
  /** how long it reads, s */
  readS: number
  /** the how-manieth book of this stay (1 …) */
  n: number
}

/**
 * #450 (designer): a stay is 6–14 min, a book 150–330 s: put back with minLeftS or more of the stay left, another book is taken (not the one just read; at most
 * `max` a stay); with less, it stays before the shelf browsing the spines (the head ±yawDeg along the rows, a periodS cycle; the hands at rest)
 */
export const SHELF_MORE = { minLeftS: 150, max: 3 } as const
export const BROWSE = { yawDeg: 12, periodS: 6, label: '책장 책 읽기 · 책등 보는 중' } as const
/** the time a book takes besides its reading: out, open, close, back in */
export const SHELF_HANDS_S = SHELF_S.pull + SHELF_S.open + SHELF_S.close + SHELF_S.put

/** #450: a book stay read at the second bookshelf (else at the low table): half of them, by the stay's seed */
export const shelfTurn = (agent: string, block: number) => hash(`${agent}|bookplace|${block}`) % 2 === 0

/** a book for this stay: seeded, never the one this agent read last */
export function chooseBook(agent: string, block: number, last?: string): ShelfRun['book'] {
  const pool = SHELF_BOOKS.filter((b) => b.name !== last)
  return pool[hash(`${agent}|shelfbook|${block}`) % pool.length].name
}

export const rowOf = (book: string) => SHELF_BOOKS.find((b) => b.name === book)?.row ?? 3

export function startShelf(agent: string, block: number, now: number, last?: string): ShelfRun {
  const [a, b] = SHELF_S.read
  const readS = a + ((hash(`${agent}|shelfread|${block}`) % 1000) / 999) * (b - a)
  return { agent, block, book: chooseBook(agent, block, last), stage: 'fetch', t0: now, readS, n: 1 }
}

/** the next book of the stay, read for what is left of it (`leftS`, the hands' time and a breath taken off; at least half a minute), not the one just read */
export function nextShelf(prev: ShelfRun, now: number, leftS: number): ShelfRun {
  const r = startShelf(prev.agent, prev.block * 10 + prev.n, now, prev.book)
  return { ...r, block: prev.block, n: prev.n + 1, readS: Math.max(30, Math.min(r.readS, leftS - SHELF_HANDS_S - 2)) }
}

/** the book is in the hand from the pull to the end of the put */
export const holding = (r: ShelfRun) => r.stage !== 'fetch'

/** called away: on the way nothing is out; with the book out it is closed and put back first */
export const callAway = (r: ShelfRun, now: number): ShelfRun => (r.stage === 'pull' || r.stage === 'open' || r.stage === 'read' ? { ...r, stage: 'close', t0: now } : r)

const STEP_S: Partial<Record<ShelfStage, number>> = { pull: SHELF_S.pull, open: SHELF_S.open, close: SHELF_S.close, put: SHELF_S.put }
const NEXT: Record<ShelfStage, ShelfStage | null> = { fetch: 'pull', pull: 'open', open: 'read', read: 'close', close: 'put', put: null }

/** advance one frame; `done` once the book is back home and let go (or the walk was given up) */
export function stepShelf(run: ShelfRun, inp: { now: number; arrived: boolean }): { run: ShelfRun; done: boolean } {
  const r = { ...run }
  for (let guard = 0; guard < 7; guard++) {
    const el = (inp.now - r.t0) / 1000
    if (r.stage === 'fetch') {
      if (!inp.arrived) return { run: r, done: el > SHELF_S.fetchMax }
    } else if (el < (r.stage === 'read' ? r.readS : STEP_S[r.stage]!)) break
    const next = NEXT[r.stage]
    if (!next) return { run: r, done: true }
    r.t0 = r.stage === 'fetch' ? inp.now : r.t0 + (r.stage === 'read' ? r.readS : STEP_S[r.stage]!) * 1000
    r.stage = next
  }
  return { run: r, done: false }
}

/** the pages turned by `u` s of reading: the first after 25–40 s, then every 25–40 s (seeded per agent and stay); the turn under way is k 0..1 */
export function pageAt(r: Pick<ShelfRun, 'agent' | 'block'>, u: number): { n: number; k: number } {
  const [a, b] = SHELF_S.pageEvery
  let at = 0
  for (let n = 0; n < 40; n++) {
    at += a + ((hash(`${r.agent}|page|${r.block}|${n}`) % 1000) / 999) * (b - a)
    if (u < at) return { n, k: 0 }
    if (u < at + SHELF_S.pageS) return { n, k: (u - at) / SHELF_S.pageS }
    at += SHELF_S.pageS
  }
  return { n: 40, k: 0 }
}
