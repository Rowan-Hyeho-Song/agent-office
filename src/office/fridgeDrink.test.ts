import { describe, expect, it } from 'vitest'
import { CARRYING_DRINK, Director } from './director'
import { DRINK_POSES, DRINK_T, SIPS, SIP_TOPS, drinkPick, drinkView, sipLift, stepDrink, type Drink } from './fridgeDrink'
import { ACT_PLACE, FRIDGE_T, grabAt } from './lounge'
import type { StatusMap } from './status'

// #457 the drink from the fridge (fridgeDrink.ts, lounge-props.md 5.3 · 5.5): which one is taken, and its life in the hand after the act, in the Director.
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
// 14:00 KST (day), 01:00 KST (night)
const T0 = Date.UTC(2026, 10, 9, 5, 0, 0)
const NIGHT = Date.UTC(2026, 10, 9, 16, 0, 0)
const idle = (): StatusMap => Object.fromEntries(IDS.map((id) => [id, { state: 'idle' as const, since: 0 }]))

describe('which drink (drinkPick)', () => {
  it('60 can : 40 milk over many visits, the same for the same visit', () => {
    let cans = 0
    const n = 2000
    for (let b = 0; b < n; b++) if (drinkPick({ agent: `agent_${b % 5}`, block: b, night: false, had: [], held: [] }) === 'can') cans++
    expect(cans / n).toBeGreaterThan(0.55)
    expect(cans / n).toBeLessThan(0.65)
    const o = { agent: 'agent_1', block: 77, night: false, had: [], held: [] }
    expect(drinkPick(o)).toBe(drinkPick(o))
  })

  it('not what the agent took already today, nor what another holds; none at night or with both taken', () => {
    for (let b = 0; b < 50; b++) {
      expect(drinkPick({ agent: 'agent_0', block: b, night: false, had: ['can'], held: [] })).toBe('milk')
      expect(drinkPick({ agent: 'agent_0', block: b, night: false, had: [], held: ['milk'] })).toBe('can')
      expect(drinkPick({ agent: 'agent_0', block: b, night: false, had: ['can', 'milk'], held: [] })).toBeNull()
      expect(drinkPick({ agent: 'agent_0', block: b, night: true, had: [], held: [] })).toBeNull()
    }
  })
})

describe('the drink after the act (stepDrink, sipLift)', () => {
  const d0: Drink = { kind: 'can', at: 0, stay: null, fadeAt: null }
  const go = (d: Drink, now: number, o: Partial<{ spot: string; pose: 'idle' | 'sofa' | 'type' | 'coffee'; arrived: boolean; errand: boolean }> = {}) =>
    stepDrink(d, { now, spot: o.spot ?? 'work_1', pose: o.pose ?? 'idle', arrived: o.arrived ?? false, errand: o.errand ?? false })

  it('carried on the way; where it stays it is kept 20 s, then fades in 0.3 s and is gone', () => {
    let d = go(d0, 1000)!
    expect(d.stay).toBeNull()
    d = go(d, 5000, { arrived: true })!
    expect(d.stay).toEqual({ spot: 'work_1', at: 5000 })
    expect(go(d, 5000 + DRINK_T.keepS * 1000 - 1, { arrived: true })!.fadeAt).toBeNull()
    d = go(d, 5000 + DRINK_T.keepS * 1000, { arrived: true })!
    expect(d.fadeAt).toBe(25000)
    expect(go(d, 25000 + DRINK_T.fadeS * 1000 - 1, { arrived: true })).not.toBeNull()
    expect(go(d, 25000 + DRINK_T.fadeS * 1000, { arrived: true })).toBeNull()
  })

  it('the hand wanted (an errand, or arriving at a pose that uses the hands) fades it at once; the sofa and standing idle keep it', () => {
    expect(go(d0, 1000, { errand: true })!.fadeAt).toBe(1000)
    expect(go(d0, 1000, { pose: 'type', arrived: true })!.fadeAt).toBe(1000)
    expect(go(d0, 1000, { pose: 'coffee', arrived: true })!.fadeAt).toBe(1000)
    expect(go(d0, 1000, { pose: 'type', arrived: false })!.fadeAt, 'walking to the desk it is still carried').toBeNull()
    for (const pose of DRINK_POSES) expect(go(d0, 1000, { pose: pose as 'idle', arrived: true })!.fadeAt).toBeNull()
    expect(go(d0, DRINK_T.maxS * 1000)!.fadeAt, 'never longer than maxS').toBe(DRINK_T.maxS * 1000)
  })

  it('two sips, 0.6 s each and 3 s apart, from 0.5 s after arriving; up, a moment held, down; none on the way or with reduced motion', () => {
    expect(SIPS).toEqual([0.5, 4.1])
    expect(sipLift(-1)).toBe(0)
    expect(sipLift(0.4)).toBe(0)
    for (const s0 of SIPS) {
      expect(sipLift(s0 + 0.3)).toBe(1)
      expect(sipLift(s0 + DRINK_T.sipS)).toBe(0)
      expect(sipLift(s0 + 0.12)).toBeGreaterThan(0.3)
    }
    expect(sipLift(2.5)).toBe(0)
    expect(SIP_TOPS.map((x) => +x.toFixed(2))).toEqual([0.75, 4.35])
    const d: Drink = { kind: 'milk', at: 0, stay: { spot: 'sofa_0', at: 2000 }, fadeAt: null }
    expect(drinkView(d, { now: 3000, spot: 'sofa_0', reduced: false }).sip).toBe(1)
    expect(drinkView(d, { now: 3000, spot: 'sofa_0', reduced: true }).sip).toBe(-1)
    expect(drinkView(d, { now: 3000, spot: 'coffee', reduced: false }).sip, 'moved on: no more sips').toBe(-1)
  })
})

describe('the drink in the Director', () => {
  /** frames of 0.1 s; `at` says where each agent stands */
  function drive(d: Director, from: number, to: number, at: (a: string, t: number) => string | null, o: { status?: (t: number) => StatusMap; reduced?: boolean; base?: number } = {}, each?: (t: number, g: ReturnType<Director['goals']>) => void) {
    for (let t = from; t <= to + 1e-9; t += 0.1) {
      const now = (o.base ?? T0) + t * 1000
      const g = d.goals(now, Math.floor(now / 60000), o.status?.(t) ?? idle(), (a) => at(a, t), { reduced: o.reduced })
      each?.(+t.toFixed(1), g)
    }
  }

  it('the hand has it from the grab on (Goal.drink, act.pick); the agent keeps it after the act and does not take the same one again that day', () => {
    const d = new Director(IDS)
    d.forceAct('agent_3', 'fridge', T0, undefined, 'can')
    let first = -1
    let afterAct = false
    drive(d, 0, 8, (a, t) => (a === 'agent_3' && t >= 1 ? ACT_PLACE.fridge.spot : null), {}, (t, g) => {
      const x = g.agent_3
      if (x.act) expect(x.act.pick).toBe('can')
      if (x.drink && first < 0) first = t
      if (!x.act && x.drink) afterAct = true
    })
    expect(first - 1, 'from the grab').toBeCloseTo(FRIDGE_T.grab, 0)
    expect(afterAct, 'still in hand once the act is over').toBe(true)
    expect(d.drinkOf('agent_3')?.kind).toBe('can')
    // the schedule's next visit that day: not the can again
    d.forceAct('agent_3', 'fridge', T0 + 60_000)
    expect(d.drinkOf('agent_3'), 'a new visit starts with an empty hand').toBeNull()
    let pick: string | undefined
    drive(d, 60, 61, () => null, {}, (_t, g) => (pick ??= g.agent_3.act?.pick))
    expect(pick).toBe('milk')
  })

  it('at night nothing is taken out (it only looks in)', () => {
    const d = new Director(IDS)
    d.forceAct('agent_1', 'fridge', NIGHT)
    let pick: string | undefined = 'x'
    drive(d, 0, 0.2, () => null, { base: NIGHT }, (_t, g) => (pick = g.agent_1.act?.pick))
    expect(pick).toBeUndefined()
  })

  it('reduced motion: in the hand as the door passes 70° (no reach), and no sips', () => {
    const d = new Director(IDS)
    d.forceAct('agent_2', 'fridge', T0, undefined, 'milk')
    let first = -1
    let sipped = false
    drive(d, 0, 30, (a, t) => (a === 'agent_2' ? (t < 4 ? (t >= 1 ? ACT_PLACE.fridge.spot : null) : 'work_2') : null), { reduced: true }, (t, g) => {
      if (g.agent_2.drink && first < 0) first = t
      if ((g.agent_2.drink?.sip ?? -1) >= 0) sipped = true
    })
    expect(first - 1).toBeCloseTo(grabAt(true), 0)
    expect(grabAt(true)).toBeLessThan(FRIDGE_T.grab)
    expect(sipped).toBe(false)
  })

  it('called to work after the grab it takes the drink along, says so on the way, and it fades at the desk; called before, nothing is taken', () => {
    const d = new Director(IDS)
    d.forceAct('agent_4', 'fridge', T0, undefined, 'can')
    const st = (t: number): StatusMap => ({ ...idle(), agent_4: t < 2.9 ? { state: 'idle', since: 0 } : { state: 'working', activity: 'test', since: 0 } })
    let carried = false
    let gone = -1
    drive(d, 0, 12, (a, t) => (a === 'agent_4' ? (t < 3 ? (t >= 0.5 ? ACT_PLACE.fridge.spot : null) : t >= 8 ? 'work_4' : null) : null), { status: st }, (t, g) => {
      if (t > 3 && t < 8) {
        expect(g.agent_4.act, 'the act is dropped').toBeUndefined()
        expect(g.agent_4.drink?.fade, 'carried on the way').toBe(-1)
        if (d.shown.agent_4?.detail === CARRYING_DRINK) carried = true
      }
      if (t >= 8 && !g.agent_4.drink && gone < 0) gone = t
    })
    expect(carried, 'the status says it is carrying the drink').toBe(true)
    expect(gone - 8, 'faded out at the desk in 0.3 s').toBeLessThanOrEqual(DRINK_T.fadeS + 0.15)
    // called away before the grab: nothing in the hand, the drink stays on its shelf (and may still be taken today)
    const d2 = new Director(IDS)
    d2.forceAct('agent_4', 'fridge', T0, undefined, 'can')
    const st2 = (t: number): StatusMap => ({ ...idle(), agent_4: t < 1.2 ? { state: 'idle', since: 0 } : { state: 'working', activity: 'test', since: 0 } })
    drive(d2, 0, 4, (a, t) => (a === 'agent_4' && t >= 0.5 ? ACT_PLACE.fridge.spot : null), { status: st2 }, (_t, g) => expect(g.agent_4.drink).toBeUndefined())
    expect(d2.drinkOf('agent_4')).toBeNull()
  })
})
