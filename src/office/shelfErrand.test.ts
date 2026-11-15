/// <reference types="node" />
// #450 (lounge-props.md 6): a book from the second bookshelf, read standing before it and put back in the same slot. Two levels:
//  - shelfRun.ts: the stages and their times, called away, the book chosen, half of the book stays here;
//  - the stage on the baked model, with the planner walking the body: the stages in order, the book out of its slot and before the face while read, the
//    halves open, the low row read with the body sunk, and the book back exactly in its slot (1 mm, 0.5°); nothing loose or jumping (Guard).
import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { stubCanvas } from './glbLoad'
import { Guard, IDS, Walk, expectCleanAll, world } from './errandWorld.fixture'
import { SHELF_BOOKS, SHELF_LABEL, SHELF_S, SHELF_STAND, callAway, chooseBook, holding, pageAt, rowOf, shelfTurn, startShelf, stepShelf } from './shelfRun'

stubCanvas()

describe('the stages (shelfRun.ts)', () => {
  it('walk, pull, open, read, close, put; done once it is back', () => {
    let r = startShelf('agent_1', 7, 0)
    expect(r.stage).toBe('fetch')
    expect(r.readS).toBeGreaterThanOrEqual(SHELF_S.read[0])
    expect(r.readS).toBeLessThanOrEqual(SHELF_S.read[1])
    r = stepShelf(r, { now: 5000, arrived: false }).run
    expect(r.stage).toBe('fetch')
    r = stepShelf(r, { now: 6000, arrived: true }).run
    expect(r).toMatchObject({ stage: 'pull', t0: 6000 })
    const seq: string[] = []
    let t = 6000
    let done = false
    while (!done && t < 6000 + 400_000) {
      t += 100
      const s = stepShelf(r, { now: t, arrived: true })
      r = s.run
      done = s.done
      if (seq.at(-1) !== r.stage) seq.push(r.stage)
    }
    expect(seq).toEqual(['pull', 'open', 'read', 'close', 'put'])
    const total = SHELF_S.pull + SHELF_S.open + r.readS + SHELF_S.close + SHELF_S.put
    expect((t - 6000) / 1000).toBeCloseTo(total, 0)
  })
  it('called away: on the way nothing is out; with the book out it is closed and put back first', () => {
    const r = startShelf('agent_1', 7, 0)
    expect(holding(r)).toBe(false)
    for (const stage of ['pull', 'open', 'read'] as const) expect(callAway({ ...r, stage }, 1000)).toMatchObject({ stage: 'close', t0: 1000 })
    expect(callAway({ ...r, stage: 'put' }, 1000).stage).toBe('put')
    expect(stepShelf(r, { now: SHELF_S.fetchMax * 1000 + 1, arrived: false }).done).toBe(true)
  })
  it('the book: seeded, never the one read last; a page every 25–40 s; half the book stays read here', () => {
    for (let b = 0; b < 40; b++) {
      const last = chooseBook('agent_2', b)
      expect(chooseBook('agent_2', b + 1, last)).not.toBe(last)
    }
    expect(rowOf('prop_shelfbook_0')).toBe(1)
    expect(rowOf('prop_shelfbook_4')).toBe(3)
    let prev = 0
    for (let u = 0; u < 300; u += 0.1) {
      const p = pageAt({ agent: 'agent_2', block: 3 }, u)
      if (p.n > prev) prev = p.n
    }
    expect(prev).toBeGreaterThanOrEqual(7)
    expect(prev).toBeLessThanOrEqual(12)
    let here = 0
    for (let b = 0; b < 400; b++) here += shelfTurn('agent_3', b) ? 1 : 0
    expect(here).toBeGreaterThan(160)
    expect(here).toBeLessThan(240)
    expect(SHELF_LABEL.read).toBe('책장 책 읽기 · 읽는 중')
  })
})

/** a shelf book read through the planner: the stages, and what is seen along the way */
function runShelf(w: Awaited<ReturnType<typeof world>>, agent: string, book: string, guard: Guard, onStep?: (walk: Walk, stage: string | undefined) => void) {
  const dt = 0.03
  const walk = new Walk(w, undefined, false)
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  for (let k = 0; k < 10; k++) walk.step(dt, guard)
  walk.status[agent] = { state: 'idle', since: 0 }
  walk.director.forceShelf(agent, walk.t0 + walk.t * 1000, book, 6)
  const stages: string[] = []
  let ended = -1
  const started = walk.t
  for (let k = 0; k < 120 / dt; k++) {
    walk.step(dt, guard)
    const g = walk.goals[agent]
    const st = g.shelf?.stage
    onStep?.(walk, st)
    if (st && stages.at(-1) !== st) stages.push(st)
    if (!g.shelf && stages.length) {
      ended = walk.t - started
      break
    }
  }
  for (const id of IDS) walk.status[id] = { state: 'working', activity: 'test', since: 0 }
  for (let k = 0; k < 15 / dt; k++) walk.step(dt, guard)
  return { walk, stages, ended }
}

describe('a book from the second bookshelf on the baked model', () => {
  for (const book of [SHELF_BOOKS[2].name, SHELF_BOOKS[3].name]) {
    it(`${book} (row ${rowOf(book)}): out, before the face open, back exactly in its slot`, async () => {
      const w = await world()
      const guard = new Guard(w)
      const node = w.scene.getObjectByName(book)!
      node.updateWorldMatrix(true, false)
      const home = node.matrixWorld.clone()
      const homeP = new Vector3().setFromMatrixPosition(home)
      const homeQ = new Quaternion().setFromRotationMatrix(home)
      let maxOut = 0
      let readSeen = false
      let openSeen = 0
      let sunk = 0
      const { stages, ended } = runShelf(w, 'agent_1', book, guard, (walk, st) => {
        node.updateWorldMatrix(true, false)
        const p = new Vector3().setFromMatrixPosition(node.matrixWorld)
        maxOut = Math.max(maxOut, p.distanceTo(homeP))
        const rig = w.rigs.agent_1
        if (st === 'read') {
          readSeen = true
          // before the face: within half a metre of the head, and below it
          const head = rig.parts.head.getWorldPosition(new Vector3())
          expect(p.distanceTo(head)).toBeLessThan(0.5)
          expect(p.y).toBeLessThan(head.y)
          const half = w.scene.getObjectByName(`${book}_l`)
          if (half) openSeen = Math.max(openSeen, Math.abs(half.rotation.z))
        }
        if (st === 'pull' || st === 'put') sunk = Math.max(sunk, -rig.parts.root.position.y)
        void walk
      })
      expect(stages).toEqual(['fetch', 'pull', 'open', 'read', 'close', 'put'])
      expect(ended).toBeGreaterThan(0)
      expect(readSeen).toBe(true)
      expect(maxOut, 'it came out of the slot').toBeGreaterThan(0.3)
      expect(openSeen, 'the halves open').toBeGreaterThan(1)
      if (rowOf(book) === 1) expect(sunk, 'the low row: the body sinks').toBeGreaterThan(0.15)
      else expect(sunk, 'the top row: the body does not sink').toBeLessThan(0.01)
      // back exactly in its slot
      node.updateWorldMatrix(true, false)
      const p = new Vector3().setFromMatrixPosition(node.matrixWorld)
      const q = new Quaternion().setFromRotationMatrix(node.matrixWorld)
      expect(p.distanceTo(homeP), 'back in its slot (m)').toBeLessThan(0.001)
      expect((q.angleTo(homeQ) * 180) / Math.PI, 'square in its slot (°)').toBeLessThan(0.5)
      expectCleanAll(book, w, guard)
      void SHELF_STAND
      void Matrix4
    }, 240_000)
  }
})

describe('a book stay at the second bookshelf in the Director (#450 designer)', () => {
  it('a book, then another while 150 s or more is left (at most 3, never the one just read), then the spines browsed till the stay ends', async () => {
    const { Director } = await import('./director')
    const { playAt } = await import('./play')
    const AG = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
    const idle = Object.fromEntries(AG.map((a) => [a, { state: 'idle' as const, since: 0 }]))
    // a long book stay that falls to the shelf
    const DAY = Date.parse('2026-11-16T13:00:00+09:00')
    let found: { t: number; a: string; until: number } | null = null
    for (let t = DAY; t < DAY + 8 * 3_600_000 && !found; t += 60_000)
      for (const a of AG) {
        const p = playAt(t, AG)[a]
        if (p?.kind === 'books' && p.since >= t - 60_000 && p.until - t > 9 * 60_000 && shelfTurn(a, p.stay)) {
          found = { t, a, until: p.until }
          break
        }
      }
    expect(found).not.toBeNull()
    const { t, a, until } = found!
    const d = new Director(AG)
    const sent: Record<string, string> = {}
    const books: string[] = []
    let browseFrom = 0
    let prevStage: string | undefined
    for (let now = t - 60_000; now < until + 5_000; now += 500) {
      const g = d.goals(now, Math.floor(now / 60_000), idle, (x) => sent[x] ?? null)
      for (const x of AG) sent[x] = g[x].spot
      const s = g[a].shelf
      if (s?.stage === 'pull' && prevStage !== 'pull') books.push(s.book)
      prevStage = s?.stage
      if (g[a].browse && !browseFrom) browseFrom = now
      if (now >= until) expect(g[a].browse ?? false).toBe(false)
    }
    const read = books
    expect(read.length).toBeGreaterThanOrEqual(2)
    expect(read.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < read.length; i++) expect(read[i]).not.toBe(read[i - 1])
    // browsing came only with less than 150 s left (or the third book done)
    if (browseFrom) expect(read.length === 3 || until - browseFrom < 150_000 + 5_000).toBe(true)
  }, 120_000)
})
