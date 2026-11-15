import { describe, expect, it } from 'vitest'
import {
  EXTEND_MAX_MS, GAP_S, LEAVE_CAP, LEAVE_WINDOW_MS, NIGHT_PLAYS, PAIR_SOON_MS, PLAYS, STAY_MIN, dayPlan, nextChange, planDay, playAt, soloAt, type Seg,
} from './play'

// #490 (docs/design/play.md 9): no blocks; each agent has its own run of stays and gaps, laid out once a day from KST 04:00, the same for every visitor.
const FIVE = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
const MIN = 60_000
/** a few days (KST 04:00 each) */
const DAYS = [20_400, 20_401, 20_402, 20_403, 20_404, 20_405]
const dayStart = (d: number) => planDay(d * 86_400_000 + 9 * 3_600_000).start
const stays = (segs: Seg[]) => segs.filter((s) => s.kind !== 'gap')

describe('the day plan (play.md 9.5)', () => {
  it('the same day and roster give the same plan, whatever the roster order; another day another plan', () => {
    const a = dayPlan(DAYS[0], FIVE)
    expect(dayPlan(DAYS[0], [...FIVE].reverse())).toBe(a)
    const t = dayStart(DAYS[0]) + 10 * 3_600_000
    expect(playAt(t, FIVE)).toEqual(playAt(t, [...FIVE].reverse()))
    expect(JSON.stringify(dayPlan(DAYS[1], FIVE))).not.toBe(JSON.stringify(a))
  })
  it('covers the whole day from 04:00 for everybody, with no holes', () => {
    for (const d of DAYS) {
      const start = dayStart(d)
      for (const segs of dayPlan(d, FIVE)) {
        expect(segs[0].start).toBeLessThanOrEqual(start)
        expect(segs[segs.length - 1].end).toBeGreaterThanOrEqual(start + 86_400_000 - 1)
        for (let k = 1; k < segs.length; k++) expect(segs[k].start, `hole at ${k}`).toBe(segs[k - 1].end)
      }
    }
  })
})

describe('leaving a play (play.md 9.4)', () => {
  it(`in no minute do more than ${LEAVE_CAP} agents leave their play (a pair game ending is two)`, () => {
    for (const d of DAYS) {
      // a record placed alone and joined (play.md 9.2 ①) is not left: the game goes on at the same board
      const leaves = dayPlan(d, FIVE).flatMap((segs) => stays(segs).slice(1).filter((s) => !s.joined).map((s) => s.end)).sort((x, y) => x - y)
      for (let k = 0; k < leaves.length; k++) {
        const inMinute = leaves.filter((x) => x >= leaves[k] && x < leaves[k] + LEAVE_WINDOW_MS).length
        expect(inMinute, `day ${d} at ${new Date(leaves[k]).toISOString()}`).toBeLessThanOrEqual(LEAVE_CAP)
      }
    }
  })
  it('the ends are spread out from the day\'s start', () => {
    const first = dayPlan(DAYS[0], FIVE).map((segs) => segs[0].end)
    expect(new Set(first.map((t) => Math.round(t / MIN))).size).toBeGreaterThanOrEqual(4)
  })
})

describe('stays (play.md 9.1)', () => {
  it('last at least their play\'s minimum, and at most its maximum + 2 minutes (a pair from when both are there)', () => {
    for (const d of DAYS)
      for (const segs of dayPlan(d, FIVE))
        for (const s of stays(segs).slice(1)) {
          if (s.kind === 'watch') continue // a watcher leaves when the game ends
          if (s.joined) continue // a record placed alone ends when somebody sits down opposite (play.md 9.2 ①)
          const [lo, hi] = STAY_MIN[s.kind as keyof typeof STAY_MIN]
          const from = s.pairAt ?? s.start
          expect(s.end - from, `${s.kind}`).toBeGreaterThanOrEqual(lo * MIN - 1)
          expect(s.end - from, `${s.kind}`).toBeLessThanOrEqual(hi * MIN + EXTEND_MAX_MS + 1)
        }
  })
  it('never the same play twice in a row; a gap of 20–50 s between two stays (up to 30 s more waiting for a partner), never the same gap twice in a row', () => {
    for (const d of DAYS)
      for (const segs of dayPlan(d, FIVE)) {
        const kinds = stays(segs).map((s) => s.kind)
        for (let k = 1; k < kinds.length; k++) if (kinds[k] !== 'watch') expect(kinds[k], `${kinds.slice(k - 1, k + 1)}`).not.toBe(kinds[k - 1])
        const gaps = segs.filter((s) => s.kind === 'gap' && s.gap)
        for (const g of gaps.slice(1)) {
          expect(g.end - g.start).toBeGreaterThanOrEqual(GAP_S[0] * 1000 - 1)
          expect(g.end - g.start).toBeLessThanOrEqual(GAP_S[1] * 1000 + PAIR_SOON_MS + 1)
        }
        for (let k = 1; k < gaps.length; k++) expect(gaps[k].gap).not.toBe(gaps[k - 1].gap)
      }
  })
  it('a pair (#516): both set off together and end together; nobody waits at a table for one to come; ping-pong is always two', () => {
    let pairs = 0
    let joins = 0
    let soon = 0
    for (const d of DAYS) {
      const plan = dayPlan(d, FIVE)
      for (const [i, segs] of plan.entries())
        for (const [n, s] of segs.entries()) {
          if (s.kind === 'pingpong') expect(s.partner, 'ping-pong alone').toBeDefined()
          if (!s.partner || s.spot !== PLAYS.find((p) => p.kind === s.kind)!.spots[0]) continue
          pairs++
          const other = plan[FIVE.indexOf(s.partner)].find((x) => x.stay === s.stay)!
          expect(other, `${FIVE[i]}'s partner`).toBeDefined()
          expect(other.end).toBe(s.end)
          // together: both from the same moment
          expect(s.start).toBe(s.pairAt)
          expect(other.start).toBe(s.pairAt)
          // ① sat down opposite one placing a record alone, ② with one free within 30 s, the drawer's gap going on till then
          const mine = segs[n - 1]
          const theirs = plan[FIVE.indexOf(s.partner)][plan[FIVE.indexOf(s.partner)].indexOf(other) - 1]
          if (mine.joined || theirs.joined) joins++
          else {
            soon++
            expect(mine.kind === 'gap' || theirs.kind === 'gap', 'one of them was in its gap').toBe(true)
          }
        }
    }
    expect(pairs).toBeGreaterThan(20)
    expect(joins, 'joined a record placed alone').toBeGreaterThan(3)
    expect(soon).toBeGreaterThan(10)
  })

  it('never the same play twice in a row, gaps, watching and short errands not counted; the same two again only now and then (#524)', () => {
    const skip = new Set(['gap', 'watch', 'water', 'fridge', 'dispenser', 'record'])
    let pairs = 0
    let again = 0
    for (const d of [...DAYS, 20_406]) {
      for (const segs of dayPlan(d, FIVE)) {
        const plays = segs.filter((x) => !skip.has(x.kind))
        for (let k = 1; k < plays.length; k++) expect(plays[k].kind, `${new Date(plays[k].start).toISOString()}`).not.toBe(plays[k - 1].kind)
        const games = segs.filter((x) => x.partner)
        for (let k = 1; k < games.length; k++) {
          pairs++
          if (games[k].partner === games[k - 1].partner) again++
        }
      }
    }
    expect(pairs).toBeGreaterThan(100)
    expect(again / pairs, `${again} of ${pairs}`).toBeLessThan(0.05)
  })

  it('a pair game drawn with nobody free within 30 s is a record placed alone (no ping-pong); a record alone is joined when one draws a pair game', () => {
    for (const d of DAYS) {
      const plan = dayPlan(d, FIVE)
      for (const segs of plan)
        for (const s of segs) {
          if (!s.joined) continue
          expect(s.kind).toBe('boardgame_solo')
          const next = segs[segs.indexOf(s) + 1]
          expect(next.kind, 'the game at the same board').toBe('boardgame')
          expect(next.spot).toBe(s.spot)
          expect(next.start).toBe(s.end)
        }
    }
  })
})

describe('at any moment (playAt)', () => {
  it('nobody shares a place; a pair is two together; the busy are out', () => {
    for (const d of DAYS.slice(0, 2))
      for (let t = dayStart(d) + 5 * 3_600_000; t < dayStart(d) + 19 * 3_600_000; t += 37_000) {
        for (const busy of [new Set<string>(), new Set(['agent_2']), new Set(['agent_0', 'agent_3'])]) {
          const out = playAt(t, FIVE, busy)
          for (const a of busy) expect(out[a]).toBeUndefined()
          const places = Object.values(out)
            .filter((o) => o.kind !== 'water' && o.kind !== 'fridge' && o.kind !== 'dispenser' && o.kind !== 'record' && !o.spot.startsWith('work_'))
            .map((o) => o.spot)
          expect(new Set(places).size, `${new Date(t).toISOString()} ${places}`).toBe(places.length)
          for (const [a, o] of Object.entries(out)) if (o.partner) expect(out[o.partner].partner, `${a}`).toBe(a)
        }
      }
  })
  it('one agent busy moves nobody else (only its partner: a record alone at the board, off the ping-pong table alone, #516)', () => {
    for (let t = dayStart(DAYS[2]) + 9 * 3_600_000; t < dayStart(DAYS[2]) + 12 * 3_600_000; t += 41_000) {
      const all = playAt(t, FIVE)
      const less = playAt(t, FIVE, new Set(['agent_1']))
      for (const a of FIVE) {
        if (a === 'agent_1') continue
        if (all[a].partner === 'agent_1') {
          expect(['boardgame_solo', 'gap', 'coffee', 'books']).toContain(less[a].kind)
          expect(less[a].partner).toBeUndefined()
        } else expect(less[a]).toEqual(all[a])
      }
    }
  })
  it('gaps, watching and waiting for a partner all happen', () => {
    const seen = new Set<string>()
    for (let t = dayStart(DAYS[3]) + 9 * 3_600_000; t < dayStart(DAYS[3]) + 23 * 3_600_000; t += 10_000)
      for (const o of Object.values(playAt(t, FIVE))) {
        if (o.gap) seen.add(o.gap)
        if (o.watch) seen.add(`watch:${o.watch}`)
        if (o.label === '탁구 · 짝 기다리는 중') seen.add('wait:pingpong')
        if (o.kind === 'boardgame_solo') seen.add('solo')
      }
    for (const k of ['stretch', 'wander', 'window', 'solo']) expect(seen, k).toContain(k)
    expect([...seen].some((k) => k.startsWith('watch:'))).toBe(true)
  })
  it('the debug panel\'s next change is the soonest end of anybody\'s stay or gap', () => {
    const t = dayStart(DAYS[0]) + 11 * 3_600_000
    const next = nextChange(t, FIVE)
    expect(next).toBeGreaterThan(t)
    expect(playAt(next - 1, FIVE)).not.toEqual(playAt(next + 1, FIVE))
  })
})

describe('likes (#28) over many days', () => {
  const share: Record<string, Record<string, number>> = {}
  for (const d of [...DAYS, 20_410, 20_411, 20_412, 20_413, 20_414, 20_415])
    for (const [i, segs] of dayPlan(d, FIVE).entries())
      for (const s of stays(segs)) {
        share[FIVE[i]] ??= {}
        share[FIVE[i]][s.kind] = (share[FIVE[i]][s.kind] ?? 0) + (s.end - s.start)
      }
  const of = (a: string, k: string) => (share[a][k] ?? 0) / Object.values(share[a]).reduce((x, y) => x + y, 0)
  it('the coder plays ping-pong more than the others; the planner and the 3D agent play board games more than ping-pong', () => {
    for (const other of ['agent_0', 'agent_1', 'agent_2']) expect(of('agent_3', 'pingpong')).toBeGreaterThan(of(other, 'pingpong'))
    for (const a of ['agent_0', 'agent_1']) expect(of(a, 'boardgame')).toBeGreaterThan(of(a, 'pingpong'))
    expect(of('agent_0', 'pingpong')).toBeGreaterThan(0)
  })
  it('one reader at a time (one book)', () => {
    for (const d of DAYS)
      for (let t = dayStart(d) + 9 * 3_600_000; t < dayStart(d) + 23 * 3_600_000; t += 30_000)
        expect(Object.values(playAt(t, FIVE)).filter((o) => o.kind === 'books').length).toBeLessThanOrEqual(1)
  })
})

describe('the night-duty agent (play.md 9.1)', () => {
  it('coffee for 3–6 minutes, a gap, coffee again; quiet and alone; the same for everybody', () => {
    const start = dayStart(DAYS[0])
    let coffees = 0
    let gaps = 0
    for (let t = start + 60_000; t < start + 4 * 3_600_000; t += 20_000) {
      const p = soloAt(t, 'agent_2')
      expect(p.partner).toBeUndefined()
      expect(soloAt(t, 'agent_2')).toEqual(p)
      if (p.kind === 'gap') gaps++
      else {
        expect(NIGHT_PLAYS).toContain(p.kind)
        coffees++
        expect(p.until - p.since).toBeGreaterThanOrEqual(3 * MIN - 1)
        expect(p.until - p.since).toBeLessThanOrEqual(6 * MIN + 1)
      }
    }
    expect(coffees).toBeGreaterThan(gaps)
    expect(gaps).toBeGreaterThan(0)
  })
})

// #516 (play.md 9.2): a ping-pong partner gone to work: the one left puts the paddle down at once, a gap, then the first free solo play for the rest; the
// partner back plays on alone too; never ping-pong again in that stay
describe('a ping-pong pair broken by work (#516)', () => {
  const games = () => {
    const out: { d: number; s: Seg; a: string }[] = []
    for (const d of DAYS.slice(0, 3))
      for (const [i, segs] of dayPlan(d, FIVE).entries())
        for (const s of segs) if (s.kind === 'pingpong' && s.spot === 'pingpong_a' && s.end - s.start > 3 * MIN && s.end < dayStart(d) + 86_400_000) out.push({ d, s, a: FIVE[i] })
    return out
  }
  it('the one left: a stroll from the moment the partner went, then the first free of coffee, books, a record, watching, the window; never back and forth, never the table', () => {
    const list = games()
    expect(list.length).toBeGreaterThan(5)
    let filled = 0
    for (const { s, a } of list) {
      const from = s.start + 40_000
      const alone = { broken: new Map([[s.stay, from]]) }
      const busy = new Set([s.partner!])
      const spots: string[] = []
      for (let t = from; t < s.end; t += 5_000) {
        const o = playAt(t, FIVE, busy, alone)[a]
        expect(o.kind, `${new Date(t).toISOString()}`).not.toBe('pingpong')
        if (t < from + 30_000) expect(o).toMatchObject({ kind: 'gap', gap: 'wander' })
        else {
          if (o.kind !== 'gap') {
            expect(['coffee', 'books', 'boardgame_solo', 'watch']).toContain(o.kind)
            filled++
          }
          // #524: one place after another, never back to one it has left (no stroll to and fro)
          if (spots.at(-1) !== o.spot) {
            expect(spots, `${o.spot} again`).not.toContain(o.spot)
            spots.push(o.spot)
          }
        }
        // the same at the same moment (seeking, another browser)
        expect(playAt(t, FIVE, busy, alone)[a]).toEqual(o)
      }
    }
    expect(filled, 'a solo play fills the rest').toBeGreaterThan(0)
  })

  it('nobody shares a place with the ones playing on alone; the partner back from work plays on alone too, never back to ping-pong', () => {
    for (const { s, a } of games()) {
      const from = s.start + 40_000
      const back = from + 2 * MIN
      if (back + 40_000 >= s.end) continue
      for (let t = back; t < s.end; t += 7_000) {
        const out = playAt(t, FIVE, new Set(), { broken: new Map([[s.stay, from]]), back: { [s.partner!]: back } })
        expect(out[a].kind).not.toBe('pingpong')
        expect(out[s.partner!].kind).not.toBe('pingpong')
        // just back: its own stroll first
        if (t < back + 30_000) expect(out[s.partner!]).toMatchObject({ kind: 'gap', gap: 'wander' })
        const places = Object.values(out).filter((o) => o.kind !== 'gap' && !o.spot.startsWith('work_') && !['water', 'fridge', 'dispenser', 'record'].includes(o.kind)).map((o) => o.spot)
        expect(new Set(places).size, `${new Date(t).toISOString()} ${places}`).toBe(places.length)
      }
    }
  })
})
