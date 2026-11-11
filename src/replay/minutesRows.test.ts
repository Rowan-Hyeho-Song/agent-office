// A minutes point plays every row of its table (timelapse.md 11): the script, the timing per speed, the cap, the day view's text,
// and a 1:1 row handing a paper between the two seats on the stage.

import { beforeAll, describe, expect, it } from 'vitest'
import { conversations, type DocMeta } from '../docs/library'
import type { Minutes } from '../docs/types'
import { holdMs, typeMs } from '../office/bubbles'
import { frameAt, tagOf } from '../office/meeting'
import { MeetingRunner } from '../office/meetingRun'
import { GATHER_RESERVE_MS, MINUTES_CAP_MS, PASS_MS, READ_MS, captionOf, passOf, planScript, trimMinutes } from '../office/minutes'
import { loadOffice } from '../office/glbLoad'
import { FOOTPRINT_DATA } from '../office/footprint.data'
import { buildGrid, decodeFootprint } from '../office/grid'
import { GRAPH } from '../office/navSpots.fixture'
import { DeskStuff, Furniture, chooseMethod, type Env } from '../office/paperPass'
import { TrafficPlanner } from '../office/traffic'
import type { Point } from '../timeline/types'
import agentOffice from '../timeline/fixtures/agent-office.json'
import { atMs } from './engine'
import { minutesExtraMs, noteMinutes, progressText } from './minutesInfo'
import { minutesDocOf, scriptFor } from './scene'
import { Stage, startMinutes } from './stage'
import { ReplayStore } from './store'

const POINTS = agentOffice.points as unknown as Point[]
const FROM = 30
const point = POINTS.find((p) => p.kind === 'minutes')!

const meta = (over: Partial<DocMeta> = {}): DocMeta => ({
  id: 41, kind: 'minutes', repo: 'o/r', folder: 414, title: 'T', agents: [1, 2], labels: [], grade: 'public', approved: true, readable: true, created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', ...over,
})
type Row = Minutes['rows'][number]
const row = (order: number, from: Row['from'], to: Row['to'], text: string): Row => ({ order, from, to, text })
const table = (rows: Row[]) => conversations({ minutes: [{ date: '2026-11-11', rows, decision: null, followUp: null }] })

/** three agents: 메시(1) 휴(2) 루프(3) and the owner */
const three = table([
  row(1, { seat: 1 }, [{ seat: 2 }], '타임랩스 회의록을 줄마다 보여 주자. 표 순서대로요'),
  row(2, { seat: 2 }, [{ seat: 3 }], '좋아요.'),
  row(3, { owner: true }, [{ seat: 2 }], '진행해 주세요'),
  row(4, { seat: 3 }, [{ owner: true }], '네, 알겠습니다'),
  row(5, { seat: 3 }, [{ seat: 1 }], '가'.repeat(60)),
])
/** two agents only: 메시 and 휴, taking turns */
const two = (n: number, text = '확인 부탁해요.') => table(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? row(i + 1, { seat: 1 }, [{ seat: 2 }], text) : row(i + 1, { seat: 2 }, [{ seat: 1 }], text))))
const GAP = 400

describe('the rows of a minutes point', () => {
  it('plays every row of the table in table order, not the first two', () => {
    const s = scriptFor(point, meta(), three, false)
    expect(s.lines.map((l) => l.key)).toEqual(['1-1', '1-2', '1-3', '1-4', '1-5'])
    expect(s.lines.map((l) => [l.from, l.to, l.toOwner])).toEqual([[1, [2], false], [2, [3], false], ['owner', [2], false], [3, [], true], [3, [1], false]])
    expect(s.lines.map((l) => l.row)).toEqual([1, 2, 3, 4, 5])
    expect(s.decision).toBeNull()
    expect(s.followUps).toEqual([])
    // more than the live meeting's 8 rows
    const long = table(Array.from({ length: 11 }, (_, i) => row(i + 1, { seat: 1 }, [{ seat: 2 }], `말 ${i}`)))
    expect(scriptFor(point, meta(), long, false).minutes!.rows).toHaveLength(11)
  })

  it('3+ agents gather, exactly 2 walk (one row: a paper from the desk), the owner is not an agent', () => {
    expect(scriptFor(point, meta(), three, false).minutes!.mode).toBe('gather')
    // timelapse.md 12.3: a 1:1 of several rows is walked to, and hands one paper over with its last row; a one-row 1:1 passes it from the desk
    const walk = scriptFor(point, meta(), two(3), false)
    expect(walk.minutes!.mode).toBe('walk')
    expect(walk.seats).toEqual([1, 2])
    expect(walk.lines.map((l) => !!l.pass)).toEqual([false, false, true])
    const pair = scriptFor(point, meta(), two(1), false)
    expect(pair.minutes!.mode).toBe('pair')
    expect(pair.lines.every((l) => l.pass)).toBe(true)
    // one agent and the owner: nobody walks and nothing is handed over
    const lone = scriptFor(point, meta(), table([row(1, { owner: true }, [{ seat: 2 }], '해 주세요'), row(2, { seat: 2 }, [{ owner: true }], '했어요')]), false)
    expect(lone.minutes!.mode).toBe('seat')
    expect(lone.lines.some((l) => l.pass)).toBe(false)
    // 기획 is the memo (seat 0) like any agent
    expect(scriptFor(point, meta(), table([row(1, { seat: 0 }, [{ seat: 2 }], '시작해요'), row(2, { seat: 2 }, [{ seat: 0 }], '네')]), false).seats).toEqual([0, 2])
  })

  it('the bubble tab says who it is said to; a row to the owner says 주인', () => {
    const s = scriptFor(point, meta(), three, false)
    expect(s.lines.map(tagOf)).toEqual(['→ 휴', '→ 루프', '→ 휴', '→ 주인', '→ 메시'])
    // the frame of a line carries the tag and the addressee (the receiver turns its head to the speaker)
    const f = frameAt(s, s.lines[1].startMs + 10)
    expect(f.speaker).toBe(2)
    expect(f.addressee).toBe(3)
    expect(f.bubbles.find((b) => b.seat === 2)!.tag).toBe('→ 루프')
  })

  it('a bubble holds the first sentence, 36 characters at most with an ellipsis', () => {
    const s = scriptFor(point, meta(), three, false)
    expect(s.lines[0].text).toBe('타임랩스 회의록을 줄마다 보여 주자.')
    expect([...s.lines[4].text]).toHaveLength(36)
    expect(s.lines[4].text.endsWith('…')).toBe(true)
  })

  it('a row from the owner is typed on the door screen as one terminal line', () => {
    const s = scriptFor(point, meta(), three, false)
    const l = s.lines[2]
    const f = frameAt(s, l.startMs + l.typeMs + 1)
    expect(f.speaker).toBeNull()
    expect(f.addressee).toBe(2)
    expect(f.door!.text).toBe('> 주인 → 휴: 진행해 주세요')
    expect(f.door!.typed).toBe([...f.door!.text].length)
    // typed a few characters in
    expect(frameAt(s, l.startMs + 40).door!.typed).toBeLessThan([...f.door!.text].length)
    // the owner has no bubble
    expect(f.bubbles.some((b) => b.text === '진행해 주세요')).toBe(false)
  })

  it('SECRET: the bubble body is a black bar, the door line too, and no row opens', () => {
    const masked = scriptFor(point, meta({ approved: false, grade: 'review' }), three, false)
    expect(masked.lines.every((l) => l.masked && l.full === '' && /^[█ …]+$/.test(l.text))).toBe(true)
    const door = frameAt(masked, masked.lines[2].startMs + masked.lines[2].typeMs + 1).door!
    expect(door.masked).toBe(true)
    expect(door.text).toMatch(/^> 주인 → 휴: [█ ]+$/)
    const cover = scriptFor(point, undefined, null, false)
    expect(cover.lines.every((l) => /^[█ ]+$/.test(l.text))).toBe(true)
    expect(frameAt(cover, 10).bubbles.every((b) => b.row === null)).toBe(true)
  })

  it('an absent agent drops its rows and the rest is timed again', () => {
    const s = trimMinutes(scriptFor(point, meta(), three, false), [1, 2])
    // 루프's own rows are gone; 휴's row to 루프 stays as a bubble (no receiver here, so no paper)
    expect(s.lines.map((l) => l.key)).toEqual(['1-1', '1-2', '1-3'])
    expect(s.lines.map((l) => !!l.pass)).toEqual([true, false, false])
    expect(s.minutes!.mode).toBe('walk')
  })
})

describe('time per speed (11.4)', () => {
  const long = '가나다라마바사아자차카타파하'.repeat(3)
  it('x1: typing then dwell (1.6 s + 70 ms a character, 6 s at most), 0.4 s between rows', () => {
    const s = scriptFor(point, meta(), three, false, 1)
    s.lines.forEach((l, i) => {
      const len = [...(l.from === 'owner' ? `> 주인 → 휴: ${l.text}` : l.text)].length
      expect(l.typeMs).toBeCloseTo(typeMs(len), 6)
      expect(l.holdMs).toBeCloseTo(holdMs(len) + GAP, 6)
      if (i) expect(l.startMs).toBeCloseTo(s.lines[i - 1].startMs + s.lines[i - 1].typeMs + s.lines[i - 1].holdMs, 6)
    })
  })
  it('x4: no typing, dwell / 4 but 0.8 s at least (in replay ms: x4), 0.1 s between', () => {
    const s = scriptFor(point, meta(), table([row(1, { seat: 1 }, [{ seat: 2 }], '네'), row(2, { seat: 2 }, [{ seat: 3 }], long), row(3, { seat: 3 }, [{ seat: 1 }], '좋아요')]), false, 4)
    for (const l of s.lines) {
      expect(l.typeMs).toBe(0)
      const dwell = l.holdMs - GAP
      expect(dwell / 4).toBeGreaterThanOrEqual(800 - 1e-6)
      expect(dwell).toBeCloseTo(Math.max(3200, holdMs([...l.text].length)), 6)
    }
  })
  it('x16: the caption line only, 0.3 s a row, no passes', () => {
    const s = scriptFor(point, meta(), two(4), false, 16)
    expect(s.lines.every((l) => l.typeMs === 0 && l.holdMs === 4800 && !l.pass)).toBe(true)
    expect(s.lines[0].holdMs / 16).toBeCloseTo(300, 6)
    expect(s.minutes!.mode).toBe('walk')
  })
  it('1:1: a row is the pass plus 1.5 s of reading (x1 and x4: the same replay time, so a quarter of it on the wall at x4)', () => {
    for (const speed of [1, 4]) {
      const s = scriptFor(point, meta(), two(1), false, speed)
      for (const l of s.lines) {
        expect(l.pass).toBe(true)
        expect(l.typeMs + l.holdMs).toBe(PASS_MS + READ_MS + GAP)
        expect(l.readAt).toBe(PASS_MS)
      }
      // a walking 1:1: only its last row is the hand-over; the rows before it are bubbles
      const w = scriptFor(point, meta(), two(3), false, speed)
      expect(w.lines.filter((l) => l.pass)).toHaveLength(1)
      expect(w.lines[2].pass).toBe(true)
      expect(w.lines[2].typeMs + w.lines[2].holdMs).toBe(PASS_MS + READ_MS + GAP)
    }
  })
  it('reduced motion: no gathering, no passes, bubbles in turn with the x1 times', () => {
    const s = scriptFor(point, meta(), three, true, 16)
    expect(s.minutes!.mode).toBe('seat')
    expect(s.lines.some((l) => l.pass)).toBe(false)
    expect(s.lines.every((l) => l.typeMs === 0)).toBe(true)
    expect(s.lines[0].holdMs).toBeCloseTo(holdMs([...s.lines[0].text].length) + GAP, 6)
  })
  it('timing again for another speed keeps the table and changes only the times', () => {
    const a = scriptFor(point, meta(), three, false, 1)
    const b = planScript(a, { speed: 16 })
    expect(b.lines.map((l) => l.key)).toEqual(a.lines.map((l) => l.key))
    expect(b.lines[0].holdMs).toBe(4800)
  })
})

describe('the 60 s cap (11.4)', () => {
  const sentence = '가'.repeat(34)
  const rotate = (n: number, text: string) => table(Array.from({ length: n }, (_, i) => row(i + 1, { seat: (1 + (i % 3)) as 1 | 2 | 3 }, [{ seat: (1 + ((i + 1) % 3)) as 1 | 2 | 3 }], text)))
  it('shrinks the dwell proportionally, never under 1.2 s a row, and fits the cap', () => {
    const s = scriptFor(point, meta(), rotate(13, sentence), false, 1)
    expect(s.lines).toHaveLength(13)
    expect(s.linesMs).toBeLessThanOrEqual(MINUTES_CAP_MS - GATHER_RESERVE_MS + 1e-6)
    expect(s.linesMs).toBeGreaterThan(MINUTES_CAP_MS - GATHER_RESERVE_MS - 50)
    for (const l of s.lines) expect(l.holdMs - GAP).toBeGreaterThanOrEqual(1200 - 1e-6)
    const ratio = (l: (typeof s.lines)[number]) => (l.holdMs - GAP) / holdMs([...l.text].length)
    expect(ratio(s.lines[0])).toBeCloseTo(ratio(s.lines[12]), 6)
    expect(ratio(s.lines[0])).toBeLessThan(1)
  })
  it('a short table is not touched', () => {
    const s = scriptFor(point, meta(), three, false, 1)
    expect(s.lines[1].holdMs).toBeCloseTo(holdMs([...s.lines[1].text].length) + GAP, 6)
  })
  it('too many rows even at 1.2 s: the first 8 and the last 4, one grey bubble `· · · N줄` for 1 s between', () => {
    const s = scriptFor(point, meta(), rotate(40, '말이에요.'), false, 1)
    expect(s.lines).toHaveLength(8 + 1 + 4)
    expect(s.lines.slice(0, 8).map((l) => l.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(s.lines.slice(9).map((l) => l.row)).toEqual([37, 38, 39, 40])
    const gap = s.lines[8]
    expect(gap.text).toBe('· · · 28줄')
    expect(gap.gap).toBe(28)
    expect(gap.typeMs + gap.holdMs).toBe(1000)
    expect(s.linesMs).toBeLessThanOrEqual(MINUTES_CAP_MS)
    // the marker shows as a grey (dim) bubble of the last speaker before it, with no row to open
    const f = frameAt(s, gap.startMs + 1)
    const b = f.bubbles.find((x) => x.text === '· · · 28줄')!
    expect(b.dim).toBe(true)
    expect(b.row).toBeNull()
    expect(b.seat).toBe(s.lines[7].from)
  })
  it('1:1 rows: 40 rows do not fit, so the first 8 and the last 4 are played and the last one hands the paper over', () => {
    const s = scriptFor(point, meta(), two(40), false, 1)
    expect(s.lines.filter((l) => !l.gap)).toHaveLength(12)
    expect(s.lines.filter((l) => l.pass)).toHaveLength(1)
    expect(s.lines[s.lines.length - 1].pass).toBe(true)
    expect(s.lines[8].gap).toBe(28)
    expect(s.linesMs).toBeLessThanOrEqual(MINUTES_CAP_MS)
  })
  it('every speed fits the cap', () => {
    for (const speed of [1, 4, 16]) {
      const s = scriptFor(point, meta(), rotate(50, sentence), false, speed)
      expect(s.linesMs).toBeLessThanOrEqual(MINUTES_CAP_MS - GATHER_RESERVE_MS)
    }
  })
})

describe('the caption line and the day view', () => {
  it('a row reads `메시 → 휴 — 내용`; the owner is 주인', () => {
    const s = scriptFor(point, meta(), three, false)
    expect(captionOf(s.lines[0])).toEqual({ seat: 1, who: '메시 → 휴', text: '— 타임랩스 회의록을 줄마다 보여 주자.' })
    expect(captionOf(s.lines[2])!.who).toBe('주인 → 휴')
    expect(captionOf(s.lines[3])!.who).toBe('루프 → 주인')
  })
  it('the position text gets `회의 4/9줄`', () => {
    expect(progressText({ row: 4, total: 9 })).toBe('회의 4/9줄')
    expect(progressText(null)).toBeNull()
    expect(progressText({ row: 0, total: 9 })).toBeNull()
  })
  it("the remaining time includes the rows beyond the point's own 4.5 s", () => {
    const p = { ...point, key: 'only-for-this-test' }
    expect(minutesExtraMs(p, 1)).toBe(0)
    const s = scriptFor(p, meta(), two(6), false)
    noteMinutes(p, s)
    expect(minutesExtraMs(p, 1)).toBeCloseTo(s.linesMs - 4500, 6)
    expect(minutesExtraMs(p, 16)).toBeCloseTo(6 * 4800 - 4500, 6)
  })
})

describe('a 1:1 row hands a paper over on the stage', () => {
  let env: Env
  beforeAll(async () => {
    const { nodes } = await loadOffice()
    env = { furniture: Furniture.from(nodes), desks: DeskStuff.from(nodes), others: [] }
  })

  async function play(speed: 1 | 4 | 16, convs: ReturnType<typeof table>, m: DocMeta, until: number) {
    const store = new ReplayStore()
    store.source = async () => POINTS
    await store.open({ project: 'all', t: atMs(POINTS[FROM]), mode: 'office' })
    store.setSpeed(speed)
    const meeting = new MeetingRunner()
    const present = { agent_0: { state: 'idle' }, agent_1: { state: 'idle' }, agent_2: { state: 'idle' }, agent_3: { state: 'idle' } } as never
    let started = false
    store.onPoint((p, via) => {
      meeting.stop()
      // only the first minutes point of the stretch plays the table
      if (via === 'play' && p.kind === 'minutes' && !started && (started = true)) startMinutes(meeting, p, m, convs, store.landedClock, present, speed)
    })
    const passes: { from: string; to: string; at: number }[] = []
    const ids = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
    const stage: Stage = new Stage({
      store,
      planner: new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH),
      meeting,
      ids,
      door: GRAPH.spots.door ? { x: GRAPH.spots.door.x, z: GRAPH.spots.door.z } : undefined,
      reduced: () => false,
      spot: (id) => GRAPH.spots[id] ?? null,
      pass: (from, to) => passes.push({ from, to, at: stage.clock }),
    })
    store.play()
    stage.begin()
    const phases = new Set<string | null>()
    const spots = new Set<string>()
    // the closest the two bodies were while the rows played (m)
    let beside = Infinity
    while (stage.clock < until) {
      stage.frame(1000 / 60, until)
      phases.add(meeting.phase)
      if (meeting.phase === 'lines') {
        for (const id of ['agent_1', 'agent_2']) spots.add(`${id}:${stage.goals[id]?.spot}`)
        const a = stage.sample('agent_1')
        const b = stage.sample('agent_2')
        if (a.arrived && b.arrived) beside = Math.min(beside, Math.hypot(a.x - b.x, a.z - b.z))
      }
    }
    return { passes, phases, spots, beside: Number.isFinite(beside) ? beside : 0 }
  }

  // the two seats' own distance rule (paper-pass.md 1)
  const method = (a: number, b: number) => chooseMethod(GRAPH.spots[`work_${a}`] as never, GRAPH.spots[`work_${b}`] as never, env).method

  it('a one-row 1:1 passes its paper from the desk (no walking, no gathering); a several-row one walks and hands one paper over with its last row (12.3)', async () => {
    const one = await play(1, two(1), meta(), 70_000)
    expect(one.passes.map((p) => [p.from, p.to])).toEqual([['agent_1', 'agent_2']])
    expect(one.phases.has('gather')).toBe(false)
    expect(one.phases.has('lines')).toBe(true)
    const r = await play(1, two(4), meta(), 70_000)
    // one hand-over, by the last row's sender (메시 asks first, 휴 answers last)
    expect(r.passes.map((p) => [p.from, p.to])).toEqual([['agent_2', 'agent_1']])
    // the first sender walks to the receiver: a gather phase, then the rows
    expect(r.phases.has('gather')).toBe(true)
    expect(r.phases.has('lines')).toBe(true)
    expect(r.beside).toBeGreaterThan(0)
    expect(r.beside).toBeLessThanOrEqual(1.0)
    // the method PaperPasses.choose gives for these two seats is the distance rule's: 1.2 m apart is a hand-over
    expect(method(1, 2)).toBe('hand')
    expect(method(2, 1)).toBe('hand')
  }, 60_000)

  it('the method follows the distance of the two seats (across the desk: a slide, the diagonal: a toss)', () => {
    expect(method(2, 3)).toBe('slide')
    expect(method(2, 4)).toBe('toss')
  })

  it('x4 runs on the replay clock too (the same passes); x16 is the caption line and passes nothing', async () => {
    const fast = await play(4, two(1), meta(), 60_000)
    expect(fast.passes).toHaveLength(1)
    expect((await play(4, two(3), meta(), 60_000)).passes).toHaveLength(1)
    const caption = await play(16, two(3), meta(), 60_000)
    expect(caption.passes).toHaveLength(0)
    // ... and the sender still walks to the receiver at x16 (an event is walked, 12.2)
    expect(caption.phases.has('gather')).toBe(true)
  }, 60_000)

  it('the pass is read from the script: only a row between two different agents', () => {
    const s = scriptFor(point, meta(), two(1), false)
    expect(passOf(s, 0)).toEqual({ key: '41:1-1', from: 1, to: 2 })
    expect(passOf(s, 5)).toBeNull()
    const w = scriptFor(point, meta(), two(2), false)
    expect(passOf(w, 0)).toBeNull()
    expect(passOf(w, 1)).toEqual({ key: '41:1-2', from: 2, to: 1 })
    expect(passOf(scriptFor(point, meta(), three, false), 0)).toBeNull()
  })
})

describe('which document a minutes point plays (#414 review: the words came out as bars)', () => {
  const at = (p: Point, t: string, issue = 414): Point => ({ ...p, project: 'o/r', issue, at: t })
  const docs = [
    meta({ id: 1, created_at: '2026-11-10T01:00:00Z' }),
    meta({ id: 2, created_at: '2026-11-10T05:30:00Z' }),
    meta({ id: 3, folder: 999, created_at: '2026-11-10T05:30:00Z' }),
    meta({ id: 4, kind: 'plan', created_at: '2026-11-10T05:30:00Z' }),
  ]

  it('the minutes filed from the same comment: same issue, same time (an issue has one document per minutes comment)', () => {
    expect(minutesDocOf(docs, at(point, '2026-11-10T05:30:00Z'))?.id).toBe(2)
    expect(minutesDocOf(docs, at(point, '2026-11-10T01:00:00Z'))?.id).toBe(1)
    // the old match took the issue's first minutes for every point of it
    expect(minutesDocOf(docs, at(point, '2026-11-10T09:00:00Z'))).toBeUndefined()
    expect(minutesDocOf(null, at(point, '2026-11-10T05:30:00Z'))).toBeUndefined()
    expect(minutesDocOf(docs, { ...at(point, '2026-11-10T05:30:00Z'), issue: null })).toBeUndefined()
  })

  it('a public, approved document plays its real words (not bars), in bubbles, on the door and in the caption', () => {
    const p = at(point, '2026-11-10T05:30:00Z')
    const s = scriptFor(p, minutesDocOf(docs, p), three, false)
    expect(s.masked).toBe(false)
    expect(s.lines.some((l) => /█/.test(l.text))).toBe(false)
    expect(s.lines[0].text).toBe('타임랩스 회의록을 줄마다 보여 주자.')
    const l = s.lines[2]
    expect(frameAt(s, l.startMs + l.typeMs + 1).door!.text).toBe('> 주인 → 휴: 진행해 주세요')
    expect(scriptFor(p, minutesDocOf(docs, p), two(2), false, 16).lines.every((x) => !x.masked)).toBe(true)
  })

  it('a document the library holds back (SECRET: in review, waiting for the owner): the rows when this viewer can read them (the owner), the words as bars; a visitor gets no rows: an invented scene of bars', () => {
    const p = at(point, '2026-11-10T05:30:00Z')
    const review = meta({ id: 2, created_at: '2026-11-10T05:30:00Z', grade: 'review', approved: false, readable: true })
    const owner = scriptFor(p, minutesDocOf([review], p), three, false)
    expect(owner.lines.map((l) => l.from)).toEqual([1, 2, 'owner', 3, 3])
    expect(owner.lines.every((l) => l.masked)).toBe(true)
    const visitor = scriptFor(p, minutesDocOf([{ ...review, readable: false }], p), null, false)
    expect(visitor.lines.every((l) => /^[█ ]+$/.test(l.text))).toBe(true)
  })
})
