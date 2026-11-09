import { describe, expect, it } from 'vitest'
import { beatAt, beatsOf, REREAD_LABEL, startWrap, stepWrap, totalOf, viewOf, WRAP, WRAP_LABEL, wrapCards, type WrapInput, type WrapRun, type WrapStep } from './wrap'

const base: WrapInput = { now: 0, atDesk: true, atBoard: false, boardTaken: false, boardBusy: false, reduced: false }

/** run a wrap-up in 100 ms frames; `world` says where the agent is / whether the board is taken at each moment (s since the start) */
function drive(n: number, world: (s: number, run: WrapRun) => Partial<WrapInput>, opts: { seconds?: number; atDesk?: boolean } = {}) {
  let run: WrapRun = { ...startWrap('agent_0', 1, 0, opts.atDesk ?? true), n }
  const steps: { s: number; step: WrapStep; label: string }[] = []
  let doneAt: number | null = null
  for (let ms = 0; ms <= (opts.seconds ?? 120) * 1000; ms += 100) {
    const inp = { ...base, now: ms, ...world(ms / 1000, run) }
    const r = stepWrap(run, inp)
    run = r.run
    if (r.done) {
      doneAt = ms / 1000
      break
    }
    const v = viewOf(run, inp)
    if (!steps.length || steps[steps.length - 1].label !== v.label) steps.push({ s: ms / 1000, step: v.step, label: v.label })
  }
  return { steps, doneAt, run }
}

describe('beats', () => {
  it('N cards: 2.5 s of writing each, 1.2 s of posting each + 0.3 s between + 0.4 s look, 1.6 s of tidying', () => {
    for (let n = 1; n <= 3; n++) {
      expect(totalOf(beatsOf('write', n))).toBeCloseTo(2.5 * n)
      expect(totalOf(beatsOf('post', n))).toBeCloseTo(1.2 * n + 0.3 * (n - 1) + 0.4)
    }
    expect(totalOf(beatsOf('tidy', 2))).toBeCloseTo(1.6)
  })

  it('a card is pushed to the stack for 0.3 s at the end of its 2.5 s; a post is pick 0.3, place, press 0.2, release 0.15', () => {
    const w = beatsOf('write', 2)
    expect(w.map((b) => b.kind)).toEqual(['write', 'push', 'write', 'push'])
    expect(w[1].dur).toBeCloseTo(0.3)
    const p = beatsOf('post', 2)
    expect(p.map((b) => b.kind)).toEqual(['pick', 'place', 'press', 'release', 'gap', 'pick', 'place', 'press', 'release', 'look'])
    expect(p.find((b) => b.kind === 'press')!.dur).toBeCloseTo(0.2)
    expect(p.find((b) => b.kind === 'release')!.dur).toBeCloseTo(0.15)
    expect(p.find((b) => b.kind === 'gap')!.dur).toBeCloseTo(0.3)
  })

  it('beatAt finds the beat and how far into it; past the end it stays on the last', () => {
    const b = beatsOf('tidy', 2)
    expect(beatAt(b, 0.1)).toMatchObject({ beat: { kind: 'gather' }, u: expect.closeTo(1 / 3, 5) })
    expect(beatAt(b, 0.4).beat.kind).toBe('tap')
    expect(beatAt(b, 99)).toMatchObject({ beat: { kind: 'lean' }, u: 1 })
  })

  it('replay x4: as it is; x16: every gesture lasts at least the gesture minimum and the tidy-up taps once', () => {
    expect(beatsOf('tidy', 1, 0.6).filter((b) => b.kind === 'tap')).toHaveLength(2)
    const gm = 0.15 * 16
    for (const step of ['write', 'post', 'tidy'] as const)
      for (const b of beatsOf(step, 3, gm)) if (b.kind !== 'write' && b.kind !== 'gap' && b.kind !== 'gather') expect(b.dur).toBeGreaterThanOrEqual(gm - 1e-9)
    expect(beatsOf('tidy', 1, gm).filter((b) => b.kind === 'tap')).toHaveLength(1)
    // x4 (gm 0.6): the 0.15 s release is held to 0.6, the 0.3 s ones too
    expect(beatsOf('post', 1, 0.6).find((b) => b.kind === 'release')!.dur).toBeCloseTo(0.6)
  })

  it('wrapCards is 1..3 and the same for the same wrap-up', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 60; i++) {
      const n = wrapCards('agent_1', 1000 + i)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(3)
      expect(wrapCards('agent_1', 1000 + i)).toBe(n)
      seen.add(n)
    }
    expect(seen.size).toBe(3)
  })
})

describe('the wrap-up timeline', () => {
  it('seated, board free: write -> walk -> post -> back -> tidy -> done, each with its own label and the designed times', () => {
    const n = 2
    const r = drive(n, (s, run) => ({
      atDesk: run.step === 'seat' ? s - run.t0 / 1000 >= 3 : run.step === 'write' || run.step === 'tidy',
      atBoard: run.step === 'walk' && s - run.t0 / 1000 >= 4,
    }))
    expect(r.steps.map((x) => x.label)).toEqual([WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.post, WRAP_LABEL.seat, WRAP_LABEL.tidy])
    const at = (label: string) => r.steps.find((x) => x.label === label)!.s
    expect(at(WRAP_LABEL.walk)).toBeCloseTo(5, 0) // 2 cards x 2.5 s
    expect(at(WRAP_LABEL.post) - at(WRAP_LABEL.walk)).toBeCloseTo(4, 0) // the walk
    expect(at(WRAP_LABEL.seat) - at(WRAP_LABEL.post)).toBeCloseTo(1.2 * 2 + 0.3 + 0.4, 0)
    expect(at(WRAP_LABEL.tidy) - at(WRAP_LABEL.seat)).toBeCloseTo(3, 0)
    // done in the frame the tidy-up ends: 1.6 s after it began
    expect(r.doneAt! - at(WRAP_LABEL.tidy)).toBeCloseTo(1.6, 0)
  })

  it('starting away from the desk: first the way back to the seat, no writing until it is there', () => {
    const r = drive(1, (s) => ({ atDesk: s >= 6 }), { atDesk: false, seconds: 7 })
    expect(r.steps[0].label).toBe(WRAP_LABEL.seat)
    expect(r.steps.find((x) => x.label === WRAP_LABEL.write)!.s).toBeCloseTo(6, 0)
  })

  it('the view of each step: the stack in the hand while carrying, thinner with each card posted, none after', () => {
    const run = (step: WrapStep, extra: Partial<WrapRun> = {}): WrapRun => ({ since: 1, n: 3, step, t0: 0, wrote: true, last: false, waitFrom: null, ...extra })
    expect(viewOf(run('walk'), { now: 0, boardTaken: false }).carry).toBe(3)
    expect(viewOf(run('post'), { now: 100, boardTaken: false })).toMatchObject({ carry: 3, beat: { kind: 'pick', k: 0 } })
    // second card, picking: one card is on the board
    expect(viewOf(run('post'), { now: 1500 + 50, boardTaken: false }).carry).toBe(2)
    expect(viewOf(run('seat', { last: true }), { now: 0, boardTaken: false }).carry).toBe(0)
    expect(viewOf(run('tidy', { last: true }), { now: 0, boardTaken: false }).carry).toBe(0)
  })

  it('a wrap-up that is not written yet writes at the desk with the card count under the hand', () => {
    const run: WrapRun = { since: 1, n: 3, step: 'write', t0: 0, wrote: false, last: false, waitFrom: null }
    expect(viewOf(run, { now: 100, boardTaken: false })).toMatchObject({ label: WRAP_LABEL.write, reread: false, carry: 1, beat: { kind: 'write', k: 0 } })
    expect(viewOf(run, { now: 2600, boardTaken: false })).toMatchObject({ carry: 2, beat: { kind: 'write', k: 1 } })
  })
})

describe('the board is taken', () => {
  it('still writing when it is taken: keeps writing; done writing: re-reads, and never leaves for the board', () => {
    const r = drive(1, () => ({ boardTaken: true, boardBusy: true }), { seconds: 30 })
    expect(r.doneAt).toBeNull()
    expect(r.steps.map((x) => x.label)).toEqual([WRAP_LABEL.write, REREAD_LABEL])
    expect(r.steps[1].s).toBeCloseTo(2.5, 0)
    expect(r.run.step).toBe('write')
  })

  it('goes once the board is free', () => {
    const r = drive(1, (s) => ({ boardTaken: s < 10, boardBusy: s < 10, atBoard: false }), { seconds: 12 })
    const walk = r.steps.find((x) => x.label === WRAP_LABEL.walk)!
    expect(walk.s).toBeGreaterThanOrEqual(10)
    expect(walk.s).toBeLessThan(10.3)
  })

  it('walking and the board taken: waits (stack in hand, standing by it) for 20 s, then goes back to the desk and tries again at the next free turn', () => {
    const board = (s: number) => s >= 5 && s < 60
    const r = drive(1, (s, run) => ({
      boardTaken: board(s) && run.step === 'walk',
      // the others' posting keeps the board busy until 60 s
      boardBusy: board(s),
      atBoard: run.step === 'walk' && !board(s) && s >= 62,
      atDesk: run.step === 'seat' ? true : run.step === 'write' || run.step === 'tidy',
    }), { seconds: 120 })
    const labels = r.steps.map((x) => x.label)
    expect(labels.slice(0, 4)).toEqual([WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.seat, REREAD_LABEL])
    // 20 s of waiting after the walk began at 2.5 s ... the wait starts when the board is taken (5 s)
    const back = r.steps.find((x) => x.label === WRAP_LABEL.seat)!
    expect(back.s).toBeCloseTo(25, 0)
    // at the desk it only re-reads (written) and sets off again after 60 s
    expect(labels).toContain(REREAD_LABEL)
    expect(r.steps.filter((x) => x.label === WRAP_LABEL.walk).length).toBe(2)
    // it never played: no frame without a wrap label (done only after the tidy-up)
    expect(r.doneAt).not.toBeNull()
    expect(labels.at(-1)).toBe(WRAP_LABEL.tidy)
  })

  it('the view says it is waiting while the board is taken during the walk', () => {
    const run: WrapRun = { since: 1, n: 2, step: 'walk', t0: 0, wrote: true, last: false, waitFrom: 0 }
    expect(viewOf(run, { now: 4000, boardTaken: true })).toMatchObject({ waiting: true, carry: 2, label: WRAP_LABEL.walk })
    expect(viewOf(run, { now: 4000, boardTaken: false }).waiting).toBe(false)
  })
})

describe('reduced motion', () => {
  it('no walking: write -> tidy -> done in place (1 -> 4 -> 5), 2.5 s per card then 1.6 s', () => {
    const r = drive(2, () => ({ reduced: true }))
    expect(r.steps.map((x) => x.label)).toEqual([WRAP_LABEL.write, WRAP_LABEL.tidy])
    expect(r.doneAt).toBeCloseTo(5 + 1.6, 0)
  })
})

describe('the wrap-up ends in rest', () => {
  it('a long wait keeps the step-1 behaviour (it is still wrapping), it does not become rest by itself', () => {
    const r = drive(1, () => ({ boardTaken: true, boardBusy: true }), { seconds: 118 })
    expect(r.doneAt).toBeNull()
    expect(WRAP.waitMs).toBe(20000)
  })
})
