import { describe, expect, it } from 'vitest'
import { Director } from './director'
import { ACT_PLACE, actTotal, recordBeats } from './lounge'
import { playAt } from './play'
import type { StatusMap } from './status'

// The lounge acts through the Director (director.ts, actRun.ts): sent by the schedule or the music's wish for a break, run from the moment the agent is at its stand, over when their length is,
// and the turntable's state follows them.
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
const T0 = Date.UTC(2026, 10, 9, 5, 0, 0)
const idle = (): StatusMap => Object.fromEntries(IDS.map((id) => [id, { state: 'idle' as const, since: 0 }]))

/** drive the Director with `where` saying who stands at which spot; returns the goals of each frame we ask for */
function drive(d: Director, from: number, to: number, where: (a: string, t: number) => string | null, opts: { wantsBreak?: boolean; status?: StatusMap } = {}, onFrame?: (t: number, g: ReturnType<Director['goals']>) => void) {
  for (let t = from; t <= to; t += 0.1) {
    const now = T0 + t * 1000
    const g = d.goals(now, Math.floor(now / 60000), opts.status ?? idle(), (a) => where(a, t), opts.wantsBreak === undefined ? {} : { wantsBreak: opts.wantsBreak })
    onFrame?.(t, g)
  }
}
const stands = (spot: string, from: number) => (_a: string, t: number) => (t >= from ? spot : null)

describe('a lounge act in the Director', () => {
  it('forceAct: on the way (u = -1) at the act\'s place, then u counts from arriving, then the agent is free again', () => {
    for (const kind of ['fridge', 'dispenser'] as const) {
      const d = new Director(IDS)
      d.forceAct('agent_3', kind, T0)
      const place = ACT_PLACE[kind]
      const seen: number[] = []
      let ended = -1
      drive(d, 0, 20, (a, t) => (a === 'agent_3' && t >= 3 ? place.spot : null), {}, (t, g) => {
        const act = g.agent_3.act
        if (act) {
          expect(g.agent_3.pose).toBe(kind)
          expect(g.agent_3.spot).toBe(place.spot)
          expect(g.agent_3.slot, 'standing at the act\'s own place').toBeTruthy()
          expect(g.agent_3.slot!.x).toBeCloseTo(place.stand.x, 6)
          seen.push(act.u)
        } else if (seen.length && ended < 0) ended = t
      })
      expect(seen[0], kind + ' walking').toBe(-1)
      expect(Math.max(...seen)).toBeGreaterThan(actTotal(kind) - 0.3)
      expect(ended - 3, kind + ' lasts its length from arriving').toBeCloseTo(actTotal(kind), 0)
    }
  })

  it('the fridge and the dispenser are never on at once; the turntable has its own', () => {
    const d = new Director(IDS)
    d.forceAct('agent_0', 'fridge', T0)
    // a second one asked while the first is on: the schedule\'s start does not double the bar
    let max = 0
    let withRecord = 0
    drive(d, 0, 12, stands(ACT_PLACE.fridge.spot, 1), {}, (t, g) => {
      if (t === 0.1) d.forceAct('agent_1', 'record', T0 + 100) // forceAct replaces the running one (the debug tool): not the schedule
      const bar = IDS.filter((a) => g[a].act && g[a].act!.kind !== 'record').length
      max = Math.max(max, bar)
      withRecord = Math.max(withRecord, IDS.filter((a) => g[a].act?.kind === 'record').length)
    })
    expect(max).toBeLessThanOrEqual(1)
    expect(withRecord).toBeLessThanOrEqual(1)
  })

  it('an agent called to work drops its act; so does one called into a meeting', () => {
    const d = new Director(IDS)
    d.forceAct('agent_2', 'dispenser', T0)
    const st = idle()
    let still = true
    drive(d, 0, 6, () => null, { status: st }, (t, g) => {
      if (t > 1 && !g.agent_2.act) still = false
    })
    expect(still).toBe(true)
    st.agent_2 = { state: 'working', activity: 'test', since: 0 }
    drive(d, 6, 8, () => null, { status: st }, (_t, g) => expect(g.agent_2.act).toBeUndefined())
    const d2 = new Director(IDS)
    d2.forceAct('agent_2', 'fridge', T0)
    d2.setMeeting({ agent_2: 'talk' })
    drive(d2, 0, 2, () => null, {}, (_t, g) => expect(g.agent_2.act).toBeUndefined())
    expect(d2.fridgeUser(), 'the one in the meeting does not hold the door').not.toBe('agent_2')
  })
})

describe('the turntable through the Director', () => {
  it('put: the needle is down when the act is done, a record is on; recordComing is true until then, fridgeUser is null', () => {
    const d = new Director(IDS)
    expect(d.deckState()).toEqual({ recordOn: false, needle: false })
    d.forceAct('agent_4', 'record', T0)
    let coming = false
    let comingAfter = true
    const beats = recordBeats('put', false)
    drive(d, 0, 10, stands(ACT_PLACE.record.spot, 0.5), {}, (t) => {
      if (t > 1 && t < 0.5 + beats.down - 0.2) coming ||= d.recordComing()
      if (t > 0.5 + beats.down + 0.2) comingAfter = d.recordComing()
    })
    expect(coming, 'on its way to the needle').toBe(true)
    expect(comingAfter, 'not any more once the needle is down').toBe(false)
    expect(d.deckState()).toEqual({ recordOn: true, needle: true })
  })

  it('the music wants a break and nobody is at the turntable: echo (agent_4) goes first, and it puts the record on; the next one asks nothing more of anybody', () => {
    const d = new Director(IDS)
    const starter: string[] = []
    drive(d, 0, 12, stands(ACT_PLACE.record.spot, 0.5), { wantsBreak: true }, (_t, g) => {
      const who = IDS.filter((a) => g[a].act?.kind === 'record')
      if (who.length) starter.push(...who)
    })
    expect(new Set(starter)).toEqual(new Set(['agent_4']))
    expect(d.deckState().needle).toBe(true)
  })

  it('without echo resting, whoever rests goes; with everybody at work, nobody', () => {
    const d = new Director(IDS)
    const st = idle()
    st.agent_4 = { state: 'working', activity: 'test', since: 0 }
    let who: string | null = null
    drive(d, 0, 3, () => null, { wantsBreak: true, status: st }, (_t, g) => {
      who ??= IDS.find((a) => g[a].act?.kind === 'record') ?? null
    })
    expect(who).toBe('agent_0')
    const w = new Director(IDS)
    const busy = Object.fromEntries(IDS.map((a) => [a, { state: 'working' as const, activity: 'test', since: 0 }])) as StatusMap
    drive(w, 0, 3, () => null, { wantsBreak: true, status: busy }, (_t, g) => expect(IDS.some((a) => g[a].act)).toBe(false))
  })

  it('the break is over and the needle is down: after a while somebody lifts the arm (not at once), and then the needle is up', () => {
    const d = new Director(IDS)
    // the break: the record goes on
    drive(d, 0, 10, stands(ACT_PLACE.record.spot, 0.5), { wantsBreak: true })
    expect(d.deckState().needle).toBe(true)
    // the break ends: nothing at once ...
    let early = false
    drive(d, 10, 20, () => null, { wantsBreak: false }, (_t, g) => (early ||= IDS.some((a) => g[a].act?.kind === 'record' && g[a].act?.mode === 'lift')))
    expect(early, 'not lifted right away').toBe(false)
    // ... then it is lifted
    let lifter: string | null = null
    const lift = recordBeats('lift', true)
    drive(d, 20, 70 + lift.total, (a) => (a === lifter ? ACT_PLACE.record.spot : null), { wantsBreak: false }, (_t, g) => {
      lifter ??= IDS.find((a) => g[a].act?.kind === 'record') ?? null
    })
    expect(lifter).not.toBeNull()
    expect(d.deckState().needle).toBe(false)
    expect(d.deckState().recordOn, 'the record stays on the platter').toBe(true)
  })

  it('the schedule sends agents to the three acts through the day', () => {
    const kinds = new Set<string>()
    for (let m = 0; m < 24 * 60; m += 3) for (const a of Object.values(playAt(m, IDS))) kinds.add(a.kind)
    for (const k of ['fridge', 'dispenser', 'record']) expect(kinds.has(k), k).toBe(true)
  })
})
