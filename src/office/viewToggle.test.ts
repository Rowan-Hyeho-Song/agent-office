import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pressViewToggle, registerTour, setTourAutoOff, setTourState, tour, tourAutoOff, viewAnnouncement, viewToggleModel } from './tourStore'

const fake = () => {
  const c = {
    start: vi.fn(() => setTourState({ active: true })),
    next: vi.fn(),
    prev: vi.fn(),
    // like TourRig.stopTour: the button reason sets the no-restart flag
    stop: vi.fn((why?: 'button' | 'input') => {
      if (why === 'button') setTourAutoOff(true)
      setTourState({ active: false })
    }),
  }
  registerTour(c)
  return c
}

afterEach(() => {
  registerTour(null)
  setTourState({ active: false, autoOff: false })
})

describe('view toggle label and icon (office-ui.md 10.6)', () => {
  it('touring: camera icon, names free view, not pressed', () => {
    expect(viewToggleModel({ active: true, autoOff: false })).toEqual({ icon: 'camera', label: '자유 시점으로 둘러보기', title: '자유 시점', pressed: false })
  })
  it('free view: cursor icon, names the tour, pressed', () => {
    const m = viewToggleModel({ active: false, autoOff: false })
    expect(m).toMatchObject({ icon: 'cursor', label: '둘러보기 시작', title: '둘러보기', pressed: true })
    expect(m.description).toBeUndefined()
  })
  it('free view with the tab flag: the title and description say why it does not start by itself', () => {
    const m = viewToggleModel({ active: false, autoOff: true })
    expect(m.title).toBe('둘러보기 시작 (이 탭에서는 자동 꺼 둠)')
    expect(m.description).toBe(m.title)
  })
  it('announcements', () => {
    expect(viewAnnouncement(true)).toBe('둘러보기 시작')
    expect(viewAnnouncement(false)).toBe('자유 시점')
  })
})

describe('pressing it', () => {
  it('during a tour: stops like the bar stop and the tab does not restart it', () => {
    const c = fake()
    setTourState({ active: true })
    pressViewToggle()
    expect(c.stop).toHaveBeenCalledWith('button')
    expect(c.start).not.toHaveBeenCalled()
    expect(tourAutoOff()).toBe(true)
    expect(viewToggleModel({ active: false, autoOff: tourAutoOff() }).icon).toBe('cursor')
  })
  it('in free view: starts the tour at once and clears the flag', () => {
    const c = fake()
    setTourAutoOff(true)
    pressViewToggle()
    expect(c.start).toHaveBeenCalledTimes(1)
    expect(tourAutoOff()).toBe(false)
    expect(viewToggleModel({ active: true, autoOff: false }).icon).toBe('camera')
  })
  it('an input-ended tour leaves no flag (the 45 s restart stays)', () => {
    fake()
    setTourState({ active: true })
    tour.stop('input')
    expect(tourAutoOff()).toBe(false)
  })
  it('can go off and on again in a row', () => {
    fake()
    setTourState({ active: true })
    pressViewToggle()
    pressViewToggle()
    pressViewToggle()
    expect(tourAutoOff()).toBe(true)
  })
})

describe('hidden during the timelapse', () => {
  it('the toggle lives in the dock, which the replay hides', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/body:has\(\.replay\) \.corner-dock[^{]*\{[^}]*visibility: hidden/)
    const dock = readFileSync(new URL('./CornerDock.tsx', import.meta.url), 'utf8')
    expect(dock).toContain("'sound', 'camera'")
  })
})
