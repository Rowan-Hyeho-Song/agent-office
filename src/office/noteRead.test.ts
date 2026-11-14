import { describe, expect, it } from 'vitest'
import { Director } from './director'
import { NOTE_LABEL, NOTE_READ, stepNote, stillWaiting, thanksNow } from './noteRead'
import type { StatusMap } from './status'

// #4 notes 2b (office-ui.md 12.3 '에이전트 반응'): the robot a note is for walks to the cork board the next time it rests, looks 2 s, nods and
// thanks; working, it waits; after an hour it lets the note go.
const IDS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
const T0 = Date.UTC(2026, 10, 9, 5, 0, 0)
const working = (): StatusMap => Object.fromEntries(IDS.map((id) => [id, { state: 'working' as const, activity: 'test', since: 0 }]))
const withIdle = (...idle: string[]): StatusMap => ({ ...working(), ...Object.fromEntries(idle.map((a) => [a, { state: 'idle' as const, since: 0 }])) })

describe('the rules (noteRead.ts)', () => {
  it('an hour to react; the clock starts at the board; done after the look (2 s) and the thanks; a walk that never ends is given up', () => {
    expect(stillWaiting([{ id: 1, at: 0 }, { id: 2, at: 100 }], NOTE_READ.waitMs + 50).map((n) => n.id)).toEqual([2])
    let r = stepNote({ ids: [1], since: 0, t0: null }, { now: 1000, arrived: false })
    expect(r.run.t0).toBeNull()
    r = stepNote(r.run, { now: 2000, arrived: true })
    expect(r.run.t0).toBe(2000)
    expect(stepNote(r.run, { now: 2000 + (NOTE_READ.lookS + NOTE_READ.thankS) * 1000 - 1, arrived: true }).done).toBe(false)
    expect(stepNote(r.run, { now: 2000 + (NOTE_READ.lookS + NOTE_READ.thankS) * 1000, arrived: true }).done).toBe(true)
    expect(stepNote({ ids: [1], since: 0, t0: null }, { now: NOTE_READ.walkMs, arrived: false }).giveUp).toBe(true)
    expect(thanksNow(1.9, 2.0)).toBe(true)
    expect(thanksNow(2.0, 2.1)).toBe(false)
    expect(thanksNow(-1, 1)).toBe(false)
  })
})

describe('notes in the Director', () => {
  /** frames of 0.1 s from `from` to `to` s; each agent is where it was sent once its goal's spot has stayed the same `walkS` */
  function drive(d: Director, from: number, to: number, status: (t: number) => StatusMap, each?: (t: number, g: ReturnType<Director['goals']>) => void, walkS = 2) {
    const sent: Record<string, { spot: string; at: number }> = {}
    for (let k = Math.round(from * 10); k <= Math.round(to * 10); k++) {
      const t = k / 10
      const now = T0 + t * 1000
      const g = d.goals(now, Math.floor(now / 60000), status(t), (a) => (sent[a] && t - sent[a].at >= walkS ? sent[a].spot : null))
      for (const a of IDS) if (sent[a]?.spot !== g[a].spot) sent[a] = { spot: g[a].spot, at: t }
      each?.(t, g)
    }
  }

  it('resting, the robot goes to the board, looks 2 s, then nods (once) and is free; it does not go again for the same note', () => {
    const d = new Director(IDS)
    d.noteArrived('agent_2', 41, T0, T0)
    const seen: { t: number; u: number; gesture?: string; label: string }[] = []
    let freeAgain = -1
    let setOff = -1
    drive(d, 0, 30, () => withIdle('agent_2'), (t, g) => {
      if (g.agent_2.note && setOff < 0) setOff = t
      const x = g.agent_2
      if (x.note) seen.push({ t, u: x.note.u, gesture: x.gesture?.key, label: x.label })
      else if (seen.length && freeAgain < 0) freeAgain = t
    })
    expect(seen[0].u, 'on the way').toBe(-1)
    expect(seen[0].label).toBe(NOTE_LABEL.walk)
    const there = seen.filter((s) => s.u >= 0)
    expect(there[0].t, 'there after the walk').toBeCloseTo(setOff + 2, 5)
    expect(there[0].label).toBe(NOTE_LABEL.read)
    // the nod: no gesture while it looks, one gesture key from 2 s on
    expect(there.filter((s) => s.u < NOTE_READ.lookS).every((s) => !s.gesture)).toBe(true)
    expect(new Set(there.filter((s) => s.u >= NOTE_READ.lookS).map((s) => s.gesture))).toEqual(new Set(['note:41']))
    expect(freeAgain - there[0].t).toBeCloseTo(NOTE_READ.lookS + NOTE_READ.thankS, 0)
    expect(d.notesWaiting('agent_2')).toEqual([])
    // the same note again (the board read again): nothing
    d.noteArrived('agent_2', 41, T0, T0 + 40_000)
    drive(d, 40, 45, () => withIdle('agent_2'), (_t, g) => expect(g.agent_2.note).toBeUndefined())
  })

  it('working, it puts the note off; it goes once it rests; two notes are read on one walk', () => {
    const d = new Director(IDS)
    d.noteArrived('agent_1', 7, T0, T0)
    d.noteArrived('agent_1', 8, T0 + 1000, T0 + 1000)
    drive(d, 0, 600, () => working(), (_t, g) => expect(g.agent_1.note, 'not while it works').toBeUndefined())
    expect(d.notesWaiting('agent_1')).toEqual([7, 8])
    let ids: number[] = []
    drive(d, 600, 680, () => withIdle('agent_1'), (_t, g) => (ids = g.agent_1.note?.ids ?? ids))
    expect(ids).toEqual([7, 8])
    expect(d.notesWaiting('agent_1')).toEqual([])
  })

  it('an hour after it was pinned the note passes without a reaction; one pinned over an hour ago is never queued', () => {
    const d = new Director(IDS)
    d.noteArrived('agent_3', 9, T0, T0)
    drive(d, 0, 10, () => working())
    expect(d.notesWaiting('agent_3')).toEqual([9])
    let went = false
    drive(d, NOTE_READ.waitMs / 1000 + 1, NOTE_READ.waitMs / 1000 + 20, () => withIdle('agent_3'), (_t, g) => (went ||= !!g.agent_3.note))
    expect(went).toBe(false)
    expect(d.notesWaiting('agent_3')).toEqual([])
    const d2 = new Director(IDS)
    d2.noteArrived('agent_3', 10, T0 - NOTE_READ.waitMs - 1, T0)
    expect(d2.notesWaiting('agent_3')).toEqual([])
    // a note for a robot that is not in the office is not queued
    d2.noteArrived('agent_9', 11, T0, T0)
    expect(d2.notesWaiting('agent_9')).toEqual([])
  })

  it('called to work on the way it gives up and goes again when it rests; one robot at the board at a time', () => {
    const d = new Director(IDS)
    d.noteArrived('agent_0', 21, T0, T0)
    d.noteArrived('agent_4', 22, T0, T0)
    let both = 0
    let n = 0
    let first = ''
    drive(d, 0, 3, () => withIdle('agent_0', 'agent_4'), (_t, g) => {
      both = Math.max(both, IDS.filter((a) => g[a].note).length)
      n += IDS.filter((a) => g[a].note).length
      first ||= IDS.find((a) => g[a].note) ?? ''
    })
    expect(n, 'one of them set off').toBeGreaterThan(0)
    expect(both, 'one at a time').toBe(1)
    // called to work: the walk is dropped, the note stays
    const st = (t: number): StatusMap => (t < 10 ? { ...withIdle('agent_0', 'agent_4'), [first]: { state: 'working', activity: 'test', since: 0 } } : withIdle('agent_0', 'agent_4'))
    drive(d, 3, 4, st, (_t, g) => expect(g[first].note).toBeUndefined())
    expect(d.notesWaiting(first).length).toBe(1)
    // both read theirs in the end
    drive(d, 4, 120, st)
    expect(d.notesWaiting('agent_0')).toEqual([])
    expect(d.notesWaiting('agent_4')).toEqual([])
  })
})
