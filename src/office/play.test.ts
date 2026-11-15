import { describe, expect, it } from 'vitest'
import {
  EXTEND_MAX_MS, GAP_S, LEAVE_CAP, LEAVE_WINDOW_MS, NIGHT_PLAYS, PAIR_WAIT_MS, PLAYS, STAY_MIN, dayPlan, nextChange, planDay, playAt, soloAt, type Seg,
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
      const leaves = dayPlan(d, FIVE).flatMap((segs) => stays(segs).slice(1).map((s) => s.end)).sort((x, y) => x - y)
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
          const [lo, hi] = STAY_MIN[s.kind as keyof typeof STAY_MIN]
          const from = s.pairAt ?? s.start
          expect(s.end - from, `${s.kind}`).toBeGreaterThanOrEqual(lo * MIN - 1)
          expect(s.end - from, `${s.kind}`).toBeLessThanOrEqual(hi * MIN + EXTEND_MAX_MS + 1)
        }
  })
  it('never the same play twice in a row; a gap of 20–50 s between two stays, never the same gap twice in a row', () => {
    for (const d of DAYS)
      for (const segs of dayPlan(d, FIVE)) {
        const kinds = stays(segs).map((s) => s.kind)
        for (let k = 1; k < kinds.length; k++) if (kinds[k] !== 'watch') expect(kinds[k], `${kinds.slice(k - 1, k + 1)}`).not.toBe(kinds[k - 1])
        const gaps = segs.filter((s) => s.kind === 'gap' && s.gap)
        for (const g of gaps.slice(1)) {
          expect(g.end - g.start).toBeGreaterThanOrEqual(GAP_S[0] * 1000 - 1)
          expect(g.end - g.start).toBeLessThanOrEqual(GAP_S[1] * 1000 + 1)
        }
        for (let k = 1; k < gaps.length; k++) expect(gaps[k].gap).not.toBe(gaps[k - 1].gap)
      }
  })
  it('a pair: the partner comes within 3 minutes, both end together; the first one waits at the table meanwhile', () => {
    let pairs = 0
    let waited = 0
    for (const d of DAYS) {
      const plan = dayPlan(d, FIVE)
      for (const [i, segs] of plan.entries())
        for (const s of segs) {
          if (!s.partner || s.spot !== PLAYS.find((p) => p.kind === s.kind)!.spots[0]) continue
          pairs++
          const other = plan[FIVE.indexOf(s.partner)].find((x) => x.stay === s.stay)!
          expect(other, `${FIVE[i]}'s partner`).toBeDefined()
          expect(other.end).toBe(s.end)
          expect(other.start).toBe(s.pairAt)
          expect(s.pairAt! - s.start).toBeLessThanOrEqual(PAIR_WAIT_MS)
          if (s.pairAt! > s.start + 10_000) waited++
        }
    }
    expect(pairs).toBeGreaterThan(20)
    expect(waited).toBeGreaterThan(5)
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
  it('one agent busy moves nobody else (only its partner, who keeps the table alone)', () => {
    for (let t = dayStart(DAYS[2]) + 9 * 3_600_000; t < dayStart(DAYS[2]) + 12 * 3_600_000; t += 41_000) {
      const all = playAt(t, FIVE)
      const less = playAt(t, FIVE, new Set(['agent_1']))
      for (const a of FIVE) {
        if (a === 'agent_1') continue
        if (all[a].partner === 'agent_1') {
          expect(['boardgame_solo', 'pingpong']).toContain(less[a].kind)
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
