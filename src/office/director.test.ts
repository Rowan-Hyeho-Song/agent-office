import { describe, expect, it } from 'vitest'
import { BUBBLE_ASK, BUBBLE_REPLY, Director } from './director'
import { playAt } from './play'
import type { AgentStatus, OfficeMessage, StatusMap } from './status'

const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3']
const MINUTE = 987_654
const POST_MS = 4000
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

  it('off agents go to the door and leave', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_2 = { state: 'off', since: 0 }
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_2).toMatchObject({ spot: 'door', pose: 'leave' })
  })

  it('an agent missing from the status map is treated as idle', () => {
    const d = new Director(AGENTS)
    const g = d.goals(0, MINUTE, {}, makeArrived().fn)
    for (const a of AGENTS) expect(g[a].spot).toBe(playAt(MINUTE, AGENTS)[a].spot)
  })
})

describe('wrapping', () => {
  it('goes to the whiteboard, posts for POST_MS, then returns to play', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_0 = { state: 'wrapping', since: 100 }
    const { at, fn } = makeArrived()
    const play = playAt(MINUTE, AGENTS)

    expect(d.goals(1000, MINUTE, st, fn).agent_0).toMatchObject({ spot: 'whiteboard', pose: 'post' })
    at.agent_0 = 'whiteboard'
    expect(d.goals(1000, MINUTE, st, fn).agent_0.spot).toBe('whiteboard')
    expect(d.goals(1000 + POST_MS - 1, MINUTE, st, fn).agent_0.spot).toBe('whiteboard')
    // POST time is up: the wrap-up is marked done; the next goals call sends it back to play
    d.goals(1000 + POST_MS, MINUTE, st, fn)
    expect(d.goals(1000 + POST_MS + 16, MINUTE, st, fn).agent_0.spot).toBe(play.agent_0.spot)
  })

  it('does not send it back with the same since, does with a new since', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_0 = { state: 'wrapping', since: 100 }
    const { at, fn } = makeArrived()
    at.agent_0 = 'whiteboard'
    d.goals(0, MINUTE, st, fn)
    d.goals(POST_MS, MINUTE, st, fn)
    const play = playAt(MINUTE, AGENTS)
    expect(d.goals(POST_MS + 10, MINUTE, st, fn).agent_0.spot).toBe(play.agent_0.spot)
    // same since again (a new snapshot object, same wrap-up)
    const same = { ...st, agent_0: { state: 'wrapping', since: 100 } as AgentStatus }
    expect(d.goals(POST_MS + 20, MINUTE, same, fn).agent_0.spot).toBe(play.agent_0.spot)
    // a new wrap-up
    const fresh = { ...st, agent_0: { state: 'wrapping', since: 200 } as AgentStatus }
    expect(d.goals(POST_MS + 30, MINUTE, fresh, fn).agent_0).toMatchObject({ spot: 'whiteboard', pose: 'post' })
  })

  it('does not finish the post before the agent has arrived', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_0 = { state: 'wrapping', since: 100 }
    const { fn } = makeArrived()
    expect(d.goals(0, MINUTE, st, fn).agent_0.spot).toBe('whiteboard')
    expect(d.goals(60_000, MINUTE, st, fn).agent_0.spot).toBe('whiteboard')
  })

  it('only one wrapping agent targets the whiteboard at a time', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_0 = { state: 'wrapping', since: 1 }
    st.agent_1 = { state: 'wrapping', since: 1 }
    st.agent_2 = { state: 'wrapping', since: 1 }
    const { at, fn } = makeArrived()
    let g = d.goals(0, MINUTE, st, fn)
    expect(AGENTS.filter((a) => g[a].spot === 'whiteboard')).toEqual(['agent_0'])
    // after agent_0 is done, the next in order takes the board
    at.agent_0 = 'whiteboard'
    d.goals(10, MINUTE, st, fn)
    d.goals(10 + POST_MS, MINUTE, st, fn)
    g = d.goals(10 + POST_MS + 16, MINUTE, st, fn)
    expect(AGENTS.filter((a) => g[a].spot === 'whiteboard')).toEqual(['agent_1'])
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
    expect(g.agent_0.spot).toBe('meet_a')
    expect(g.agent_1.spot).toBe('meet_b')
    expect(g.agent_0.bubble).toBeUndefined()
    expect(g.agent_1.bubble).toBeUndefined()

    // only one arrived: still gathering
    at.agent_0 = 'meet_a'
    g = d.goals(1000, MINUTE, st, fn)
    expect(g.agent_0.bubble).toBeUndefined()

    at.agent_1 = 'meet_b'
    g = d.goals(2000, MINUTE, st, fn)
    expect(g.agent_0.bubble).toBe(BUBBLE_ASK)
    expect(g.agent_1.bubble).toBe(BUBBLE_REPLY)
    expect(g.agent_0.pose).toBe('talk')
    expect(g.agent_1.pose).toBe('talk')

    g = d.goals(2000 + TALK_MS - 1, MINUTE, st, fn)
    expect(g.agent_0.spot).toBe('meet_a')
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
    expect(d.goals(0, MINUTE, st, fn).agent_0.spot).toBe('meet_a')
    expect(d.goals(30_000, MINUTE, st, fn).agent_0.spot).toBe(playAt(MINUTE, AGENTS).agent_0.spot)
  })

  it('a second talk uses the other meet pair; a third waits', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    d.receive(msg('agent_0', 'agent_1', 'a'))
    d.receive(msg('agent_2', 'agent_3', 'b'))
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_2.spot).toBe('meet_c')
    expect(g.agent_3.spot).toBe('meet_d')
    expect(d.pending.queued).toBe(0)
  })

  it('a message to an off agent is dropped', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_1 = { state: 'off', since: 0 }
    d.receive(msg('agent_0', 'agent_1'))
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_1).toMatchObject({ spot: 'door', pose: 'leave' })
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
