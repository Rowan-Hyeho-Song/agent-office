// #137 ③ the visitor's paddle: the view (play.md 3.2, a tall screen fitted), who plays and who steps aside (3.1), what the HUD says, the store's flow.
import { describe, expect, it } from 'vitest'
import { DEFAULT_DIMS } from '../../play/pingpong'
import { startVisitorPP } from '../../play/visitorPingpong'
import { opponentAt, ppView, PP_VIEW } from './PingpongVisitRig'
import { ppStatus } from './PingpongVisitUi'
import {
  closePingpong, getPingpongVisit, openPingpong, pingpongArrived, pingpongLeft, resetPingpong, servePingpong, setPingpongReady, spacePingpong,
} from './store'

const O = { x: 1.6, y: 0.76, z: 0.7 }

describe('the view', () => {
  it('a wide screen: 2.2 m behind the near end line, 1.6 m up, the office field kept', () => {
    const v = ppView(O, 2.05, 0.25, 1.6, 32)
    expect(v.pos).toEqual([O.x - 2.05 / 2 - PP_VIEW.backM, PP_VIEW.heightM, O.z])
    expect(v.fov).toBeNull()
  })
  it('a phone: higher and wider, the paddle reach across fitted to the width', () => {
    const v = ppView(O, 2.05, 0.25, 390 / 844, 32)
    expect(v.fov).toBeGreaterThan(32)
    expect(v.fov).toBeLessThanOrEqual(PP_VIEW.maxFov)
    expect(v.pos[1]).toBeGreaterThan(PP_VIEW.heightM)
  })
})

describe('who plays the visitor', () => {
  const goals = (g: Record<string, string>) => Object.fromEntries(Object.entries(g).map(([a, spot]) => [a, { spot, pose: 'pingpong' }]))
  const all = () => true
  it('the far end player plays; the near end player steps aside', () => {
    const g = goals({ agent_1: 'pingpong_a', agent_3: 'pingpong_b' })
    expect(opponentAt(g, (a) => g[a].spot, all)).toEqual({ agent: 'agent_3', watcher: 'agent_1' })
  })
  it('one alone at either end plays; nobody there, or not yet arrived, or working: no tag', () => {
    const near = goals({ agent_1: 'pingpong_a' })
    expect(opponentAt(near, (a) => near[a].spot, all)).toEqual({ agent: 'agent_1', watcher: null })
    expect(opponentAt(near, () => null, all)).toBeNull()
    expect(opponentAt(near, (a) => near[a].spot, () => false)).toBeNull()
    expect(opponentAt({}, () => null, all)).toBeNull()
  })
})

describe('the HUD line', () => {
  it('serve, toss, rally, a point, the end; the agent still walking over', () => {
    const m = startVisitorPP('agent_3', 1)
    expect(ppStatus(m, '루프', false)).toBe('당신 서브 · 클릭 · Space')
    expect(ppStatus(m, '루프', true)).toBe('당신 서브 · 탭')
    expect(ppStatus({ ...m, easy: true }, '루프', false)).toBe('당신 서브 · Space')
    expect(ppStatus({ ...m, phase: 'toss' }, '루프', false)).toBe('루프 서브')
    expect(ppStatus({ ...m, decided: 1 }, '루프', false)).toBe('루프 득점')
    expect(ppStatus({ ...m, phase: 'over', score: [3, 1] }, '루프', false)).toBe('당신 승 · 3 : 1')
    expect(ppStatus({ ...m, phase: 'over', score: [2, 3] }, '루프', false)).toBe('루프 승 · 2 : 3')
    expect(ppStatus(m, '메시', false, false)).toBe('메시가 자리로 가는 중…')
    expect(ppStatus(m, '루프', false, false)).toBe('루프가 자리로 가는 중…')
    expect(ppStatus(m, '휴', false, false)).toBe('휴가 자리로 가는 중…')
  })
})

describe('the store', () => {
  it('opens flying, plays only once the agent is at its end, leaves flying back; reduced motion starts easy and slow', () => {
    resetPingpong()
    expect(openPingpong('agent_3', 'agent_1', 9, true, DEFAULT_DIMS)).toBe(true)
    expect(getPingpongVisit()).toMatchObject({ phase: 'flying', agent: 'agent_3', watcher: 'agent_1' })
    expect(getPingpongVisit().match).toMatchObject({ speed: 'slow', easy: true })
    pingpongArrived()
    expect(servePingpong()).toBe(false) // the agent is not at its end yet
    expect(spacePingpong()).toBe(false)
    setPingpongReady(true)
    expect(servePingpong()).toBe(true)
    expect(getPingpongVisit().match!.phase).toBe('flight')
    closePingpong()
    expect(getPingpongVisit().phase).toBe('leaving')
    pingpongLeft()
    expect(getPingpongVisit().phase).toBe('closed')
    expect(openPingpong('agent_3', null, 9)).toBe(true)
    expect(getPingpongVisit().match).toMatchObject({ speed: 'normal', easy: false })
    resetPingpong()
  })
})
