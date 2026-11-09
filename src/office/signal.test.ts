import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COALESCE_MS, POLL_JOINED_MS, POLL_UNJOINED_MS, createSignalHub, tablesOf, type SignalTable, type SignalWire } from './signal'

// a stand-in for the tab: `document.hidden` and visibilitychange
function stubDocument() {
  const handlers = new Set<() => void>()
  const doc = {
    hidden: false,
    addEventListener: (_t: string, h: () => void) => void handlers.add(h),
    removeEventListener: (_t: string, h: () => void) => void handlers.delete(h),
  }
  vi.stubGlobal('document', doc)
  return { doc, handlers, show: () => { doc.hidden = false; handlers.forEach((h) => h()) } }
}

function fakeWire() {
  let message: (p: unknown) => void = () => {}
  let status: (j: boolean) => void = () => {}
  let change: (t: SignalTable) => void = () => {}
  const w = {
    joins: 0,
    leaves: 0,
    changeJoins: 0,
    changeLeaves: 0,
    broadcast: vi.fn((onMessage: (p: unknown) => void, s: (j: boolean) => void) => {
      w.joins++
      message = onMessage
      status = s
      return () => void w.leaves++
    }),
    changes: vi.fn((onChange: (t: SignalTable) => void) => {
      w.changeJoins++
      change = onChange
      return () => void w.changeLeaves++
    }),
    send: (p: unknown) => message(p),
    status: (j: boolean) => status(j),
    table: (t: SignalTable) => change(t),
  }
  return w satisfies SignalWire & Record<string, unknown>
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('what a message points at', () => {
  it('a known table re-reads that table only', () => {
    expect(tablesOf({ table: 'docs', at: 'x' })).toEqual(['docs'])
    expect(tablesOf({ table: 'approvals' })).toEqual(['approvals'])
  })
  it('anything else re-reads everything (the payload is never trusted)', () => {
    expect(tablesOf(null)).toEqual(['approvals', 'docs'])
    expect(tablesOf({ table: 'users', title: 'x' })).toEqual(['approvals', 'docs'])
    expect(tablesOf('docs')).toEqual(['approvals', 'docs'])
  })
})

describe('a signal re-reads', () => {
  it('only the lists of that table, once however many arrive together', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    const a = vi.fn()
    const d = vi.fn()
    hub.on('approvals', a)
    hub.on('docs', d)
    wire.status(true)
    vi.advanceTimersByTime(COALESCE_MS * 2) // joining caught up once; start counting from here
    a.mockClear()
    d.mockClear()
    wire.send({ table: 'approvals', at: 'now' })
    wire.send({ table: 'approvals', at: 'now' })
    vi.advanceTimersByTime(COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(d).not.toHaveBeenCalled()
  })
  it('receive() is the debug fakes\' way in', () => {
    stubDocument()
    const hub = createSignalHub(null)
    const d = vi.fn()
    hub.on('docs', d)
    hub.receive({ table: 'docs' })
    vi.advanceTimersByTime(COALESCE_MS + 1)
    expect(d).toHaveBeenCalledTimes(1)
  })
  it('the channel opens with the first listener and leaves with the last', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    expect(wire.joins).toBe(0)
    const off1 = hub.on('approvals', () => {})
    const off2 = hub.on('docs', () => {})
    expect(wire.joins).toBe(1)
    off1()
    expect(wire.leaves).toBe(0)
    off2()
    expect(wire.leaves).toBe(1)
  })
})

describe('the owner also hears the tables', () => {
  it('joins the change channel only while an owner is listening, and a change re-reads that table', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    const a = vi.fn()
    hub.on('approvals', a)
    hub.watchOwner(true)
    expect(wire.changeJoins).toBe(1)
    wire.status(true)
    vi.advanceTimersByTime(COALESCE_MS * 2)
    a.mockClear()
    wire.table('approvals')
    vi.advanceTimersByTime(COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
    hub.watchOwner(false)
    expect(wire.changeLeaves).toBe(1)
  })
  it('a visitor never joins it', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    hub.on('approvals', () => {})
    hub.watchOwner(false)
    expect(wire.changeJoins).toBe(0)
  })
  it('the broadcast and the table change together are one re-read', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    const a = vi.fn()
    hub.on('approvals', a)
    hub.watchOwner(true)
    wire.status(true)
    vi.advanceTimersByTime(COALESCE_MS * 2)
    a.mockClear()
    wire.send({ table: 'approvals' })
    wire.table('approvals')
    vi.advanceTimersByTime(COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
  })
})

describe('the polling fallback', () => {
  it('not joined: re-reads every 15 s', () => {
    stubDocument()
    const hub = createSignalHub(fakeWire())
    const a = vi.fn()
    hub.on('approvals', a)
    expect(hub.joined()).toBe(false)
    vi.advanceTimersByTime(POLL_UNJOINED_MS + COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(POLL_UNJOINED_MS)
    expect(a).toHaveBeenCalledTimes(2)
  })
  it('joined: only the slow 60 s poll, and joining catches up once', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    const a = vi.fn()
    hub.on('approvals', a)
    wire.status(true)
    expect(hub.joined()).toBe(true)
    vi.advanceTimersByTime(COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1) // what happened while it was down
    a.mockClear()
    vi.advanceTimersByTime(POLL_UNJOINED_MS * 3)
    expect(a).not.toHaveBeenCalled()
    vi.advanceTimersByTime(POLL_JOINED_MS)
    expect(a).toHaveBeenCalledTimes(1)
  })
  it('the channel failing later puts the 15 s poll back', () => {
    stubDocument()
    const wire = fakeWire()
    const hub = createSignalHub(wire)
    const a = vi.fn()
    hub.on('approvals', a)
    wire.status(true)
    vi.advanceTimersByTime(COALESCE_MS + 1)
    a.mockClear()
    wire.status(false)
    expect(hub.joined()).toBe(false)
    vi.advanceTimersByTime(POLL_UNJOINED_MS + COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
  })
  it('a hidden tab does not poll', () => {
    const { doc } = stubDocument()
    const hub = createSignalHub(fakeWire())
    const a = vi.fn()
    hub.on('approvals', a)
    doc.hidden = true
    vi.advanceTimersByTime(POLL_UNJOINED_MS * 4)
    expect(a).not.toHaveBeenCalled()
  })
  it('coming back to a visible tab re-reads at once', () => {
    const { doc, show } = stubDocument()
    const hub = createSignalHub(fakeWire())
    const a = vi.fn()
    const d = vi.fn()
    hub.on('approvals', a)
    hub.on('docs', d)
    doc.hidden = true
    show.call(null) // becomes visible
    vi.advanceTimersByTime(COALESCE_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(d).toHaveBeenCalledTimes(1)
  })
  it('stops everything when the last listener goes', () => {
    const { handlers } = stubDocument()
    const hub = createSignalHub(fakeWire())
    const a = vi.fn()
    const off = hub.on('approvals', a)
    expect(handlers.size).toBe(1)
    off()
    expect(handlers.size).toBe(0)
    vi.advanceTimersByTime(POLL_UNJOINED_MS * 3)
    expect(a).not.toHaveBeenCalled()
  })
})
