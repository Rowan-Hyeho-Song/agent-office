import { describe, expect, it } from 'vitest'
import { beatAt, beatsOf, piecesOf, planBoard, planDesk, REREAD_LABEL, startWrap, stepWrap, tidyBeats, totalOf, TOUCH_LABEL, viewOf, WRAP, WRAP_LABEL, WRAP_SPAN_MS, wrapTarget, type Beat, type PieceKind, type WrapInput, type WrapRun, type WrapStep } from './wrap'

const base: WrapInput = { now: 0, atDesk: true, atBoard: false, boardTaken: false, boardBusy: false, reduced: false }
const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
/** the pieces that may follow themselves (wrapup.md 4) */
const MAY_REPEAT: PieceKind[] = ['line', 'newline', 'post', 'point']

/** run a wrap-up in 100 ms frames; `world` says where the agent is / whether the board is taken at each moment (s since the start) */
function drive(agent: string, world: (s: number, run: WrapRun) => Partial<WrapInput>, opts: { seconds?: number; atDesk?: boolean; reduced?: boolean; since?: number } = {}) {
  let run: WrapRun = startWrap(agent, opts.since ?? 1, 0, opts.atDesk ?? true, { reduced: opts.reduced })
  const steps: { s: number; step: WrapStep; label: string }[] = []
  const frames: { s: number; run: WrapRun; piece?: PieceKind; kind?: string }[] = []
  let doneAt: number | null = null
  for (let ms = 0; ms <= (opts.seconds ?? 130) * 1000; ms += 100) {
    const inp = { ...base, reduced: !!opts.reduced, now: ms, ...world(ms / 1000, run) }
    const r = stepWrap(run, inp)
    run = r.run
    if (r.done) {
      doneAt = ms / 1000
      break
    }
    const v = viewOf(run, inp)
    frames.push({ s: ms / 1000, run, piece: v.beat?.piece, kind: v.beat?.kind })
    if (!steps.length || steps[steps.length - 1].label !== v.label) steps.push({ s: ms / 1000, step: v.step, label: v.label })
  }
  return { steps, doneAt, run, frames }
}

/** a world where the walks take 4 s each way and nothing else is in the way */
const calmWorld = (s: number, run: WrapRun): Partial<WrapInput> => ({
  atDesk: run.step === 'seat' ? s - run.t0 / 1000 >= 4 : run.step === 'write' || run.step === 'tidy',
  atBoard: run.step === 'walk' && s - run.t0 / 1000 >= 4,
})

const pieces = (beats: Beat[]) => piecesOf(beats)

describe('the numbers (wrapup.md 7)', () => {
  it('are the designed ones', () => {
    expect(WRAP).toMatchObject({ cardsMin: 2, cardsMax: 5, newline: 0.3, tapPen: 0.8, strike: 1.4, readUp: 1.8, next: 0.6, back: 0.6, forth: 0.6, move: 1.4, swap: 2.4, straighten: 0.7, point: 0.5, final: 0.8, fillBefore: 6, deskShare: 0.45, noRepeat: 3, waitMs: 20000 })
    expect(WRAP.line).toEqual([1.6, 2.4])
    expect(WRAP.lines).toEqual([3, 5])
    expect(WRAP.flourishes).toEqual([1, 2])
    expect(WRAP.think).toEqual([2.5, 4])
    expect(WRAP.points).toEqual([2, 4])
    expect(WRAP_SPAN_MS).toBe(2 * 60_000)
  })

  it('the posting is still 1.2 s a card with 0.3 s between, the tidy-up 1.6 s (two taps)', () => {
    const b = planBoard('agent_0', 1, 3, 0)
    expect(totalOf(b.filter((x) => x.piece === 'post'))).toBeCloseTo(1.2 * 3 + 0.3 * 2)
    expect(totalOf(tidyBeats())).toBeCloseTo(1.6)
  })

  it('the target is the display time left less 6 s', () => {
    expect(wrapTarget(0, 0)).toBeCloseTo(114)
    expect(wrapTarget(0, 60_000)).toBeCloseTo(54)
    expect(wrapTarget(0, 200_000)).toBe(0)
  })
})

describe('the desk pieces (section 2)', () => {
  it('2..5 cards of 3..5 lines each, a card ends with the push to the stack, a card takes 6..12 s', () => {
    for (const a of AGENTS)
      for (let since = 0; since < 12; since++) {
        const { beats, cards } = planDesk(a, since, 40)
        expect(cards).toBeGreaterThanOrEqual(2)
        expect(cards).toBeLessThanOrEqual(5)
        for (let k = 0; k < cards; k++) {
          const own = beats.filter((b) => b.k === k)
          const lines = own.filter((b) => b.kind === 'line').length
          expect(lines).toBeGreaterThanOrEqual(3)
          expect(lines).toBeLessThanOrEqual(5)
          expect(own.at(-1)!.kind).toBe('next')
          const flourishes = own.filter((b) => ['tapPen', 'strike', 'readUp'].includes(b.kind)).length
          expect(flourishes).toBeLessThanOrEqual(2)
          expect(totalOf(own)).toBeGreaterThanOrEqual(4.5)
          expect(totalOf(own)).toBeLessThanOrEqual(16)
        }
      }
  })

  it('a line is 1.6–2.4 s, the other pieces the designed time', () => {
    const { beats } = planDesk('agent_2', 5, 60)
    for (const b of beats) {
      if (b.kind === 'line') {
        expect(b.dur).toBeGreaterThanOrEqual(1.6 * 0.85 - 0.06)
        expect(b.dur).toBeLessThanOrEqual(2.4 + 1e-9)
      } else expect(b.dur).toBeCloseTo({ newline: 0.3, tapPen: 0.8, strike: 1.4, readUp: 1.8, next: 0.6 }[b.kind as 'newline']!, 5)
    }
  })

  it('fills the desk time: the cards written take the budget, at most one card more or less', () => {
    for (const budget of [32, 41, 50, 70]) {
      const { beats } = planDesk('agent_1', 3, budget, null)
      expect(totalOf(beats)).toBeLessThanOrEqual(budget + 1e-9)
      expect(totalOf(beats)).toBeGreaterThan(budget - 15)
    }
  })

  it('never the same piece twice in a row (a line, a new line, a post, a point may), and a habit not within the last three', () => {
    for (const a of AGENTS)
      for (let since = 0; since < 40; since++) {
        const p = pieces(planDesk(a, since, 60, null).beats)
        for (let i = 1; i < p.length; i++) if (!MAY_REPEAT.includes(p[i])) expect(p[i]).not.toBe(p[i - 1])
        for (let i = 0; i < p.length; i++)
          if (['tapPen', 'strike', 'readUp'].includes(p[i])) for (const q of p.slice(Math.max(0, i - 3), i)) expect(q).not.toBe(p[i])
      }
  })

  it('is the same for the same wrap-up (#135) and differs with the start', () => {
    const a = planDesk('agent_3', 77, 40)
    expect(planDesk('agent_3', 77, 40)).toEqual(a)
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(JSON.stringify(planDesk('agent_3', 100 + i, 40).beats.map((b) => b.kind)))
    expect(seen.size).toBeGreaterThan(10)
  })

  it('every flourish shows up across the agents, and each agent leans to its own (x2 weight)', () => {
    const count = (a: string, kind: string) => {
      let n = 0
      for (let since = 0; since < 150; since++) n += planDesk(a, since, 60, null).beats.filter((b) => b.kind === kind).length
      return n
    }
    for (const k of ['tapPen', 'strike', 'readUp']) expect(AGENTS.reduce((s, a) => s + count(a, k), 0)).toBeGreaterThan(0)
    expect(count('agent_2', 'strike')).toBeGreaterThan(count('agent_3', 'strike'))
    expect(count('agent_3', 'tapPen')).toBeGreaterThan(count('agent_2', 'tapPen'))
    expect(count('agent_1', 'readUp')).toBeGreaterThan(count('agent_0', 'readUp'))
  })
})

describe('the board pieces (section 3)', () => {
  it('post every card first (one or two crooked), then the mixed pieces, then the last look', () => {
    for (const a of AGENTS)
      for (let since = 0; since < 20; since++) {
        const n = 2 + (since % 4)
        const b = planBoard(a, since, n, 45)
        const posts = b.filter((x) => x.piece === 'post')
        expect(b.slice(0, posts.length)).toEqual(posts)
        expect(posts.filter((x) => x.kind === 'pick')).toHaveLength(n)
        const crooked = posts.filter((x) => x.kind === 'pick' && x.v === 1).length
        expect(crooked).toBeGreaterThanOrEqual(1)
        expect(crooked).toBeLessThanOrEqual(2)
        expect(b.at(-1)).toMatchObject({ kind: 'final', dur: 0.8 })
        const mixed = b.slice(posts.length, -1)
        expect(mixed.length).toBeGreaterThan(0)
        expect(mixed.every((x) => ['back', 'think', 'forth', 'move', 'swap', 'straighten', 'point'].includes(x.kind))).toBe(true)
      }
  })

  it('the mixed pieces: thinking is stepping back 0.6 + 2.5–4 + coming back 0.6; moving 1.4; swapping 2.4; straightening 0.7; 2–4 points of 0.5', () => {
    const b = planBoard('agent_0', 9, 4, 80)
    const think = b.filter((x) => x.piece === 'think')
    expect(think.length % 3).toBe(0)
    for (let i = 0; i < think.length; i += 3) {
      expect(think.slice(i, i + 3).map((x) => x.kind)).toEqual(['back', 'think', 'forth'])
      expect(think[i].dur).toBe(0.6)
      expect(think[i + 1].dur).toBeGreaterThanOrEqual(2.5)
      expect(think[i + 1].dur).toBeLessThanOrEqual(4)
      expect(think[i + 2].dur).toBe(0.6)
    }
    for (const [kind, dur] of [['move', 1.4], ['swap', 2.4], ['straighten', 0.7], ['point', 0.5]] as const) for (const x of b.filter((y) => y.kind === kind)) expect(x.dur).toBe(dur)
    // pointing is 2..4 in a row
    let run = 0
    const runs: number[] = []
    for (const x of b) {
      if (x.kind === 'point') run++
      else if (run) (runs.push(run), (run = 0))
    }
    for (const r of runs) expect(r).toBeGreaterThanOrEqual(2)
    for (const r of runs) expect(r).toBeLessThanOrEqual(4)
  })

  it('fills the board time, never repeats a piece back to back and rarely within the last three (the window narrows only when nothing else is left); each think habit once', () => {
    let habits = 0
    let inWindow = 0
    for (const a of AGENTS)
      for (let since = 0; since < 40; since++) {
        const n = 2 + (since % 4)
        const budget = 30 + (since % 4) * 10
        const b = planBoard(a, since, n, budget)
        expect(totalOf(b)).toBeLessThanOrEqual(budget + 1e-9)
        expect(totalOf(b)).toBeGreaterThan(budget - 6)
        const p = pieces(b)
        for (let i = 1; i < p.length; i++) if (!MAY_REPEAT.includes(p[i])) expect(p[i]).not.toBe(p[i - 1])
        for (let i = 0; i < p.length; i++)
          if (['think', 'move', 'swap', 'straighten'].includes(p[i])) {
            habits++
            if (p.slice(Math.max(0, i - 3), i).includes(p[i])) inWindow++
          }
        const thinks = b.filter((x) => x.kind === 'think').map((x) => x.v)
        expect(new Set(thinks).size).toBe(thinks.length)
        expect(thinks.length).toBeLessThanOrEqual(3)
        expect(b.filter((x) => x.kind === 'straighten').length).toBeLessThanOrEqual(2)
      }
    expect(inWindow / habits).toBeLessThan(0.05)
  })

  it('a swap names the second card, never the first', () => {
    for (let since = 0; since < 30; since++)
      for (const s of planBoard('agent_2', since, 3, 60).filter((x) => x.kind === 'swap')) {
        expect(s.v).not.toBe(s.k)
        expect(s.v).toBeLessThan(3)
      }
  })

  it('all three think habits and the five characters show up across wrap-ups', () => {
    const habits = new Set<number>()
    const kinds = new Set<string>()
    for (const a of AGENTS)
      for (let since = 0; since < 30; since++)
        for (const x of planBoard(a, since, 4, 60)) {
          kinds.add(x.kind)
          if (x.kind === 'think') habits.add(x.v!)
        }
    expect([...habits].sort()).toEqual([0, 1, 2])
    for (const k of ['move', 'swap', 'straighten', 'point', 'think', 'final']) expect(kinds.has(k)).toBe(true)
  })

  it('at the fast replay (x16) only posting and the last look are left', () => {
    const b = planBoard('agent_1', 4, 3, 60, 2.4)
    expect(new Set(b.map((x) => x.piece))).toEqual(new Set(['post', 'final']))
    expect(tidyBeats(2.4).filter((x) => x.kind === 'tap')).toHaveLength(1)
    expect(tidyBeats(0.6).filter((x) => x.kind === 'tap')).toHaveLength(2)
    for (const x of b) if (x.kind !== 'gap') expect(x.dur).toBeGreaterThanOrEqual(2.4 - 1e-9)
  })

  it('beatAt finds the beat and how far into it; past the end it stays on the last', () => {
    const b = tidyBeats()
    expect(beatAt(b, 0.1)).toMatchObject({ beat: { kind: 'gather' }, u: expect.closeTo(1 / 3, 5) })
    expect(beatAt(b, 0.4).beat.kind).toBe('tap')
    expect(beatAt(b, 99)).toMatchObject({ beat: { kind: 'lean' }, u: 1 })
  })
})

describe('the wrap-up fills the time (section 1)', () => {
  it('seated, board free: write -> walk -> post -> back -> tidy -> done, with the labels, ending about 6 s before the display does', () => {
    for (const a of AGENTS) {
      const r = drive(a, calmWorld)
      const labels = r.steps.map((x) => x.label)
      expect(labels).toEqual([WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.post, TOUCH_LABEL, WRAP_LABEL.seat, WRAP_LABEL.tidy])
      // 1 ms to 120 s display: the plan ends at 114 s; the walks and the pieces' sizes let it be a little off, never past the display's end
      expect(r.doneAt!).toBeGreaterThan(114 - 9)
      expect(r.doneAt!).toBeLessThanOrEqual(114.1)
    }
  })

  it('the desk takes about 45% of what is left after the walks and the tidy-up, the board the rest', () => {
    const r = drive('agent_2', calmWorld)
    const at = (label: string) => r.steps.find((x) => x.label === label)!.s
    const desk = at(WRAP_LABEL.walk)
    const board = at(WRAP_LABEL.seat) - at(WRAP_LABEL.post)
    const T = wrapTarget(1, 0)
    const free = T - 8 - 1.6
    expect(desk).toBeGreaterThan(free * 0.45 - 12)
    expect(desk).toBeLessThanOrEqual(free * 0.45 + 1e-9)
    expect(board).toBeGreaterThan(20)
    expect(board / (desk + board)).toBeGreaterThan(0.45)
  })

  it('an agent starting late (the status began long ago) writes less, never less than 2 cards', () => {
    const early = drive('agent_0', calmWorld)
    expect(early.run.plan.cards).toBeGreaterThanOrEqual(2)
    const run = startWrap('agent_0', 1, 100_000, true)
    expect(run.plan.cards).toBeGreaterThanOrEqual(2)
    expect(run.plan.cards).toBeLessThanOrEqual(5)
    expect(totalOf(run.plan.desk)).toBeLessThan(totalOf(early.run.plan.desk))
  })

  it('never the same piece twice in a row over the whole scene (desk, board)', () => {
    for (const a of AGENTS) {
      const r = drive(a, calmWorld)
      const seen: PieceKind[] = []
      for (const f of r.frames) if (f.piece && f.run.step !== 'tidy' && seen.at(-1) !== f.piece) seen.push(f.piece)
      for (let i = 1; i < seen.length; i++) if (!MAY_REPEAT.includes(seen[i])) expect(seen[i]).not.toBe(seen[i - 1])
      // the three the user asked for are all there: writing at the desk, thinking at the board, touching the cards
      expect(seen).toContain('line')
      expect(seen).toContain('final')
      expect(seen.some((p) => ['move', 'swap', 'straighten', 'point'].includes(p))).toBe(true)
    }
  })

  it('the cards in hand: all of them from the desk to the board, thinner with each card posted, none after', () => {
    const run = startWrap('agent_0', 1, 0, true)
    const n = run.n
    expect(n).toBeGreaterThanOrEqual(2)
    const posted: WrapRun = { ...run, step: 'post', t0: 0, wrote: true, plan: { ...run.plan, board: planBoard('agent_0', 1, n, 40) } }
    expect(viewOf({ ...run, step: 'walk', wrote: true }, { now: 0, boardTaken: false }).carry).toBe(n)
    expect(viewOf(posted, { now: 100, boardTaken: false })).toMatchObject({ carry: n, beat: { kind: 'pick', k: 0, piece: 'post' } })
    // second card, picking: one card is on the board
    expect(viewOf(posted, { now: 1500 + 50, boardTaken: false }).carry).toBe(n - 1)
    const afterPosts = totalOf(posted.plan.board!.filter((b) => b.piece === 'post')) * 1000 + 50
    expect(viewOf(posted, { now: afterPosts, boardTaken: false })).toMatchObject({ carry: 0, label: TOUCH_LABEL })
    expect(viewOf({ ...posted, step: 'seat', last: true }, { now: 0, boardTaken: false }).carry).toBe(0)
    expect(viewOf({ ...posted, step: 'tidy', last: true }, { now: 0, boardTaken: false }).carry).toBe(0)
  })

  it('writing shows the card being written (1-based stack) and the beat', () => {
    const run = startWrap('agent_0', 1, 0, true)
    expect(viewOf(run, { now: 100, boardTaken: false })).toMatchObject({ label: WRAP_LABEL.write, reread: false, carry: 1, beat: { kind: 'line', k: 0 } })
    const second = totalOf(run.plan.desk.filter((b) => b.k === 0)) * 1000 + 100
    expect(viewOf(run, { now: second, boardTaken: false })).toMatchObject({ carry: 2, beat: { k: 1 } })
  })

  it('starting away from the desk: first the way back to the seat, no writing until it is there', () => {
    const r = drive('agent_0', (s) => ({ atDesk: s >= 6 }), { atDesk: false, seconds: 7 })
    expect(r.steps[0].label).toBe(WRAP_LABEL.seat)
    expect(r.steps.find((x) => x.label === WRAP_LABEL.write)!.s).toBeCloseTo(6, 0)
  })
})

describe('the board is taken (#186)', () => {
  it('written and the board taken: the desk pieces go round (re-reading), and it never leaves for the board', () => {
    const r = drive('agent_1', () => ({ boardTaken: true, boardBusy: true }), { seconds: 100 })
    expect(r.doneAt).toBeNull()
    expect(r.steps.map((x) => x.label)).toEqual([WRAP_LABEL.write, REREAD_LABEL])
    expect(r.run.step).toBe('write')
    // the loop is not one motion over and over: it mixes the desk pieces
    const loop = r.frames.filter((f) => f.run.wrote)
    const kinds = new Set(loop.map((f) => f.kind))
    expect(kinds.has('line')).toBe(true)
    expect(kinds.size).toBeGreaterThanOrEqual(4)
    // and never the same piece twice in a row across the loop's seam
    const seen: string[] = []
    for (const f of loop) if (f.kind && !['line', 'newline'].includes(f.kind) && seen.at(-1) !== f.kind) seen.push(f.kind)
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1])
  })

  it('goes once the board is free', () => {
    const r = drive('agent_1', (s) => ({ boardTaken: s < 70, boardBusy: s < 70, atBoard: false }), { seconds: 72 })
    const walk = r.steps.find((x) => x.label === WRAP_LABEL.walk)!
    expect(walk.s).toBeGreaterThanOrEqual(70)
    expect(walk.s).toBeLessThan(70.3)
  })

  it('walking and the board taken: waits (stack in hand, standing by it) for 20 s, then goes back to the desk and tries again at the next free turn', () => {
    const run0 = startWrap('agent_1', 1, 0, true)
    const written = totalOf(run0.plan.desk)
    const boardFrom = written + 5
    const board = (s: number) => s >= boardFrom && s < boardFrom + 40
    const r = drive('agent_1', (s, run) => ({
      boardTaken: board(s) && run.step === 'walk',
      boardBusy: board(s),
      atBoard: run.step === 'walk' && !board(s) && s >= boardFrom + 42,
      atDesk: run.step === 'seat' ? true : run.step === 'write' || run.step === 'tidy',
    }), { seconds: 125 })
    const labels = r.steps.map((x) => x.label)
    expect(labels.slice(0, 4)).toEqual([WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.seat, REREAD_LABEL])
    // back to the desk 20 s after the wait began
    const back = r.steps.find((x) => x.label === WRAP_LABEL.seat)!
    expect(back.s).toBeCloseTo(boardFrom + 20, 0)
    expect(r.steps.filter((x) => x.label === WRAP_LABEL.walk).length).toBe(2)
    // it never played: no frame without a wrap label; the display's end (114 s) cuts it in the real app
    expect(labels).not.toContain('idle')
  })

  it('the view says it is waiting while the board is taken during the walk', () => {
    const run: WrapRun = { ...startWrap('agent_0', 1, 0, true), n: 2, step: 'walk', t0: 0, wrote: true, waitFrom: 0 }
    expect(viewOf(run, { now: 4000, boardTaken: true })).toMatchObject({ waiting: true, carry: 2, label: WRAP_LABEL.walk })
    expect(viewOf(run, { now: 4000, boardTaken: false }).waiting).toBe(false)
  })

  it('a board plan made after a wait uses only the time that is left', () => {
    const run = startWrap('agent_3', 1, 0, true)
    const w = { ...run, step: 'walk' as const, wrote: true, t0: 80_000 }
    const r = stepWrap(w, { ...base, now: 84_000, atBoard: true, atDesk: false })
    const board = totalOf(r.run.plan.board!)
    // 114 s - 84 s - the way back (4 s) - the tidy-up (1.6 s)
    expect(board).toBeLessThanOrEqual(30 - 4 - 1.6 + 1e-9)
    expect(board).toBeGreaterThan(30 - 4 - 1.6 - 6)
  })
})

describe('reduced motion (section 6)', () => {
  it('no walking: write (the whole time, in the still writing posture) -> tidy -> done in place', () => {
    const r = drive('agent_2', () => ({ reduced: true }), { reduced: true })
    expect(r.steps.map((x) => x.label)).toEqual([WRAP_LABEL.write, WRAP_LABEL.tidy])
    // the time is still filled: to the same end as walking, 6 s before the display's
    expect(r.doneAt!).toBeGreaterThan(114 - 12)
    expect(r.doneAt!).toBeLessThanOrEqual(114.1)
    // the stack never grows past five cards, however long the writing goes
    expect(r.run.n).toBeLessThanOrEqual(5)
    for (const f of r.frames) expect(viewOf(f.run, { now: f.s * 1000, boardTaken: false }).carry).toBeLessThanOrEqual(5)
  })
})

describe('the wrap-up ends in rest', () => {
  it('a long wait keeps the step-1 behaviour (it is still wrapping), it does not become rest by itself', () => {
    const r = drive('agent_1', () => ({ boardTaken: true, boardBusy: true }), { seconds: 118 })
    expect(r.doneAt).toBeNull()
    expect(WRAP.waitMs).toBe(20000)
  })

  it('beatsOf gives the plan of each step', () => {
    const run = startWrap('agent_0', 1, 0, true)
    expect(beatsOf(run, 'write')).toBe(run.plan.desk)
    expect(totalOf(beatsOf(run, 'tidy'))).toBeCloseTo(1.6)
  })
})
