import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pressViewToggle, registerTour, setTourState, tour, tourTick, viewAnnouncement, viewToggleModel } from './tourStore'

const fake = () => {
  const c = {
    start: vi.fn(() => setTourState({ active: true })),
    next: vi.fn(),
    prev: vi.fn(),
    stop: vi.fn(() => setTourState({ active: false })),
  }
  registerTour(c)
  return c
}

afterEach(() => {
  registerTour(null)
  setTourState({ active: false })
})

describe('view toggle label and icon (office-ui.md 10.6)', () => {
  it('touring: camera icon, names free view, not pressed', () => {
    expect(viewToggleModel({ active: true })).toEqual({ icon: 'camera', label: '자유 시점으로 둘러보기', title: '자유 시점', pressed: false })
  })
  it('free view: cursor icon, names the tour, pressed', () => {
    const m = viewToggleModel({ active: false })
    expect(m).toMatchObject({ icon: 'cursor', label: '둘러보기 시작', title: '둘러보기', pressed: true })
    expect(m.description).toBeUndefined()
  })
  it('announcements', () => {
    expect(viewAnnouncement(true)).toBe('둘러보기 시작')
    expect(viewAnnouncement(false)).toBe('자유 시점')
  })
})

describe('pressing it', () => {
  it('during a tour: stops like the bar stop', () => {
    const c = fake()
    setTourState({ active: true })
    pressViewToggle()
    expect(c.stop).toHaveBeenCalledTimes(1)
    expect(c.start).not.toHaveBeenCalled()
    expect(viewToggleModel({ active: false }).icon).toBe('cursor')
  })
  it('in free view: starts the tour at once', () => {
    const c = fake()
    pressViewToggle()
    expect(c.start).toHaveBeenCalledTimes(1)
    expect(viewToggleModel({ active: true }).icon).toBe('camera')
  })
  it('can go off and on again in a row', () => {
    const c = fake()
    setTourState({ active: true })
    pressViewToggle()
    pressViewToggle()
    pressViewToggle()
    expect(c.stop).toHaveBeenCalledTimes(2)
    expect(c.start).toHaveBeenCalledTimes(1)
  })
})

describe('the tour never starts by itself (#427)', () => {
  it('two minutes without any input: the 0.4 s clock never starts it; the view toggle and an agent name do', () => {
    const c = fake()
    // TourRig's clock: every 0.4 s it asks tourTick, which only stops a tour that has to give way
    for (let t = 0; t <= 120_000; t += 400) {
      const s = tourTick({ active: false, controls: true, busy: false, panel: false, panelBefore: false })
      expect(s).toBeNull()
      if (s) tour.stop(s)
    }
    expect(c.start).not.toHaveBeenCalled()
    // the dock's view toggle
    pressViewToggle()
    expect(c.start).toHaveBeenCalledTimes(1)
    setTourState({ active: false })
    // an agent's name in the list (AgentList: tour.start(agent))
    tour.start('agent_2')
    expect(c.start).toHaveBeenLastCalledWith('agent_2')
  })
  it('a running tour still gives way, and says why: no controls, the door animation, a side panel opening', () => {
    const s = { active: true, controls: true, busy: false, panel: false, panelBefore: false }
    expect(tourTick(s)).toBeNull()
    expect(tourTick({ ...s, controls: false })).toBe('controls')
    expect(tourTick({ ...s, busy: true })).toBe('door')
    expect(tourTick({ ...s, panel: true })).toBe('panel')
    expect(tourTick({ active: false, controls: false, busy: true, panel: true, panelBefore: false })).toBeNull()
  })
  it('#440: a panel that was open when the tour started does not end it; closing and opening it again does', () => {
    // 서재 open, then the view toggle: the clock ticks every 0.4 s and the panel stays open the whole time
    let before = true
    const tick = (panel: boolean) => {
      const r = tourTick({ active: true, controls: true, busy: false, panel, panelBefore: before })
      before = panel
      return r
    }
    for (let t = 0; t < 30_000; t += 400) expect(tick(true)).toBeNull()
    expect(tick(false)).toBeNull() // closed: nothing
    expect(tick(true)).toBe('panel') // opened during the tour: gives way
  })
  it('the bar, the toggle and the debug tools stop it with a reason (button unless told)', () => {
    const c = fake()
    tour.stop()
    expect(c.stop).toHaveBeenLastCalledWith('button')
    tour.stop('board')
    expect(c.stop).toHaveBeenLastCalledWith('board')
  })
  it('no idle wait left in the code that could start it', () => {
    const rig = readFileSync(new URL('./TourRig.tsx', import.meta.url), 'utf8')
    expect(rig).not.toMatch(/idleMs|lastInput|tourIdle/)
    const tourTs = readFileSync(new URL('./tour.ts', import.meta.url), 'utf8')
    expect(tourTs).not.toMatch(/idleMs/)
  })
})

describe('hidden during the timelapse', () => {
  it('the toggle lives in the dock, which the replay hides: its office bars and its 2D list (#444)', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/body:has\(\.replay, \.replay-list\) \.corner-dock[^{]*\{[^}]*visibility: hidden/)
    const dock = readFileSync(new URL('./CornerDock.tsx', import.meta.url), 'utf8')
    expect(dock).toContain("'sound', 'camera'")
  })
})
