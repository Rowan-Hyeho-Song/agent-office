import { describe, expect, it } from 'vitest'
import { conversations, type DocMeta } from '../docs/library'
import type { Goal } from './director'
import { buildScript } from './meeting'
import { MeetingRunner } from './meetingRun'
import type { StatusMap } from './status'

const meta: DocMeta = { id: 7, kind: 'minutes', repo: 'o/r', folder: 28, title: 'T', agents: [], grade: 'public', approved: true, readable: true, created_at: '', updated_at: '' }
const convs = conversations({
  minutes: [{ date: null, rows: [{ order: 1, from: { seat: 2 }, to: [{ seat: 3 }], text: '하나.' }, { order: 2, from: { seat: 3 }, to: [{ seat: 2 }], text: '둘.' }], decision: '정했다.', followUp: '루프가 한다.' }],
})
const status = (over: Record<string, 'working' | 'idle' | 'off'> = {}): StatusMap =>
  Object.fromEntries([0, 1, 2, 3].map((i) => [`agent_${i}`, { state: over[`agent_${i}`] ?? 'idle', since: 0 }]))

/** step the runner like the scene: agents arrive wherever they are sent */
function run(r: MeetingRunner, until: () => boolean, at: Record<string, string | null> = {}) {
  const trail: Record<string, Goal>[] = []
  for (let now = 0; now < 120_000; now += 100) {
    const goals: Record<string, Goal> = {}
    r.apply(now, (a) => at[a] ?? null, goals)
    trail.push(goals)
    for (const [a, g] of Object.entries(goals)) at[a] = g.spot
    if (until()) break
  }
  return trail
}

describe('MeetingRunner', () => {
  it('gathers at meet spots, plays, pins the decision at the board, sends the follow-up to its seat, ends', () => {
    const r = new MeetingRunner()
    const events: string[] = []
    r.onDecisionPinned((d) => events.push(`pin:${d.text}`))
    r.onEnd(() => events.push('end'))
    expect(r.start(buildScript(meta, convs), 0, status())).toBe(true)
    const trail = run(r, () => !r.busy)
    const spots = (g: Record<string, Goal>) => Object.fromEntries(Object.entries(g).map(([a, x]) => [a, x.spot]))
    expect(spots(trail[0])).toEqual({ agent_2: 'meet_a', agent_3: 'meet_b' })
    expect(trail.some((g) => g.agent_2?.pose === 'talk' && g.agent_2.lookAt === 'agent_3')).toBe(true)
    expect(trail.some((g) => g.agent_0?.spot === 'whiteboard' && g.agent_0.pose === 'post')).toBe(true)
    expect(trail.some((g) => g.agent_3?.spot === 'work_3')).toBe(true)
    expect(events).toEqual(['pin:정했다.', 'end'])
  })
  it('shows no bubbles while gathering, then plays', () => {
    const r = new MeetingRunner()
    r.start(buildScript(meta, convs), 0, status())
    expect(r.view(0)).toBeNull()
    run(r, () => r.phase === 'lines')
    expect(r.phase).toBe('lines')
  })
  it('leaves working agents out of an idle replay, and drops a meeting nobody can attend', () => {
    const r = new MeetingRunner()
    expect(r.start(buildScript(meta, convs), 0, status({ agent_2: 'working' }), { skipWorking: true })).toBe(false)
    expect(r.start(buildScript(meta, convs), 0, status({ agent_2: 'off', agent_3: 'off' }))).toBe(false)
    expect(r.start(buildScript(meta, convs), 0, status({ agent_2: 'working' }))).toBe(true) // a new meeting calls everyone
  })
  it('queues a second meeting behind the first', () => {
    const r = new MeetingRunner()
    r.start(buildScript(meta, convs), 0, status())
    expect(r.start(buildScript({ ...meta, id: 8 }, convs), 0, status())).toBe(true)
    run(r, () => r.script?.id === '8')
    expect(r.script?.id).toBe('8')
  })
})
