import { describe, expect, it, vi } from 'vitest'
import { FakePropsFeed } from './propsFeed'
import { FakeStatusSource } from './status'

describe('FakeStatusSource results (#44)', () => {
  it('setResult sets lastResult and notifies', () => {
    const src = new FakeStatusSource(['agent_3'], 0)
    const l = vi.fn()
    src.subscribe(l)
    const before = src.getSnapshot()
    src.setResult('agent_3', 'test', false)
    expect(l).toHaveBeenCalledTimes(1)
    expect(src.getSnapshot()).not.toBe(before)
    const s = src.getSnapshot().agent_3
    expect(s.state).toBe('idle')
    expect(s.lastResult).toMatchObject({ activity: 'test', ok: false })
    expect(typeof s.lastResult?.at).toBe('number')
  })

  it('a later set() keeps lastResult', () => {
    const src = new FakeStatusSource(['agent_3'], 0)
    src.setResult('agent_3', 'build', true)
    src.set('agent_3', 'working', 'edit')
    const s = src.getSnapshot().agent_3
    expect(s).toMatchObject({ state: 'working', activity: 'edit' })
    expect(s.lastResult).toMatchObject({ activity: 'build', ok: true })
  })

  it('set() without a result has no lastResult key', () => {
    const src = new FakeStatusSource(['agent_0'], 0)
    src.set('agent_0', 'working', 'edit')
    expect(src.getSnapshot().agent_0).not.toHaveProperty('lastResult')
  })
})

describe('FakePropsFeed', () => {
  it('starts empty', () => {
    expect(new FakePropsFeed().getSnapshot()).toEqual({ pending: 0, waitingSeats: [], decidedAt: null, handoffsToday: 0 })
  })

  it('set merges and notifies only on change', () => {
    const feed = new FakePropsFeed()
    const l = vi.fn()
    const off = feed.subscribe(l)
    feed.set({ pending: 3 })
    expect(l).toHaveBeenCalledTimes(1)
    expect(feed.getSnapshot()).toEqual({ pending: 3, waitingSeats: [], decidedAt: null, handoffsToday: 0 })
    feed.set({ handoffsToday: 2 })
    expect(feed.getSnapshot()).toEqual({ pending: 3, waitingSeats: [], decidedAt: null, handoffsToday: 2 })
    expect(l).toHaveBeenCalledTimes(2)
    feed.set({ pending: 3 })
    feed.set({ waitingSeats: [] })
    feed.set({})
    expect(l).toHaveBeenCalledTimes(2)
    feed.set({ waitingSeats: [0] })
    expect(l).toHaveBeenCalledTimes(3)
    off()
    feed.set({ pending: 4 })
    expect(l).toHaveBeenCalledTimes(3)
  })
})
