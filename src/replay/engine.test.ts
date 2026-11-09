import { describe, expect, it } from 'vitest'
import type { Point } from '../timeline/types'
import officeFile from '../timeline/fixtures/agent-office.json'
import hubFile from '../timeline/fixtures/rowansong.dev.json'
import { ALL, approvalsAt, deployTitle, describe as describePoint, whoKind, daybreakMs, doorFor, flipText, indexAt, isDaybreak, issueRange, laneOf, layoutX, prepare, projectFrom, remainingMs, sceneAt, shelfAt, statusAt, stepMs, valueText, whenText } from './engine'

const OFFICE = 'Rowan-Hyeho-Song/agent-office'
const pt = (n: number, over: Partial<Point> = {}): Point => ({
  key: `k${n}`, project: OFFICE, at: `2026-11-07T0${n}:00:00Z`, kind: 'work', agent: 3, title: `t${n}`, secret: false,
  additions: 10, deletions: 2, files: 1, issue: null, pr: null, tier: 'public', ...over,
})
const real = [...(officeFile as { points: Point[] }).points, ...(hubFile as { points: Point[] }).points] as Point[]

describe('prepare / indexAt', () => {
  it('sorts by time then key and filters by project', () => {
    const all = prepare([pt(3), pt(1), pt(2, { project: 'o/other' })])
    expect(all.map((p) => p.key)).toEqual(['k1', 'k2', 'k3'])
    expect(prepare([pt(3), pt(2, { project: 'o/other' })], OFFICE).map((p) => p.key)).toEqual(['k3'])
  })
  it('finds the last point at or before t', () => {
    const ps = prepare([pt(1), pt(2), pt(3)])
    const t = (n: number) => Date.parse(`2026-11-07T0${n}:00:00Z`)
    expect(indexAt(ps, t(2))).toBe(1)
    expect(indexAt(ps, t(2) + 1000)).toBe(1)
    expect(indexAt(ps, t(1) - 1)).toBe(0)
    expect(indexAt(ps, t(9))).toBe(2)
    expect(indexAt([], 0)).toBe(-1)
  })
  it('reads a project from an address', () => {
    expect(projectFrom('agent-office', [OFFICE])).toBe(OFFICE)
    expect(projectFrom(OFFICE, [OFFICE])).toBe(OFFICE)
    expect(projectFrom('nope', [OFFICE])).toBe(ALL)
    expect(projectFrom(null, [OFFICE])).toBe(ALL)
  })
})

describe('lanes and timing', () => {
  it('puts the owner results on the owner lane, no agent on the last lane', () => {
    expect(laneOf(pt(1, { kind: 'approval', result: true }))).toBe('o')
    expect(laneOf(pt(1, { kind: 'approval' }))).toBe(3)
    expect(laneOf(pt(1, { agent: null }))).toBe('n')
    expect(laneOf(pt(1, { kind: 'deploy', agent: null }))).toBe('n')
  })
  it('lays out by order with a gap at a day change', () => {
    const ps = [pt(1), pt(2), pt(3, { at: '2026-11-08T05:00:00Z' })]
    const l = layoutX(ps, 100, 8)
    expect(l.xs[1] - l.xs[0]).toBeCloseTo(l.step)
    expect(l.xs[2] - l.xs[1]).toBeCloseTo(l.step + 10)
  })
  it('takes 3 s a point at x1, 4.5 s for minutes, and a 1 s flip over a day gap', () => {
    expect(stepMs(pt(1), 1)).toBe(3000)
    expect(stepMs(pt(1, { kind: 'minutes' }), 1)).toBe(4500)
    expect(stepMs(pt(1), 4)).toBe(750)
    const a = pt(1, { at: '2026-11-07T10:00:00Z' })
    const b = pt(2, { at: '2026-11-08T10:00:00Z' })
    const c = pt(3, { at: '2026-11-07T15:30:00Z' }) // 00:30 KST next day, only 5.5 h later
    expect(isDaybreak(a, b)).toBe(true)
    expect(isDaybreak(a, c)).toBe(false)
    expect(remainingMs([a, b], 0, 1)).toBe(3000 + 1000 + 3000)
    expect(daybreakMs(4)).toBe(250)
  })
  it('flips a date character by character', () => {
    expect(flipText('2026.11.07', '2026.11.08', 0)).toBe('2026.11.07')
    expect(flipText('2026.11.07', '2026.11.08', 1)).toBe('2026.11.08')
  })
  it('writes Seoul time', () => {
    expect(whenText(Date.parse('2026-11-07T16:51:00Z'))).toBe('2026.11.08 일 01:51')
  })
})

describe('the office at a point', () => {
  const plan = pt(1, { kind: 'plan', agent: 0, issue: 5, title: '기획 5' })
  const work = pt(2, { kind: 'work', agent: 3, issue: 5, pr: 9, title: '작업 5' })
  const ask = pt(3, { kind: 'approval', agent: 0, issue: 6, title: '결재 요청: x' })
  const ok = pt(4, { kind: 'approval', agent: 0, issue: 6, title: '결재: x', result: true })
  const ps = prepare([plan, work, ask, ok])
  it('folds the board, the shelf and the approvals up to the point', () => {
    const s0 = sceneAt(ps, 0)
    expect(s0.board.doing.map((c) => c.n)).toEqual([5])
    expect(s0.layout.binders.map((b) => b.label)).toEqual(['#5'])
    expect(sceneAt(ps, 1).board.done.map((c) => c.n)).toEqual([5])
    expect(sceneAt(ps, 2).pending).toBe(1)
    expect(sceneAt(ps, 2).waitingSeats).toEqual([0])
    expect(sceneAt(ps, 3).pending).toBe(0)
    expect(sceneAt(ps, 3).stamped).toBe(true)
  })
  it('puts the point agent to work, the others at rest; a result puts nobody to work', () => {
    const w = statusAt(work)
    expect(w.agent_3).toMatchObject({ state: 'working', activity: 'edit' })
    expect(w.agent_0.state).toBe('idle')
    expect(Object.values(statusAt(ok)).every((s) => s.state === 'idle')).toBe(true)
    expect(statusAt(pt(1, { secret: true, title: '' })).agent_3.activity).toBe('private')
    // five agents (#193): echo is on the map and can be the one working
    expect(Object.keys(w)).toEqual(['agent_0', 'agent_1', 'agent_2', 'agent_3', 'agent_4'])
    expect(statusAt(pt(1, { agent: 4 })).agent_4).toMatchObject({ state: 'working', activity: 'edit' })
    expect(statusAt(pt(1, { agent: 4 })).agent_3.state).toBe('idle')
    expect(Object.values(statusAt(pt(1, { kind: 'deploy', agent: null }))).every((s) => s.state === 'idle')).toBe(true)
  })
  it('is a pure function of (points, index): the way there does not matter', () => {
    const forward = ps.map((_, i) => JSON.stringify(sceneAt(ps, i)))
    const backward = [...ps.keys()].reverse().map((i) => JSON.stringify(sceneAt(ps, i))).reverse()
    expect(backward).toEqual(forward)
    const a = JSON.stringify(sceneAt(ps, 2))
    sceneAt(ps, 0)
    sceneAt(ps, 3)
    expect(JSON.stringify(sceneAt(ps, 2))).toBe(a)
  })
  it('is deterministic over the real fixtures too: the same point twice gives the same scene', () => {
    const ps2 = prepare(real)
    for (const i of [0, 17, 80, 150, ps2.length - 1]) {
      const a = JSON.stringify(sceneAt(ps2, i))
      sceneAt(ps2, (i + 40) % ps2.length)
      expect(JSON.stringify(sceneAt(ps2, i))).toBe(a)
      // and the time of that point leads back to a scene at or after the same moment
      expect(Date.parse(ps2[indexAt(ps2, Date.parse(ps2[i].at))].at)).toBe(Date.parse(ps2[i].at))
    }
  })
  it('counts approvals with the same timestamp by index, not by time', () => {
    const a = pt(1, { kind: 'approval', agent: 1, issue: 7 })
    const b = pt(1, { key: 'k1b', kind: 'approval', agent: 1, issue: 7, result: true })
    const both = prepare([a, b])
    expect(approvalsAt(both, 0).pending).toBe(1)
    expect(approvalsAt(both, 1).pending).toBe(0)
  })
  it('never makes a card or binder out of a SECRET point', () => {
    const s = sceneAt(prepare([pt(1, { secret: true, title: '', tier: 'review', kind: 'plan', agent: 1 })]), 0)
    expect(s.board.doing).toEqual([])
    expect(shelfAt([pt(1, { secret: true, issue: 3 })], 0).binders).toEqual([])
  })
})

describe('a deploy is not "before roles"', () => {
  const dep = pt(1, { kind: 'deploy', agent: null, title: 'Merge pull request #106 from Rowan-Hyeho-Song/dev', additions: null, deletions: null, files: null })
  it('is named ▲ 배포 with no agent, in the subtitle, the tag, the list and the slider text', () => {
    const d = describePoint(dep)
    expect(d.head).toBe('▲ 배포')
    expect(d.kind).toBe('')
    expect(whoKind(dep)).toBe('▲ 배포')
    expect(`${d.head} ${d.title}`).not.toContain('역할 분담 이전')
    expect(valueText([dep], 0)).not.toContain('역할 분담 이전')
    expect(valueText([dep], 0)).toContain('▲ 배포')
  })
  it('reads as #PR · dev → main, without the repository path', () => {
    expect(describePoint(dep).title).toBe('#106 · dev → main')
    expect(deployTitle(pt(1, { kind: 'deploy', title: 'Deploy', pr: 7 }))).toBe('#7 · dev → main')
    expect(deployTitle(pt(1, { kind: 'deploy', title: 'Deploy', pr: null }))).toBe('dev → main')
  })
  it('a commit before roles still reads as 역할 분담 이전', () => {
    expect(describePoint(pt(1, { agent: null })).who).toBe('역할 분담 이전')
  })
})

describe('door, issue range, words', () => {
  it('marks a deploy and types the terminal line of a point before roles', () => {
    expect(doorFor(pt(1, { kind: 'deploy', agent: null }))).toEqual({ kind: 'deploy', text: 'DEPLOYED ▲ main' })
    expect(doorFor(pt(1, { kind: 'deploy', agent: null, project: 'o/rowansong.dev' }))?.text).toBe('ROWAN/OS 배포')
    expect(doorFor(pt(1, { agent: null, additions: 4440, deletions: 0, files: 36, title: '' }))?.text).toBe('> commit · +4440 −0 · 파일 36')
    expect(doorFor(pt(1))).toBeNull()
  })
  it('finds the points of one issue, never of a SECRET project', () => {
    const ps = prepare([pt(1, { issue: 5 }), pt(2), pt(3, { issue: 5 }), pt(4, { issue: 6 })])
    expect(issueRange(ps, OFFICE, 5)).toEqual({ lo: 0, hi: 2 })
    expect(issueRange(ps, OFFICE, 99)).toBeNull()
    expect(issueRange(prepare(real), 'Rowan-Hyeho-Song/rowansong.dev', 1)).toBeNull()
  })
  it('hides the title of a SECRET point in every sentence', () => {
    expect(valueText([pt(1, { secret: true, title: '' })], 0)).toContain('결재 전이라 제목을 가렸어요')
  })
  it('the fixtures carry result on approvals and every SECRET point is opaque', () => {
    expect(real.some((p) => p.kind === 'approval' && p.result === true)).toBe(true)
    for (const p of real.filter((x) => x.secret)) expect([p.title, p.issue, p.pr]).toEqual(['', null, null])
    expect(real.every((p) => (p.result === undefined ? true : p.kind === 'approval' && p.result === true))).toBe(true)
  })
})
