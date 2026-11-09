import { describe, expect, it } from 'vitest'
import { BUBBLE_ASK, BUBBLE_REPLY, Director } from './director'
import { playAt } from './play'
import { WRAP_LABEL, wrapCards } from './wrap'
import type { AgentStatus, OfficeMessage, StatusMap } from './status'

const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const MINUTE = 987_654
const TALK_MS = 6000

const idle = (since = 0): AgentStatus => ({ state: 'idle', since })
const allIdle = (): StatusMap => Object.fromEntries(AGENTS.map((a) => [a, idle()]))
const msg = (from: string, to: string, id = 'm1'): OfficeMessage => ({ id, kind: 'talk', from, to, at: 0 })

/** arrivedAt stub: a record you control */
function makeArrived() {
  const at: Record<string, string | null> = {}
  return { at, fn: (a: string) => at[a] ?? null }
}

describe('Director.goals by state', () => {
  it('idle agents get the same spots as playAt', () => {
    const d = new Director(AGENTS)
    const { fn } = makeArrived()
    const g = d.goals(0, MINUTE, allIdle(), fn)
    const play = playAt(MINUTE, AGENTS)
    for (const a of AGENTS) {
      expect(g[a].spot).toBe(play[a].spot)
      expect(g[a].pose).toBe(play[a].kind)
    }
  })

  it('working agents go to work_<i> and type; the rest play without them', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_1 = { state: 'working', since: 0, activity: 'edit' }
    st.agent_3 = { state: 'working', since: 0 }
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_1).toMatchObject({ spot: 'work_1', pose: 'type', label: '파일 편집 중' })
    expect(g.agent_3).toMatchObject({ spot: 'work_3', pose: 'type' })
    const play = playAt(MINUTE, AGENTS, new Set(['agent_1', 'agent_3']))
    expect(g.agent_0.spot).toBe(play.agent_0.spot)
    expect(g.agent_2.spot).toBe(play.agent_2.spot)
  })

  it('off agents never leave (#110): a sleeper dozes at its desk, the night-duty agent plays solo, a bare off rests', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_1 = { state: 'off', since: 0, night: 'sleep' }
    st.agent_2 = { state: 'idle', since: 0, night: 'duty' }
    st.agent_3 = { state: 'off', since: 0 }
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_1).toMatchObject({ spot: 'work_1', pose: 'doze', label: '조는 중' })
    expect(['coffee', 'books']).toContain(g.agent_2.pose)
    expect(g.agent_2.quiet).toBe(true)
    expect(g.agent_3).toMatchObject({ spot: 'work_3', pose: 'idle' })
    expect(Object.values(g).some((x) => x.pose === 'leave' || x.spot === 'door')).toBe(false)
  })

  it('no state of any agent, at any minute, yields leave', () => {
    const d = new Director(AGENTS)
    const states: AgentStatus[] = [
      idle(),
      { state: 'working', since: 0 },
      { state: 'wrapping', since: 0 },
      { state: 'off', since: 0 },
      { state: 'off', since: 0, night: 'sleep' },
      { state: 'idle', since: 0, night: 'duty' },
    ]
    for (let m = 0; m < 60; m++)
      for (const s of states) {
        const g = d.goals(m * 60000, MINUTE + m, Object.fromEntries(AGENTS.map((a) => [a, s])), makeArrived().fn)
        for (const a of AGENTS) expect(g[a].pose).not.toBe('leave')
      }
  })

  it('an agent missing from the status map is treated as idle', () => {
    const d = new Director(AGENTS)
    const g = d.goals(0, MINUTE, {}, makeArrived().fn)
    for (const a of AGENTS) expect(g[a].spot).toBe(playAt(MINUTE, AGENTS)[a].spot)
  })
})

describe('wrapping (#186): real work, then rest', () => {
  const since = 100
  const wrapping = (...agents: string[]): StatusMap => {
    const st = allIdle()
    for (const a of agents) st[a] = { state: 'wrapping', since }
    return st
  }

  it('never plays while the wrap-up is going on: first back to the desk, then write, carry, post, tidy; rest only after the tidy-up', () => {
    const d = new Director(AGENTS)
    const st = wrapping('agent_0')
    const { at, fn } = makeArrived()
    const n = wrapCards('agent_0', since)
    let now = 0
    const seen: string[] = []
    const poses: string[] = []
    const step = (ms: number) => {
      now += ms
      const g = d.goals(now, MINUTE, st, fn).agent_0
      const sh = d.shown.agent_0
      if (seen.at(-1) !== sh.detail) {
        seen.push(sh.detail ?? sh.status.state)
        poses.push(g.pose)
      }
      return { g, sh }
    }
    // away from the desk: the way back
    expect(step(0).g).toMatchObject({ spot: 'work_0', pose: 'idle' })
    expect(d.shown.agent_0).toMatchObject({ kind: 'wrap', detail: WRAP_LABEL.seat, status: { state: 'wrapping' } })
    at.agent_0 = 'work_0'
    expect(step(100).g).toMatchObject({ spot: 'work_0', pose: 'write', carry: 1 })
    for (let s = 0; s < n * 25; s++) step(100)
    expect(step(100).g).toMatchObject({ spot: 'whiteboard', pose: 'carry', carry: n })
    at.agent_0 = 'whiteboard'
    expect(step(100).g).toMatchObject({ spot: 'whiteboard', pose: 'cardpost', carry: n })
    for (let s = 0; s < 80 && d.shown.agent_0.detail === WRAP_LABEL.post; s++) step(100)
    expect(d.shown.agent_0.detail).toBe(WRAP_LABEL.seat)
    expect(step(100).g).toMatchObject({ spot: 'work_0', pose: 'idle', carry: 0 })
    at.agent_0 = 'work_0'
    expect(step(100).g.pose).toBe('tidy')
    let last = step(0)
    for (let s = 0; s < 40 && last.sh.kind === 'wrap'; s++) last = step(100)
    // the frame the tidy-up ends: shown = rest, and the play assignment is the goal in that same frame
    expect(last.sh).toMatchObject({ kind: 'rest', status: { state: 'idle' } })
    expect(last.sh.detail).toBeUndefined()
    expect(last.g.spot).toBe(playAt(MINUTE, AGENTS).agent_0.spot)
    expect(seen).toEqual([WRAP_LABEL.seat, WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.post, WRAP_LABEL.seat, WRAP_LABEL.tidy, 'idle'])
    expect(poses.slice(0, 6)).toEqual(['idle', 'write', 'carry', 'cardpost', 'idle', 'tidy'])
    // still `wrapping` in the raw status, and not started again with the same since
    for (let s = 0; s < 20; s++) expect(step(1000).sh.kind).toBe('rest')
  })

  it('the board is taken: it never plays; written, it re-reads; walking, it waits by the board with its stack and after 20 s goes back to its desk and tries again', () => {
    const d = new Director(AGENTS)
    const st = wrapping('agent_1')
    const { at, fn } = makeArrived()
    at.agent_1 = 'work_1'
    const n = wrapCards('agent_1', since)
    const trail: string[] = []
    let waitedFrom = -1
    let carryFrom: number | null = null
    let backAt = -1
    for (let now = 0; now <= 200_000; now += 100) {
      // someone else (a talk, a decision being pinned) takes the board from 10 s + the cards' writing to 100 s
      at.agent_2 = now >= n * 2500 + 3000 && now < 100_000 ? 'whiteboard' : null
      const g = d.goals(now, MINUTE, st, fn).agent_1
      const sh = d.shown.agent_1
      if (sh.kind === 'rest') {
        trail.push('rest')
        break
      }
      expect(['idle', 'write', 'carry', 'cardpost', 'tidy']).toContain(g.pose)
      if (trail.at(-1) !== sh.detail) trail.push(sh.detail!)
      if (g.pose === 'carry') {
        carryFrom ??= now
        at.agent_1 = g.waiting || now - carryFrom < 5000 ? null : 'whiteboard'
        if (g.waiting && waitedFrom < 0) waitedFrom = now
      } else if (g.pose === 'cardpost') {
        carryFrom = null
        at.agent_1 = 'whiteboard'
      } else {
        carryFrom = null
        at.agent_1 = g.spot
      }
      if (sh.detail === WRAP_LABEL.seat && backAt < 0 && waitedFrom >= 0) backAt = now
    }
    expect(waitedFrom).toBeGreaterThan(0)
    expect(backAt - waitedFrom).toBeGreaterThanOrEqual(19_900)
    expect(backAt - waitedFrom).toBeLessThan(21_000)
    expect(trail).toEqual([
      WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.seat, '카드 다시 읽는 중', WRAP_LABEL.walk, WRAP_LABEL.post, WRAP_LABEL.seat, WRAP_LABEL.tidy, 'rest',
    ])
  })

  it('only one wrapping agent is at the board posting at a time', () => {
    const d = new Director(AGENTS)
    const st = wrapping('agent_0', 'agent_1', 'agent_2')
    const { at, fn } = makeArrived()
    for (const a of ['agent_0', 'agent_1', 'agent_2']) at[a] = `work_${a.split('_')[1]}`
    let now = 0
    for (let k = 0; k < 900; k++) {
      now += 100
      const g = d.goals(now, MINUTE, st, fn)
      expect(AGENTS.filter((a) => g[a].pose === 'cardpost').length).toBeLessThanOrEqual(1)
      for (const a of ['agent_0', 'agent_1', 'agent_2']) {
        if (g[a].pose === 'carry' && !AGENTS.some((b) => b !== a && g[b].pose === 'cardpost')) at[a] = 'whiteboard'
        else if (g[a].pose === 'carry') at[a] = null
        else if (g[a].pose !== 'cardpost') at[a] = g[a].spot.startsWith('work_') ? g[a].spot : null
      }
    }
  })

  it('reduced motion: it never leaves the desk, 1 -> 4 -> 5 in place', () => {
    const d = new Director(AGENTS)
    const st = wrapping('agent_0')
    const { at, fn } = makeArrived()
    at.agent_0 = 'work_0'
    const poses = new Set<string>()
    for (let now = 0; now < 15_000; now += 100) {
      const g = d.goals(now, MINUTE, st, fn, { reduced: true }).agent_0
      if (d.shown.agent_0.kind === 'wrap') {
        poses.add(g.pose)
        expect(g.spot).toBe('work_0')
      }
    }
    expect([...poses].sort()).toEqual(['tidy', 'write'])
    expect(d.shown.agent_0.kind).toBe('rest')
  })

  it('a new wrap-up (a new since) starts over', () => {
    const d = new Director(AGENTS)
    const { at, fn } = makeArrived()
    at.agent_0 = 'work_0'
    d.goals(0, MINUTE, wrapping('agent_0'), fn)
    for (let now = 100; now < 30_000; now += 100) {
      at.agent_0 = d.goals(now, MINUTE, wrapping('agent_0'), fn).agent_0.spot
    }
    expect(d.shown.agent_0.kind).toBe('rest')
    const fresh = allIdle()
    fresh.agent_0 = { state: 'wrapping', since: 999_999 }
    d.goals(31_000, MINUTE, fresh, fn)
    expect(d.shown.agent_0).toMatchObject({ kind: 'wrap' })
  })
})

describe('one place for one agent (#186, left over from #188)', () => {
  it('never gives a spot to a second agent while another holds it or is heading to it', () => {
    for (let minute = 0; minute < 600; minute++) {
      const d = new Director(AGENTS)
      const arrived: Record<string, string | null> = {}
      // everyone has been on its way to last block's spots; agent_3 already stands at the coffee machine
      const g1 = d.goals(0, minute, allIdle(), (a) => arrived[a] ?? null)
      arrived.agent_3 = g1.agent_3.spot
      const g2 = d.goals(3 * 60_000, minute + 3, allIdle(), (a) => arrived[a] ?? null)
      const keys = AGENTS.map((a) => (g2[a].slot ? `${g2[a].spot}|${g2[a].slot!.x.toFixed(1)}` : g2[a].spot)).filter((k) => !k.startsWith('work_'))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('the sofa middle seat is not given out between two seated agents', () => {
    const d = new Director(AGENTS)
    const arrived: Record<string, string | null> = { agent_0: 'sofa_0', agent_1: 'sofa_2' }
    let any = false
    for (let minute = 0; minute < 3000; minute += 3) {
      const g = d.goals(minute * 60_000, minute, allIdle(), (a) => arrived[a] ?? null)
      if (g.agent_2.spot === 'sofa_1' || g.agent_3.spot === 'sofa_1') any = true
    }
    expect(any).toBe(false)
  })
})

describe('messages', () => {
  it('agent_0 -> working agent_1: agent_0 goes to desk_side_1, agent_1 stays and looks at agent_0', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_1 = { state: 'working', since: 0 }
    d.receive(msg('agent_0', 'agent_1'))
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_0.spot).toBe('desk_side_1')
    expect(g.agent_1.spot).toBe('work_1')
    expect(g.agent_1.lookAt).toBe('agent_0')
    expect(g.agent_0.lookAt).toBe('agent_1')
  })

  it('idle pair: meet spots, bubbles after both arrive, back to play after TALK_MS', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    const { at, fn } = makeArrived()
    d.receive(msg('agent_0', 'agent_1'))
    let g = d.goals(0, MINUTE, st, fn)
    expect(g.agent_0.spot).toBe('meet_floor_0')
    expect(g.agent_1.spot).toBe('meet_floor_1')
    expect(g.agent_0.bubble).toBeUndefined()
    expect(g.agent_1.bubble).toBeUndefined()

    // only one arrived: still gathering
    at.agent_0 = 'meet_floor_0'
    g = d.goals(1000, MINUTE, st, fn)
    expect(g.agent_0.bubble).toBeUndefined()

    at.agent_1 = 'meet_floor_1'
    g = d.goals(2000, MINUTE, st, fn)
    expect(g.agent_0.bubble).toBe(BUBBLE_ASK)
    expect(g.agent_1.bubble).toBe(BUBBLE_REPLY)
    expect(g.agent_0.pose).toBe('talk')
    expect(g.agent_1.pose).toBe('talk')

    g = d.goals(2000 + TALK_MS - 1, MINUTE, st, fn)
    expect(g.agent_0.spot).toBe('meet_floor_0')
    g = d.goals(2000 + TALK_MS, MINUTE, st, fn)
    const play = playAt(MINUTE, AGENTS)
    expect(g.agent_0.spot).toBe(play.agent_0.spot)
    expect(g.agent_1.spot).toBe(play.agent_1.spot)
    expect(g.agent_0.bubble).toBeUndefined()
    expect(d.pending.talks).toEqual([])
  })

  it('gives up gathering after 30 s if they never arrive', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    const { fn } = makeArrived()
    d.receive(msg('agent_0', 'agent_1'))
    expect(d.goals(0, MINUTE, st, fn).agent_0.spot).toBe('meet_floor_0')
    expect(d.goals(30_000, MINUTE, st, fn).agent_0.spot).toBe(playAt(MINUTE, AGENTS).agent_0.spot)
  })

  it('a second talk uses the other meet pair; a third waits', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    d.receive(msg('agent_0', 'agent_1', 'a'))
    d.receive(msg('agent_2', 'agent_3', 'b'))
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_2.spot).toBe('meet_board_0')
    expect(g.agent_3.spot).toBe('meet_board_1')
    expect(d.pending.queued).toBe(0)
  })

  it('a message to an off agent is dropped', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_1 = { state: 'off', since: 0 }
    d.receive(msg('agent_0', 'agent_1'))
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_1).toMatchObject({ spot: 'work_1', pose: 'idle' })
    expect(g.agent_0.spot).toBe(playAt(MINUTE, AGENTS, new Set(['agent_1'])).agent_0.spot)
    expect(d.pending).toEqual({ queued: 0, talks: [] })
  })

  it('a message from an off agent is dropped', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_0 = { state: 'off', since: 0 }
    d.receive(msg('agent_0', 'agent_1'))
    d.goals(0, MINUTE, st, makeArrived().fn)
    expect(d.pending).toEqual({ queued: 0, talks: [] })
  })

  it('a message to oneself is ignored', () => {
    const d = new Director(AGENTS)
    d.receive(msg('agent_0', 'agent_0'))
    expect(d.pending.queued).toBe(0)
  })
})

describe('handoffs are paper planes, not meetings (#51)', () => {
  it('a handoff message gathers nobody', () => {
    const d = new Director(AGENTS)
    d.receive({ id: 'h1', kind: 'handoff', from: 'agent_0', to: 'agent_3', at: 0 })
    const g = d.goals(0, 0, allIdle(), () => null)
    expect(Object.values(g).some((x) => x.bubble)).toBe(false)
    expect(d.pending.talks).toEqual([])
    expect(d.pending.queued).toBe(0)
  })
})
