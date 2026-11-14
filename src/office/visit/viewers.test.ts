import { afterEach, describe, expect, it, vi } from 'vitest'
import { sharedPresence, viewersText, type PresenceChannel } from './viewers'

describe('the viewer count (#4 12.4)', () => {
  it('alone, several, and the short phone form', () => {
    expect(viewersText(1)).toBe('· 지금 혼자 보고 있어요')
    expect(viewersText(3)).toBe('· 지금 3명이 보고 있어요')
    expect(viewersText(0)).toBe('· 지금 혼자 보고 있어요') // this tab is always one
    expect(viewersText(12, true)).toBe('👁 12')
  })
})

describe('one presence channel per page (#452)', () => {
  afterEach(() => vi.useRealTimers())
  const fake = () => {
    const made: { close: number; n: number; fire: () => void }[] = []
    const make = (): PresenceChannel => {
      const c = { close: 0, n: 1, fire: () => {} }
      made.push(c)
      return {
        open(on) {
          c.fire = on
        },
        count: () => c.n,
        close: () => void c.close++,
      }
    }
    return { made, make }
  }

  it('a leave and a quick re-join (StrictMode, a re-render) keep the one channel; every presence event counts again', () => {
    vi.useFakeTimers()
    const f = fake()
    const wire = sharedPresence(f.make)
    const seen: number[] = []
    const leave = wire.join((n) => seen.push(n))
    leave()
    const leave2 = wire.join((n) => seen.push(n))
    vi.advanceTimersByTime(5000)
    expect(f.made).toHaveLength(1)
    expect(f.made[0].close).toBe(0)
    f.made[0].n = 2
    f.made[0].fire()
    f.made[0].n = 3
    f.made[0].fire()
    expect(seen.at(-1)).toBe(3)
    leave2()
    vi.advanceTimersByTime(999)
    expect(f.made[0].close).toBe(0)
    vi.advanceTimersByTime(1)
    expect(f.made[0].close).toBe(1)
  })

  it('a second listener on the page hears the count at once and shares the channel', () => {
    const f = fake()
    const wire = sharedPresence(f.make)
    wire.join(() => {})
    f.made[0].n = 4
    f.made[0].fire()
    let got = 0
    wire.join((n) => (got = n))
    expect(got).toBe(4)
    expect(f.made).toHaveLength(1)
  })
})
