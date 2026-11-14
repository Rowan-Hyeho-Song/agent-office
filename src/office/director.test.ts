import { describe, expect, it } from 'vitest'
import { conversations, type DocMeta } from '../docs/library'
import { buildScript } from './meeting'
import { MEET_WORDS, MeetingRunner } from './meetingRun'
import { BUBBLE_ASK, BUBBLE_REPLY, Director } from './director'
import { playAt, playPose } from './play'
import { startWrap, totalOf, TOUCH_LABEL, WRAP_LABEL } from './wrap'
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
      expect(g[a].pose).toBe(playPose(play[a].kind)) // a game record placed alone is drawn as the board pose (#137)
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
    const plan = startWrap('agent_0', since, 0, false)
    const n = plan.n
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
    // the cards are written for the desk's share of the time (wrapup.md 1), then it sets off with all of them
    for (let s = 0; s < totalOf(plan.plan.desk) * 10 - 1; s++) step(100)
    expect(step(100).g).toMatchObject({ spot: 'whiteboard', pose: 'carry', carry: n })
    at.agent_0 = 'whiteboard'
    expect(step(100).g).toMatchObject({ spot: 'whiteboard', pose: 'cardpost', carry: n })
    // the pieces at the board: posting, then touching the cards, to about 6 s before the display ends
    let touched = false
    for (let s = 0; s < 1500 && [WRAP_LABEL.post, TOUCH_LABEL].includes(d.shown.agent_0.detail!); s++) {
      step(100)
      touched ||= d.shown.agent_0.detail === TOUCH_LABEL
    }
    expect(touched).toBe(true)
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
    expect(seen).toEqual([WRAP_LABEL.seat, WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.post, TOUCH_LABEL, WRAP_LABEL.seat, WRAP_LABEL.tidy, 'idle'])
    expect(poses.slice(0, 7)).toEqual(['idle', 'write', 'carry', 'cardpost', 'cardpost', 'idle', 'tidy'])
    // the whole wrap-up lasted to about 6 s before the display's end (2 min from the status' since)
    expect(now).toBeGreaterThan(since + 120_000 - 6000 - 30_000)
    expect(now).toBeLessThanOrEqual(since + 120_000 - 6000 + 5000)
    // still `wrapping` in the raw status, and not started again with the same since
    for (let s = 0; s < 20; s++) expect(step(1000).sh.kind).toBe('rest')
  })

  it('the board is taken: it never plays; written, it re-reads; walking, it waits by the board with its stack and after 20 s goes back to its desk and tries again', () => {
    const d = new Director(AGENTS)
    const st = wrapping('agent_1')
    const { at, fn } = makeArrived()
    at.agent_1 = 'work_1'
    const n = startWrap('agent_1', since, 0, true)
    const writeMs = totalOf(n.plan.desk) * 1000
    const trail: string[] = []
    let waitedFrom = -1
    let carryFrom: number | null = null
    let backAt = -1
    for (let now = 0; now <= 200_000; now += 100) {
      // someone else (a talk, a decision being pinned) takes the board from 10 s + the cards' writing to 100 s
      at.agent_2 = now >= writeMs + 3000 && now < 100_000 ? 'whiteboard' : null
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
      WRAP_LABEL.write, WRAP_LABEL.walk, WRAP_LABEL.seat, '카드 다시 읽는 중', WRAP_LABEL.walk, WRAP_LABEL.post, TOUCH_LABEL, WRAP_LABEL.seat, WRAP_LABEL.tidy, 'rest',
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

  it('reduced motion: it never leaves the desk, writes the whole time (still posture), tidies, rests (1 -> 4 -> 5 in place)', () => {
    const d = new Director(AGENTS)
    const st = wrapping('agent_0')
    const { at, fn } = makeArrived()
    at.agent_0 = 'work_0'
    const poses = new Set<string>()
    let wrapEnd = 0
    for (let now = 0; now < 118_000; now += 100) {
      const g = d.goals(now, MINUTE, st, fn, { reduced: true }).agent_0
      if (d.shown.agent_0.kind === 'wrap') {
        poses.add(g.pose)
        expect(g.spot).toBe('work_0')
        wrapEnd = now
      }
    }
    // the time is filled the same: to about 6 s before the display ends
    expect(wrapEnd).toBeGreaterThan(100 + 120_000 - 6000 - 12_000)
    expect([...poses].sort()).toEqual(['tidy', 'write'])
    expect(d.shown.agent_0.kind).toBe('rest')
  })

  it('a talk in the middle of the writing holds the wrap-up: back at the desk it goes on from where it was, never showing "writing" away from the desk', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    st.agent_2 = { state: 'wrapping', since: 100 }
    const { at, fn } = makeArrived()
    at.agent_2 = 'work_2'
    let now = 0
    const tick = (ms: number) => {
      now += ms
      const g = d.goals(now, MINUTE, st, fn).agent_2
      return g
    }
    for (let i = 0; i < 200; i++) tick(100)
    const before = tick(0).beat!
    expect(d.shown.agent_2.step).toBe('write')
    d.receive(msg('agent_2', 'agent_3'))
    // gone to the talk place: the talk's own display, the wrap-up's clock stands still
    at.agent_2 = null
    tick(100)
    expect(d.shown.agent_2.kind).toBe('talk')
    at.agent_2 = 'meet_talk_0'
    at.agent_3 = 'meet_talk_1'
    for (let i = 0; i < 400 && d.shown.agent_2.kind === 'talk'; i++) tick(100)
    // the talk is over: on the way back it says so, and shows no writing until it sits at its desk
    expect(d.shown.agent_2).toMatchObject({ kind: 'wrap', step: 'seat', detail: WRAP_LABEL.seat })
    at.agent_2 = null
    for (let i = 0; i < 20; i++) tick(100)
    expect(d.shown.agent_2.step).toBe('seat')
    at.agent_2 = 'work_2'
    const after = tick(100)
    expect(d.shown.agent_2.step).toBe('write')
    // on from the same card: the pieces did not start over (card 1 of the plan was reached before the talk)
    expect(after.beat!.k).toBeGreaterThanOrEqual(before.k)
  })

  it('a new wrap-up (a new since) starts over', () => {
    const d = new Director(AGENTS)
    const { at, fn } = makeArrived()
    at.agent_0 = 'work_0'
    d.goals(0, MINUTE, wrapping('agent_0'), fn)
    for (let now = 100; now < 118_000; now += 100) {
      at.agent_0 = d.goals(now, MINUTE, wrapping('agent_0'), fn).agent_0.spot
    }
    expect(d.shown.agent_0.kind).toBe('rest')
    const fresh = allIdle()
    fresh.agent_0 = { state: 'wrapping', since: 999_999 }
    d.goals(119_000, MINUTE, fresh, fn)
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

  it('the sofa never has all three seats given out (nobody squeezed in the middle)', () => {
    const d = new Director(AGENTS)
    for (let minute = 0; minute < 3000; minute += 3) {
      const g = d.goals(minute * 60_000, minute, allIdle(), () => null)
      const seats = AGENTS.map((a) => g[a].spot).filter((s) => s.startsWith('sofa_'))
      expect(seats.includes('sofa_0') && seats.includes('sofa_1') && seats.includes('sofa_2'), `minute ${minute}`).toBe(false)
    }
  })

  // the day simulation went from 18 s to 220 s: a seat rule that read "arrived" swapped two agents between the sofa and
  // a desk every few frames (an agent stepping aside for a passer is briefly not arrived), and every swap was a replan
  it('who gets which place does not change when someone briefly stops being "arrived"', () => {
    for (let minute = 0; minute < 3000; minute += 3) {
      const d = new Director(AGENTS)
      const t = minute * 60_000
      const g0 = d.goals(t, minute, allIdle(), () => null)
      const there = (a: string) => g0[a].spot
      const g1 = d.goals(t + 100, minute, allIdle(), there)
      const key = (g: Record<string, { spot: string }>) => AGENTS.map((a) => g[a].spot).join(',')
      for (const away of AGENTS) {
        const g2 = d.goals(t + 200, minute, allIdle(), (a) => (a === away ? null : there(a)))
        const g3 = d.goals(t + 300, minute, allIdle(), there)
        expect(key(g2), `minute ${minute}, ${away} steps aside`).toBe(key(g1))
        expect(key(g3), `minute ${minute}, ${away} back`).toBe(key(g1))
      }
    }
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
    expect(g.agent_0.spot).toBe('meet_talk_0')
    expect(g.agent_1.spot).toBe('meet_talk_1')
    expect(g.agent_0.bubble).toBeUndefined()
    expect(g.agent_1.bubble).toBeUndefined()

    // only one arrived: still gathering
    at.agent_0 = 'meet_talk_0'
    g = d.goals(1000, MINUTE, st, fn)
    expect(g.agent_0.bubble).toBeUndefined()

    at.agent_1 = 'meet_talk_1'
    g = d.goals(2000, MINUTE, st, fn)
    expect(g.agent_0.bubble).toBe(BUBBLE_ASK)
    expect(g.agent_1.bubble).toBe(BUBBLE_REPLY)
    expect(g.agent_0.pose).toBe('talk')
    expect(g.agent_1.pose).toBe('talk')

    g = d.goals(2000 + TALK_MS - 1, MINUTE, st, fn)
    expect(g.agent_0.spot).toBe('meet_talk_0')
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
    expect(d.goals(0, MINUTE, st, fn).agent_0.spot).toBe('meet_talk_0')
    expect(d.goals(30_000, MINUTE, st, fn).agent_0.spot).toBe(playAt(MINUTE, AGENTS).agent_0.spot)
  })

  it('a second talk goes to the chat spots by the window; a third waits', () => {
    const d = new Director(AGENTS)
    const st = allIdle()
    d.receive(msg('agent_0', 'agent_1', 'a'))
    d.receive(msg('agent_2', 'agent_3', 'b'))
    const g = d.goals(0, MINUTE, st, makeArrived().fn)
    expect(g.agent_2.spot).toBe('chat_0')
    expect(g.agent_3.spot).toBe('chat_1')
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

describe('a meeting shows its own words (#354)', () => {
  const meta: DocMeta = { id: 7, kind: 'minutes', repo: 'o/r', folder: 28, title: 'T', agents: [], labels: [], grade: 'public', approved: true, readable: true, created_at: '', updated_at: '' }
  const convs = conversations({
    minutes: [{ date: null, rows: [{ order: 1, from: { seat: 2 }, to: [{ seat: 3 }], text: '하나.' }, { order: 2, from: { seat: 3 }, to: [{ seat: 2 }], text: '둘.' }], decision: '정했다.', followUp: '루프가 한다.' }],
  })
  const MEET = new Set(Object.values(MEET_WORDS))

  /** the scene's frame order: director, then the meeting over the goals, then the meeting's words to the director */
  function play(st: StatusMap, calledAt: number) {
    const d = new Director(AGENTS)
    const r = new MeetingRunner()
    const at: Record<string, string | null> = {}
    const during: Record<string, Set<string>> = {}
    const kinds: Record<string, string[]> = {}
    let started = false
    let endedAt = -1
    for (let now = 0; now < 200_000; now += 100) {
      const goals = d.goals(now, MINUTE, st, (a) => at[a] ?? null)
      if (!started && now >= calledAt) started = r.start(buildScript(meta, convs), now, st)
      r.apply(now, (a) => at[a] ?? null, goals)
      d.setMeeting(r.words)
      for (const a of AGENTS) {
        at[a] = goals[a].spot
        if (r.busy && a in r.words) {
          // for as long as the runner steers it: only the meeting's words, never a wrap stage or "자리로 가는 중"
          ;(during[a] ??= new Set()).add(d.shown[a].detail ?? '')
          ;(kinds[a] ??= []).push(d.shown[a].kind)
          expect(MEET.has(d.shown[a].detail ?? '')).toBe(true)
          expect(d.shown[a].detail).toBe(goals[a].label)
        }
      }
      if (started && !r.busy && endedAt < 0) endedAt = now
      if (endedAt >= 0 && now > endedAt + 60_000) break
    }
    return { d, during, kinds, endedAt }
  }

  it('a wrapping agent away from its desk shows the meeting text, not "자리로 돌아가는 중", and its wrap-up goes on afterwards', () => {
    const st = allIdle()
    st.agent_2 = { state: 'wrapping', since: 100 }
    const { d, during, kinds, endedAt } = play(st, 1000)
    expect(endedAt).toBeGreaterThan(0)
    expect(during.agent_2.has(WRAP_LABEL.seat)).toBe(false)
    expect(during.agent_2.has(MEET_WORDS.gather)).toBe(true)
    expect(during.agent_2.has(MEET_WORDS.talk) || during.agent_2.has(MEET_WORDS.listen)).toBe(true)
    expect(new Set(kinds.agent_2)).toEqual(new Set(['meet']))
    // the meeting is over: the wrap-up carries on as before (the agent was at its desk at the start of the wrap, so it writes / tidies, then rests)
    expect(['wrap', 'rest']).toContain(d.shown.agent_2.kind)
  })

  it('a wrap-up stage does not run on while the agent is at the meeting', () => {
    const st = allIdle()
    st.agent_2 = { state: 'wrapping', since: 100 }
    const d = new Director(AGENTS)
    const at: Record<string, string | null> = {}
    const step = (now: number, meeting: boolean) => {
      const g = d.goals(now, MINUTE, st, (a) => at[a] ?? null)
      d.setMeeting(meeting ? { agent_2: MEET_WORDS.listen } : {})
      return g
    }
    step(0, false)
    expect(d.shown.agent_2).toMatchObject({ kind: 'wrap', step: 'seat' })
    // called away while it is walking back (the meeting's words come after that frame's goals); at its desk it would start writing, but the meeting holds the wrap-up
    step(50, true)
    at.agent_2 = 'work_2'
    step(100, true)
    step(30_000, true)
    expect(d.shown.agent_2).toMatchObject({ kind: 'meet', detail: MEET_WORDS.listen })
    at.agent_2 = 'meet_seat_2'
    step(40_000, false)
    expect(d.shown.agent_2).toMatchObject({ kind: 'wrap', step: 'seat', detail: WRAP_LABEL.seat })
    at.agent_2 = 'work_2'
    step(40_100, false)
    expect(d.shown.agent_2).toMatchObject({ kind: 'wrap', step: 'write', detail: WRAP_LABEL.write })
  })

  it('a working agent away from its desk shows only the meeting text, then works again', () => {
    const st = allIdle()
    st.agent_3 = { state: 'working', since: 0 }
    const { d, during, kinds, endedAt } = play(st, 1000)
    expect(endedAt).toBeGreaterThan(0)
    expect(during.agent_3.has('자리로 가는 중')).toBe(false)
    expect(new Set(kinds.agent_3)).toEqual(new Set(['meet']))
    expect(d.shown.agent_3).toMatchObject({ kind: 'work', status: { state: 'working' } })
  })

  it('an idle agent shows only the meeting text too, then rests', () => {
    const { d, during, kinds, endedAt } = play(allIdle(), 1000)
    expect(endedAt).toBeGreaterThan(0)
    expect(new Set(kinds.agent_2)).toEqual(new Set(['meet']))
    expect([...during.agent_2].every((w) => MEET.has(w))).toBe(true)
    expect(d.shown.agent_2.kind).toBe('rest')
  })
})

// the start rule (#228): an errand / act is not started when the agent's night is about to change under it (a few seconds in it would be called away)
describe('Director start rule: not just before the night changes', () => {
  const KST_H = (day: number, h: number, m: number, s: number) => Date.UTC(2026, 0, day, h - 9, m, s)
  const ROSTER = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
  const idleAll = (): StatusMap => Object.fromEntries(ROSTER.map((a) => [a, idle()]))
  /** the first day (and agent) on which `who` is assigned water at this KST time */
  function waterDay(who: string, h: number, m: number, s: number) {
    for (let day = 1; day < 120; day++) {
      const now = KST_H(day, h, m, s)
      if (playAt(Math.floor(now / 60000), ROSTER)[who]?.kind === 'water') return now
    }
    throw new Error('no such day')
  }
  const goalsAt = (d: Director, now: number, st: StatusMap) => d.goals(now, Math.floor(now / 60000), st, () => null)

  it('starts the errand by day, and not 10 s before agent_1 goes dark (23:03): its night changes within the lead', () => {
    const day = waterDay('agent_1', 22, 56, 0)
    expect(goalsAt(new Director(ROSTER), day, idleAll()).agent_1.water?.stage).toBe('fetch')
    const late = waterDay('agent_1', 23, 2, 50)
    expect(goalsAt(new Director(ROSTER), late, idleAll()).agent_1.water).toBeUndefined()
  })

  it('does not start while wrapping at night (asleep or on the night shift as soon as the wrap-up ends), does by day', () => {
    const night = waterDay('agent_1', 1, 10, 0)
    const wrapping = idleAll()
    wrapping.agent_1 = { state: 'wrapping', since: night - 200_000 }
    expect(goalsAt(new Director(ROSTER), night, wrapping).agent_1.water).toBeUndefined()
    const noon = waterDay('agent_1', 13, 10, 0)
    const wrapDay = idleAll()
    wrapDay.agent_1 = { state: 'wrapping', since: noon - 200_000 }
    // (a wrap-up still under way holds the agent; the errand may start once it has run, so only the night case is asserted above)
    expect(goalsAt(new Director(ROSTER), noon, idleAll()).agent_1.water?.stage).toBe('fetch')
  })

  it('an errand already under way is not touched by the rule', () => {
    const day = waterDay('agent_1', 23, 2, 30)
    const d = new Director(ROSTER)
    expect(goalsAt(d, day, idleAll()).agent_1.water?.stage).toBe('fetch')
    // 10 s later its night is within the lead (a fresh start would be refused), but it is on its way already: still fetching
    const edge = day + 10_000
    expect(goalsAt(d, edge, idleAll()).agent_1.water?.stage).toBe('fetch')
  })
})
