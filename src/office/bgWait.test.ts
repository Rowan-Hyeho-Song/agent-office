/// <reference types="node" />
// #535 (office-ui.md 3 · 4.2, typing.md 4 'background'): an agent waiting on background work it left running. It still works (no play, no wrap-up),
// types nothing with the hands off the keys (4 cm up, 20 cm apart), looks at the monitor now and then, and the monitor shows the wait; the coder's
// light stays yellow while a test or a build is still running.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { loadOffice, stubCanvas } from './glbLoad'
import { AgentRig, BG_WAIT, bgGlance, buildRig } from './rig'
import { Typist, WAIT_HANDS } from './typist'
import { CHUNK_S, makeChunk, modeOf } from './typingSchedule'
import { onInput, type InputEvent } from './inputEvents'
import { fitLabel, LABEL_PX, screenPlan, screenState, spinFrame, SPIN } from './screens'
import { deskProps } from './props'
import { activityLabel } from './status'

stubCanvas()
const BG = ['background', 'bg_test', 'bg_build', 'bg_delegate'] as const

describe('waiting on background work: the typing', () => {
  it('no key in a whole hour of chunks; now and then the wheel, never a click', () => {
    for (const a of BG) expect(modeOf(a)).toBe('wait')
    let wheels = 0
    for (let i = 0; i < 300; i++) {
      const c = makeChunk('agent_3', i, 'bg_test')
      expect(c.keys).toHaveLength(0)
      // the wheel only: no button pressed
      expect(c.mouse.filter((m) => m.kind === 'down')).toHaveLength(0)
      wheels += c.mouse.filter((m) => m.kind === 'wheel').length > 0 ? 1 : 0
    }
    // about one chunk in seven has the wheel: once in 60–120 s
    const every = (300 * CHUNK_S) / Math.max(1, wheels)
    expect(every).toBeGreaterThan(50)
    expect(every).toBeLessThan(140)
  })

  it('the hands off the keys: 4 cm over home, 20 cm apart; no key events', async () => {
    const { scene, nodes } = await loadOffice()
    scene.updateMatrixWorld(true)
    const rig = new AgentRig('agent_3', 3, buildRig(scene, nodes, 3), '#ffffff')
    const ty = new Typist(nodes)
    const at = (activity: string, t: number) => {
      rig.drive = { l: null, r: null }
      ty.step(rig, 3, { t, dt: 1 / 60, reduced: false, activity, dilation: 1, still: false, leftOnly: false, hasMouse: false })
      const p = (side: 'l' | 'r') => new Vector3().setFromMatrixPosition(rig.drive[side]!.target!)
      return { l: p('l'), r: p('r') }
    }
    const seen: InputEvent[] = []
    const off = onInput((e) => seen.push(e))
    // a quiet moment of a chunk: no key in hand, so the hands are at home
    const home = at('think', 0.1)
    const wait = at('bg_build', 0.1)
    for (let t = 0.1; t < 12; t += 1 / 30) at('bg_build', t)
    off()
    expect(seen.filter((e) => e.type === 'key')).toHaveLength(0)
    expect(wait.l.y - home.l.y).toBeCloseTo(WAIT_HANDS.up, 6)
    expect(wait.r.y - home.r.y).toBeCloseTo(WAIT_HANDS.up, 6)
    expect(Math.hypot(wait.l.x - wait.r.x, wait.l.z - wait.r.z)).toBeCloseTo(WAIT_HANDS.apart, 6)
  })
})

describe('waiting on background work: the head', () => {
  it('a look at the monitor every 20–40 s, 1.2 s each, the same for every visitor', () => {
    const starts: number[] = []
    let prev = 0
    for (let t = 0; t < 1800; t += 0.05) {
      const g = bgGlance('agent_3', t)
      expect(g).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThanOrEqual(1)
      if (g > 0 && prev === 0) starts.push(t)
      prev = g
    }
    const gaps = starts.slice(1).map((s, i) => s - starts[i])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(20 - 0.1)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(40 + 0.1)
    // 1.2 s long
    let on = 0
    for (let t = starts[3]; t < starts[3] + 3; t += 0.01) on += bgGlance('agent_3', t) > 0 ? 0.01 : 0
    expect(on).toBeCloseTo(BG_WAIT.lookS, 1)
    expect(bgGlance('agent_3', starts[2] + 0.6)).toBe(bgGlance('agent_3', starts[2] + 0.6))
  })
})

describe('waiting on background work: the monitor and the desk', () => {
  it('the wait screen: half the tint, the turning bar for the icon, the words not bold, the strip at half speed, m:ss', () => {
    for (const a of BG) {
      expect(screenState({ state: 'working', activity: a })).toBe('work')
      const plan = screenPlan('work', a)
      expect(plan).toEqual([
        { op: 'bg', tone: 'wait' },
        { op: 'head', tone: 'ink' },
        { op: 'spin' },
        { op: 'label', text: activityLabel(a), tone: 'text', light: true },
        { op: 'strip', tone: 'agent', half: true },
        { op: 'elapsed', short: true },
      ])
    }
    expect(screenPlan('work', 'test').some((o) => o.op === 'spin')).toBe(false)
    expect(activityLabel('bg_test')).toBe('테스트 결과 기다리는 중')
    expect(activityLabel('background')).toBe('백그라운드 작업 중')
  })
  it('the turning bar: | / – \\ a frame every 0.25 s; still in reduced motion', () => {
    expect([0, 0.25, 0.5, 0.75, 1].map((t) => SPIN[spinFrame(t, false)])).toEqual(['|', '/', '–', '\\', '|'])
    expect(spinFrame(0.6, true)).toBe(0)
  })
  it("the coder's light stays yellow while its test or build runs in the background", () => {
    const at = (activity: string) =>
      deskProps({ now: Date.parse('2026-11-15T10:00:00+09:00'), pending: 0, waitingSeats: [], decidedAt: null, handoffsToday: 0, status: { agent_3: { state: 'working', activity, since: 0, lastResult: { activity: 'test', ok: true, at: 0 } } } }).signal
    expect(at('bg_test')).toBe('yellow')
    expect(at('bg_build')).toBe('yellow')
    expect(at('bg_delegate')).toBe('green')
    expect(at('test')).toBe('yellow')
  })
})

describe('the activity words fit the monitor (#535 designer)', () => {
  // a stand-in font: each character px * 0.9 wide
  const measure = (text: string, px: number) => text.length * px * 0.9
  it('the largest size that fits on one line, down to 34 px', () => {
    expect(fitLabel('빌드 중', 400, measure)).toEqual({ px: 48, lines: ['빌드 중'] })
    // 8 characters: 48 px is 345.6, 40 px is 288 → 40 fits 300
    expect(fitLabel('백그라운드 작업', 300, measure)).toEqual({ px: 40, lines: ['백그라운드 작업'] })
  })
  it('two lines at 34 px when even 34 does not fit, split at the space nearest the middle', () => {
    expect(fitLabel('테스트 결과 기다리는 중', 240, measure)).toEqual({ px: 34, lines: ['테스트 결과', '기다리는 중'] })
    expect(fitLabel('아주긴한낱말로된문구입니다만', 100, measure)).toEqual({ px: 34, lines: ['아주긴한낱말로된문구입니다만'] })
    expect(LABEL_PX).toEqual({ max: 48, min: 34, step: 2 })
  })
})
