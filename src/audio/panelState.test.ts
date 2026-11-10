import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LEVELS, previewsOnRelease, closePanel, fromPct, getPanel, openPanel, outsideClosesPanel, placePopover, togglePanel, toPct, valueText, EDGE, PANEL_W, TAIL } from './panelState'
import { DEFAULT_SETTING, getSetting, resetLevels, setSetting } from './settings'
import { previewDue } from './cues'

describe('sound panel values (#353)', () => {
  it('maps 0..1 to 0..100 in 5 % steps and back', () => {
    expect(toPct(0.8)).toBe(80)
    expect(toPct(0.5)).toBe(50)
    expect(toPct(0.123)).toBe(10)
    expect(fromPct(50)).toBeCloseTo(0.5)
    expect(fromPct(52)).toBeCloseTo(0.5)
    expect(fromPct(100)).toBeCloseTo(1)
    expect(fromPct(-3)).toBe(0)
  })
  it('names, hints and aria-valuetext as designed', () => {
    expect(LEVELS.map((l) => [l.label, l.hint])).toEqual([
      ['전체', '모든 소리'],
      ['배경음악', '스피커 음악'],
      ['효과음', '말소리 · 타자 · 방 소리'],
    ])
    expect(valueText('배경음악', 0.5)).toBe('배경음악 50%')
    expect(valueText('전체', 0)).toBe('전체 0%')
  })
})

describe('the panel and the HUD share one setting', () => {
  beforeEach(() => setSetting({ ...DEFAULT_SETTING }))
  it('moving a slider unmutes (the panel sends muted:false)', () => {
    setSetting({ muted: true })
    setSetting({ music: fromPct(40), muted: false })
    expect(getSetting().muted).toBe(false)
    expect(getSetting().music).toBeCloseTo(0.4)
  })
  it('reset puts the three levels back and leaves mute alone', () => {
    setSetting({ volume: 0.3, music: 0.2, sfx: 0.1, muted: true })
    resetLevels()
    expect(getSetting()).toEqual({ muted: true, volume: 1, music: 1, sfx: 1 })
  })
  it('the preview click is rate-limited, so a drag does not chatter', () => {
    expect(previewDue(0, 100)).toBe(false)
    expect(previewDue(0, 150)).toBe(true)
  })
})

describe('open / close', () => {
  beforeEach(() => void closePanel())
  it('toggles on the same opener and moves between openers', () => {
    const back = {} as HTMLElement
    expect(togglePanel('turntable', back)).toBeNull()
    expect(getPanel()).toEqual({ open: true, from: 'turntable' })
    expect(togglePanel('turntable', back)).toBe(back) // the turntable again closes, focus goes back
    expect(getPanel().open).toBe(false)
    openPanel('turntable')
    togglePanel('hud')
    expect(getPanel()).toEqual({ open: true, from: 'hud' })
  })
  it('close hands back where it was opened from, once', () => {
    const btn = {} as HTMLElement
    openPanel('hud', btn)
    expect(closePanel()).toBe(btn)
    expect(closePanel()).toBeNull()
  })
  it('notifies subscribers', async () => {
    const { subscribePanel } = await import('./panelState')
    const f = vi.fn()
    const off = subscribePanel(f)
    openPanel('hud')
    closePanel()
    off()
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('an outside click closes, a camera drag, a click inside or on an opener does not', () => {
    expect(outsideClosesPanel(0, false, false)).toBe(true)
    expect(outsideClosesPanel(4, false, false)).toBe(true)
    expect(outsideClosesPanel(5, false, false)).toBe(false) // drag
    expect(outsideClosesPanel(0, true, false)).toBe(false)
    expect(outsideClosesPanel(0, false, true)).toBe(false)
  })
})

describe('popover placement', () => {
  const box = (cx: number, cy: number) => ({ left: cx - 30, right: cx + 30, top: cy - 20, bottom: cy + 20 })
  it('sits right of the target with a 10 px tail', () => {
    const p = placePopover(box(400, 300), 1280, 800, 200)
    expect(p.side).toBe('right')
    expect(p.x).toBe(430 + TAIL)
    expect(p.y).toBe(300 - 100)
    expect(p.tail).toBe(true)
  })
  it('flips left when it does not fit on the right', () => {
    const p = placePopover(box(1100, 300), 1280, 800, 200)
    expect(p.side).toBe('left')
    expect(p.x).toBe(1070 - TAIL - PANEL_W)
  })
  it('clamps 16 px inside the edge and hides the tail when the target is off screen', () => {
    const p = placePopover({ left: -500, right: -400, top: 900, bottom: 950 }, 1280, 800, 200)
    expect(p.x).toBeGreaterThanOrEqual(EDGE)
    expect(p.y).toBe(800 - EDGE - 200)
    expect(p.tail).toBe(false)
  })
  it('the HUD prefers the left of its button', () => {
    const p = placePopover({ left: 1200, right: 1234, top: 700, bottom: 734 }, 1280, 800, 200, 'left')
    expect(p.side).toBe('left')
    expect(p.x + PANEL_W).toBeLessThanOrEqual(1200 - TAIL)
  })
})

describe('preview on release', () => {
  it('전체 and 효과음 preview, 배경음악 does not', () => {
    expect(previewsOnRelease('volume')).toBe(true)
    expect(previewsOnRelease('sfx')).toBe(true)
    expect(previewsOnRelease('music')).toBe(false)
  })
})
