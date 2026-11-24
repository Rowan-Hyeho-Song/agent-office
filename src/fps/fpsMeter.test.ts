import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fpsStats } from './fpsMeter'

describe('?fps readout (#693)', () => {
  it('counts the last second, averages the window and finds its longest frame', () => {
    // 10 s at 60 fps, with one 50 ms hitch near the end
    const times: number[] = []
    let t = 0
    for (let i = 0; i < 600; i++) times.push((t += i === 550 ? 50 : 1000 / 60))
    const s = fpsStats(times, t)
    expect(s.fps1).toBeGreaterThanOrEqual(58)
    expect(s.fps1).toBeLessThanOrEqual(60)
    expect(s.avg).toBeCloseTo(599 / ((t - times[0]) / 1000), 5)
    expect(s.worst).toBe(50)
  })

  it('reads zero before there are two frames', () => {
    expect(fpsStats([], 0)).toEqual({ fps1: 0, avg: 0, worst: 0 })
    expect(fpsStats([100], 100)).toEqual({ fps1: 1, avg: 0, worst: 0 })
  })

  it('is loaded only when the address has fps, as its own chunk', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
    expect(main).toMatch(/has\('fps'\)\)\s*void import\('\.\/fps\/fpsMeter'\)/)
    expect(main).not.toMatch(/^import .*fpsMeter/m)
  })
})
