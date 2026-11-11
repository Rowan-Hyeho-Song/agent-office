/// <reference types="node" />
// The replayed office lives (#429) and its faces follow the replay (#428), timelapse.md 12: the scene is decided by the replay time alone, the
// working ones are those with a point in the 10 minutes before it, the others keep the live day's schedule at that time (play, rest, the night),
// bodies walk at x1 / x4 and are put down at x16, and no live status or event reaches the replayed faces.

import { beforeAll, describe, expect, it } from 'vitest'
import { baseExpression, BORED_AFTER_MS } from '../office/faceMind'
import { EXPRESSIONS, type Expression } from '../office/faceModel'
import { nightDuty } from '../office/duty'
import { FOOTPRINT_DATA } from '../office/footprint.data'
import { buildGrid, decodeFootprint } from '../office/grid'
import { MeetingRunner } from '../office/meetingRun'
import { GRAPH } from '../office/navSpots.fixture'
import { AgentRig, buildRig } from '../office/rig'
import { loadOffice, stubCanvas } from '../office/glbLoad'
import { greetsOwner, questionFaceFor } from '../office/liveFace'
import { playAt } from '../office/play'
import { sessionsAt } from '../play/session'
import type { OfficeMessage } from '../office/status'
import { TrafficPlanner } from '../office/traffic'
import type { Point } from '../timeline/types'
import { atMs, lifeStatusAt, sceneAt, WORK_WINDOW_MS } from './engine'
import { landingFaces, NOT_IN_REPLAY } from './faces'
import { Stage } from './stage'
import { ReplayStore } from './store'

stubCanvas()

const AGENTS = ['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4']
const MIN = 60_000

let n = 0
const pt = (ms: number, over: Partial<Point> = {}): Point => ({
  key: `k${n++}`, project: 'o/r', at: new Date(ms).toISOString(), kind: 'work', agent: 3, title: 't', secret: false, additions: 1, deletions: 0, files: 1, issue: 1, pr: null, tier: 'public', ...over,
})
/** a KST time of day on 2026-11-12 as epoch ms */
const kst = (h: number, m = 0) => Date.parse(`2026-11-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`)

describe('who works at a replay time (12.1)', () => {
  it('the ones with a point in the 10 minutes before it work; the others do not', () => {
    const t = kst(14)
    const ps = [pt(t - 30 * MIN, { agent: 1 }), pt(t - 10 * MIN, { agent: 4 }), pt(t - 9 * MIN, { agent: 2 }), pt(t, { agent: 3, kind: 'plan' })]
    const s = lifeStatusAt(ps, 3)
    expect(s.agent_3).toMatchObject({ state: 'working', activity: 'think' })
    expect(s.agent_2.state).toBe('working') // 9 minutes ago
    expect(s.agent_4.state).toBe('idle') // exactly 10 minutes ago is out
    expect(s.agent_1.state).toBe('idle')
    expect(s.agent_0.state).toBe('idle')
    expect(WORK_WINDOW_MS).toBe(10 * MIN)
  })
  it('a point of the future does not count; a result, a minutes point and a deploy are not work', () => {
    const t = kst(14)
    const ps = [pt(t, { agent: 1, kind: 'minutes' }), pt(t + 1, { agent: 2, kind: 'approval', result: true }), pt(t + 2, { agent: 0, kind: 'deploy' }), pt(t + 3, { agent: 4 })]
    const s = lifeStatusAt(ps, 0)
    expect(Object.values(s).every((x) => x.state === 'idle')).toBe(true)
    expect(lifeStatusAt(ps, 3).agent_4.state).toBe('working')
  })
  it('the idle ones carry the replay time as their "since", never a stretch of days', () => {
    const t = kst(14)
    const s = lifeStatusAt([pt(t - 3 * 86_400_000, { agent: 1 }), pt(t)], 1)
    expect(s.agent_1).toMatchObject({ state: 'idle', since: t })
  })
  it('the night is the live day\'s rule at the replay time: asleep at the desk, one agent on duty, a working one stays up', () => {
    const t = kst(2, 30)
    const s = sceneAt([pt(t, { agent: 3 })], 0).status
    expect(s.agent_3.state).toBe('working')
    const duty = nightDuty(Object.keys(s), t)
    for (const id of AGENTS.filter((a) => a !== 'agent_3')) {
      if (id === duty) expect(s[id]).toMatchObject({ state: 'idle', night: 'duty' })
      else expect(s[id]).toMatchObject({ state: 'off', night: 'sleep' })
    }
    // by day nobody sleeps
    expect(Object.values(sceneAt([pt(kst(14), { agent: 3 })], 0).status).every((x) => x.night === undefined)).toBe(true)
  })
})

async function stageAt(points: Point[], speed: 1 | 4 | 16 = 1, index = 0) {
  const store = new ReplayStore()
  store.source = async () => points
  store.reduced = () => true // the store's own fade (the day change's) is not under test
  await store.open({ project: 'all', t: atMs(points[index]), mode: 'office' })
  store.setSpeed(speed)
  const planner = new TrafficPlanner(buildGrid(decodeFootprint(FOOTPRINT_DATA), GRAPH), GRAPH)
  const stage = new Stage({ store, planner, meeting: new MeetingRunner(), ids: AGENTS, reduced: () => false, spot: (id) => GRAPH.spots[id] ?? null })
  stage.begin()
  return { store, stage }
}

/** a minute (in a day hour) at which the schedule has a pair game among the agents left free by `busy` */
function minuteWithGame(busy: string[], kind: 'pingpong' | 'boardgame') {
  for (let m = 0; m < 600; m++) {
    const ms = kst(14) + m * 3 * MIN
    const minute = Math.floor(ms / MIN)
    const plan = playAt(minute, AGENTS, new Set(busy))
    const players = Object.entries(plan).filter(([, a]) => a.kind === kind).map(([id]) => id)
    if (players.length === 2) return { ms, players, plan }
  }
  throw new Error('no such minute')
}

describe('the scene at a replay time (12.1)', () => {
  it('the worker is at its desk typing; a free body is where the live schedule puts it at that time', async () => {
    const { ms, players, plan } = minuteWithGame(['agent_3'], 'pingpong')
    const { stage } = await stageAt([pt(ms, { agent: 3 })])
    expect(stage.goals.agent_3).toMatchObject({ spot: 'work_3', pose: 'type' })
    for (const id of players) {
      expect(stage.goals[id].pose).toBe('pingpong')
      expect(stage.goals[id].spot).toBe(plan[id].spot)
      // a scene opened by a seek puts the body there at once
      expect(stage.sample(id).arrived).toBe(plan[id].spot)
    }
    // nobody is left "sitting at the desk reading the record" while the schedule has them play: every free body's goal is a schedule goal
    for (const id of AGENTS.filter((a) => a !== 'agent_3')) expect(stage.goals[id].label).not.toBe('자리에서 기록을 보는 중')
  })

  it('the same time is the same scene, whichever way it is opened', async () => {
    const { ms } = minuteWithGame(['agent_3'], 'boardgame')
    const points = [pt(ms - 40 * 86_400_000, { agent: 1 }), pt(ms, { agent: 3 })]
    const a = await stageAt(points, 1, 1)
    // the same point reached by playing from the day's first point and by a seek, at the other speeds
    const b = await stageAt(points, 16, 1)
    const c = await stageAt(points, 4, 1)
    const view = (s: Stage) => Object.fromEntries(AGENTS.map((id) => [id, [s.goals[id].spot, s.goals[id].pose, s.sample(id).x.toFixed(3), s.sample(id).z.toFixed(3)]]))
    expect(view(b.stage)).toEqual(view(a.stage))
    expect(view(c.stage)).toEqual(view(a.stage))
  })

  it('the night follows the real-time night rules at the replay time: asleep at the desks, one on duty', async () => {
    const t = kst(2, 30)
    const { stage } = await stageAt([pt(t, { agent: 3 })])
    const duty = nightDuty(AGENTS, t)
    for (const id of AGENTS.filter((a) => a !== 'agent_3')) {
      if (id === duty) expect(stage.goals[id]).toMatchObject({ quiet: true })
      else expect(stage.goals[id]).toMatchObject({ pose: 'doze', spot: `work_${id.split('_')[1]}` })
    }
    expect(stage.goals.agent_3).toMatchObject({ spot: 'work_3', pose: 'type' })
  })

  it('games in the replay are really played: the pair has a session on the replay time', () => {
    const { ms, players } = minuteWithGame(['agent_3'], 'pingpong')
    const s = sessionsAt(ms, AGENTS, new Set(['agent_3']))
    expect(s.map((x) => x.players.slice().sort())).toContainEqual(players.slice().sort())
  })
})

describe('walking and putting down (12.2)', () => {
  /** step the stage with real frames until `until` replay ms */
  const spend = (stage: Stage, until: number) => {
    let placed = 0
    for (let f = 0; stage.clock < until && f < 200_000; f++) {
      stage.frame(1000 / 60, until)
      placed += stage.takePlaced().length
    }
    return placed
  }
  // two points whose times have different games: the free bodies' schedule changes when the playhead moves from one to the other
  const pair = () => {
    const a = minuteWithGame(['agent_3'], 'pingpong').ms
    const b = minuteWithGame(['agent_3'], 'boardgame').ms
    return [pt(Math.min(a, b), { agent: 3 }), pt(Math.max(a, b), { agent: 3 })]
  }

  it('x1 and x4 walk a schedule change, x16 puts the bodies down at once', async () => {
    const out: Record<number, number> = {}
    for (const speed of [1, 16] as const) {
      const { store, stage } = await stageAt(pair(), speed)
      store.play()
      out[speed] = spend(stage, 6_000)
    }
    expect(out[1]).toBe(0)
    expect(out[16]).toBeGreaterThan(0)
  }, 120_000)
})

describe('the faces (12.4)', () => {
  const t = kst(14)
  it('a decision gladdens the decider for 2.5 s, an approved request makes its requester proud for 3 s, a deploy gladdens everyone', () => {
    expect(landingFaces(pt(t, { kind: 'decision', agent: 0 }))).toEqual([{ seat: 0, expr: 'joy', dur: 2.5 }])
    expect(landingFaces(pt(t, { kind: 'approval', agent: 2, result: true }))).toEqual([{ seat: 2, expr: 'proud', dur: 3 }])
    const d = landingFaces(pt(t, { kind: 'deploy', agent: null }))
    expect(d.map((c) => c.seat)).toEqual([0, 1, 2, 3, 4])
    expect(d.every((c) => c.expr === 'joy' && c.dur === 2.5)).toBe(true)
  })
  it('work, plan, a request and a minutes point start no event: their faces are the status\'s', () => {
    for (const kind of ['work', 'plan', 'minutes'] as const) expect(landingFaces(pt(t, { kind }))).toEqual([])
    expect(landingFaces(pt(t, { kind: 'approval', agent: 1 }))).toEqual([])
  })
  it('the sustained faces: work = focused, think = thinking, other = neutral, rest = neutral, nap and night = asleep, night duty = sleepy', () => {
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'edit' })).toBe('focused')
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'think' })).toBe('thinking')
    expect(baseExpression({ pose: 'type', state: 'working', activity: 'delegate' })).toBe('neutral')
    expect(baseExpression({ pose: 'coffee', state: 'idle', idleMs: 0 })).toBe('neutral')
    expect(baseExpression({ pose: 'pingpong', state: 'idle', idleMs: 0 })).toBe('neutral')
    expect(baseExpression({ pose: 'sofa', state: 'idle', idleMs: 0 })).toBe('asleep')
    expect(baseExpression({ pose: 'doze', state: 'off', night: 'sleep' })).toBe('asleep')
    expect(baseExpression({ pose: 'coffee', state: 'idle', night: 'duty', idleMs: 0 })).toBe('sleepy')
  })
  it('the expressions that are not the replay\'s are named, and a replay status never gives one', () => {
    expect([...NOT_IN_REPLAY].sort()).toEqual(['bored', 'greeting', 'question', 'yielding'])
    // every state of a whole day of the schedule, with the "idle for days" a record's status has, at replay's zero idle time
    const seen = new Set<Expression>()
    for (let h = 0; h < 24; h++)
      for (const w of [3, null] as const) {
        const s = sceneAt([pt(kst(h), { agent: w })], 0).status
        for (const st of Object.values(s))
          for (const pose of ['idle', 'type', 'pingpong', 'boardgame', 'coffee', 'sofa', 'doze', 'books', 'water'])
            seen.add(baseExpression({ pose, state: st.state, activity: st.activity, night: st.night, idleMs: 0, late: false }))
      }
    for (const e of NOT_IN_REPLAY) expect(seen.has(e)).toBe(false)
    expect(EXPRESSIONS.length).toBeGreaterThan(NOT_IN_REPLAY.length)
  })
  it('a live message or the owner connecting makes no face while replaying, and does live', () => {
    const talk: OfficeMessage = { id: '1', kind: 'talk', from: 'agent_1', to: 'agent_3', at: 0 }
    const busy = { agent_3: { state: 'working' as const, since: 0 } }
    expect(questionFaceFor(true, talk, busy)).toBeNull()
    expect(questionFaceFor(false, talk, busy)).toBe('agent_1')
    expect(questionFaceFor(false, talk, { agent_3: { state: 'idle', since: 0 } })).toBeNull()
    expect(greetsOwner(true, 'visitor', 'owner')).toBe(false)
    expect(greetsOwner(false, 'visitor', 'owner')).toBe(true)
  })
})

describe('a rig in the replay (#428): no wall clock, no live events', async () => {
  const { scene, nodes } = await loadOffice()
  const mk = (replayFace: boolean) => {
    const rig = new AgentRig('agent_2', 2, buildRig(scene, nodes, 2), '#ffffff')
    rig.replayFace = replayFace
    rig.setGoal({ spot: 'work_2', pose: 'idle', label: '' }, GRAPH)
    return rig
  }
  const run = (rig: AgentRig, status: Parameters<AgentRig['update']>[5], from: number, seconds: number, seen?: Set<Expression>) => {
    let t = from
    for (; t < from + seconds; t += 1 / 30) {
      rig.update(1 / 30, t, GRAPH, {}, false, status)
      seen?.add(rig.faceState().expr)
    }
    return t
  }
  beforeAll(() => void 0)

  it('a rest the record dates days ago does not freeze on bored; live it does', () => {
    const days = Date.now() - 3 * 86_400_000
    expect(Date.now() - days).toBeGreaterThan(BORED_AFTER_MS)
    const idle = { state: 'idle' as const, since: days }
    const replaying = new Set<Expression>()
    run(mk(true), idle, 0, 12, replaying)
    expect(replaying.has('bored')).toBe(false)
    const live = new Set<Expression>()
    run(mk(false), idle, 0, 12, live)
    expect(live.has('bored')).toBe(true)
  })

  it('coming to work and a prompt after a long idle fire no greeting / surprise in the replay', () => {
    const rig = mk(true)
    const seen = new Set<Expression>()
    let t = run(rig, { state: 'off', since: 0 }, 0, 1, seen)
    t = run(rig, { state: 'idle', since: 0 }, t, 3, seen)
    run(rig, { state: 'working', activity: 'edit', since: Date.now() }, t, 3, seen)
    expect(seen.has('greeting')).toBe(false)
    expect(seen.has('surprised')).toBe(false)
    expect(seen.has('focused')).toBe(true)
  })
})
